import { and, desc, eq, gt, gte, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { FEATURE_MODULES, PLAN_LIMIT_KEYS } from '@sos/core';
import { config } from '../config.js';
import { systemDb } from '../db/client.js';
import { aiUsage, apiConnections, auditLogs, authChallenges, emails, featureFlags, files, jobs, plans, searchEvents, sessions, subscriptions, tenantDomains, tenants, userRoles, users } from '../db/schema/index.js';
import { randomToken, sha256Hex } from '../lib/crypto.js';
import { AppError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { setSessionCookies } from '../http/plugins.js';
import { tenantOf, userOf } from '../http/context.js';
import type { App } from '../http/types.js';
import { auditSystem } from '../services/audit.js';
import { createSession } from '../services/auth.js';
import { createTenant } from '../services/tenant-bootstrap.js';
import { invalidateFeatures, invalidateHostCache } from '../services/tenancy.js';
import { systemHealth } from './health.js';

/** Super admin (platform console). Only reachable on the platform host with an MFA-verified SUPER_ADMIN session. */
function superAdmin(req: Parameters<typeof userOf>[0]) {
  if (!req.ctx.platform) throw notFound();
  const u = userOf(req);
  if (!u.isSuperAdmin) throw forbidden();
  return u;
}

const limitSchema = z.record(z.enum(PLAN_LIMIT_KEYS), z.object({ value: z.number().int().min(-1), hard: z.boolean() }));

export async function platformRoutes(app: App) {
  app.get('/platform/dashboard', async (req) => {
    superAdmin(req);
    const since30 = new Date(Date.now() - 30 * 86_400_000);
    const [t] = await systemDb.select({ total: sql<number>`count(*)::int`, active: sql<number>`count(*) filter (where status='ACTIVE')::int`, suspended: sql<number>`count(*) filter (where status='SUSPENDED')::int` }).from(tenants);
    const [au] = await systemDb.select({ n: sql<number>`count(distinct ${sessions.userId})::int` }).from(sessions).where(gt(sessions.lastSeenAt, since30));
    const revenue = await systemDb.select({ plan: plans.code, price: plans.priceMonthly, n: sql<number>`count(*)::int` }).from(subscriptions).innerJoin(plans, eq(plans.id, subscriptions.planId)).where(eq(subscriptions.status, 'ACTIVE')).groupBy(plans.code, plans.priceMonthly);
    const [ai] = await systemDb.select({ calls: sql<number>`count(*)::int`, failures: sql<number>`count(*) filter (where not ${aiUsage.success})::int`, tokens: sql<number>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens}),0)::int` }).from(aiUsage).where(gte(aiUsage.createdAt, since30));
    const [apiErr] = await systemDb.select({ n: sql<number>`count(*)::int` }).from(apiConnections).where(and(eq(apiConnections.enabled, true), eq(apiConnections.status, 'ERROR')));
    const [storage] = await systemDb.select({ bytes: sql<number>`coalesce(sum(${files.sizeBytes}),0)::bigint` }).from(files);
    const jobCounts = await systemDb.select({ status: jobs.status, n: sql<number>`count(*)::int` }).from(jobs).groupBy(jobs.status);
    const mail = await systemDb.select({ status: emails.status, n: sql<number>`count(*)::int` }).from(emails).where(gte(emails.createdAt, since30)).groupBy(emails.status);
    const [searches] = await systemDb.select({ n: sql<number>`count(*)::int` }).from(searchEvents).where(gte(searchEvents.createdAt, since30));
    const topTenants = await systemDb.select({ tenantId: searchEvents.tenantId, n: sql<number>`count(*)::int` }).from(searchEvents).where(gte(searchEvents.createdAt, since30)).groupBy(searchEvents.tenantId).orderBy(desc(sql`count(*)`)).limit(5);
    const health = await systemHealth();
    return {
      tenants: t,
      activeUsers30d: au?.n ?? 0,
      monthlyRecurringRevenue: revenue.reduce((a, r) => a + Number(r.price ?? 0) * r.n, 0),
      revenueByPlan: revenue,
      ai30d: ai,
      apiErrors: apiErr?.n ?? 0,
      storageBytes: Number(storage?.bytes ?? 0),
      jobs: jobCounts,
      email30d: mail,
      searches30d: searches?.n ?? 0,
      topTenantsBySearch: topTenants,
      incidents: Object.entries(health.components).filter(([, c]) => c.status === 'DOWN' || c.status === 'DEGRADED').map(([k, c]) => ({ component: k, status: c.status })),
      health,
    };
  });

  app.get('/platform/tenants', async (req) => {
    superAdmin(req);
    const rows = await systemDb.select({ t: tenants, planCode: plans.code, subscriptionId: subscriptions.id }).from(tenants).leftJoin(subscriptions, eq(subscriptions.tenantId, tenants.id)).leftJoin(plans, eq(plans.id, subscriptions.planId)).orderBy(desc(tenants.createdAt));
    const userCounts = await systemDb.select({ tenantId: users.tenantId, n: sql<number>`count(*)::int` }).from(users).groupBy(users.tenantId);
    const domains = await systemDb.select().from(tenantDomains).where(eq(tenantDomains.isPrimary, true));
    return { items: rows.map((r) => ({ ...r.t, plan: r.planCode, users: userCounts.find((u) => u.tenantId === r.t.id)?.n ?? 0, primaryDomain: domains.find((d) => d.tenantId === r.t.id)?.hostname ?? null })) };
  });

  app.post('/platform/tenants', { schema: { body: z.object({ name: z.string().min(1).max(120), slug: z.string().min(3).max(32), planCode: z.string().default('BUSINESS'), ownerEmail: z.string().email(), ownerName: z.string().max(80).default('대표 관리자') }) } }, async (req, reply) => {
    superAdmin(req);
    const r = await createTenant({ name: req.body.name, slug: req.body.slug, planCode: req.body.planCode, owner: { email: req.body.ownerEmail, name: req.body.ownerName, password: null } });
    await auditSystem(req, { action: 'platform.tenant.created', entityType: 'tenant', entityId: r.tenantId, tenantId: r.tenantId, after: req.body });
    const port = new URL(config.PUBLIC_WEB_URL).port;
    reply.status(201);
    return { tenantId: r.tenantId, inviteLink: `${new URL(config.PUBLIC_WEB_URL).protocol}//${req.body.slug}.${config.PLATFORM_BASE_DOMAIN}${port ? `:${port}` : ''}/invite?token=${r.inviteToken}` };
  });

  app.patch('/platform/tenants/:id', { schema: { params: z.object({ id: z.string().uuid() }), body: z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']).optional(), name: z.string().min(1).max(120).optional(), planCode: z.string().optional(), limitOverrides: limitSchema.optional(), featureOverrides: z.record(z.enum(FEATURE_MODULES), z.boolean()).optional() }) } }, async (req) => {
    superAdmin(req);
    const [t] = await systemDb.select().from(tenants).where(eq(tenants.id, req.params.id)).limit(1);
    if (!t) throw notFound();
    const b = req.body;
    if (b.status || b.name) await systemDb.update(tenants).set({ ...(b.status ? { status: b.status } : {}), ...(b.name ? { name: b.name } : {}), updatedAt: new Date() }).where(eq(tenants.id, t.id));
    if (b.planCode || b.limitOverrides || b.featureOverrides) {
      const [plan] = b.planCode ? await systemDb.select().from(plans).where(eq(plans.code, b.planCode)).limit(1) : [];
      if (b.planCode && !plan) throw badRequest('알 수 없는 요금제입니다.');
      const [sub] = await systemDb.select().from(subscriptions).where(eq(subscriptions.tenantId, t.id)).limit(1);
      if (sub) await systemDb.update(subscriptions).set({ ...(plan ? { planId: plan.id } : {}), ...(b.limitOverrides ? { limitOverrides: b.limitOverrides } : {}), ...(b.featureOverrides ? { featureOverrides: b.featureOverrides } : {}), updatedAt: new Date() }).where(eq(subscriptions.id, sub.id));
      else if (plan) await systemDb.insert(subscriptions).values({ tenantId: t.id, planId: plan.id, limitOverrides: b.limitOverrides ?? {}, featureOverrides: b.featureOverrides ?? {} });
    }
    if (b.status === 'SUSPENDED') await systemDb.execute(sql`update sessions set revoked_at = now() where tenant_id = ${t.id} and revoked_at is null`);
    await invalidateFeatures(t.id);
    const domains = await systemDb.select().from(tenantDomains).where(eq(tenantDomains.tenantId, t.id));
    for (const d of domains) await invalidateHostCache(d.hostname);
    await auditSystem(req, { action: 'platform.tenant.updated', entityType: 'tenant', entityId: t.id, tenantId: t.id, before: { status: t.status, name: t.name }, after: b });
    return { ok: true };
  });

  app.put('/platform/tenants/:id/feature-flags', { schema: { params: z.object({ id: z.string().uuid() }), body: z.object({ flags: z.record(z.enum(FEATURE_MODULES), z.boolean().nullable()) }) } }, async (req) => {
    const u = superAdmin(req);
    for (const [module, enabled] of Object.entries(req.body.flags)) {
      if (enabled === null) await systemDb.delete(featureFlags).where(and(eq(featureFlags.tenantId, req.params.id), eq(featureFlags.module, module)));
      else await systemDb.insert(featureFlags).values({ tenantId: req.params.id, module, enabled, updatedBy: u.id }).onConflictDoUpdate({ target: [featureFlags.tenantId, featureFlags.module], set: { enabled, updatedBy: u.id, updatedAt: new Date() } });
    }
    await invalidateFeatures(req.params.id);
    await auditSystem(req, { action: 'platform.feature_flags.updated', entityType: 'tenant', entityId: req.params.id, tenantId: req.params.id, after: req.body.flags });
    return { ok: true };
  });

  app.get('/platform/plans', async (req) => {
    superAdmin(req);
    return { items: await systemDb.select().from(plans).orderBy(plans.code), modules: FEATURE_MODULES, limitKeys: PLAN_LIMIT_KEYS };
  });

  app.post('/platform/plans', { schema: { body: z.object({ code: z.string().regex(/^[A-Z0-9_]{2,30}$/), name: z.string().min(1).max(60), description: z.string().max(300).default(''), features: z.array(z.enum(FEATURE_MODULES)), limits: limitSchema, priceMonthly: z.string().regex(/^\d+$/).nullable().default(null), active: z.boolean().default(true) }) } }, async (req) => {
    superAdmin(req);
    const [p] = await systemDb.insert(plans).values(req.body).onConflictDoUpdate({ target: plans.code, set: { ...req.body, updatedAt: new Date() } }).returning();
    const subs = await systemDb.select({ tenantId: subscriptions.tenantId }).from(subscriptions).where(eq(subscriptions.planId, p!.id));
    for (const s of subs) await invalidateFeatures(s.tenantId);
    await auditSystem(req, { action: 'platform.plan.saved', entityType: 'plan', entityId: p!.id, after: req.body });
    return p;
  });

  /**
   * Support impersonation. Requires a written reason, creates a 1-hour session
   * flagged with impersonator_id (visible banner in UI), and is audited on both
   * the platform and the tenant audit trail.
   */
  app.post('/platform/tenants/:id/impersonate', { schema: { params: z.object({ id: z.string().uuid() }), body: z.object({ userId: z.string().uuid().optional(), reason: z.string().min(10).max(500) }) } }, async (req) => {
    const admin = superAdmin(req);
    const [t] = await systemDb.select().from(tenants).where(eq(tenants.id, req.params.id)).limit(1);
    if (!t) throw notFound();
    let targetId = req.body.userId;
    if (!targetId) {
      const [owner] = await systemDb.select({ id: userRoles.userId }).from(userRoles).where(and(eq(userRoles.tenantId, t.id), eq(userRoles.role, 'TENANT_OWNER'))).limit(1);
      targetId = owner?.id;
    }
    if (!targetId) throw badRequest('대상 사용자가 없습니다.');
    const [target] = await systemDb.select().from(users).where(and(eq(users.id, targetId), eq(users.tenantId, t.id))).limit(1);
    if (!target) throw notFound();
    const token = randomToken(24);
    await systemDb.insert(authChallenges).values({ tenantId: t.id, userId: target.id, purpose: `IMPERSONATE:${admin.id}`, challenge: sha256Hex(token), expiresAt: new Date(Date.now() + 60_000) });
    await auditSystem(req, { action: 'platform.impersonation.started', entityType: 'user', entityId: target.id, tenantId: t.id, after: { reason: req.body.reason, targetEmail: target.email, impersonator: admin.email } });
    const port = new URL(config.PUBLIC_WEB_URL).port;
    return { url: `${new URL(config.PUBLIC_WEB_URL).protocol}//${t.slug}.${config.PLATFORM_BASE_DOMAIN}${port ? `:${port}` : ''}/api/v1/auth/impersonate/consume?token=${token}`, expiresInSeconds: 60 };
  });

  app.get('/auth/impersonate/consume', { schema: { querystring: z.object({ token: z.string().min(10) }) } }, async (req, reply) => {
    const tenant = tenantOf(req);
    const [ch] = await systemDb
      .select()
      .from(authChallenges)
      .where(and(eq(authChallenges.challenge, sha256Hex(req.query.token)), eq(authChallenges.tenantId, tenant.id), isNull(authChallenges.usedAt), gt(authChallenges.expiresAt, new Date())))
      .limit(1);
    if (!ch?.userId || !ch.purpose.startsWith('IMPERSONATE:')) throw new AppError(400, 'INVALID_TOKEN', '만료되었거나 올바르지 않은 링크입니다.');
    await systemDb.update(authChallenges).set({ usedAt: new Date() }).where(eq(authChallenges.id, ch.id));
    const impersonatorId = ch.purpose.split(':')[1]!;
    const s = await createSession({ userId: ch.userId, tenantId: tenant.id, mfaVerified: true, ip: req.ip, userAgent: req.ctx.userAgent, impersonatorId });
    setSessionCookies(reply, s.token, s.csrfToken);
    await auditSystem(req, { action: 'impersonation.session.created', entityType: 'user', entityId: ch.userId, tenantId: tenant.id, after: { impersonatorId } });
    return reply.redirect('/admin');
  });

  app.get('/platform/audit', { schema: { querystring: z.object({ tenantId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(500).default(200) }) } }, async (req) => {
    superAdmin(req);
    return { items: await systemDb.select().from(auditLogs).where(req.query.tenantId ? eq(auditLogs.tenantId, req.query.tenantId) : undefined).orderBy(desc(auditLogs.createdAt)).limit(req.query.limit) };
  });
}
