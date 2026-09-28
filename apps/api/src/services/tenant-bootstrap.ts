import { eq } from 'drizzle-orm';
import { DEFAULT_MARGIN_CONFIG, defaultHomepage, type Role } from '@sos/core';
import { config } from '../config.js';
import { systemDb, withTenant, type Tx } from '../db/client.js';
import {
  documentTemplates,
  documentTemplateVersions,
  emailTemplates,
  marginRuleSets,
  plans,
  policies,
  subscriptions,
  tenantDomains,
  tenants,
  userRoles,
  users,
} from '../db/schema/index.js';
import { randomToken } from '../lib/crypto.js';
import { conflict } from '../lib/errors.js';
import { hashPassword } from './auth.js';
import { publishSection } from './settings.js';
import { BASE_CSS, DEFAULT_CONTRACT_CLAUSES, DOCUMENT_TEMPLATE_DEFAULTS, EMAIL_TEMPLATE_DEFAULTS, POLICY_DEFAULTS } from './templates/defaults.js';

export interface CreateTenantInput {
  name: string;
  slug: string;
  planCode?: string;
  isDemo?: boolean;
  owner: { email: string; name: string; password?: string | null };
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;
const RESERVED = new Set(['www', 'api', 'platform', 'admin', 'app', 'mail', 'static', 'assets', 'cdn', 'status']);

export function validateSlug(slug: string): string | null {
  if (!SLUG_RE.test(slug)) return '영문 소문자, 숫자, 하이픈 3~32자로 입력하세요.';
  if (RESERVED.has(slug)) return '예약된 주소입니다.';
  return null;
}

/** Creates a fully-usable tenant: subscription, subdomain, default settings, templates, margin rules, owner account. */
export async function createTenant(input: CreateTenantInput): Promise<{ tenantId: string; ownerId: string; inviteToken: string | null }> {
  const slugProblem = validateSlug(input.slug);
  if (slugProblem) throw conflict(slugProblem);
  const [dup] = await systemDb.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, input.slug)).limit(1);
  if (dup) throw conflict('이미 사용 중인 주소입니다.');

  const [tenant] = await systemDb.insert(tenants).values({ slug: input.slug, name: input.name, isDemo: input.isDemo ?? false }).returning({ id: tenants.id });
  const tenantId = tenant!.id;

  const [plan] = await systemDb.select().from(plans).where(eq(plans.code, input.planCode ?? 'BUSINESS')).limit(1);
  if (plan) await systemDb.insert(subscriptions).values({ tenantId, planId: plan.id });

  await systemDb.insert(tenantDomains).values({
    tenantId,
    hostname: `${input.slug}.${config.PLATFORM_BASE_DOMAIN}`,
    kind: 'SUBDOMAIN',
    verificationToken: randomToken(16),
    dnsStatus: 'VERIFIED',
    sslStatus: 'NOT_REQUIRED',
    active: true,
    isPrimary: true,
  });

  const passwordHash = input.owner.password ? await hashPassword(input.owner.password) : null;
  const [owner] = await systemDb
    .insert(users)
    .values({ tenantId, email: input.owner.email.toLowerCase(), name: input.owner.name, passwordHash, status: passwordHash ? 'ACTIVE' : 'INVITED', emailVerifiedAt: passwordHash ? new Date() : null })
    .returning({ id: users.id });
  await systemDb.insert(userRoles).values({ tenantId, userId: owner!.id, role: 'TENANT_OWNER' satisfies Role });

  await withTenant({ tenantId, userId: owner!.id }, async (tx) => {
    await installTenantDefaults(tx, tenantId, input.name, owner!.id);
  });

  let inviteToken: string | null = null;
  if (!passwordHash) {
    const { createInvite } = await import('./invites.js');
    inviteToken = await createInvite(tenantId, owner!.id);
  }
  return { tenantId, ownerId: owner!.id, inviteToken };
}

export async function installTenantDefaults(tx: Tx, tenantId: string, name: string, userId: string): Promise<void> {
  await publishSection(tx, tenantId, 'brand', { siteName: name, serviceName: `${name} AI 소싱`, companyDisplayName: name }, userId);
  await publishSection(tx, tenantId, 'company', { legalName: name }, userId);
  await publishSection(tx, tenantId, 'homepage', defaultHomepage(name), userId);
  await publishSection(tx, tenantId, 'footer', { copyright: `© ${new Date().getFullYear()} ${name}` }, userId);
  for (const s of ['social', 'pricing', 'numbering', 'locale', 'search', 'ai', 'notifications', 'privacy'] as const) {
    await publishSection(tx, tenantId, s, {}, userId);
  }

  await tx.insert(marginRuleSets).values({ tenantId, version: 1, status: 'PUBLISHED', config: DEFAULT_MARGIN_CONFIG as unknown as Record<string, unknown>, rules: [], note: '기본 마진 설정', createdBy: userId, publishedBy: userId, publishedAt: new Date() });

  for (const t of DOCUMENT_TEMPLATE_DEFAULTS) {
    const [tpl] = await tx.insert(documentTemplates).values({ tenantId, kind: t.kind, name: t.name }).returning({ id: documentTemplates.id });
    const [ver] = await tx
      .insert(documentTemplateVersions)
      .values({
        tenantId,
        templateId: tpl!.id,
        version: 1,
        status: 'PUBLISHED',
        html: t.html,
        css: BASE_CSS,
        defaultClauses: t.kind === 'CONTRACT' ? DEFAULT_CONTRACT_CLAUSES : [],
        requiresLegalReview: t.requiresLegalReview ?? false,
        createdBy: userId,
        publishedAt: new Date(),
      })
      .returning({ id: documentTemplateVersions.id });
    await tx.update(documentTemplates).set({ publishedVersionId: ver!.id }).where(eq(documentTemplates.id, tpl!.id));
  }

  for (const [trigger, t] of Object.entries(EMAIL_TEMPLATE_DEFAULTS)) {
    await tx.insert(emailTemplates).values({ tenantId, trigger, version: 1, status: 'PUBLISHED', subject: t.subject, bodyHtml: t.body, createdBy: userId });
  }

  for (const p of POLICY_DEFAULTS) {
    await tx.insert(policies).values({ tenantId, type: p.type, version: 1, title: p.title, body: p.body, status: 'PUBLISHED', publishedAt: new Date(), createdBy: userId });
  }
}
