import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { permissionsOf } from '@sos/core';
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import { config } from '../config.js';
import { systemDb, withTenant } from '../db/client.js';
import { authChallenges, companies, passkeys, policies, policyConsents, sessions, userRoles, users } from '../db/schema/index.js';
import { AppError, badRequest, forbidden, unauthorized } from '../lib/errors.js';
import { sha256Hex, randomToken } from '../lib/crypto.js';
import { clearSessionCookies, setSessionCookies } from '../http/plugins.js';
import { noStore, tenantOf, userOf } from '../http/context.js';
import type { App } from '../http/types.js';
import {
  createSession,
  encryptTotp,
  hashPassword,
  ipLoginFailures,
  loadAuthUser,
  newRecoveryCodes,
  newTotpSecret,
  passwordProblems,
  recordLoginAttempt,
  revokeAllSessions,
  revokeSession,
  totpUri,
  verifyPassword,
  verifyTotp,
} from '../services/auth.js';
import { audit, auditSystem } from '../services/audit.js';
import { getPublished } from '../services/settings.js';

const LOCK_THRESHOLD = 5;
let dummy: string | null = null;
const dummyHash = async () => (dummy ??= await hashPassword(randomToken(16)));
const LOCK_MINUTES = 15;

/** The authenticated user even if MFA has not been completed yet (used by MFA endpoints only). */
function sessionUser(req: Parameters<typeof userOf>[0]) {
  if (!req.ctx.user || !req.ctx.session) throw unauthorized();
  return req.ctx.user;
}

function rpId(host: string) {
  return host;
}
function expectedOrigin(req: { ctx: { proto: string }; headers: Record<string, unknown> }) {
  const origin = req.headers.origin as string | undefined;
  return origin ?? `${req.ctx.proto}://${req.headers['x-forwarded-host'] ?? req.headers.host}`;
}

