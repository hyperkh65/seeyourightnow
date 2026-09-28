import { boolean, index, integer, jsonb, pgTable, real, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, money, rate, tenantId, ts, updatedAt } from './_common.js';

// ─────────────────────────── HS / tariff (reference data) ───────────────────────────

/** HS nomenclature. tenant_id NULL = platform reference data shared by all tenants (read-only to tenants). */
export const hsCodes = pgTable(
  'hs_codes',
  {
    id: id(),
    tenantId: uuid('tenant_id'),
    code: text('code').notNull(), // digits only, 4/6/10
    level: integer('level').notNull(),
    descriptionKo: text('description_ko').notNull().default(''),
    descriptionEn: text('description_en').notNull().default(''),
    keywords: jsonb('keywords').$type<string[]>().notNull().default([]),
    importRequirements: jsonb('import_requirements').$type<string[]>().notNull().default([]),
    source: text('source').notNull(),
    verification: text('verification').notNull().default('UNVERIFIED'),
    effectiveFrom: text('effective_from'),
    effectiveTo: text('effective_to'),
    createdAt: createdAt(),
  },
  (t) => [index('hs_codes_code_idx').on(t.code)],
);

export const tariffRates = pgTable(
  'tariff_rates',
  {
    id: id(),
    tenantId: uuid('tenant_id'),
    hsCode: text('hs_code').notNull(),
    rateType: text('rate_type').notNull(), // BASIC | WTO | FTA_KR_CN | RCEP | APTA | ...
    ratePct: rate('rate_pct'),
    specificDuty: text('specific_duty'),
    originCountry: text('origin_country').notNull().default('*'),
    requiresCertificateOfOrigin: boolean('requires_coo').notNull().default(false),
    source: text('source').notNull(),
    sourceUrl: text('source_url').notNull().default(''),
    verification: text('verification').notNull().default('UNVERIFIED'),
    validFrom: text('valid_from'),
    validTo: text('valid_to'),
    collectedAt: ts('collected_at').notNull().defaultNow(),
  },
  (t) => [index('tariff_rates_hs_idx').on(t.hsCode, t.rateType)],
);

