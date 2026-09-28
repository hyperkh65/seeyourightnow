import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, real, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { ProductAttributes } from '@sos/core';
import { createdAt, id, money, rate, tenantId, ts, updatedAt, vector } from './_common.js';

// ─────────────────────────── CRM ───────────────────────────

export const companies = pgTable(
  'companies',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    businessNumber: text('business_number').notNull().default(''),
    ceo: text('ceo').notNull().default(''),
    address: text('address').notNull().default(''),
    industry: text('industry').notNull().default(''),
    categories: jsonb('categories').$type<string[]>().notNull().default([]),
    taxInvoiceEmail: text('tax_invoice_email').notNull().default(''),
    paymentTerms: text('payment_terms').notNull().default(''),
    preferences: jsonb('preferences')
      .$type<{ targetMarginPct?: string; preferredFreight?: string; categories?: string[] }>()
      .notNull()
      .default({}),
    tier: text('tier').notNull().default('STANDARD'),
    creditLevel: text('credit_level').notNull().default('NORMAL'),
    warnings: jsonb('warnings').$type<string[]>().notNull().default([]),
    ownerUserId: uuid('owner_user_id'),
    anonymizedAt: ts('anonymized_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('companies_tenant_name_idx').on(t.tenantId, t.name)],
);

export const contacts = pgTable('contacts', {
  id: id(),
  tenantId: tenantId(),
  companyId: uuid('company_id').notNull(),
  name: text('name').notNull(),
  department: text('department').notNull().default(''),
  title: text('title').notNull().default(''),
  phone: text('phone').notNull().default(''),
  email: text('email').notNull().default(''),
  messenger: jsonb('messenger').$type<Record<string, string>>().notNull().default({}),
  isPrimary: boolean('is_primary').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Internal-only notes. Never serialized to customer audiences. */
export const customerNotes = pgTable('customer_notes', {
  id: id(),
  tenantId: tenantId(),
  companyId: uuid('company_id').notNull(),
  authorId: uuid('author_id').notNull(),
  body: text('body').notNull(),
  pinned: boolean('pinned').notNull().default(false),
  createdAt: createdAt(),
});

// ─────────────────────────── Projects & requests ───────────────────────────

export const sourcingProjects = pgTable(
  'sourcing_projects',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    title: text('title').notNull(),
    companyId: uuid('company_id'),
    customerUserId: uuid('customer_user_id'),
    ownerUserId: uuid('owner_user_id'),
    stage: text('stage').notNull().default('REQUESTED'),
    status: text('status').notNull().default('OPEN'), // OPEN | ON_HOLD | CLOSED
    attention: jsonb('attention')
      .$type<Array<{ kind: string; message: string; since: string }>>()
      .notNull()
      .default([]),
    stageHistory: jsonb('stage_history')
      .$type<Array<{ stage: string; at: string; by?: string | null }>>()
      .notNull()
      .default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('projects_code_uq').on(t.tenantId, t.code),
    index('projects_stage_idx').on(t.tenantId, t.stage),
  ],
);

export const sourcingRequests = pgTable(
  'sourcing_requests',
  {
    id: id(),
    tenantId: tenantId(),
    projectId: uuid('project_id'),
    /** Anonymous requests are addressed by an unguessable access token instead of a user. */
    accessTokenHash: text('access_token_hash'),
    createdByUserId: uuid('created_by_user_id'),
    anonymousIpHash: text('anonymous_ip_hash'),
    inputType: text('input_type').notNull(), // IMAGE | URL | TEXT | DOCUMENT | MIXED
    query: text('query').notNull().default(''),
    url: text('url').notNull().default(''),
    description: text('description').notNull().default(''),
    imageFileIds: jsonb('image_file_ids').$type<string[]>().notNull().default([]),
    documentFileIds: jsonb('document_file_ids').$type<string[]>().notNull().default([]),
    quantity: integer('quantity'),
    targetPurchasePrice: money('target_purchase_price'),
    targetPurchaseCurrency: text('target_purchase_currency'),
    targetLandedPriceKrw: money('target_landed_price_krw'),
    targetSellingPriceKrw: money('target_selling_price_krw'),
    desiredLeadTimeDays: integer('desired_lead_time_days'),
    options: jsonb('options')
      .$type<{
        oem?: boolean;
        logoPrint?: boolean;
        packageChange?: boolean;
        certificationNeeded?: 'YES' | 'NO' | 'UNSURE';
        qualityLevel?: string;
        colors?: string;
        sizes?: string;
        notes?: string;
      }>()
      .notNull()
      .default({}),
    status: text('status').notNull().default('RECEIVED'), // RECEIVED | ANALYZING | READY | FAILED
    progress: jsonb('progress')
      .$type<
        Record<
          string,
          { status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'SKIPPED'; message?: string; at?: string }
        >
      >()
      .notNull()
      .default({}),
    productId: uuid('product_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('requests_project_idx').on(t.tenantId, t.projectId),
    index('requests_created_idx').on(t.tenantId, t.createdAt),
  ],
);

// ─────────────────────────── Products ───────────────────────────

export const products = pgTable(
  'products',
  {
    id: id(),
    tenantId: tenantId(),
    projectId: uuid('project_id'),
    requestId: uuid('request_id'),
    nameKo: text('name_ko').notNull().default(''),
    nameEn: text('name_en').notNull().default(''),
    nameCn: text('name_cn').notNull().default(''),
    category: text('category').notNull().default('UNKNOWN'),
    subcategory: text('subcategory').notNull().default('UNKNOWN'),
    /** AI/pipeline estimate. Never overwritten by human edits (see attributesVerified). */
    attributesEstimated: jsonb('attributes_estimated').$type<ProductAttributes>(),
    attributesVerified: jsonb('attributes_verified').$type<Partial<ProductAttributes>>(),
    attributeSources: jsonb('attribute_sources').$type<Record<string, string>>().notNull().default({}),
    attributeConflicts: jsonb('attribute_conflicts').$type<string[]>().notNull().default([]),
    confidence: real('confidence').notNull().default(0),
    hsCodeEstimated: text('hs_code_estimated'),
    hsCodeVerified: text('hs_code_verified'),
    hsCodeActual: text('hs_code_actual'),
    passport: jsonb('passport').$type<Record<string, unknown>>().notNull().default({}),
    risk: jsonb('risk').$type<{
      overall: string;
      items: Array<{ dimension: string; level: string; reasons: string[] }>;
    }>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('products_project_idx').on(t.tenantId, t.projectId)],
);

export const productVariants = pgTable('product_variants', {
  id: id(),
  tenantId: tenantId(),
  productId: uuid('product_id').notNull(),
  name: text('name').notNull(),
  sku: text('sku').notNull().default(''),
  attributes: jsonb('attributes').$type<Record<string, string>>().notNull().default({}),
  createdAt: createdAt(),
});

export const productImages = pgTable(
  'product_images',
  {
    id: id(),
    tenantId: tenantId(),
    productId: uuid('product_id'),
    requestId: uuid('request_id'),
    fileId: uuid('file_id').notNull(),
    sha256: text('sha256').notNull(),
    phash: text('phash'),
    width: integer('width'),
    height: integer('height'),
    ocrText: text('ocr_text'),
    ocrProvider: text('ocr_provider'),
    subjectBox: jsonb('subject_box').$type<{ x: number; y: number; w: number; h: number } | null>(),
    analysis: jsonb('analysis').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index('product_images_sha_idx').on(t.tenantId, t.sha256),
    index('product_images_phash_idx').on(t.tenantId, t.phash),
  ],
);

export const productEmbeddings = pgTable(
  'product_embeddings',
  {
    id: id(),
    tenantId: tenantId(),
    ownerType: text('owner_type').notNull(), // PRODUCT_IMAGE | SOURCE_LISTING | PRODUCT
    ownerId: uuid('owner_id').notNull(),
    model: text('model').notNull(),
    dimensions: integer('dimensions').notNull(),
    embedding: vector('embedding', { dimensions: 768 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('product_embeddings_owner_uq').on(t.ownerType, t.ownerId, t.model)],
);

export const productClusters = pgTable('product_clusters', {
  id: id(),
  tenantId: tenantId(),
  requestId: uuid('request_id'),
  label: text('label').notNull().default(''),
  supplierCount: integer('supplier_count').notNull().default(0),
  currency: text('currency'),
  lowestPrice: money('lowest_price'),
  medianPrice: money('median_price'),
  highestPrice: money('highest_price'),
  moqDistribution: jsonb('moq_distribution')
    .$type<{ min: number | null; median: number | null; max: number | null }>()
    .notNull()
    .default({ min: null, median: null, max: null }),
  avgSellerQuality: real('avg_seller_quality'),
  reasons: jsonb('reasons').$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ─────────────────────────── Suppliers & listings ───────────────────────────

export const suppliers = pgTable(
  'suppliers',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    nameLocal: text('name_local').notNull().default(''),
    alias: text('alias').notNull().default(''),
    visibility: text('visibility').notNull().default('ALIAS'), // HIDDEN | ALIAS | VISIBLE
    sourceType: text('source_type').notNull(),
    businessType: text('business_type').notNull().default('UNKNOWN'), // FACTORY | TRADING | UNKNOWN
    country: text('country').notNull().default('CN'),
    province: text('province').notNull().default(''),
    city: text('city').notNull().default(''),
    address: text('address').notNull().default(''),
    lat: real('lat'),
    lon: real('lon'),
    nearestPort: text('nearest_port').notNull().default(''),
    yearsInBusiness: integer('years_in_business'),
    businessVerified: boolean('business_verified'),
    verificationNote: text('verification_note').notNull().default(''),
    avgResponseHours: real('avg_response_hours'),
    typicalMoq: integer('typical_moq'),
    oemSupported: boolean('oem_supported'),
    certifications: jsonb('certifications')
      .$type<Array<{ name: string; number?: string; validUntil?: string; fileId?: string }>>()
      .notNull()
      .default([]),
    bankInfo: jsonb('bank_info').$type<Record<string, string>>().notNull().default({}),
    externalRefs: jsonb('external_refs').$type<Record<string, string>>().notNull().default({}),
    metrics: jsonb('metrics')
      .$type<{
        orderCount?: number;
        sampleCount?: number;
        claimCount?: number;
        refundCount?: number;
        lateDeliveryCount?: number;
        qualityScore?: number;
        communicationScore?: number;
        reliabilityScore?: number;
      }>()
      .notNull()
      .default({}),
    riskFlags: jsonb('risk_flags').$type<string[]>().notNull().default([]),
    blacklisted: boolean('blacklisted').notNull().default(false),
    blacklistReason: text('blacklist_reason').notNull().default(''),
    internalNotes: text('internal_notes').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('suppliers_tenant_name_idx').on(t.tenantId, t.name)],
);

export const supplierContacts = pgTable('supplier_contacts', {
  id: id(),
  tenantId: tenantId(),
  supplierId: uuid('supplier_id').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull().default(''),
  phone: text('phone').notNull().default(''),
  email: text('email').notNull().default(''),
  wechat: text('wechat').notNull().default(''),
  whatsapp: text('whatsapp').notNull().default(''),
  language: text('language').notNull().default('zh'),
  createdAt: createdAt(),
});

/** Supplier history events: samples, orders, quality issues, late deliveries, claims, refunds, communication. */
export const supplierEvents = pgTable(
  'supplier_events',
  {
    id: id(),
    tenantId: tenantId(),
    supplierId: uuid('supplier_id').notNull(),
    kind: text('kind').notNull(), // SAMPLE | ORDER | QUALITY_ISSUE | LATE_DELIVERY | CLAIM | REFUND | COMMUNICATION | PRICE_CHANGE
    projectId: uuid('project_id'),
    rating: real('rating'),
    amount: money('amount'),
    currency: text('currency'),
    note: text('note').notNull().default(''),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [index('supplier_events_supplier_idx').on(t.tenantId, t.supplierId)],
);

export const sourceListings = pgTable(
  'source_listings',
  {
    id: id(),
    tenantId: tenantId(),
    supplierId: uuid('supplier_id'),
    sourceType: text('source_type').notNull(),
    connector: text('connector').notNull(), // e.g. PRIVATE_DB, CSV_IMPORT, GENERIC_HTTP, ALIBABA_1688_OPEN, DEV_MOCK
    externalId: text('external_id').notNull().default(''),
    url: text('url').notNull().default(''),
    title: text('title').notNull(),
    titleKo: text('title_ko').notNull().default(''),
    model: text('model').notNull().default(''),
    currency: text('currency').notNull().default('CNY'),
    /** Price tiers (qty ≥ minQty → unitPrice). Amounts are decimal strings. */
    priceTiers: jsonb('price_tiers')
      .$type<Array<{ minQty: number; unitPrice: string }>>()
      .notNull()
      .default([]),
    supplierListPrice: money('supplier_list_price'),
    supplierVerifiedPrice: money('supplier_verified_price'),
    moq: integer('moq'),
    leadTimeDays: integer('lead_time_days'),
    imageUrls: jsonb('image_urls').$type<string[]>().notNull().default([]),
    imageFileIds: jsonb('image_file_ids').$type<string[]>().notNull().default([]),
    phash: text('phash'),
    specs: jsonb('specs').$type<Record<string, string>>().notNull().default({}),
    salesMetrics: jsonb('sales_metrics')
      .$type<{ sold30d?: number; reviews?: number; rating?: number; repurchaseRate?: number }>()
      .notNull()
      .default({}),
    packaging: jsonb('packaging')
      .$type<{
        unitsPerCarton?: number;
        cartonL?: string;
        cartonW?: string;
        cartonH?: string;
        cartonGw?: string;
        cartonNw?: string;
      }>()
      .notNull()
      .default({}),
    shippingOrigin: text('shipping_origin').notNull().default(''),
    oemSupported: boolean('oem_supported'),
    sellerQuality: real('seller_quality'),
    clusterId: uuid('cluster_id'),
    isDevMock: boolean('is_dev_mock').notNull().default(false),
    collectedAt: ts('collected_at').notNull().defaultNow(),
    lastCheckedAt: ts('last_checked_at').notNull().defaultNow(),
    expiresAt: ts('expires_at'),
    raw: jsonb('raw').$type<unknown>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('listings_supplier_idx').on(t.tenantId, t.supplierId),
    uniqueIndex('listings_external_uq')
      .on(t.tenantId, t.connector, t.externalId)
      .where(sql`${t.externalId} <> ''`),
  ],
);

export const listingPriceHistory = pgTable(
  'listing_price_history',
  {
    id: id(),
    tenantId: tenantId(),
    listingId: uuid('listing_id').notNull(),
    unitPrice: money('unit_price').notNull(),
    currency: text('currency').notNull(),
    moq: integer('moq'),
    stock: integer('stock'),
    specsHash: text('specs_hash'),
    sellerName: text('seller_name'),
    observedAt: ts('observed_at').notNull().defaultNow(),
  },
  (t) => [index('listing_price_history_idx').on(t.tenantId, t.listingId, t.observedAt)],
);

/** Each candidate for a request, with its explainable score breakdown. */
export const requestCandidates = pgTable(
  'request_candidates',
  {
    id: id(),
    tenantId: tenantId(),
    requestId: uuid('request_id').notNull(),
    listingId: uuid('listing_id').notNull(),
    clusterId: uuid('cluster_id'),
    score: real('score').notNull().default(0),
    coverage: real('coverage').notNull().default(0),
    components: jsonb('components')
      .$type<Array<{ key: string; label: string; score: number | null; weight: number; evidence: string }>>()
      .notNull()
      .default([]),
    weightsSnapshot: jsonb('weights_snapshot').$type<Record<string, number>>().notNull().default({}),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    reasons: jsonb('reasons').$type<string[]>().notNull().default([]),
    cautions: jsonb('cautions').$type<string[]>().notNull().default([]),
    unitPriceBase: money('unit_price_base'),
    imageSimilarity: real('image_similarity'),
    pinned: boolean('pinned').notNull().default(false),
    hiddenFromCustomer: boolean('hidden_from_customer').notNull().default(false),
    /** Internal recommendation fields (staff-only). */
    isInternalRecommendation: boolean('is_internal_recommendation').notNull().default(false),
    internalCost: money('internal_cost'),
    customerPrice: money('customer_price'),
    customerPriceCurrency: text('customer_price_currency'),
    qualityLevel: text('quality_level'),
    reason: text('reason').notNull().default(''),
    privateNote: text('private_note').notNull().default(''),
    customerNote: text('customer_note').notNull().default(''),
    addedBy: uuid('added_by'),
    selected: boolean('selected').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('request_candidates_uq').on(t.requestId, t.listingId),
    index('request_candidates_req_idx').on(t.tenantId, t.requestId),
  ],
);

// ─────────────────────────── Domestic market intelligence ───────────────────────────

export const marketListings = pgTable(
  'market_listings',
  {
    id: id(),
    tenantId: tenantId(),
    requestId: uuid('request_id'),
    platform: text('platform').notNull(), // NAVER_SHOPPING | COUPANG_PARTNERS | ELEVENST | MANUAL ...
    externalId: text('external_id').notNull().default(''),
    title: text('title').notNull(),
    url: text('url').notNull().default(''),
    imageUrl: text('image_url').notNull().default(''),
    seller: text('seller').notNull().default(''),
    brand: text('brand').notNull().default(''),
    category: text('category').notNull().default(''),
    sellingPrice: money('selling_price'),
    discountPrice: money('discount_price'),
    currency: text('currency').notNull().default('KRW'),
    reviews: integer('reviews'),
    rating: real('rating'),
    rank: integer('rank'),
    delivery: text('delivery').notNull().default(''),
    query: text('query').notNull().default(''),
    isDevMock: boolean('is_dev_mock').notNull().default(false),
    collectedAt: ts('collected_at').notNull().defaultNow(),
    expiresAt: ts('expires_at'),
  },
  (t) => [
    index('market_listings_req_idx').on(t.tenantId, t.requestId),
    index('market_listings_ext_idx').on(t.tenantId, t.platform, t.externalId),
  ],
);

export const marketPriceHistory = pgTable(
  'market_price_history',
  {
    id: id(),
    tenantId: tenantId(),
    platform: text('platform').notNull(),
    externalId: text('external_id').notNull(),
    price: money('price').notNull(),
    currency: text('currency').notNull().default('KRW'),
    observedAt: ts('observed_at').notNull().defaultNow(),
  },
  (t) => [index('market_price_history_idx').on(t.tenantId, t.platform, t.externalId, t.observedAt)],
);

// ─────────────────────────── Demand intelligence ───────────────────────────

/** De-identified search events: no user id, no IP; only aggregate-friendly fields. */
export const searchEvents = pgTable(
  'search_events',
  {
    id: id(),
    tenantId: tenantId(),
    normalizedQuery: text('normalized_query').notNull().default(''),
    category: text('category').notNull().default('UNKNOWN'),
    clusterKey: text('cluster_key').notNull().default(''),
    inputType: text('input_type').notNull(),
    quantity: integer('quantity'),
    targetPriceKrw: money('target_price_krw'),
    buyerKey: text('buyer_key').notNull().default(''), // salted hash, lets us count distinct buyers without identifying them
    createdAt: createdAt(),
  },
  (t) => [index('search_events_query_idx').on(t.tenantId, t.normalizedQuery)],
);

export const watchedItems = pgTable('watched_items', {
  id: id(),
  tenantId: tenantId(),
  listingId: uuid('listing_id').notNull(),
  lastSnapshot: jsonb('last_snapshot').$type<Record<string, unknown>>().notNull().default({}),
  lastCheckedAt: ts('last_checked_at'),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
});

export const fxRates = pgTable(
  'fx_rates',
  {
    id: id(),
    tenantId: uuid('tenant_id'), // NULL = platform-wide reference rate
    base: text('base').notNull(),
    quote: text('quote').notNull(),
    rate: rate('rate').notNull(),
    rateDate: text('rate_date').notNull(),
    source: text('source').notNull(),
    verification: text('verification').notNull().default('UNVERIFIED'),
    collectedAt: ts('collected_at').notNull().defaultNow(),
  },
  (t) => [index('fx_rates_pair_idx').on(t.base, t.quote, t.rateDate)],
);
