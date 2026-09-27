/**
 * Canonical enumerations shared by API, web and database layers.
 * Keep values UPPER_SNAKE_CASE and stable: they are persisted.
 */

export const ROLES = [
  'SUPER_ADMIN',
  'TENANT_OWNER',
  'TENANT_ADMIN',
  'SALES',
  'SOURCING_MANAGER',
  'FINANCE',
  'WAREHOUSE',
  'CUSTOMS_PARTNER',
  'FORWARDER_PARTNER',
  'CERTIFICATION_PARTNER',
  'SUPPLIER_PARTNER',
  'CUSTOMER_ADMIN',
  'CUSTOMER_USER',
  'READ_ONLY',
] as const;
export type Role = (typeof ROLES)[number];

export const STAFF_ROLES: readonly Role[] = [
  'TENANT_OWNER',
  'TENANT_ADMIN',
  'SALES',
  'SOURCING_MANAGER',
  'FINANCE',
  'WAREHOUSE',
  'READ_ONLY',
];
export const PARTNER_ROLES: readonly Role[] = [
  'CUSTOMS_PARTNER',
  'FORWARDER_PARTNER',
  'CERTIFICATION_PARTNER',
  'SUPPLIER_PARTNER',
];
export const CUSTOMER_ROLES: readonly Role[] = ['CUSTOMER_ADMIN', 'CUSTOMER_USER'];

export type Audience = 'PLATFORM' | 'STAFF' | 'PARTNER' | 'CUSTOMER';

export function audienceOf(roles: readonly Role[]): Audience {
  if (roles.includes('SUPER_ADMIN')) return 'PLATFORM';
  if (roles.some((r) => STAFF_ROLES.includes(r))) return 'STAFF';
  if (roles.some((r) => PARTNER_ROLES.includes(r))) return 'PARTNER';
  return 'CUSTOMER';
}