export async function authRoutes(app: App) {
  app.get('/auth/me', async (req, reply) => {
    noStore(reply);
    const u = req.ctx.user;
    const s = req.ctx.session;
    return {
      platform: req.ctx.platform,
      tenant: req.ctx.tenant ? { id: req.ctx.tenant.id, slug: req.ctx.tenant.slug, name: req.ctx.tenant.name, isDemo: req.ctx.tenant.isDemo } : null,
      user: u
        ? {
            id: u.id,
            email: u.email,
            name: u.name,
            roles: u.roles,
            audience: u.audience,
            companyId: u.companyId,
            mfaEnabled: u.mfaEnabled,
            mfaPending: (u.mfaEnabled || u.isSuperAdmin) && !s?.mfaVerified,
            mfaSetupRequired: u.isSuperAdmin && !u.mfaEnabled,
            impersonating: !!s?.impersonatorId,
          }
        : null,
      csrfToken: s?.csrfToken ?? null,
      permissions: u ? permissionsOf(u.roles) : [],
      features: req.ctx.features ? [...req.ctx.features] : [],
    };
  });

  app.post(
    '/auth/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { body: z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) }) },
    },
    async (req, reply) => {
      noStore(reply);
      const { email, password } = req.body;
      const tenantId = req.ctx.platform ? null : tenantOf(req).id;
      if ((await ipLoginFailures(req.ip)) >= 30) throw new AppError(429, 'TOO_MANY_ATTEMPTS', '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.');
      const [u] = await systemDb
        .select()
        .from(users)
        .where(and(tenantId ? eq(users.tenantId, tenantId) : isNull(users.tenantId), eq(users.email, email.toLowerCase())))
        .limit(1);
      const fail = async (reason: string) => {
        await recordLoginAttempt(tenantId, email, req.ip, false, reason);
        throw new AppError(401, 'INVALID_CREDENTIALS', '이메일 또는 비밀번호가 올바르지 않습니다.');
      };
      if (!u || u.status !== 'ACTIVE') {
        await verifyPassword(await dummyHash(), password); // timing equalisation: same work as a real check
        return fail('no_user');
      }
      if (req.ctx.platform && !u.isSuperAdmin) return fail('not_platform');
      if (u.lockedUntil && u.lockedUntil > new Date()) {
        await recordLoginAttempt(tenantId, email, req.ip, false, 'locked');
        throw new AppError(423, 'ACCOUNT_LOCKED', `로그인 실패가 반복되어 계정이 잠겼습니다. ${LOCK_MINUTES}분 후 다시 시도해 주세요.`);
      }
      if (!(await verifyPassword(u.passwordHash, password))) {
        const count = u.failedLoginCount + 1;
        await systemDb
          .update(users)
          .set({ failedLoginCount: count, lockedUntil: count >= LOCK_THRESHOLD ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null })
          .where(eq(users.id, u.id));
        return fail('bad_password');
      }
      await systemDb.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, u.id));
      await recordLoginAttempt(tenantId, email, req.ip, true);
      const needsMfa = u.mfaEnabled || u.isSuperAdmin;
      const s = await createSession({ userId: u.id, tenantId, mfaVerified: !needsMfa, ip: req.ip, userAgent: req.ctx.userAgent, stepUp: !needsMfa });
      setSessionCookies(reply, s.token, s.csrfToken);
      if (tenantId) await withTenant({ tenantId, userId: u.id }, (tx) => audit(tx, req, { action: 'auth.login', entityType: 'user', entityId: u.id }));
      else await auditSystem(req, { action: 'auth.login', entityType: 'user', entityId: u.id });
      return { ok: true, mfaRequired: u.mfaEnabled, mfaSetupRequired: u.isSuperAdmin && !u.mfaEnabled, csrfToken: s.csrfToken };
    },
  );

  app.post(
    '/auth/signup',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        body: z.object({
          name: z.string().min(1).max(80),
          email: z.string().email().max(200),
          password: z.string().min(1).max(200),
          companyName: z.string().min(1).max(120),
          phone: z.string().max(40).default(''),
          agreePolicies: z.literal(true),
        }),
      },
    },
    async (req, reply) => {
      noStore(reply);
      const tenant = tenantOf(req);
      const b = req.body;
      const problems = passwordProblems(b.password, b.email);
      if (problems.length) throw badRequest(problems[0]!, { problems });
      const [exists] = await systemDb.select({ id: users.id }).from(users).where(and(eq(users.tenantId, tenant.id), eq(users.email, b.email.toLowerCase()))).limit(1);
      if (exists) throw new AppError(409, 'EMAIL_TAKEN', '이미 가입된 이메일입니다. 로그인해 주세요.');
      const passwordHash = await hashPassword(b.password);
      const result = await withTenant({ tenantId: tenant.id }, async (tx) => {
        const [c] = await tx.insert(companies).values({ tenantId: tenant.id, name: b.companyName }).returning({ id: companies.id });
        const [u] = await tx
          .insert(users)
          .values({ tenantId: tenant.id, email: b.email.toLowerCase(), name: b.name, phone: b.phone, passwordHash, companyId: c!.id })
          .returning({ id: users.id });
        await tx.insert(userRoles).values({ tenantId: tenant.id, userId: u!.id, role: 'CUSTOMER_ADMIN' });
        await tx.update(companies).set({ ownerUserId: u!.id }).where(eq(companies.id, c!.id));
        // Record consent to the currently published policies (version-pinned).
        const pubs = await tx.select().from(policies).where(and(eq(policies.tenantId, tenant.id), eq(policies.status, 'PUBLISHED')));
        for (const p of pubs.filter((x) => ['PRIVACY', 'TERMS', 'SOURCING_TERMS'].includes(x.type))) {
          await tx.insert(policyConsents).values({ tenantId: tenant.id, userId: u!.id, policyId: p.id, policyType: p.type, policyVersion: p.version, ip: req.ip, userAgent: req.ctx.userAgent });
        }
        await audit(tx, req, { action: 'auth.signup', entityType: 'user', entityId: u!.id, after: { email: b.email, company: b.companyName } });
        return { userId: u!.id, companyId: c!.id };
      });
      const s = await createSession({ userId: result.userId, tenantId: tenant.id, mfaVerified: true, ip: req.ip, userAgent: req.ctx.userAgent });
      setSessionCookies(reply, s.token, s.csrfToken);
      return { ok: true, csrfToken: s.csrfToken };
    },
  );

  app.post('/auth/logout', async (req, reply) => {
    if (req.ctx.session) await revokeSession(req.ctx.session.id);
    clearSessionCookies(reply);
    return { ok: true };
  });

  // ─── MFA (TOTP) ───
  app.post('/auth/mfa/setup', async (req, reply) => {
    noStore(reply);
    const u = sessionUser(req);
    const [row] = await systemDb.select().from(users).where(eq(users.id, u.id)).limit(1);
    if (row?.mfaEnabled) throw badRequest('이미 2단계 인증이 켜져 있습니다.');
    const secret = newTotpSecret();
    await systemDb.update(users).set({ mfaSecretEnc: encryptTotp(secret) }).where(eq(users.id, u.id));
    let issuer = config.WEBAUTHN_RP_NAME;
    if (req.ctx.tenant) issuer = (await withTenant({ tenantId: req.ctx.tenant.id }, (tx) => getPublished(tx, req.ctx.tenant!.id, 'brand'))).siteName;
    return { secret, otpauthUri: totpUri(u.email, issuer, secret) };
  });

  app.post('/auth/mfa/enable', { schema: { body: z.object({ code: z.string().min(6).max(10) }) } }, async (req, reply) => {
    noStore(reply);
    const u = sessionUser(req);
    const [row] = await systemDb.select().from(users).where(eq(users.id, u.id)).limit(1);
    if (!row?.mfaSecretEnc || !verifyTotp(row.mfaSecretEnc, req.body.code)) throw badRequest('인증 코드가 올바르지 않습니다.');
    const rc = newRecoveryCodes();
    await systemDb.update(users).set({ mfaEnabled: true, mfaRecoveryHashes: rc.hashes }).where(eq(users.id, u.id));
    await systemDb.update(sessions).set({ mfaVerified: true, stepUpAt: new Date() }).where(eq(sessions.id, req.ctx.session!.id));
    await revokeAllSessions(u.id, req.ctx.session!.id);
    await auditSystem(req, { action: 'auth.mfa.enabled', entityType: 'user', entityId: u.id, tenantId: u.tenantId });
    return { ok: true, recoveryCodes: rc.codes };
  });

  app.post('/auth/mfa/verify', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { body: z.object({ code: z.string().min(6).max(20) }) } }, async (req) => {
    const u = sessionUser(req);
    const [row] = await systemDb.select().from(users).where(eq(users.id, u.id)).limit(1);
    if (!row?.mfaEnabled) throw badRequest('2단계 인증이 설정되지 않았습니다.');
    let ok = verifyTotp(row.mfaSecretEnc, req.body.code);
    if (!ok) {
      const h = sha256Hex(req.body.code.trim().toUpperCase());
      if (row.mfaRecoveryHashes.includes(h)) {
        ok = true;
        await systemDb.update(users).set({ mfaRecoveryHashes: row.mfaRecoveryHashes.filter((x) => x !== h) }).where(eq(users.id, u.id));
      }
    }
    if (!ok) throw new AppError(401, 'INVALID_CODE', '인증 코드가 올바르지 않습니다.');
    await systemDb.update(sessions).set({ mfaVerified: true, stepUpAt: new Date() }).where(eq(sessions.id, req.ctx.session!.id));
    return { ok: true };
  });

  app.post('/auth/mfa/disable', { schema: { body: z.object({ password: z.string(), code: z.string() }) } }, async (req) => {
    const u = userOf(req);
    if (u.isSuperAdmin) throw forbidden('슈퍼 관리자는 2단계 인증을 끌 수 없습니다.');
    const [row] = await systemDb.select().from(users).where(eq(users.id, u.id)).limit(1);
    if (!row || !(await verifyPassword(row.passwordHash, req.body.password)) || !verifyTotp(row.mfaSecretEnc, req.body.code)) throw badRequest('확인 정보가 올바르지 않습니다.');
    await systemDb.update(users).set({ mfaEnabled: false, mfaSecretEnc: null, mfaRecoveryHashes: [] }).where(eq(users.id, u.id));
    await auditSystem(req, { action: 'auth.mfa.disabled', entityType: 'user', entityId: u.id, tenantId: u.tenantId });
    return { ok: true };
  });

  /** Step-up authentication for sensitive changes (bank, API keys, margins). */
  app.post('/auth/step-up', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { body: z.object({ password: z.string().optional(), code: z.string().optional() }) } }, async (req) => {
    const u = userOf(req);
    const [row] = await systemDb.select().from(users).where(eq(users.id, u.id)).limit(1);
    if (!row) throw unauthorized();
    const ok = row.mfaEnabled ? !!req.body.code && verifyTotp(row.mfaSecretEnc, req.body.code) : !!req.body.password && (await verifyPassword(row.passwordHash, req.body.password));
    if (!ok) throw new AppError(401, 'STEP_UP_FAILED', row.mfaEnabled ? '인증 코드가 올바르지 않습니다.' : '비밀번호가 올바르지 않습니다.');
    await systemDb.update(sessions).set({ stepUpAt: new Date() }).where(eq(sessions.id, req.ctx.session!.id));
    return { ok: true, method: row.mfaEnabled ? 'TOTP' : 'PASSWORD', validMinutes: config.STEP_UP_MINUTES };
  });

  app.post('/auth/password', { schema: { body: z.object({ currentPassword: z.string(), newPassword: z.string().max(200) }) } }, async (req) => {
    const u = userOf(req);
    const [row] = await systemDb.select().from(users).where(eq(users.id, u.id)).limit(1);
    if (!row || !(await verifyPassword(row.passwordHash, req.body.currentPassword))) throw badRequest('현재 비밀번호가 올바르지 않습니다.');
    const problems = passwordProblems(req.body.newPassword, u.email);
    if (problems.length) throw badRequest(problems[0]!);
    await systemDb.update(users).set({ passwordHash: await hashPassword(req.body.newPassword) }).where(eq(users.id, u.id));
    await revokeAllSessions(u.id, req.ctx.session!.id);
    await auditSystem(req, { action: 'auth.password.changed', entityType: 'user', entityId: u.id, tenantId: u.tenantId });
    return { ok: true };
  });

  // ─── Device / session management ───
  app.get('/auth/sessions', async (req) => {
    const u = userOf(req);
    const rows = await systemDb
      .select({ id: sessions.id, deviceLabel: sessions.deviceLabel, ip: sessions.ip, lastSeenAt: sessions.lastSeenAt, createdAt: sessions.createdAt })
      .from(sessions)
      .where(and(eq(sessions.userId, u.id), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
      .orderBy(desc(sessions.lastSeenAt));
    return { items: rows.map((r) => ({ ...r, current: r.id === req.ctx.session!.id })) };
  });

  app.delete('/auth/sessions/:id', { schema: { params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const u = userOf(req);
    await systemDb.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.id, req.params.id), eq(sessions.userId, u.id)));
    return { ok: true };
  });

  // ─── Invitations (staff / partners) ───
  app.post('/auth/invite/accept', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { body: z.object({ token: z.string().min(10), password: z.string().max(200), name: z.string().max(80).optional() }) } }, async (req, reply) => {
    const tenant = tenantOf(req);
    const [ch] = await systemDb
      .select()
      .from(authChallenges)
      .where(and(eq(authChallenges.challenge, sha256Hex(req.body.token)), eq(authChallenges.purpose, 'INVITE'), eq(authChallenges.tenantId, tenant.id), isNull(authChallenges.usedAt), gt(authChallenges.expiresAt, new Date())))
      .limit(1);
    if (!ch?.userId) throw badRequest('초대 링크가 만료되었거나 올바르지 않습니다.');
    const [u] = await systemDb.select().from(users).where(eq(users.id, ch.userId)).limit(1);
    if (!u) throw badRequest('초대 정보를 찾을 수 없습니다.');
    const problems = passwordProblems(req.body.password, u.email);
    if (problems.length) throw badRequest(problems[0]!);
    await systemDb
      .update(users)
      .set({ passwordHash: await hashPassword(req.body.password), status: 'ACTIVE', emailVerifiedAt: new Date(), ...(req.body.name ? { name: req.body.name } : {}) })
      .where(eq(users.id, u.id));
    await systemDb.update(authChallenges).set({ usedAt: new Date() }).where(eq(authChallenges.id, ch.id));
    const s = await createSession({ userId: u.id, tenantId: tenant.id, mfaVerified: true, ip: req.ip, userAgent: req.ctx.userAgent });
    setSessionCookies(reply, s.token, s.csrfToken);
    return { ok: true, csrfToken: s.csrfToken };
  });

  // ─── Passkeys (WebAuthn) ───
  app.post('/auth/passkeys/register/options', async (req) => {
    const u = userOf(req);
    const existing = await systemDb.select().from(passkeys).where(eq(passkeys.userId, u.id));
    const options = await generateRegistrationOptions({
      rpName: config.WEBAUTHN_RP_NAME,
      rpID: rpId(req.ctx.host),
      userName: u.email,
      userDisplayName: u.name || u.email,
      attestationType: 'none',
      excludeCredentials: existing.map((p) => ({ id: p.credentialId })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });
    await systemDb.insert(authChallenges).values({ tenantId: u.tenantId, userId: u.id, purpose: 'PASSKEY_REGISTER', challenge: options.challenge, expiresAt: new Date(Date.now() + 5 * 60_000) });
    return options;
  });

  app.post('/auth/passkeys/register/verify', { schema: { body: z.object({ response: z.any(), label: z.string().max(60).default('') }) } }, async (req) => {
    const u = userOf(req);
    const [ch] = await systemDb
      .select()
      .from(authChallenges)
      .where(and(eq(authChallenges.userId, u.id), eq(authChallenges.purpose, 'PASSKEY_REGISTER'), isNull(authChallenges.usedAt), gt(authChallenges.expiresAt, new Date())))
      .orderBy(desc(authChallenges.createdAt))
      .limit(1);
    if (!ch) throw badRequest('등록 요청이 만료되었습니다.');
    const v = await verifyRegistrationResponse({ response: req.body.response, expectedChallenge: ch.challenge, expectedOrigin: expectedOrigin(req), expectedRPID: rpId(req.ctx.host) });
    if (!v.verified || !v.registrationInfo) throw badRequest('패스키 등록에 실패했습니다.');
    const cred = v.registrationInfo.credential;
    await systemDb.insert(passkeys).values({
      tenantId: u.tenantId,
      userId: u.id,
      credentialId: cred.id,
      publicKey: Buffer.from(cred.publicKey).toString('base64url'),
      counter: cred.counter,
      transports: cred.transports ?? [],
      label: req.body.label,
    });
    await systemDb.update(authChallenges).set({ usedAt: new Date() }).where(eq(authChallenges.id, ch.id));
    await auditSystem(req, { action: 'auth.passkey.added', entityType: 'user', entityId: u.id, tenantId: u.tenantId });
    return { ok: true };
  });

  app.get('/auth/passkeys', async (req) => {
    const u = userOf(req);
    const rows = await systemDb.select({ id: passkeys.id, label: passkeys.label, createdAt: passkeys.createdAt, lastUsedAt: passkeys.lastUsedAt }).from(passkeys).where(eq(passkeys.userId, u.id));
    return { items: rows };
  });

  app.delete('/auth/passkeys/:id', { schema: { params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const u = userOf(req);
    await systemDb.delete(passkeys).where(and(eq(passkeys.id, req.params.id), eq(passkeys.userId, u.id)));
    await auditSystem(req, { action: 'auth.passkey.removed', entityType: 'user', entityId: u.id, tenantId: u.tenantId });
    return { ok: true };
  });

  app.post('/auth/passkeys/login/options', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const tenantId = req.ctx.platform ? null : tenantOf(req).id;
    const options = await generateAuthenticationOptions({ rpID: rpId(req.ctx.host), userVerification: 'preferred' });
    const handle = randomToken(16);
    await systemDb.insert(authChallenges).values({ tenantId, purpose: 'PASSKEY_LOGIN', challenge: `${handle}:${options.challenge}`, expiresAt: new Date(Date.now() + 5 * 60_000) });
    return { ...options, handle };
  });

  app.post('/auth/passkeys/login/verify', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { body: z.object({ handle: z.string(), response: z.any() }) } }, async (req, reply) => {
    const tenantId = req.ctx.platform ? null : tenantOf(req).id;
    const rows = await systemDb
      .select()
      .from(authChallenges)
      .where(and(eq(authChallenges.purpose, 'PASSKEY_LOGIN'), isNull(authChallenges.usedAt), gt(authChallenges.expiresAt, new Date())))
      .orderBy(desc(authChallenges.createdAt))
      .limit(200);
    const ch = rows.find((r) => r.challenge.startsWith(`${req.body.handle}:`) && r.tenantId === tenantId);
    if (!ch) throw badRequest('로그인 요청이 만료되었습니다.');
    const credId = (req.body.response as { id?: string })?.id;
    const [pk] = credId ? await systemDb.select().from(passkeys).where(eq(passkeys.credentialId, credId)).limit(1) : [];
    if (!pk || pk.tenantId !== tenantId) throw new AppError(401, 'INVALID_PASSKEY', '등록되지 않은 패스키입니다.');
    const v = await verifyAuthenticationResponse({
      response: req.body.response,
      expectedChallenge: ch.challenge.split(':')[1]!,
      expectedOrigin: expectedOrigin(req),
      expectedRPID: rpId(req.ctx.host),
      credential: { id: pk.credentialId, publicKey: Buffer.from(pk.publicKey, 'base64url'), counter: pk.counter, transports: pk.transports as never },
    });
    if (!v.verified) throw new AppError(401, 'INVALID_PASSKEY', '패스키 인증에 실패했습니다.');
    await systemDb.update(passkeys).set({ counter: v.authenticationInfo.newCounter, lastUsedAt: new Date() }).where(eq(passkeys.id, pk.id));
    await systemDb.update(authChallenges).set({ usedAt: new Date() }).where(eq(authChallenges.id, ch.id));
    const user = await loadAuthUser(pk.userId);
    if (!user) throw unauthorized();
    // A passkey with user verification satisfies MFA.
    const s = await createSession({ userId: pk.userId, tenantId, mfaVerified: true, ip: req.ip, userAgent: req.ctx.userAgent, stepUp: true });
    setSessionCookies(reply, s.token, s.csrfToken);
    await auditSystem(req, { action: 'auth.login.passkey', entityType: 'user', entityId: pk.userId, tenantId });
    return { ok: true, csrfToken: s.csrfToken };
  });

}
