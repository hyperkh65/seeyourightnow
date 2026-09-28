import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, tenantId, ts, updatedAt } from './_common.js';

// ─────────────────────────── Files & documents ───────────────────────────

export const files = pgTable(
  'files',
  {
    id: id(),
    tenantId: tenantId(),
    storageKey: text('storage_key').notNull(),
    bucket: text('bucket').notNull(),
    originalName: text('original_name').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    purpose: text('purpose').notNull(), // SEARCH_IMAGE | PRODUCT_IMAGE | DOCUMENT | BRAND_ASSET | ATTACHMENT | EXPORT
    scanStatus: text('scan_status').notNull().default('PENDING'), // PENDING | CLEAN | INFECTED | NOT_SCANNED | ERROR
    scanDetail: text('scan_detail').notNull().default(''),
    isPublicAsset: boolean('is_public_asset').notNull().default(false), // brand logos served via tenant asset route
    uploadedBy: uuid('uploaded_by'),
    createdAt: createdAt(),
  },
  (t) => [index('files_sha_idx').on(t.tenantId, t.sha256)],
);

export const documentTemplates = pgTable(
  'document_templates',
  {
    id: id(),
    tenantId: tenantId(),
    kind: text('kind').notNull(), // QUOTATION | CONTRACT | PROFORMA_INVOICE | ...
    locale: text('locale').notNull().default('ko'),
    name: text('name').notNull(),
    publishedVersionId: uuid('published_version_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('document_templates_uq').on(t.tenantId, t.kind, t.locale)],
);

export const documentTemplateVersions = pgTable(
  'document_template_versions',
  {
    id: id(),
    tenantId: tenantId(),
    templateId: uuid('template_id').notNull(),
    version: integer('version').notNull(),
    status: text('status').notNull(), // DRAFT | PUBLISHED | ARCHIVED
    html: text('html').notNull(),
    css: text('css').notNull().default(''),
    defaultClauses: jsonb('default_clauses')
      .$type<Array<{ key: string; title: string; body: string }>>()
      .notNull()
      .default([]),
    requiresLegalReview: boolean('requires_legal_review').notNull().default(false),
    createdBy: uuid('created_by'),
    publishedAt: ts('published_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('document_template_versions_uq').on(t.templateId, t.version)],
);

/** Issued documents are immutable. A change produces a new row with version+1. */
export const documents = pgTable(
  'documents',
  {
    id: id(),
    tenantId: tenantId(),
    kind: text('kind').notNull(),
    number: text('number').notNull(),
    version: integer('version').notNull().default(1),
    projectId: uuid('project_id'),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    templateVersionId: uuid('template_version_id'),
    fileId: uuid('file_id').notNull(),
    sha256: text('sha256').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    renderer: text('renderer').notNull(), // GOTENBERG | CHROMIUM
    customerVisible: boolean('customer_visible').notNull().default(true),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('documents_uq').on(t.tenantId, t.kind, t.number, t.version),
    index('documents_project_idx').on(t.tenantId, t.projectId),
  ],
);

// ─────────────────────────── Legal policies ───────────────────────────

export const policies = pgTable(
  'policies',
  {
    id: id(),
    tenantId: tenantId(),
    type: text('type').notNull(), // PRIVACY | TERMS | SOURCING_TERMS | QUOTATION_NOTICE | CANCELLATION | REFUND | SHIPPING
    version: integer('version').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    status: text('status').notNull(), // DRAFT | PUBLISHED | ARCHIVED
    publishedAt: ts('published_at'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('policies_uq').on(t.tenantId, t.type, t.version)],
);

export const policyConsents = pgTable('policy_consents', {
  id: id(),
  tenantId: tenantId(),
  userId: uuid('user_id').notNull(),
  policyId: uuid('policy_id').notNull(),
  policyType: text('policy_type').notNull(),
  policyVersion: integer('policy_version').notNull(),
  ip: text('ip').notNull().default(''),
  userAgent: text('user_agent').notNull().default(''),
  createdAt: createdAt(),
});

// ─────────────────────────── Integrations ───────────────────────────

export const apiConnections = pgTable(
  'api_connections',
  {
    id: id(),
    tenantId: tenantId(),
    category: text('category').notNull(),
    provider: text('provider').notNull(),
    label: text('label').notNull().default(''),
    enabled: boolean('enabled').notNull().default(false),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    secretRefs: jsonb('secret_refs').$type<Record<string, string>>().notNull().default({}),
    status: text('status').notNull().default('DISCONNECTED'),
    lastTestAt: ts('last_test_at'),
    lastSuccessAt: ts('last_success_at'),
    lastError: text('last_error'),
    circuitOpenUntil: ts('circuit_open_until'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('api_connections_tenant_idx').on(t.tenantId, t.category)],
);

/** Secret store (built-in adapter). Values are AES-256-GCM encrypted; only last4 is ever shown. */
export const secrets = pgTable(
  'secrets',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    backend: text('backend').notNull().default('BUILTIN'), // BUILTIN | VAULT | INFISICAL
    externalRef: text('external_ref').notNull().default(''),
    ciphertext: text('ciphertext'),
    keyVersion: integer('key_version').notNull().default(1),
    last4: text('last4').notNull().default(''),
    version: integer('version').notNull().default(1),
    rotatedAt: ts('rotated_at'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('secrets_name_uq').on(t.tenantId, t.name)],
);

export const webhooks = pgTable('webhooks', {
  id: id(),
  tenantId: tenantId(),
  url: text('url').notNull(),
  events: jsonb('events').$type<string[]>().notNull().default([]),
  secretRef: text('secret_ref').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  disabledReason: text('disabled_reason'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: id(),
    tenantId: tenantId(),
    webhookId: uuid('webhook_id').notNull(),
    event: text('event').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    status: text('status').notNull().default('PENDING'), // PENDING | SUCCESS | FAILED
    attempts: integer('attempts').notNull().default(0),
    responseStatus: integer('response_status'),
    responseBody: text('response_body'),
    lastAttemptAt: ts('last_attempt_at'),
    createdAt: createdAt(),
  },
  (t) => [index('webhook_deliveries_idx').on(t.tenantId, t.webhookId, t.createdAt)],
);

// ─────────────────────────── Messaging ───────────────────────────

export const emailTemplates = pgTable(
  'email_templates',
  {
    id: id(),
    tenantId: tenantId(),
    trigger: text('trigger').notNull(),
    locale: text('locale').notNull().default('ko'),
    version: integer('version').notNull(),
    status: text('status').notNull(), // DRAFT | PUBLISHED | ARCHIVED
    subject: text('subject').notNull(),
    bodyHtml: text('body_html').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('email_templates_uq').on(t.tenantId, t.trigger, t.locale, t.version)],
);

export const emails = pgTable(
  'emails',
  {
    id: id(),
    tenantId: tenantId(),
    trigger: text('trigger'),
    projectId: uuid('project_id'),
    toAddress: text('to_address').notNull(),
    fromAddress: text('from_address').notNull(),
    subject: text('subject').notNull(),
    bodyHtml: text('body_html').notNull(),
    attachments: jsonb('attachments').$type<Array<{ fileId: string; name: string }>>().notNull().default([]),
    status: text('status').notNull().default('QUEUED'), // QUEUED | SENT | DELIVERED | FAILED | NOT_CONFIGURED | SUPPRESSED
    providerMessageId: text('provider_message_id'),
    error: text('error'),
    dedupeKey: text('dedupe_key'),
    direction: text('direction').notNull().default('OUTBOUND'), // OUTBOUND | INBOUND
    sentAt: ts('sent_at'),
    openedAt: ts('opened_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('emails_dedupe_uq').on(t.tenantId, t.dedupeKey),
    index('emails_project_idx').on(t.tenantId, t.projectId),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id').notNull(),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    link: text('link').notNull().default(''),
    projectId: uuid('project_id'),
    severity: text('severity').notNull().default('INFO'), // INFO | WARNING | CRITICAL
    channels: jsonb('channels').$type<string[]>().notNull().default(['WEB']),
    dedupeKey: text('dedupe_key'),
    readAt: ts('read_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_user_idx').on(t.tenantId, t.userId, t.readAt),
    uniqueIndex('notifications_dedupe_uq').on(t.tenantId, t.userId, t.dedupeKey),
  ],
);

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id').notNull(),
    kind: text('kind').notNull(), // trigger or '*'
    channels: jsonb('channels').$type<string[]>().notNull().default(['WEB', 'EMAIL']),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('notification_preferences_uq').on(t.tenantId, t.userId, t.kind)],
);

// ─────────────────────────── Reliability ───────────────────────────

export const jobs = pgTable(
  'jobs',
  {
    id: id(),
    tenantId: tenantId(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status').notNull().default('PENDING'),
    priority: integer('priority').notNull().default(100),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    runAt: ts('run_at').notNull().defaultNow(),
    lockedAt: ts('locked_at'),
    lockedBy: text('locked_by'),
    lastError: text('last_error'),
    result: jsonb('result').$type<unknown>(),
    dedupeKey: text('dedupe_key'),
    finishedAt: ts('finished_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('jobs_poll_idx').on(t.status, t.runAt, t.priority),
    uniqueIndex('jobs_dedupe_uq').on(t.tenantId, t.dedupeKey),
  ],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id'),
    key: text('key').notNull(),
    route: text('route').notNull(),
    requestHash: text('request_hash').notNull(),
    status: text('status').notNull().default('IN_PROGRESS'), // IN_PROGRESS | COMPLETED
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body').$type<unknown>(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('idempotency_keys_uq').on(t.tenantId, t.key, t.route)],
);

/** Durable workflow instances (DB-persisted state machine with human-in-the-loop waits). */
export const workflowInstances = pgTable(
  'workflow_instances',
  {
    id: id(),
    tenantId: tenantId(),
    definition: text('definition').notNull(), // ORDER_FULFILLMENT
    version: integer('version').notNull().default(1),
    projectId: uuid('project_id'),
    currentStep: text('current_step').notNull(),
    status: text('status').notNull().default('RUNNING'), // RUNNING | WAITING_HUMAN | COMPLETED | FAILED | CANCELLED
    waitingFor: text('waiting_for'),
    context: jsonb('context').$type<Record<string, unknown>>().notNull().default({}),
    history: jsonb('history')
      .$type<Array<{ step: string; status: string; at: string; by?: string | null; note?: string }>>()
      .notNull()
      .default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('workflow_project_def_uq').on(t.tenantId, t.projectId, t.definition)],
);

/** Append-only audit log (UPDATE/DELETE revoked at the database level). */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    tenantId: uuid('tenant_id'),
    actorId: uuid('actor_id'),
    actorRole: text('actor_role').notNull().default(''),
    impersonatorId: uuid('impersonator_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull().default(''),
    before: jsonb('before').$type<unknown>(),
    after: jsonb('after').$type<unknown>(),
    ip: text('ip').notNull().default(''),
    userAgent: text('user_agent').notNull().default(''),
    requestId: text('request_id').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_tenant_idx').on(t.tenantId, t.createdAt),
    index('audit_logs_entity_idx').on(t.tenantId, t.entityType, t.entityId),
  ],
);

// ─────────────────────────── AI accounting & learning ───────────────────────────

export const aiUsage = pgTable(
  'ai_usage',
  {
    id: id(),
    tenantId: tenantId(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    task: text('task').notNull(), // VISION_UNDERSTAND | TEXT_STRUCTURE | TRANSLATE | EMBED | OCR | RFQ_PARSE
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    latencyMs: integer('latency_ms').notNull().default(0),
    success: boolean('success').notNull(),
    fallbackUsed: boolean('fallback_used').notNull().default(false),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [index('ai_usage_tenant_idx').on(t.tenantId, t.createdAt)],
);

/** Every AI/system prediction, paired later with human corrections and actual outcomes. */
export const modelPredictions = pgTable(
  'model_predictions',
  {
    id: id(),
    tenantId: tenantId(),
    kind: text('kind').notNull(), // HS | FREIGHT | LANDED_COST | ATTRIBUTE | COMPLIANCE | IMAGE_MATCH | ETA
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    predicted: jsonb('predicted').$type<unknown>().notNull(),
    model: text('model').notNull().default(''),
    confidence: real('confidence'),
    humanValue: jsonb('human_value').$type<unknown>(),
    humanBy: uuid('human_by'),
    humanAt: ts('human_at'),
    actualValue: jsonb('actual_value').$type<unknown>(),
    actualAt: ts('actual_at'),
    approvedForTraining: boolean('approved_for_training').notNull().default(false),
    approvedBy: uuid('approved_by'),
    createdAt: createdAt(),
  },
  (t) => [index('model_predictions_kind_idx').on(t.tenantId, t.kind, t.createdAt)],
);

/** Human overrides of any AI result: original, changed, reason, who, when. */
export const overrides = pgTable('overrides', {
  id: id(),
  tenantId: tenantId(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  field: text('field').notNull(),
  original: jsonb('original').$type<unknown>(),
  changed: jsonb('changed').$type<unknown>(),
  reason: text('reason').notNull(),
  actorId: uuid('actor_id').notNull(),
  createdAt: createdAt(),
});

export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    properties: jsonb('properties').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('analytics_events_idx').on(t.tenantId, t.name, t.createdAt)],
);

export const numberSequences = pgTable(
  'number_sequences',
  {
    id: id(),
    tenantId: tenantId(),
    docType: text('doc_type').notNull(),
    scope: text('scope').notNull(),
    nextValue: integer('next_value').notNull().default(1),
  },
  (t) => [uniqueIndex('number_sequences_uq').on(t.tenantId, t.docType, t.scope)],
);

export const importJobs = pgTable('import_jobs', {
  id: id(),
  tenantId: tenantId(),
  entity: text('entity').notNull(), // SUPPLIERS | PRODUCTS | CUSTOMERS | FREIGHT_RATES | MARGIN_RULES | HS_HISTORY
  fileId: uuid('file_id'),
  status: text('status').notNull().default('PENDING'),
  totalRows: integer('total_rows').notNull().default(0),
  importedRows: integer('imported_rows').notNull().default(0),
  errors: jsonb('errors').$type<Array<{ row: number; message: string }>>().notNull().default([]),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