export const SOURCE_TYPES = [
  'PUBLIC_MARKET',
  'PRIVATE_NETWORK',
  'DIRECT_FACTORY',
  'LOCAL_PARTNER',
  'INTERNAL_PRODUCT',
  'RFQ_RESULT',
  'MANUAL_PROPOSAL',
  'CUSTOMER_NOMINATED',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** Verification level of any value that carries legal or monetary consequences. */
export const VERIFICATION_STATUSES = [
  'UNVERIFIED',
  'AI_ESTIMATE',
  'SYSTEM_CALCULATED',
  'PARTNER_VERIFIED',
  'EXPERT_VERIFIED',
  'ACTUAL',
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const VERIFICATION_RANK: Record<VerificationStatus, number> = {
  UNVERIFIED: 0,
  AI_ESTIMATE: 1,
  SYSTEM_CALCULATED: 2,
  PARTNER_VERIFIED: 3,
  EXPERT_VERIFIED: 4,
  ACTUAL: 5,
};

export function weakestVerification(list: VerificationStatus[]): VerificationStatus {
  if (list.length === 0) return 'UNVERIFIED';
  return list.reduce((a, b) => (VERIFICATION_RANK[a] <= VERIFICATION_RANK[b] ? a : b));
}

export const COMPLIANCE_STATUSES = [
  'NOT_APPLICABLE',
  'UNKNOWN',
  'AI_POSSIBLE',
  'AI_LIKELY',
  'RULE_MATCHED',
  'EXPERT_REVIEW_REQUIRED',
  'VERIFIED',
  'REJECTED',
  'CONFIRMED',
] as const;
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

/** Customer-friendly wording for compliance states. Internal jargon never reaches customers. */
export const COMPLIANCE_CUSTOMER_LABEL: Record<ComplianceStatus, { ko: string; en: string; tone: 'neutral' | 'warn' | 'ok' | 'info' }> = {
  NOT_APPLICABLE: { ko: '해당 없음', en: 'Not applicable', tone: 'neutral' },
  UNKNOWN: { ko: '확인 필요', en: 'To be checked', tone: 'neutral' },
  AI_POSSIBLE: { ko: '필요할 수 있음', en: 'May be required', tone: 'info' },
  AI_LIKELY: { ko: '필요 가능성 높음', en: 'Likely required', tone: 'warn' },
  RULE_MATCHED: { ko: '필요 가능성 높음', en: 'Likely required', tone: 'warn' },
  EXPERT_REVIEW_REQUIRED: { ko: '전문가 확인 중', en: 'Under expert review', tone: 'info' },
  VERIFIED: { ko: '확인 완료', en: 'Verified', tone: 'ok' },
  REJECTED: { ko: '해당 없음 (확인됨)', en: 'Not required (verified)', tone: 'ok' },
  CONFIRMED: { ko: '필요 (확인 완료)', en: 'Required (confirmed)', tone: 'ok' },
};

export const FREIGHT_MODES = ['COURIER', 'AIR', 'LCL', 'FCL_20', 'FCL_40', 'FCL_40HQ'] as const;
export type FreightMode = (typeof FREIGHT_MODES)[number];

export const FREIGHT_SOURCES = [
  'REAL_TIME_API',
  'FORWARDER_VERIFIED',
  'CONTRACT_RATE',
  'MARKET_RATE',
  'GOVERNMENT_STATISTICS',
  'HISTORICAL_ACTUAL',
  'AI_ESTIMATE',
] as const;
export type FreightSource = (typeof FREIGHT_SOURCES)[number];

/** Lower is more trusted. */
export const FREIGHT_SOURCE_PRIORITY: Record<FreightSource, number> = {
  REAL_TIME_API: 1,
  FORWARDER_VERIFIED: 2,
  CONTRACT_RATE: 3,
  MARKET_RATE: 4,
  GOVERNMENT_STATISTICS: 5,
  HISTORICAL_ACTUAL: 6,
  AI_ESTIMATE: 7,
};

export const QUOTATION_STATUSES = [
  'DRAFT',
  'ADMIN_REVIEW',
  'SENT',
  'CUSTOMER_APPROVED',
  'ADMIN_FINAL_APPROVED',
  'REJECTED',
  'EXPIRED',
  'LOCKED',
] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

export const CONTRACT_STATUSES = [
  'DRAFT',
  'CUSTOMER_REVIEW',
  'CUSTOMER_APPROVED',
  'COMPANY_APPROVED',
  'EFFECTIVE',
  'CANCELLED',
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const INVOICE_TYPES = [
  'QUOTATION',
  'PURCHASE_ORDER',
  'PROFORMA_INVOICE',
  'COMMERCIAL_INVOICE',
  'PACKING_LIST',
  'SALES_INVOICE',
  'RECEIPT',
  'SHIPPING_NOTICE',
  'DELIVERY_NOTE',
] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];

export const DOCUMENT_KINDS = [...INVOICE_TYPES, 'CONTRACT'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const PROJECT_STAGES = [
  'REQUESTED',
  'SEARCHING',
  'QUOTE_PREPARING',
  'QUOTE_APPROVED',
  'CONTRACT',
  'PRODUCTION',
  'INSPECTION',
  'READY_TO_SHIP',
  'SHIPPED',
  'ARRIVED',
  'CUSTOMS',
  'DELIVERING',
  'COMPLETED',
  'CANCELLED',
] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const PROJECT_STAGE_LABEL_KO: Record<ProjectStage, string> = {
  REQUESTED: '요청 접수',
  SEARCHING: '제품 검색',
  QUOTE_PREPARING: '견적 준비',
  QUOTE_APPROVED: '견적 승인',
  CONTRACT: '계약',
  PRODUCTION: '생산',
  INSPECTION: '검품',
  READY_TO_SHIP: '출고',
  SHIPPED: '선적',
  ARRIVED: '입항',
  CUSTOMS: '통관',
  DELIVERING: '배송',
  COMPLETED: '완료',
  CANCELLED: '취소',
};

export const SHIPMENT_EVENT_TYPES = [
  'BOOKED',
  'EMPTY_RELEASED',
  'GATE_IN',
  'LOADED',
  'DEPARTED',
  'TRANSSHIPMENT',
  'ARRIVED',
  'DISCHARGED',
  'CUSTOMS',
  'GATE_OUT',
  'DELIVERED',
] as const;
export type ShipmentEventType = (typeof SHIPMENT_EVENT_TYPES)[number];

export const SHIPMENT_EVENT_SOURCES = ['CARRIER_CONFIRMED', 'AIS_INFERRED', 'FORWARDER_REPORTED', 'MANUAL'] as const;
export type ShipmentEventSource = (typeof SHIPMENT_EVENT_SOURCES)[number];

export const ETA_SOURCES = ['CARRIER', 'AIS', 'HISTORICAL', 'INTERNAL_ML', 'FORWARDER', 'MANUAL'] as const;
export type EtaSource = (typeof ETA_SOURCES)[number];

export const RISK_DIMENSIONS = [
  'COMPLIANCE',
  'CUSTOMS',
  'FREIGHT',
  'BATTERY',
  'DG',
  'QUALITY',
  'SUPPLIER',
  'DELIVERY',
  'IP',
  'PACKAGING',
  'FX',
  'PAYMENT',
  'MARKET',
  'CERTIFICATION',
] as const;
export type RiskDimension = (typeof RISK_DIMENSIONS)[number];
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export const JOB_STATUSES = ['PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'RETRYING', 'DEAD_LETTER'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const CONNECTION_STATUSES = ['DISCONNECTED', 'CONNECTED', 'ERROR'] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const CONNECTION_CATEGORIES = [
  'AI',
  'MARKETPLACE',
  'DOMESTIC_MARKET',
  'SHIPPING',
  'CUSTOMS',
  'GOVERNMENT',
  'EMAIL',
  'SMS',
  'PAYMENT',
  'STORAGE',
  'ANALYTICS',
  'WEBHOOKS',
  'MESSAGING',
] as const;
export type ConnectionCategory = (typeof CONNECTION_CATEGORIES)[number];

export const ADMIN_PRICE_REASONS = [
  'STRATEGIC_CUSTOMER',
  'MARKET_PRICE',
  'DISCOUNT',
  'HIGH_RISK',
  'LOW_QUANTITY',
  'MANUAL',
  'OTHER',
] as const;
export type AdminPriceReason = (typeof ADMIN_PRICE_REASONS)[number];

export const CERT_COST_ALLOCATIONS = ['FULL_ON_ORDER', 'AMORTIZE', 'COMPANY_EXPENSE', 'CUSTOMER_SEPARATE'] as const;
export type CertCostAllocation = (typeof CERT_COST_ALLOCATIONS)[number];

export const SUPPLIER_VISIBILITY = ['HIDDEN', 'ALIAS', 'VISIBLE'] as const;
export type SupplierVisibility = (typeof SUPPLIER_VISIBILITY)[number];

export const EMAIL_TRIGGERS = [
  'SOURCING_RECEIVED',
  'ANALYSIS_COMPLETED',
  'QUOTE_ISSUED',
  'QUOTE_REMINDER',
  'QUOTE_APPROVED',
  'CONTRACT_READY',
  'CONTRACT_COMPLETED',
  'PI_ISSUED',
  'PAYMENT_RECEIVED',
  'PRODUCTION_STARTED',
  'PRODUCTION_DELAY',
  'INSPECTION_COMPLETED',
  'SHIPMENT_BOOKED',
  'VESSEL_DEPARTED',
  'ETA_CHANGED',
  'ARRIVED',
  'CUSTOMS_COMPLETED',
  'DELIVERY_STARTED',
  'DELIVERED',
] as const;
export type EmailTrigger = (typeof EMAIL_TRIGGERS)[number];

export const WEBHOOK_EVENTS = [
  'project.created',
  'quote.issued',
  'quote.approved',
  'contract.completed',
  'invoice.issued',
  'payment.received',
  'production.started',
  'shipment.departed',
  'shipment.arrived',
  'customs.completed',
  'delivery.completed',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const FEATURE_MODULES = [
  'PRODUCT_SEARCH',
  'VISION_SEARCH',
  'DOMESTIC_MARKET',
  'COMPLIANCE',
  'FREIGHT',
  'CUSTOMS',
  'QUOTATION',
  'CONTRACT',
  'INVOICE',
  'SHIPMENT',
  'AIS',
  'CRM',
  'ANALYTICS',
  'API',
  'WHITE_LABEL',
  'CUSTOM_DOMAIN',
  'JOINT_SOURCING',
  'PRODUCT_DISCOVERY',
  'EXPERT_PORTAL',
  'WEBHOOKS',
] as const;
export type FeatureModule = (typeof FEATURE_MODULES)[number];

export const PLAN_LIMIT_KEYS = [
  'users',
  'monthly_searches',
  'ai_requests',
  'storage_mb',
  'quotes',
  'projects',
  'api_calls',
  'custom_domains',
] as const;
export type PlanLimitKey = (typeof PLAN_LIMIT_KEYS)[number];

export const EXPERT_TYPES = [
  'CUSTOMS_BROKER',
  'CERTIFICATION_EXPERT',
  'ELECTRICAL_SAFETY_LAB',
  'RRA_EMC_LAB',
  'MFDS_EXPERT',
  'CHEMICAL_SAFETY_EXPERT',
  'FIRE_CERTIFICATION_EXPERT',
  'FORWARDER',
] as const;
export type ExpertType = (typeof EXPERT_TYPES)[number];

/** Tri-state value used for every product attribute: unknown values are never guessed. */
export type Tri = 'TRUE' | 'FALSE' | 'UNKNOWN';
export const UNKNOWN = 'UNKNOWN' as const;