/** Per-product HS classification: estimate, verified and actual are separate columns and never overwrite each other. */
export const hsClassifications = pgTable(
  'hs_classifications',
  {
    id: id(),
    tenantId: tenantId(),
    productId: uuid('product_id').notNull(),
    candidates: jsonb('candidates')
      .$type<Array<{ code: string; description: string; score: number; reasons: string[]; source: string }>>()
      .notNull()
      .default([]),
    estimatedHs: text('estimated_hs'),
    estimatedConfidence: real('estimated_confidence'),
    estimatedSource: text('estimated_source').notNull().default(''),
    verifiedHs: text('verified_hs'),
    verifiedBy: uuid('verified_by'),
    verifiedAt: ts('verified_at'),
    verificationNote: text('verification_note').notNull().default(''),
    actualHs: text('actual_hs'),
    actualSource: text('actual_source').notNull().default(''),
    actualAt: ts('actual_at'),
    selectedRateType: text('selected_rate_type'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('hs_classifications_product_uq').on(t.productId)],
);

// ─────────────────────────── Regulations & compliance ───────────────────────────

export const regulations = pgTable('regulations', {
  id: id(),
  tenantId: uuid('tenant_id'), // NULL = platform-maintained rule
  code: text('code').notNull(),
  name: text('name').notNull(),
  authority: text('authority').notNull(),
  category: text('category').notNull(),
  active: boolean('active').notNull().default(true),
  currentVersionId: uuid('current_version_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const regulationVersions = pgTable(
  'regulation_versions',
  {
    id: id(),
    tenantId: uuid('tenant_id'),
    regulationId: uuid('regulation_id').notNull(),
    version: integer('version').notNull(),
    hsPrefixes: jsonb('hs_prefixes').$type<string[]>().notNull().default([]),
    triggerAll: jsonb('trigger_all').$type<string[]>().notNull().default([]),
    triggerAny: jsonb('trigger_any').$type<string[]>().notNull().default([]),
    exceptions: jsonb('exceptions').$type<string[]>().notNull().default([]),
    mandatory: boolean('mandatory').notNull().default(true),
    documentsRequired: jsonb('documents_required').$type<string[]>().notNull().default([]),
    testsRequired: jsonb('tests_required').$type<string[]>().notNull().default([]),
    expertType: text('expert_type'),
    officialSource: text('official_source').notNull().default(''),
    summary: text('summary').notNull().default(''),
    effectiveFrom: text('effective_from'),
    effectiveTo: text('effective_to'),
    changeNote: text('change_note').notNull().default(''),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('regulation_versions_uq').on(t.regulationId, t.version)],
);

export const complianceChecks = pgTable(
  'compliance_checks',
  {
    id: id(),
    tenantId: tenantId(),
    productId: uuid('product_id').notNull(),
    regulationId: uuid('regulation_id').notNull(),
    regulationVersionId: uuid('regulation_version_id').notNull(),
    /** Machine estimate (AI + rules). */
    estimatedStatus: text('estimated_status').notNull(),
    estimatedConfidence: real('estimated_confidence').notNull().default(0),
    reasons: jsonb('reasons').$type<string[]>().notNull().default([]),
    missingAttributes: jsonb('missing_attributes').$type<string[]>().notNull().default([]),
    /** Expert decision, stored separately from the estimate. */
    verifiedStatus: text('verified_status'),
    verifiedBy: uuid('verified_by'),
    verifiedAt: ts('verified_at'),
    expertNote: text('expert_note').notNull().default(''),
    estimatedCost: money('estimated_cost'),
    verifiedCost: money('verified_cost'),
    actualCost: money('actual_cost'),
    costCurrency: text('cost_currency').notNull().default('KRW'),
    certificateNumber: text('certificate_number').notNull().default(''),
    stale: boolean('stale').notNull().default(false), // regulation version changed since evaluation
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('compliance_checks_uq').on(t.productId, t.regulationId),
    index('compliance_checks_product_idx').on(t.tenantId, t.productId),
  ],
);

/** Append-only review history (who changed what, when, why). */
export const complianceReviews = pgTable('compliance_reviews', {
  id: id(),
  tenantId: tenantId(),
  checkId: uuid('check_id').notNull(),
  reviewerId: uuid('reviewer_id').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  note: text('note').notNull().default(''),
  attachments: jsonb('attachments').$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
});

/** Work items assigned to partner portals (customs brokers, labs, forwarders, suppliers). */
export const partnerTasks = pgTable(
  'partner_tasks',
  {
    id: id(),
    tenantId: tenantId(),
    partnerUserId: uuid('partner_user_id').notNull(),
    kind: text('kind').notNull(), // HS_REVIEW | COMPLIANCE_REVIEW | FREIGHT_QUOTE | SUPPLIER_RFQ
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    projectId: uuid('project_id'),
    title: text('title').notNull(),
    status: text('status').notNull().default('OPEN'), // OPEN | IN_PROGRESS | SUBMITTED | CANCELLED
    dueAt: ts('due_at'),
    submittedAt: ts('submitted_at'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('partner_tasks_user_idx').on(t.tenantId, t.partnerUserId, t.status)],
);

// ─────────────────────────── Freight ───────────────────────────

export const ports = pgTable('ports', {
  id: id(),
  unlocode: text('unlocode').notNull().unique(),
  name: text('name').notNull(),
  country: text('country').notNull(),
  lat: real('lat').notNull(),
  lon: real('lon').notNull(),
  geofenceKm: real('geofence_km').notNull().default(15),
  kind: text('kind').notNull().default('SEAPORT'), // SEAPORT | AIRPORT | INLAND
  source: text('source').notNull().default('UN/LOCODE'),
});

export const freightRates = pgTable(
  'freight_rates',
  {
    id: id(),
    tenantId: tenantId(),
    mode: text('mode').notNull(),
    origin: text('origin').notNull(),
    destination: text('destination').notNull(),
    source: text('source').notNull(),
    verification: text('verification').notNull().default('UNVERIFIED'),
    providerName: text('provider_name').notNull().default(''),
    currency: text('currency').notNull(),
    basis: text('basis').notNull(),
    rate: money('rate').notNull(),
    minCharge: money('min_charge'),
    fixedCharges: jsonb('fixed_charges')
      .$type<Array<{ name: string; amount: string }>>()
      .notNull()
      .default([]),
    transitDaysMin: integer('transit_days_min'),
    transitDaysMax: integer('transit_days_max'),
    validFrom: text('valid_from'),
    validUntil: text('valid_until'),
    note: text('note').notNull().default(''),
    collectedAt: ts('collected_at').notNull().defaultNow(),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [index('freight_rates_lane_idx').on(t.tenantId, t.mode, t.origin, t.destination)],
);

export const freightRfqs = pgTable('freight_rfqs', {
  id: id(),
  tenantId: tenantId(),
  code: text('code').notNull(),
  projectId: uuid('project_id'),
  requestId: uuid('request_id'),
  origin: text('origin').notNull(),
  destination: text('destination').notNull(),
  incoterm: text('incoterm').notNull().default('FOB'),
  cartons: integer('cartons').notNull(),
  cbm: rate('cbm').notNull(),
  grossWeightKg: rate('gross_weight_kg').notNull(),
  cargoType: text('cargo_type').notNull().default('GENERAL'),
  battery: boolean('battery').notNull().default(false),
  dangerousGoods: boolean('dangerous_goods').notNull().default(false),
  readyDate: text('ready_date'),
  modes: jsonb('modes').$type<string[]>().notNull().default([]),
  packing: jsonb('packing').$type<Record<string, unknown>>().notNull().default({}),
  status: text('status').notNull().default('OPEN'), // OPEN | QUOTED | AWARDED | CLOSED
  awardedQuoteId: uuid('awarded_quote_id'),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Freight quotes. kind separates estimate / partner-verified / actual — never overwritten. */
export const freightQuotes = pgTable(
  'freight_quotes',
  {
    id: id(),
    tenantId: tenantId(),
    rfqId: uuid('rfq_id'),
    projectId: uuid('project_id'),
    kind: text('kind').notNull(), // ESTIMATED | PARTNER_VERIFIED | ACTUAL
    mode: text('mode').notNull(),
    source: text('source').notNull(),
    partnerUserId: uuid('partner_user_id'),
    providerName: text('provider_name').notNull().default(''),
    currency: text('currency').notNull(),
    freight: money('freight'),
    originCharges: money('origin_charges'),
    destinationCharges: money('destination_charges'),
    customsCharges: money('customs_charges'),
    deliveryCharges: money('delivery_charges'),
    total: money('total').notNull(),
    totalBase: money('total_base'),
    transitDays: text('transit_days').notNull().default(''),
    validUntil: text('valid_until'),
    note: text('note').notNull().default(''),
    confirmedAt: ts('confirmed_at'),
    createdAt: createdAt(),
  },
  (t) => [index('freight_quotes_project_idx').on(t.tenantId, t.projectId)],
);

// ─────────────────────────── Cost & pricing ───────────────────────────

export const costCalculations = pgTable(
  'cost_calculations',
  {
    id: id(),
    tenantId: tenantId(),
    projectId: uuid('project_id'),
    requestId: uuid('request_id'),
    candidateId: uuid('candidate_id'),
    productId: uuid('product_id'),
    version: integer('version').notNull().default(1),
    kind: text('kind').notNull().default('ESTIMATED'), // ESTIMATED | VERIFIED | ACTUAL
    quantity: integer('quantity').notNull(),
    baseCurrency: text('base_currency').notNull().default('KRW'),
    inputs: jsonb('inputs').$type<Record<string, unknown>>().notNull(),
    result: jsonb('result').$type<Record<string, unknown>>().notNull(),
    landedCostTotal: money('landed_cost_total').notNull(),
    landedCostPerUnit: money('landed_cost_per_unit').notNull(),
    complete: boolean('complete').notNull().default(false),
    verification: text('verification').notNull(),
    fxSnapshot: jsonb('fx_snapshot').$type<unknown[]>().notNull().default([]),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [index('cost_calculations_project_idx').on(t.tenantId, t.projectId)],
);

export const costItems = pgTable('cost_items', {
  id: id(),
  tenantId: tenantId(),
  calculationId: uuid('calculation_id').notNull(),
  key: text('key').notNull(),
  component: text('component').notNull(),
  totalBase: money('total_base').notNull(),
  perUnitBase: rate('per_unit_base').notNull(),
  originalAmount: money('original_amount'),
  originalCurrency: text('original_currency'),
  source: text('source').notNull(),
  verification: text('verification').notNull(),
  included: boolean('included').notNull().default(true),
});

export const marginRuleSets = pgTable(
  'margin_rule_sets',
  {
    id: id(),
    tenantId: tenantId(),
    version: integer('version').notNull(),
    status: text('status').notNull(), // DRAFT | PUBLISHED | ARCHIVED
    config: jsonb('config').$type<Record<string, unknown>>().notNull(),
    rules: jsonb('rules').$type<unknown[]>().notNull().default([]),
    note: text('note').notNull().default(''),
    createdBy: uuid('created_by'),
    publishedBy: uuid('published_by'),
    publishedAt: ts('published_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('margin_rule_sets_uq').on(t.tenantId, t.version)],
);

/**
 * Every price value is its own column — never a single "price".
 * supplier_list → supplier_verified → actual_purchase; estimated/verified/actual landed;
 * calculated → admin_final → actual_customer.
 */
export const pricingSnapshots = pgTable(
  'pricing_snapshots',
  {
    id: id(),
    tenantId: tenantId(),
    projectId: uuid('project_id'),
    candidateId: uuid('candidate_id'),
    costCalculationId: uuid('cost_calculation_id'),
    marginRuleSetId: uuid('margin_rule_set_id'),
    quantity: integer('quantity').notNull(),
    currency: text('currency').notNull().default('KRW'),
    supplierListPrice: money('supplier_list_price'),
    supplierVerifiedPrice: money('supplier_verified_price'),
    actualPurchasePrice: money('actual_purchase_price'),
    supplierPriceCurrency: text('supplier_price_currency'),
    estimatedLandedCost: money('estimated_landed_cost'),
    verifiedLandedCost: money('verified_landed_cost'),
    actualLandedCost: money('actual_landed_cost'),
    calculatedCustomerPrice: money('calculated_customer_price'),
    adminFinalPrice: money('admin_final_price'),
    adminFinalReason: text('admin_final_reason'),
    adminFinalNote: text('admin_final_note').notNull().default(''),
    adminFinalBy: uuid('admin_final_by'),
    adminFinalAt: ts('admin_final_at'),
    actualCustomerPrice: money('actual_customer_price'),
    priceResult: jsonb('price_result').$type<Record<string, unknown>>().notNull().default({}),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('pricing_snapshots_project_idx').on(t.tenantId, t.projectId)],
);
