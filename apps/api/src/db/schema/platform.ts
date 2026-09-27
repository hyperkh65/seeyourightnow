import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext, createdAt, id, tenantId, ts, updatedAt } from './_common.js';

// ─────────────────────────── Platform (SaaS) level ───────────────────────────

export const plans = pgTable('plans', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  features: jsonb('features').$type<string[]>().notNull().default([]),
  limits: jsonb('limits').$type<Record<string, { value: number; hard: boolean }>>().notNull().default({}),
  priceMonthly: text('price_monthly'),
  currency: text('currency').notNull().default('KRW'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const tenants = pgTable('tenants', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  status: text('status').notNull().default('ACTIVE'), // ACTIVE | SUSPENDED | DELETED
  isDemo: boolean('is_demo').notNull().default(false),
  setupCompletedAt: ts('setup_completed_at'),
  setupState: jsonb('setup_state').$type<Record<string, 'DONE' | 'SKIPPED'>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: id(),
    tenantId: tenantId(),
    planId: uuid('plan_id').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    limitOverrides: jsonb('limit_overrides').$type<Record<string, { value: number; hard: boolean }>>().notNull().default({}),
    featureOverrides: jsonb('feature_overrides').$type<Record<string, boolean>>().notNull().default({}),
    currentPeriodStart: ts('current_period_start').notNull().defaultNow(),
    currentPeriodEnd: ts('current_period_end'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('subscriptions_tenant_uq').on(t.tenantId)],
);

export const usageCounters = pgTable(
  'usage_counters',
  {
    id: id(),
    tenantId: tenantId(),
    metric: text('metric').notNull(),
    period: text('period').notNull(), // YYYY-MM
    count: integer('count').notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('usage_counters_uq').on(t.tenantId, t.metric, t.period)],
);

export const tenantDomains = pgTable(
  'tenant_domains',
  {
    id: id(),
    tenantId: tenantId(),
    hostname: text('hostname').notNull(),
    kind: text('kind').notNull(), // SUBDOMAIN | CUSTOM
    verificationToken: text('verification_token').notNull(),
    dnsStatus: text('dns_status').notNull().default('PENDING'), // PENDING | VERIFIED | FAILED
    sslStatus: text('ssl_status').notNull().default('PENDING'), // PENDING | ISSUED | FAILED | NOT_REQUIRED
    active: boolean('active').notNull().default(false),
    isPrimary: boolean('is_primary').notNull().default(false),
    lastCheckedAt: ts('last_checked_at'),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('tenant_domains_hostname_uq').on(t.hostname)],
);

/** Versioned configuration sections with Draft → Preview → Publish. */
export const configVersions = pgTable(
  'config_versions',
  {
    id: id(),
    tenantId: tenantId(),
    section: text('section').notNull(),
    version: integer('version').notNull(),
    status: text('status').notNull(), // DRAFT | PUBLISHED | ARCHIVED
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    previewToken: text('preview_token'),
    createdBy: uuid('created_by'),
    publishedBy: uuid('published_by'),
    publishedAt: ts('published_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('config_versions_uq').on(t.tenantId, t.section, t.version),
    index('config_versions_status_idx').on(t.tenantId, t.section, t.status),
  ],
);

export const bankAccounts = pgTable('bank_accounts', {
  id: id(),
  tenantId: tenantId(),
  label: text('label').notNull().default(''),
  bankName: text('bank_name').notNull(),
  accountNumber: text('account_number').notNull(),
  accountHolder: text('account_holder').notNull(),
  currency: text('currency').notNull().default('KRW'),
  swift: text('swift').notNull().default(''),
  bankAddress: text('bank_address').notNull().default(''),
  intermediaryInfo: text('intermediary_info').notNull().default(''),
  isDefault: boolean('is_default').notNull().default(false),
  showOnDocuments: boolean('show_on_documents').notNull().default(true),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const featureFlags = pgTable(
  'feature_flags',
  {
    id: id(),
    tenantId: tenantId(),
    module: text('module').notNull(),
    enabled: boolean('enabled').notNull(),
    updatedBy: uuid('updated_by'),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('feature_flags_uq').on(t.tenantId, t.module)],
);

// ─────────────────────────── Identity ───────────────────────────

export const users = pgTable(
  'users',
  {
    id: id(),
    /** NULL only for platform super admins. */
    tenantId: uuid('tenant_id'),
    email: citext('email').notNull(),
    name: text('name').notNull().default(''),
    phone: text('phone').notNull().default(''),
    passwordHash: text('password_hash'),
    status: text('status').notNull().default('ACTIVE'), // ACTIVE | INVITED | DISABLED
    isSuperAdmin: boolean('is_super_admin').notNull().default(false),
    companyId: uuid('company_id'), // customer users → their company
    expertTypes: jsonb('expert_types').$type<string[]>().notNull().default([]),
    locale: text('locale').notNull().default('ko'),
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    mfaSecretEnc: text('mfa_secret_enc'),
    mfaRecoveryHashes: jsonb('mfa_recovery_hashes').$type<string[]>().notNull().default([]),
    emailVerifiedAt: ts('email_verified_at'),
    lastLoginAt: ts('last_login_at'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: ts('locked_until'),
    anonymizedAt: ts('anonymized_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_tenant_email_uq').on(t.tenantId, t.email).where(sql`${t.tenantId} is not null`),
    uniqueIndex('users_platform_email_uq').on(t.email).where(sql`${t.tenantId} is null`),
  ],
);

export const userRoles = pgTable(
  'user_roles',
  {
    id: id(),
    tenantId: uuid('tenant_id'),
    userId: uuid('user_id').notNull(),
    role: text('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('user_roles_uq').on(t.userId, t.role)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    tenantId: uuid('tenant_id'),
    userId: uuid('user_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    previousTokenHash: text('previous_token_hash'),
    csrfToken: text('csrf_token').notNull(),
    mfaVerified: boolean('mfa_verified').notNull().default(false),
    stepUpAt: ts('step_up_at'),
    impersonatorId: uuid('impersonator_id'),
    ip: text('ip').notNull().default(''),
    userAgent: text('user_agent').notNull().default(''),
    deviceLabel: text('device_label').notNull().default(''),
    rotatedAt: ts('rotated_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    idleExpiresAt: ts('idle_expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('sessions_token_uq').on(t.tokenHash), index('sessions_user_idx').on(t.userId)],
);

export const passkeys = pgTable('passkeys', {
  id: id(),
  tenantId: uuid('tenant_id'),
  userId: uuid('user_id').notNull(),
  credentialId: text('credential_id').notNull().unique(),
  publicKey: text('public_key').notNull(),
  counter: integer('counter').notNull().default(0),
  transports: jsonb('transports').$type<string[]>().notNull().default([]),
  label: text('label').notNull().default(''),
  lastUsedAt: ts('last_used_at'),
  createdAt: createdAt(),
});

export const authChallenges = pgTable('auth_challenges', {
  id: id(),
  tenantId: uuid('tenant_id'),
  userId: uuid('user_id'),
  purpose: text('purpose').notNull(), // PASSKEY_REGISTER | PASSKEY_LOGIN | PASSWORD_RESET | EMAIL_VERIFY | INVITE
  challenge: text('challenge').notNull(),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
  createdAt: createdAt(),
});

export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: id(),
    tenantId: uuid('tenant_id'),
    email: text('email').notNull(),
    ip: text('ip').notNull(),
    success: boolean('success').notNull(),
    reason: text('reason').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [index('login_attempts_ip_idx').on(t.ip, t.createdAt)],
);
