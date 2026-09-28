import { hash, verify } from '@node-rs/argon2';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { authenticator } from 'otplib';
import { audienceOf, type Role } from '@sos/core';
import { config } from '../config.js';
import { systemDb } from '../db/client.js';
import { loginAttempts, sessions, userRoles, users } from '../db/schema/index.js';
import { decrypt, encrypt, randomToken, sha256Hex } from '../lib/crypto.js';
import type { AuthUser, SessionInfo } from '../http/context.js';

// Argon2id, OWASP-recommended parameters.
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export const hashPassword = (password: string) => hash(password, ARGON);
export async function verifyPassword(hashValue: string | null, password: string): Promise<boolean> {
  if (!hashValue) return false;
  try {
    return await verify(hashValue, password);
  } catch {
    return false;
  }
}

/** Minimal password policy: length + not trivially weak. */
export function passwordProblems(password: string, email?: string): string[] {
  const p: string[] = [];
  if (password.length < 10) p.push('비밀번호는 10자 이상이어야 합니다.');
  if (password.length > 200) p.push('비밀번호가 너무 깁니다.');
  if (email && password.toLowerCase().includes(email.split('@')[0]!.toLowerCase())) p.push('이메일과 비슷한 비밀번호는 사용할 수 없습니다.');
  if (/^(.)\1+$/.test(password) || /^(0123456789|1234567890|password|qwerty)/i.test(password)) p.push('너무 단순한 비밀번호입니다.');
  return p;
}

authenticator.options = { window: 1 };

export function newTotpSecret(): string {
  return authenticator.generateSecret();
}
export function totpUri(email: string, issuer: string, secret: string): string {
  return authenticator.keyuri(email, issuer, secret);
}
export function verifyTotp(secretEnc: string | null, code: string): boolean {
  if (!secretEnc) return false;
  try {
    return authenticator.verify({ token: code.replace(/\s/g, ''), secret: decrypt(secretEnc) });
  } catch {
    return false;
  }
}
export const encryptTotp = (secret: string) => encrypt(secret);

export function newRecoveryCodes(): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: 8 }, () => randomToken(6).replace(/[-_]/g, 'x').slice(0, 10).toUpperCase());
  return { codes, hashes: codes.map((c) => sha256Hex(c)) };
}

export async function loadAuthUser(userId: string): Promise<AuthUser | null> {
  const [u] = await systemDb.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u || u.status !== 'ACTIVE') return null;
  const roles = (await systemDb.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, u.id))).map((r) => r.role as Role);
  if (u.isSuperAdmin && !roles.includes('SUPER_ADMIN')) roles.push('SUPER_ADMIN');
  return {
    id: u.id,
    tenantId: u.tenantId,
    email: u.email,
    name: u.name,
    roles,
    audience: audienceOf(roles),
    companyId: u.companyId,
    isSuperAdmin: u.isSuperAdmin,
    mfaEnabled: u.mfaEnabled,
    expertTypes: u.expertTypes,
  };
}

export interface CreatedSession {
  token: string;
  csrfToken: string;
  sessionId: string;
}

export async function createSession(p: { userId: string; tenantId: string | null; mfaVerified: boolean; ip: string; userAgent: string; impersonatorId?: string | null; stepUp?: boolean }): Promise<CreatedSession> {
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const now = Date.now();
  const [s] = await systemDb
    .insert(sessions)
    .values({
      userId: p.userId,
      tenantId: p.tenantId,
      tokenHash: sha256Hex(token),
      csrfToken,
      mfaVerified: p.mfaVerified,
      stepUpAt: p.stepUp ? new Date() : null,
      impersonatorId: p.impersonatorId ?? null,
      ip: p.ip,
      userAgent: p.userAgent.slice(0, 500),
      deviceLabel: deviceLabel(p.userAgent),
      expiresAt: new Date(now + (p.impersonatorId ? 1 : config.SESSION_TTL_HOURS) * 3_600_000),
      idleExpiresAt: new Date(now + config.SESSION_IDLE_HOURS * 3_600_000),
    })
    .returning({ id: sessions.id });
  return { token, csrfToken, sessionId: s!.id };
}

function deviceLabel(ua: string): string {
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '기타';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : '브라우저';
  return `${br} · ${os}`;
}

export interface ValidatedSession {
  session: SessionInfo;
  userId: string;
  tenantId: string | null;
  /** When set, the cookie must be replaced with this token (refresh rotation). */
  rotatedToken?: string;
}

/**
 * Validates the session token. Tokens rotate every SESSION_ROTATE_MINUTES;
 * the previous token stays valid for a 60s grace window to tolerate concurrent requests.
 */
export async function validateSession(token: string, ip: string): Promise<ValidatedSession | null> {
  const h = sha256Hex(token);
  const now = new Date();
  const [s] = await systemDb
    .select()
    .from(sessions)
    .where(and(or(eq(sessions.tokenHash, h), and(eq(sessions.previousTokenHash, h), gt(sessions.rotatedAt, new Date(now.getTime() - 60_000)))), isNull(sessions.revokedAt), gt(sessions.expiresAt, now), gt(sessions.idleExpiresAt, now)))
    .limit(1);
  if (!s) return null;
  let rotatedToken: string | undefined;
  const patch: Partial<typeof sessions.$inferInsert> = {
    lastSeenAt: now,
    idleExpiresAt: new Date(now.getTime() + config.SESSION_IDLE_HOURS * 3_600_000),
  };
  if (s.tokenHash === h && now.getTime() - s.rotatedAt.getTime() > config.SESSION_ROTATE_MINUTES * 60_000) {
    rotatedToken = randomToken(32);
    patch.previousTokenHash = s.tokenHash;
    patch.tokenHash = sha256Hex(rotatedToken);
    patch.rotatedAt = now;
  }
  if (ip && ip !== s.ip) patch.ip = ip;
  // Throttle writes: only touch the row when rotating or once a minute.
  if (rotatedToken || now.getTime() - s.lastSeenAt.getTime() > 60_000) {
    await systemDb.update(sessions).set(patch).where(eq(sessions.id, s.id));
  }
  return {
    session: { id: s.id, csrfToken: s.csrfToken, mfaVerified: s.mfaVerified, stepUpAt: s.stepUpAt, impersonatorId: s.impersonatorId },
    userId: s.userId,
    tenantId: s.tenantId,
    ...(rotatedToken ? { rotatedToken } : {}),
  };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await systemDb.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string): Promise<void> {
  await systemDb
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), exceptSessionId ? sql`${sessions.id} <> ${exceptSessionId}` : sql`true`));
}

export async function recordLoginAttempt(tenantId: string | null, email: string, ip: string, success: boolean, reason = ''): Promise<void> {
  await systemDb.insert(loginAttempts).values({ tenantId, email: email.toLowerCase(), ip, success, reason });
}

/** Too many failures from one IP in 15 minutes → throttle (in addition to per-account lockout). */
export async function ipLoginFailures(ip: string): Promise<number> {
  const [r] = await systemDb
    .select({ n: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.ip, ip), eq(loginAttempts.success, false), gt(loginAttempts.createdAt, new Date(Date.now() - 15 * 60_000))));
  return r?.n ?? 0;
}
