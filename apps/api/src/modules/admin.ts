import { resolveTxt } from 'node:dns/promises';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  CONNECTION_CATEGORIES,
  EMAIL_TRIGGERS,
  FEATURE_MODULES,
  MARGIN_SCOPES,
  PREVIEWABLE_SECTIONS,
  ROLES,
  SETTINGS_SECTION_KEYS,
  WEBHOOK_EVENTS,
  simulateMarginChange,
  type MarginConfig,
  type MarginRule,
  type SettingsSection,
} from '@sos/core';
import { config } from '../config.js';
import { systemDb } from '../db/client.js';
import {
  apiConnections,
  bankAccounts,
  costCalculations,
  documentTemplates,
  documentTemplateVersions,
  emailTemplates,
  featureFlags,
  marginRuleSets,
  policies,
  tenantDomains,
  tenants,
  userRoles,
  users,
  webhooks,
} from '../db/schema/index.js';
import { randomToken } from '../lib/crypto.js';
import { AppError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { db, requirePerm, tenantOf } from '../http/context.js';
import type { App } from '../http/types.js';
import { audit } from '../services/audit.js';
import { loadConnection } from '../services/connections/index.js';
import { describeProvider, PROVIDERS, providerDef } from '../services/connections/registry.js';
import { previewHtml } from '../services/documents.js';
import { createInvite } from '../services/invites.js';
import { deleteSecret, putSecret, secretMask } from '../services/secrets.js';
import { discardDraft, getSectionState, publishDraft, saveDraft } from '../services/settings.js';
import { invalidateFeatures, invalidateHostCache } from '../services/tenancy.js';
import { render, validateTemplate } from '../services/templates/render.js';
import { publishedMarginSet } from '../services/pricing.js';
import { consumeFor } from '../services/usage.js';

const sectionParam = z.object({
  section: z.enum(SETTINGS_SECTION_KEYS as [SettingsSection, ...SettingsSection[]]),
});

export async function adminRoutes(app: App) {
  // ═════════════ Settings sections (Draft → Preview → Publish, versioned) ═════════════
  app.get('/admin/settings/:section', { schema: { params: sectionParam } }, async (req) => {
    const tenant = tenantOf(req);
    requirePerm(req, 'tenant.settings.read');
    return db(req, (tx) => getSectionState(tx, tenant.id, req.params.section));
  });

  app.put(
    '/admin/settings/:section/draft',
    { schema: { params: sectionParam, body: z.object({ data: z.record(z.string(), z.unknown()) }) } },
    async (req) => {
      const tenant = tenantOf(req);
      const user = requirePerm(req, 'tenant.settings.write');
      return db(req, async (tx) => {
        const r = await saveDraft(tx, tenant.id, req.params.section, req.body.data, user.id);
        await audit(tx, req, {
          action: 'settings.draft.saved',
          entityType: 'settings',
          entityId: req.params.section,
          after: { version: r.version },
        });
        return { ...r, previewable: PREVIEWABLE_SECTIONS.includes(req.params.section) };
      });
    },
  );

  app.post('/admin/settings/:section/publish', { schema: { params: sectionParam } }, async (req) => {
    const tenant = tenantOf(req);
    const user = requirePerm(req, 'tenant.settings.write');
    return db(req, async (tx) => {
      const r = await publishDraft(tx, tenant.id, req.params.section, user.id);
      await audit(tx, req, {
        action: 'settings.published',
        entityType: 'settings',
        entityId: req.params.section,
        before: r.before,
        after: r.after,
      });
      return { ok: true, version: r.version };
    });
  });

  app.delete('/admin/settings/:section/draft', { schema: { params: sectionParam } }, async (req) => {
    const tenant = tenantOf(req);
    requirePerm(req, 'tenant.settings.write');
    return db(req, async (tx) => {
      await discardDraft(tx, tenant.id, req.params.section);
      return { ok: true };
    });
  });

  // ═════════════ Setup wizard state ═════════════
  app.get('/admin/setup', async (req) => {
    const tenant = tenantOf(req);
    requirePerm(req, 'tenant.settings.read');
    return db(req, async (tx) => {
      const [t] = await tx.select().from(tenants).where(eq(tenants.id, tenant.id)).limit(1);
      const steps = [
        'company',
        'brand',
        'domain',
        'bank',
        'ai',
        'marketplace',
        'domestic',
        'email',
        'freight',
        'experts',
        'margin',
        'documents',
      ];
      return { completedAt: t?.setupCompletedAt ?? null, state: t?.setupState ?? {}, steps };
    });
  });

  app.post(
    '/admin/setup/:step',
    {
      schema: {
        params: z.object({ step: z.string().max(30) }),
        body: z.object({ status: z.enum(['DONE', 'SKIPPED']) }),
      },
    },
    async (req) => {
      const tenant = tenantOf(req);
      requirePerm(req, 'tenant.settings.write');
      return db(req, async (tx) => {
        const [t] = await tx.select().from(tenants).where(eq(tenants.id, tenant.id)).limit(1);
        const state = { ...(t?.setupState ?? {}), [req.params.step]: req.body.status };
        const done = Object.keys(state).length >= 12;
        await tx
          .update(tenants)
          .set({
            setupState: state,
            ...(done && !t?.setupCompletedAt ? { setupCompletedAt: new Date() } : {}),
            updatedAt: new Date(),
          })
          .where(eq(tenants.id, tenant.id));
        return { ok: true, state };
      });
    },
  );

  // ═════════════ Domains ═════════════
  app.get('/admin/domains', async (req) => {
    const tenant = tenantOf(req);
    requirePerm(req, 'tenant.domains.manage');
    return db(req, async (tx) => ({
      items: await tx.select().from(tenantDomains).orderBy(desc(tenantDomains.isPrimary)),
      cnameTarget: `${tenant.slug}.${config.PLATFORM_BASE_DOMAIN}`,
    }));
  });

  app.post(
    '/admin/domains',
    {
      schema: {
        body: z.object({
          hostname: z
            .string()
            .regex(
              /^(?=.{4,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/,
              '올바른 도메인을 입력하세요 (예: sourcing.example.co.kr)',
            ),
        }),
      },
    },
    async (req, reply) => {
      const tenant = tenantOf(req);
      requirePerm(req, 'tenant.domains.manage');
      if (!req.ctx.features?.has('CUSTOM_DOMAIN'))
        throw new AppError(403, 'FEATURE_DISABLED', '현재 요금제에서는 자체 도메인을 사용할 수 없습니다.');
      const host = req.body.hostname.toLowerCase();
      if (host.endsWith(`.${config.PLATFORM_BASE_DOMAIN}`))
        throw badRequest('플랫폼 기본 도메인은 등록할 수 없습니다.');
      const [dup] = await systemDb
        .select({ id: tenantDomains.id })
        .from(tenantDomains)
        .where(eq(tenantDomains.hostname, host))
        .limit(1);
      if (dup) throw new AppError(409, 'DOMAIN_TAKEN', '이미 등록된 도메인입니다.');
      await consumeFor(req, 'custom_domains');
      return db(req, async (tx) => {
        const [d] = await tx
          .insert(tenantDomains)
          .values({ tenantId: tenant.id, hostname: host, kind: 'CUSTOM', verificationToken: randomToken(18) })
          .returning();
        await audit(tx, req, {
          action: 'domain.added',
          entityType: 'tenant_domain',
          entityId: d!.id,
          after: { hostname: host },
        });
        reply.status(201);
        return {
          ...d,
          instructions: {
            txtRecord: { name: `_sos-verify.${host}`, value: d!.verificationToken },
            cname: { name: host, value: `${tenant.slug}.${config.PLATFORM_BASE_DOMAIN}` },
          },
        };
      });
    },
  );

  /** DNS TXT verification. SSL is issued by the edge proxy (Caddy on-demand TLS) once verified. */
  app.post(
    '/admin/domains/:id/verify',
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      requirePerm(req, 'tenant.domains.manage');
      return db(req, async (tx) => {
        const [d] = await tx.select().from(tenantDomains).where(eq(tenantDomains.id, req.params.id)).limit(1);
        if (!d) throw notFound();
        let ok = false;
        let error: string | null = null;
        try {
          const recs = await resolveTxt(`_sos-verify.${d.hostname}`);
          ok = recs.some((r) => r.join('') === d.verificationToken);
          if (!ok) error = 'TXT 레코드 값이 일치하지 않습니다.';
        } catch (e) {
          error = `TXT 레코드를 찾을 수 없습니다 (${e instanceof Error ? ((e as NodeJS.ErrnoException).code ?? e.message) : 'DNS 오류'}).`;
        }
        await tx
          .update(tenantDomains)
          .set({
            dnsStatus: ok ? 'VERIFIED' : 'FAILED',
            sslStatus: ok ? 'PENDING' : d.sslStatus,
            lastCheckedAt: new Date(),
            lastError: error,
            updatedAt: new Date(),
          })
          .where(eq(tenantDomains.id, d.id));
        await audit(tx, req, {
          action: 'domain.verify',
          entityType: 'tenant_domain',
          entityId: d.id,
          after: { ok, error },
        });
        return { ok, error };
      });
    },
  );

  app.patch(
    '/admin/domains/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ active: z.boolean().optional(), isPrimary: z.boolean().optional() }),
      },
    },
    async (req) => {
      const tenant = tenantOf(req);
      requirePerm(req, 'tenant.domains.manage');
      return db(req, async (tx) => {
        const [d] = await tx.select().from(tenantDomains).where(eq(tenantDomains.id, req.params.id)).limit(1);
        if (!d) throw notFound();
        if (req.body.active && d.dnsStatus !== 'VERIFIED')
          throw badRequest('DNS 확인 후 활성화할 수 있습니다.');
        if (req.body.isPrimary)
          await tx
            .update(tenantDomains)
            .set({ isPrimary: false })
            .where(eq(tenantDomains.tenantId, tenant.id));
        await tx
          .update(tenantDomains)
          .set({ ...req.body, updatedAt: new Date() })
          .where(eq(tenantDomains.id, d.id));
        await invalidateHostCache(d.hostname);
        await audit(tx, req, {
          action: 'domain.updated',
          entityType: 'tenant_domain',
          entityId: d.id,
          before: { active: d.active },
          after: req.body,
        });
        return { ok: true };
      });
    },
  );

  app.delete(
    '/admin/domains/:id',
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      requirePerm(req, 'tenant.domains.manage');
      return db(req, async (tx) => {
        const [d] = await tx.select().from(tenantDomains).where(eq(tenantDomains.id, req.params.id)).limit(1);
        if (!d) throw notFound();
        if (d.kind === 'SUBDOMAIN') throw badRequest('기본 주소는 삭제할 수 없습니다.');
        await tx.delete(tenantDomains).where(eq(tenantDomains.id, d.id));
        await invalidateHostCache(d.hostname);
        await audit(tx, req, {
          action: 'domain.deleted',
          entityType: 'tenant_domain',
          entityId: d.id,
          before: d,
        });
        return { ok: true };
      });
    },
  );

  // ═════════════ Bank accounts (step-up required) ═════════════
  const bankBody = z.object({
    label: z.string().max(60).default(''),
    bankName: z.string().min(1).max(80),
    accountNumber: z.string().min(4).max(60),
    accountHolder: z.string().min(1).max(80),
    currency: z.string().length(3).default('KRW'),
    swift: z.string().max(20).default(''),
    bankAddress: z.string().max(300).default(''),
    intermediaryInfo: z.string().max(500).default(''),
    isDefault: z.boolean().default(false),
    showOnDocuments: z.boolean().default(true),
    active: z.boolean().default(true),
  });

  app.get('/admin/bank-accounts', async (req) => {
    requirePerm(req, 'tenant.settings.read');
    return db(req, async (tx) => ({
      items: await tx.select().from(bankAccounts).orderBy(desc(bankAccounts.isDefault)),
    }));
  });
  app.post('/admin/bank-accounts', { schema: { body: bankBody } }, async (req, reply) => {
    const tenant = tenantOf(req);
    requirePerm(req, 'tenant.bank.write');
    return db(req, async (tx) => {
      if (req.body.isDefault)
        await tx.update(bankAccounts).set({ isDefault: false }).where(eq(bankAccounts.tenantId, tenant.id));
      const [b] = await tx
        .insert(bankAccounts)
        .values({ tenantId: tenant.id, ...req.body })
        .returning();
      await audit(tx, req, {
        action: 'bank.created',
        entityType: 'bank_account',
        entityId: b!.id,
        after: { ...req.body, accountNumber: `****${req.body.accountNumber.slice(-4)}` },
      });
      reply.status(201);
      return b;
    });
  });
  app.patch(
    '/admin/bank-accounts/:id',
    { schema: { params: z.object({ id: z.string().uuid() }), body: bankBody.partial() } },
    async (req) => {
      const tenant = tenantOf(req);
      requirePerm(req, 'tenant.bank.write');
      return db(req, async (tx) => {
        const [b] = await tx.select().from(bankAccounts).where(eq(bankAccounts.id, req.params.id)).limit(1);
        if (!b) throw notFound();
        if (req.body.isDefault)
          await tx.update(bankAccounts).set({ isDefault: false }).where(eq(bankAccounts.tenantId, tenant.id));
        await tx
          .update(bankAccounts)
          .set({ ...req.body, updatedAt: new Date() })
          .where(eq(bankAccounts.id, b.id));
        await audit(tx, req, {
          action: 'bank.updated',
          entityType: 'bank_account',
          entityId: b.id,
          before: {
            bankName: b.bankName,
            accountNumber: `****${b.accountNumber.slice(-4)}`,
            accountHolder: b.accountHolder,
          },
          after: {
            ...req.body,
            ...(req.body.accountNumber ? { accountNumber: `****${req.body.accountNumber.slice(-4)}` } : {}),
          },
        });
        return { ok: true };
      });
    },
  );
  app.delete(
    '/admin/bank-accounts/:id',
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      requirePerm(req, 'tenant.bank.write');
      return db(req, async (tx) => {
        const [b] = await tx.select().from(bankAccounts).where(eq(bankAccounts.id, req.params.id)).limit(1);
        if (!b) throw notFound();
        await tx.delete(bankAccounts).where(eq(bankAccounts.id, b.id));
        await audit(tx, req, {
          action: 'bank.deleted',
          entityType: 'bank_account',
          entityId: b.id,
          before: { bankName: b.bankName, accountNumber: `****${b.accountNumber.slice(-4)}` },
        });
        return { ok: true };
      });
    },
  );

  // ═════════════ API connections (secrets never returned) ═════════════
  app.get('/admin/connections/catalog', async (req) => {
    requirePerm(req, 'tenant.settings.read');
    return { categories: CONNECTION_CATEGORIES, providers: PROVIDERS.map(describeProvider) };
  });

  app.get('/admin/connections', async (req) => {
    requirePerm(req, 'tenant.settings.read');
    return db(req, async (tx) => {
      const rows = await tx.select().from(apiConnections).orderBy(apiConnections.category);
      const items = [];
      for (const r of rows) {
        const masks: Record<string, string | null> = {};
        for (const [k, ref] of Object.entries(r.secretRefs)) masks[k] = await secretMask(tx, ref);
        items.push({
          ...r,
          secretRefs: undefined,
          secrets: masks,
          circuitOpen: !!r.circuitOpenUntil && r.circuitOpenUntil > new Date(),
        });
      }
      return {
        items,
        system: {
          storage: config.STORAGE_DRIVER,
          email: config.SMTP_HOST ? 'CONFIGURED' : 'NOT_CONFIGURED',
          pdf: config.GOTENBERG_URL ? 'GOTENBERG' : 'CHROMIUM',
          malwareScan: config.CLAMAV_HOST ? 'CONFIGURED' : 'NOT_CONFIGURED',
          secretsBackend: config.SECRETS_BACKEND,
        },
      };
    });
  });

  const connBody = z.object({
    provider: z.string().min(2).max(40),
    label: z.string().max(80).default(''),
    enabled: z.boolean().default(true),
    config: z.record(z.string(), z.unknown()).default({}),
    secrets: z.record(z.string(), z.string().max(5000)).default({}),
  });

  app.post('/admin/connections', { schema: { body: connBody } }, async (req, reply) => {
    const tenant = tenantOf(req);
    const user = requirePerm(req, 'tenant.connections.write');
    const def = providerDef(req.body.provider);
    if (!def) throw badRequest('알 수 없는 제공자입니다.');
    return db(req, async (tx) => {
      const [row] = await tx
        .insert(apiConnections)
        .values({
          tenantId: tenant.id,
          category: def.category,
          provider: def.provider,
          label: req.body.label || def.label,
          enabled: req.body.enabled,
          config: req.body.config,
        })
        .returning();
      const refs: Record<string, string> = {};
      for (const f of def.secretFields) {
        const v = req.body.secrets[f.key];
        if (v) refs[f.key] = await putSecret(tx, tenant.id, `conn:${row!.id}:${f.key}`, v, user.id);
      }
      await tx.update(apiConnections).set({ secretRefs: refs }).where(eq(apiConnections.id, row!.id));
      await audit(tx, req, {
        action: 'connection.created',
        entityType: 'api_connection',
        entityId: row!.id,
        after: { provider: def.provider, config: req.body.config, secrets: Object.keys(refs) },
      });
      reply.status(201);
      return { id: row!.id };
    });
  });

  app.patch(
    '/admin/connections/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: connBody.partial().omit({ provider: true }),
      },
    },
    async (req) => {
      const tenant = tenantOf(req);
      const user = requirePerm(req, 'tenant.connections.write');
      return db(req, async (tx) => {
        const [row] = await tx
          .select()
          .from(apiConnections)
          .where(eq(apiConnections.id, req.params.id))
          .limit(1);
        if (!row) throw notFound();
        const def = providerDef(row.provider)!;
        const refs = { ...row.secretRefs };
        for (const f of def.secretFields) {
          const v = req.body.secrets?.[f.key];
          if (v) refs[f.key] = await putSecret(tx, tenant.id, `conn:${row.id}:${f.key}`, v, user.id); // rotation keeps the same ref, bumps version
        }
        await tx
          .update(apiConnections)
          .set({
            label: req.body.label ?? row.label,
            enabled: req.body.enabled ?? row.enabled,
            config: req.body.config ?? row.config,
            secretRefs: refs,
            circuitOpenUntil: null,
            consecutiveFailures: 0,
            updatedAt: new Date(),
          })
          .where(eq(apiConnections.id, row.id));
        await audit(tx, req, {
          action: 'connection.updated',
          entityType: 'api_connection',
          entityId: row.id,
          before: { enabled: row.enabled, config: row.config },
          after: {
            enabled: req.body.enabled,
            config: req.body.config,
            rotatedSecrets: Object.keys(req.body.secrets ?? {}),
          },
        });
        return { ok: true };
      });
    },
  );

  app.delete(
    '/admin/connections/:id',
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      requirePerm(req, 'tenant.connections.write');
      return db(req, async (tx) => {
        const [row] = await tx
          .select()
          .from(apiConnections)
          .where(eq(apiConnections.id, req.params.id))
          .limit(1);
        if (!row) throw notFound();
        for (const ref of Object.values(row.secretRefs)) await deleteSecret(tx, ref);
        await tx.delete(apiConnections).where(eq(apiConnections.id, row.id));
        await audit(tx, req, {
          action: 'connection.deleted',
          entityType: 'api_connection',
          entityId: row.id,
          before: { provider: row.provider },
        });
        return { ok: true };
      });
    },
  );

  app.post(
    '/admin/connections/:id/test',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (req) => {
      requirePerm(req, 'tenant.settings.write');
      return db(req, async (tx) => {
        const [row] = await tx
          .select()
          .from(apiConnections)
          .where(eq(apiConnections.id, req.params.id))
          .limit(1);
        if (!row) throw notFound();
        const def = providerDef(row.provider);
        if (!def) throw badRequest('알 수 없는 제공자입니다.');
        const missing = def.secretFields
          .filter((f) => f.required && !row.secretRefs[f.key])
          .map((f) => f.label);
        if (missing.length) {
          await tx
            .update(apiConnections)
            .set({
              status: 'DISCONNECTED',
              lastTestAt: new Date(),
              lastError: `필수 값 누락: ${missing.join(', ')}`,
            })
            .where(eq(apiConnections.id, row.id));
          return { ok: false, message: `필수 값 누락: ${missing.join(', ')}` };
        }
        const conn = await loadConnection(tx, row);
        const r = await def.test(conn);
        await tx
          .update(apiConnections)
          .set({
            status: r.ok ? 'CONNECTED' : 'ERROR',
            lastTestAt: new Date(),
            ...(r.ok
              ? { lastSuccessAt: new Date(), lastError: null, consecutiveFailures: 0, circuitOpenUntil: null }
              : { lastError: r.message.slice(0, 1000) }),
            updatedAt: new Date(),
          })
          .where(eq(apiConnections.id, row.id));
        await audit(tx, req, {
          action: 'connection.tested',
          entityType: 'api_connection',
          entityId: row.id,
          after: { ok: r.ok },
        });
        return r;
      });
    },
  );

  // ═════════════ Users, roles, invitations ═════════════
  app.get(
    '/admin/users',
    { schema: { querystring: z.object({ audience: z.enum(['STAFF', 'PARTNER', 'CUSTOMER']).optional() }) } },
    async (req) => {
      requirePerm(req, 'tenant.users.manage');
      return db(req, async (tx) => {
        const rows = await tx
          .select({
            id: users.id,
            email: users.email,
            name: users.name,
            phone: users.phone,
            status: users.status,
            companyId: users.companyId,
            expertTypes: users.expertTypes,
            mfaEnabled: users.mfaEnabled,
            lastLoginAt: users.lastLoginAt,
            createdAt: users.createdAt,
          })
          .from(users)
          .orderBy(desc(users.createdAt))
          .limit(1000);
        const roles = rows.length
          ? await tx
              .select()
              .from(userRoles)
              .where(
                inArray(
                  userRoles.userId,
                  rows.map((r) => r.id),
                ),
              )
          : [];
        const withRoles = rows.map((r) => ({
          ...r,
          roles: roles.filter((x) => x.userId === r.id).map((x) => x.role),
        }));
        const staffRoles = [
          'TENANT_OWNER',
          'TENANT_ADMIN',
          'SALES',
          'SOURCING_MANAGER',
          'FINANCE',
          'WAREHOUSE',
          'READ_ONLY',
        ];
        const partnerRoles = [
          'CUSTOMS_PARTNER',
          'FORWARDER_PARTNER',
          'CERTIFICATION_PARTNER',
          'SUPPLIER_PARTNER',
        ];
        const filter = req.query.audience;
        return {
          items: withRoles.filter(
            (u) =>
              !filter ||
              (filter === 'STAFF'
                ? u.roles.some((r) => staffRoles.includes(r))
                : filter === 'PARTNER'
                  ? u.roles.some((r) => partnerRoles.includes(r))
                  : u.roles.some((r) => r.startsWith('CUSTOMER'))),
          ),
        };
      });
    },
  );

  app.post(
    '/admin/users/invite',
    {
      schema: {
        body: z.object({
          email: z.string().email().max(200),
          name: z.string().max(80).default(''),
          roles: z.array(z.enum(ROLES)).min(1).max(4),
          companyId: z.string().uuid().optional(),
          expertTypes: z.array(z.string().max(40)).default([]),
        }),
      },
    },
    async (req, reply) => {
      const tenant = tenantOf(req);
      const actor = requirePerm(req, 'tenant.users.manage');
      if (req.body.roles.includes('SUPER_ADMIN')) throw forbidden();
      if (req.body.roles.includes('TENANT_OWNER') && !actor.roles.includes('TENANT_OWNER'))
        throw forbidden('대표 관리자만 대표 관리자를 초대할 수 있습니다.');
      await consumeFor(req, 'users');
      const email = req.body.email.toLowerCase();
      const [exists] = await systemDb
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.tenantId, tenant.id), eq(users.email, email)))
        .limit(1);
      if (exists) throw new AppError(409, 'EMAIL_TAKEN', '이미 등록된 이메일입니다.');
      const userId = await db(req, async (tx) => {
        const [u] = await tx
          .insert(users)
          .values({
            tenantId: tenant.id,
            email,
            name: req.body.name,
            status: 'INVITED',
            companyId: req.body.companyId ?? null,
            expertTypes: req.body.expertTypes,
          })
          .returning({ id: users.id });
        for (const role of req.body.roles)
          await tx.insert(userRoles).values({ tenantId: tenant.id, userId: u!.id, role });
        await audit(tx, req, {
          action: 'user.invited',
          entityType: 'user',
          entityId: u!.id,
          after: { email, roles: req.body.roles },
        });
        return u!.id;
      });
      const token = await createInvite(tenant.id, userId);
      const link = `${config.PUBLIC_WEB_URL.replace(/\/\/[^/]+/, `//${req.ctx.host}${new URL(config.PUBLIC_WEB_URL).port ? `:${new URL(config.PUBLIC_WEB_URL).port}` : ''}`)}/invite?token=${token}`;
      reply.status(201);
      // The link is shown once to the inviting admin (and emailed when SMTP is configured).
      return { userId, inviteLink: link };
    },
  );

  app.patch(
    '/admin/users/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          roles: z.array(z.enum(ROLES)).min(1).max(4).optional(),
          status: z.enum(['ACTIVE', 'DISABLED']).optional(),
          name: z.string().max(80).optional(),
          expertTypes: z.array(z.string()).optional(),
          companyId: z.string().uuid().nullable().optional(),
        }),
      },
    },
    async (req) => {
      const tenant = tenantOf(req);
      const actor = requirePerm(req, 'tenant.users.manage');
      if (req.params.id === actor.id && (req.body.status === 'DISABLED' || req.body.roles))
        throw badRequest('자기 자신의 권한은 변경할 수 없습니다.');
      if (req.body.roles?.includes('SUPER_ADMIN')) throw forbidden();
      return db(req, async (tx) => {
        const [u] = await tx.select().from(users).where(eq(users.id, req.params.id)).limit(1);
        if (!u) throw notFound();
        const before = (await tx.select().from(userRoles).where(eq(userRoles.userId, u.id))).map(
          (r) => r.role,
        );
        if (before.includes('TENANT_OWNER') && !actor.roles.includes('TENANT_OWNER'))
          throw forbidden('대표 관리자 계정은 대표 관리자만 변경할 수 있습니다.');
        if (req.body.roles) {
          await tx.delete(userRoles).where(eq(userRoles.userId, u.id));
          for (const role of req.body.roles)
            await tx.insert(userRoles).values({ tenantId: tenant.id, userId: u.id, role });
        }
        const { roles: _r, ...rest } = req.body;
        if (Object.keys(rest).length)
          await tx
            .update(users)
            .set({ ...rest, updatedAt: new Date() })
            .where(eq(users.id, u.id));
        if (req.body.status === 'DISABLED')
          await systemDb.execute(
            sql`update sessions set revoked_at = now() where user_id = ${u.id} and revoked_at is null`,
          );
        await audit(tx, req, {
          action: 'user.updated',
          entityType: 'user',
          entityId: u.id,
          before: { roles: before, status: u.status },
          after: req.body,
        });
        return { ok: true };
      });
    },
  );

  // ═════════════ Feature flags (tenant level; plan decides availability) ═════════════
  app.get('/admin/features', async (req) => {
    requirePerm(req, 'tenant.settings.read');
    return db(req, async (tx) => {
      const flags = await tx.select().from(featureFlags);
      return {
        modules: FEATURE_MODULES.map((m) => ({
          module: m,
          enabled: req.ctx.features?.has(m) ?? true,
          override: flags.find((f) => f.module === m)?.enabled ?? null,
        })),
      };
    });
  });

  // ═════════════ Policies (versioned; consents store version) ═════════════
  app.get('/admin/policies', async (req) => {
    requirePerm(req, 'tenant.settings.read');
    return db(req, async (tx) => ({
      items: await tx.select().from(policies).orderBy(policies.type, desc(policies.version)),
    }));
  });
  app.post(
    '/admin/policies',
    {
      schema: {
        body: z.object({
          type: z.enum([
            'PRIVACY',
            'TERMS',
            'SOURCING_TERMS',
            'QUOTATION_NOTICE',
            'CANCELLATION',
            'REFUND',
            'SHIPPING',
          ]),
          title: z.string().min(1).max(120),
          body: z.string().min(1).max(100000),
          publish: z.boolean().default(false),
        }),
      },
    },
    async (req, reply) => {
      const tenant = tenantOf(req);
      const user = requirePerm(req, 'tenant.settings.write');
      return db(req, async (tx) => {
        const [max] = await tx
          .select({ v: sql<number>`coalesce(max(${policies.version}),0)::int` })
          .from(policies)
          .where(eq(policies.type, req.body.type));
        if (req.body.publish)
          await tx
            .update(policies)
            .set({ status: 'ARCHIVED' })
            .where(and(eq(policies.type, req.body.type), eq(policies.status, 'PUBLISHED')));
        const [p] = await tx
          .insert(policies)
          .values({
            tenantId: tenant.id,
            type: req.body.type,
            version: (max?.v ?? 0) + 1,
            title: req.body.title,
            body: req.body.body,
            status: req.body.publish ? 'PUBLISHED' : 'DRAFT',
            publishedAt: req.body.publish ? new Date() : null,
            createdBy: user.id,
          })
          .returning();
        await audit(tx, req, {
          action: req.body.publish ? 'policy.published' : 'policy.draft',
          entityType: 'policy',
          entityId: p!.id,
          after: { type: p!.type, version: p!.version },
        });
        reply.status(201);
        return p;
      });
    },
  );

  // ═════════════ Email templates (versioned) ═════════════
  app.get('/admin/email-templates', async (req) => {
    requirePerm(req, 'email.manage');
    return db(req, async (tx) => ({
      triggers: EMAIL_TRIGGERS,
      items: await tx
        .select()
        .from(emailTemplates)
        .where(eq(emailTemplates.status, 'PUBLISHED'))
        .orderBy(emailTemplates.trigger),
    }));
  });
  app.post(
    '/admin/email-templates',
    {
      schema: {
        body: z.object({
          trigger: z.enum(EMAIL_TRIGGERS),
          subject: z.string().min(1).max(300),
          bodyHtml: z.string().min(1).max(100000),
          enabled: z.boolean().default(true),
        }),
      },
    },
    async (req, reply) => {
      const tenant = tenantOf(req);
      const user = requirePerm(req, 'email.manage');
      const err = validateTemplate(req.body.subject) ?? validateTemplate(req.body.bodyHtml);
      if (err) throw badRequest(`템플릿 문법 오류: ${err}`);
      return db(req, async (tx) => {
        const [max] = await tx
          .select({ v: sql<number>`coalesce(max(${emailTemplates.version}),0)::int` })
          .from(emailTemplates)
          .where(eq(emailTemplates.trigger, req.body.trigger));
        await tx
          .update(emailTemplates)
          .set({ status: 'ARCHIVED' })
          .where(and(eq(emailTemplates.trigger, req.body.trigger), eq(emailTemplates.status, 'PUBLISHED')));
        const [t] = await tx
          .insert(emailTemplates)
          .values({
            tenantId: tenant.id,
            ...req.body,
            version: (max?.v ?? 0) + 1,
            status: 'PUBLISHED',
            createdBy: user.id,
          })
          .returning();
        await audit(tx, req, {
          action: 'email_template.published',
          entityType: 'email_template',
          entityId: t!.id,
          after: { trigger: t!.trigger, version: t!.version },
        });
        reply.status(201);
        return t;
      });
    },
  );
  app.post(
    '/admin/email-templates/preview',
    { schema: { body: z.object({ subject: z.string(), bodyHtml: z.string() }) } },
    async (req) => {
      const tenant = tenantOf(req);
      requirePerm(req, 'email.manage');
      return db(req, async (tx) => {
        const { brandContext } = await import('../services/notify.js');
        const ctx = {
          ...(await brandContext(tx, tenant.id)),
          projectCode: 'SRC-2026-000001',
          recipientName: '홍길동',
          productName: '미리보기 제품',
          quoteNumber: 'QT-2026-0001',
          total: '1,000,000 KRW',
          validUntil: '2026-12-31',
          link: '#',
          eta: '2026-12-01',
        };
        return { subject: render(req.body.subject, ctx), html: render(req.body.bodyHtml, ctx) };
      });
    },
  );

  // ═════════════ Document templates (versioned; preview) ═════════════
  app.get('/admin/document-templates', async (req) => {
    requirePerm(req, 'document.template.manage');
    return db(req, async (tx) => {
      const tpls = await tx.select().from(documentTemplates);
      const vers = tpls.length
        ? await tx
            .select()
            .from(documentTemplateVersions)
            .where(
              inArray(
                documentTemplateVersions.templateId,
                tpls.map((t) => t.id),
              ),
            )
            .orderBy(desc(documentTemplateVersions.version))
        : [];
      return {
        items: tpls.map((t) => ({
          ...t,
          versions: vers
            .filter((v) => v.templateId === t.id)
            .map((v) => ({
              id: v.id,
              version: v.version,
              status: v.status,
              createdAt: v.createdAt,
              requiresLegalReview: v.requiresLegalReview,
            })),
          published: vers.find((v) => v.id === t.publishedVersionId) ?? null,
        })),
      };
    });
  });
  app.post(
    '/admin/document-templates/:id/versions',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          html: z.string().min(1).max(300000),
          css: z.string().max(100000).default(''),
          defaultClauses: z
            .array(z.object({ key: z.string(), title: z.string(), body: z.string() }))
            .optional(),
          requiresLegalReview: z.boolean().optional(),
          publish: z.boolean().default(false),
        }),
      },
    },
    async (req, reply) => {
      const tenant = tenantOf(req);
      const user = requirePerm(req, 'document.template.manage');
      const err = validateTemplate(req.body.html) ?? validateTemplate(req.body.css);
      if (err) throw badRequest(`템플릿 문법 오류: ${err}`);
      if (/<script|javascript:|on\w+=/i.test(req.body.html))
        throw badRequest('문서 템플릿에는 스크립트를 사용할 수 없습니다.');
      return db(req, async (tx) => {
        const [t] = await tx
          .select()
          .from(documentTemplates)
          .where(eq(documentTemplates.id, req.params.id))
          .limit(1);
        if (!t) throw notFound();
        const [cur] = t.publishedVersionId
          ? await tx
              .select()
              .from(documentTemplateVersions)
              .where(eq(documentTemplateVersions.id, t.publishedVersionId))
              .limit(1)
          : [];
        const [max] = await tx
          .select({ v: sql<number>`coalesce(max(${documentTemplateVersions.version}),0)::int` })
          .from(documentTemplateVersions)
          .where(eq(documentTemplateVersions.templateId, t.id));
        const [v] = await tx
          .insert(documentTemplateVersions)
          .values({
            tenantId: tenant.id,
            templateId: t.id,
            version: (max?.v ?? 0) + 1,
            status: req.body.publish ? 'PUBLISHED' : 'DRAFT',
            html: req.body.html,
            css: req.body.css,
            defaultClauses: req.body.defaultClauses ?? cur?.defaultClauses ?? [],
            requiresLegalReview: req.body.requiresLegalReview ?? cur?.requiresLegalReview ?? false,
            createdBy: user.id,
            publishedAt: req.body.publish ? new Date() : null,
          })
          .returning();
        if (req.body.publish) {
          if (cur)
            await tx
              .update(documentTemplateVersions)
              .set({ status: 'ARCHIVED' })
              .where(eq(documentTemplateVersions.id, cur.id));
          await tx
            .update(documentTemplates)
            .set({ publishedVersionId: v!.id, updatedAt: new Date() })
            .where(eq(documentTemplates.id, t.id));
        }
        await audit(tx, req, {
          action: req.body.publish ? 'document_template.published' : 'document_template.draft',
          entityType: 'document_template',
          entityId: t.id,
          after: { version: v!.version },
        });
        reply.status(201);
        return v;
      });
    },
  );
  app.post(
    '/admin/document-templates/preview',
    {
      schema: {
        body: z.object({
          html: z.string().max(300000),
          css: z.string().max(100000).default(''),
          sample: z.record(z.string(), z.unknown()).default({}),
        }),
      },
    },
    async (req, reply) => {
      const tenant = tenantOf(req);
      requirePerm(req, 'document.template.manage');
      const html = await db(req, (tx) =>
        previewHtml(tx, tenant.id, req.body.html, req.body.css, {
          title: '견적서',
          number: 'QT-2026-0001',
          version: 1,
          issueDate: '2026-01-01',
          validUntil: '2026-01-15',
          customer: { name: '미리보기 고객' },
          items: [
            {
              name: '샘플 제품',
              specification: '사양',
              quantity: 100,
              unit: 'EA',
              unitPrice: '12000',
              amount: '1200000',
              visibleBreakdown: [],
            },
          ],
          currency: 'KRW',
          subtotal: '1200000',
          vat: '120000',
          total: '1320000',
          clauses: [{ title: '샘플 조항', body: '내용' }],
          lines: [],
          ...req.body.sample,
        }),
      );
      reply.header('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'");
      reply.type('text/html');
      return html;
    },
  );

  // ═════════════ Webhooks ═════════════
  app.get('/admin/webhooks', async (req) => {
    requirePerm(req, 'webhook.manage');
    return db(req, async (tx) => ({
      events: WEBHOOK_EVENTS,
      items: (await tx.select().from(webhooks)).map((w) => ({ ...w, secretRef: undefined })),
    }));
  });
  app.post(
    '/admin/webhooks',
    {
      schema: {
        body: z.object({
          url: z.string().url().max(500),
          events: z.array(z.enum([...WEBHOOK_EVENTS, '*'] as [string, ...string[]])).min(1),
        }),
      },
    },
    async (req, reply) => {
      const tenant = tenantOf(req);
      const user = requirePerm(req, 'webhook.manage');
      if (!req.body.url.startsWith('https://') && config.NODE_ENV === 'production')
        throw badRequest('HTTPS 주소만 허용됩니다.');
      const secret = `whsec_${randomToken(24)}`;
      return db(req, async (tx) => {
        const [w] = await tx
          .insert(webhooks)
          .values({ tenantId: tenant.id, url: req.body.url, events: req.body.events, secretRef: 'pending' })
          .returning();
        const ref = await putSecret(tx, tenant.id, `webhook:${w!.id}`, secret, user.id);
        await tx.update(webhooks).set({ secretRef: ref }).where(eq(webhooks.id, w!.id));
        await audit(tx, req, {
          action: 'webhook.created',
          entityType: 'webhook',
          entityId: w!.id,
          after: { url: req.body.url, events: req.body.events },
        });
        reply.status(201);
        return { id: w!.id, signingSecret: secret, note: '서명 비밀키는 지금 한 번만 표시됩니다.' };
      });
    },
  );
  app.patch(
    '/admin/webhooks/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ enabled: z.boolean().optional(), events: z.array(z.string()).optional() }),
      },
    },
    async (req) => {
      requirePerm(req, 'webhook.manage');
      return db(req, async (tx) => {
        await tx
          .update(webhooks)
          .set({
            ...req.body,
            ...(req.body.enabled ? { consecutiveFailures: 0, disabledReason: null } : {}),
            updatedAt: new Date(),
          })
          .where(eq(webhooks.id, req.params.id));
        await audit(tx, req, {
          action: 'webhook.updated',
          entityType: 'webhook',
          entityId: req.params.id,
          after: req.body,
        });
        return { ok: true };
      });
    },
  );
  app.get(
    '/admin/webhooks/:id/deliveries',
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      requirePerm(req, 'webhook.manage');
      const { webhookDeliveries } = await import('../db/schema/index.js');
      return db(req, async (tx) => ({
        items: await tx
          .select()
          .from(webhookDeliveries)
          .where(eq(webhookDeliveries.webhookId, req.params.id))
          .orderBy(desc(webhookDeliveries.createdAt))
          .limit(100),
      }));
    },
  );

  // ═════════════ Margin rules (versioned, step-up, simulation) ═════════════
  const ruleSchema: z.ZodType<MarginRule> = z.object({
    id: z.string().min(1).max(60),
    name: z.string().min(1).max(120),
    scope: z.enum(MARGIN_SCOPES),
    component: z.enum(['PRODUCT', 'FREIGHT', 'INSPECTION', 'SERVICE', 'DOMESTIC_DELIVERY', 'ALL']),
    action: z.enum(['SET', 'ADD']),
    markupPct: z.string().regex(/^-?\d+(\.\d+)?$/),
    priority: z.number().int(),
    active: z.boolean(),
    match: z.object({
      category: z.string().optional(),
      subcategory: z.string().optional(),
      hsPrefix: z.string().optional(),
      sourceType: z
        .enum([
          'PUBLIC_MARKET',
          'PRIVATE_NETWORK',
          'DIRECT_FACTORY',
          'LOCAL_PARTNER',
          'INTERNAL_PRODUCT',
          'RFQ_RESULT',
          'MANUAL_PROPOSAL',
          'CUSTOMER_NOMINATED',
        ])
        .optional(),
      supplierId: z.string().optional(),
      costMin: z.string().optional(),
      costMax: z.string().optional(),
      qtyMin: z.number().int().optional(),
      qtyMax: z.number().int().optional(),
      belowMoq: z.boolean().optional(),
      riskLevels: z.array(z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])).optional(),
      customerTier: z.string().optional(),
      attribute: z.object({ key: z.string(), equals: z.string() }).optional(),
    }),
    minMarkupPct: z.string().optional(),
    maxMarkupPct: z.string().optional(),
  }) as z.ZodType<MarginRule>;
  const marginConfigSchema = z.object({
    defaults: z.object({
      PRODUCT: z.string(),
      FREIGHT: z.string(),
      INSPECTION: z.string(),
      SERVICE: z.string(),
      DOMESTIC_DELIVERY: z.string(),
    }),
    globalMinMarkupPct: z.string().optional(),
    globalMaxMarkupPct: z.string().optional(),
    rounding: z.object({
      mode: z.enum(['HALF_UP', 'HALF_EVEN', 'UP', 'DOWN', 'CEIL', 'FLOOR']),
      step: z.string().optional(),
    }),
    taxPassThrough: z.boolean(),
  });

  app.get('/admin/margin', async (req) => {
    requirePerm(req, 'cost.read');
    const tenant = tenantOf(req);
    return db(req, async (tx) => {
      const current = await publishedMarginSet(tx, tenant.id);
      const history = await tx
        .select({
          id: marginRuleSets.id,
          version: marginRuleSets.version,
          status: marginRuleSets.status,
          note: marginRuleSets.note,
          publishedAt: marginRuleSets.publishedAt,
          createdAt: marginRuleSets.createdAt,
        })
        .from(marginRuleSets)
        .orderBy(desc(marginRuleSets.version))
        .limit(30);
      const [draft] = await tx
        .select()
        .from(marginRuleSets)
        .where(eq(marginRuleSets.status, 'DRAFT'))
        .orderBy(desc(marginRuleSets.version))
        .limit(1);
      return { current, draft: draft ?? null, history };
    });
  });

  app.put(
    '/admin/margin/draft',
    {
      schema: {
        body: z.object({
          config: marginConfigSchema,
          rules: z.array(ruleSchema).max(500),
          note: z.string().max(500).default(''),
        }),
      },
    },
    async (req) => {
      const tenant = tenantOf(req);
      const user = requirePerm(req, 'margin.manage');
      return db(req, async (tx) => {
        const [draft] = await tx
          .select()
          .from(marginRuleSets)
          .where(eq(marginRuleSets.status, 'DRAFT'))
          .limit(1);
        if (draft) {
          await tx
            .update(marginRuleSets)
            .set({ config: req.body.config, rules: req.body.rules, note: req.body.note, createdBy: user.id })
            .where(eq(marginRuleSets.id, draft.id));
          return { id: draft.id, version: draft.version };
        }
        const [max] = await tx
          .select({ v: sql<number>`coalesce(max(${marginRuleSets.version}),0)::int` })
          .from(marginRuleSets);
        const [row] = await tx
          .insert(marginRuleSets)
          .values({
            tenantId: tenant.id,
            version: (max?.v ?? 0) + 1,
            status: 'DRAFT',
            config: req.body.config,
            rules: req.body.rules,
            note: req.body.note,
            createdBy: user.id,
          })
          .returning();
        return { id: row!.id, version: row!.version };
      });
    },
  );

  /** "What if": re-price the last N cost snapshots with the draft vs the published rules. */
  app.post(
    '/admin/margin/simulate',
    {
      schema: {
        body: z.object({
          config: marginConfigSchema,
          rules: z.array(ruleSchema).max(500),
          sampleSize: z.number().int().min(1).max(500).default(100),
        }),
      },
    },
    async (req) => {
      const tenant = tenantOf(req);
      requirePerm(req, 'cost.read');
      return db(req, async (tx) => {
        const current = await publishedMarginSet(tx, tenant.id);
        const calcs = await tx
          .select()
          .from(costCalculations)
          .orderBy(desc(costCalculations.createdAt))
          .limit(req.body.sampleSize);
        const samples = calcs.map((c) => {
          const res = c.result as {
            lines?: Array<{ component: string; totalBase: string; includedInLandedCost: boolean }>;
            perUnitLandedCostBase?: string;
          };
          return {
            costs: (res.lines ?? [])
              .filter((l) => l.includedInLandedCost)
              .map((l) => ({ component: l.component as never, totalCostBase: l.totalBase })),
            quantity: c.quantity,
            ctx: { unitCostBase: res.perUnitLandedCostBase ?? c.landedCostPerUnit, quantity: c.quantity },
          };
        });
        const sim = simulateMarginChange(
          samples,
          'KRW',
          { rules: current.rules, config: current.config },
          { rules: req.body.rules, config: req.body.config as MarginConfig },
        );
        return {
          ...sim,
          note: samples.length
            ? `최근 ${samples.length}건의 원가 계산에 적용한 결과입니다.`
            : '시뮬레이션할 원가 계산 기록이 없습니다.',
        };
      });
    },
  );

  app.post('/admin/margin/publish', async (req) => {
    const tenant = tenantOf(req);
    const user = requirePerm(req, 'margin.manage');
    return db(req, async (tx) => {
      const [draft] = await tx
        .select()
        .from(marginRuleSets)
        .where(eq(marginRuleSets.status, 'DRAFT'))
        .limit(1);
      if (!draft) throw badRequest('게시할 초안이 없습니다.');
      const before = await publishedMarginSet(tx, tenant.id);
      await tx
        .update(marginRuleSets)
        .set({ status: 'ARCHIVED' })
        .where(eq(marginRuleSets.status, 'PUBLISHED'));
      await tx
        .update(marginRuleSets)
        .set({ status: 'PUBLISHED', publishedBy: user.id, publishedAt: new Date() })
        .where(eq(marginRuleSets.id, draft.id));
      await audit(tx, req, {
        action: 'margin.published',
        entityType: 'margin_rule_set',
        entityId: draft.id,
        before: { version: before.version, defaults: before.config.defaults, rules: before.rules.length },
        after: { version: draft.version, config: draft.config, rules: (draft.rules as unknown[]).length },
      });
      return { ok: true, version: draft.version };
    });
  });

  // Feature flags / invalidation helper for platform changes
  app.post('/admin/features/refresh', async (req) => {
    const tenant = tenantOf(req);
    requirePerm(req, 'tenant.settings.read');
    await invalidateFeatures(tenant.id);
    return { ok: true };
  });
}
