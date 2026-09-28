import type { ContractStatus, QuotationStatus } from './enums.js';

/**
 * Explicit state machines for documents with legal weight. Any transition not
 * listed is rejected by the API.
 */

type Actor = 'STAFF' | 'CUSTOMER' | 'SYSTEM';

interface Transition<S extends string> {
  from: S[];
  to: S;
  by: Actor[];
}

export const QUOTATION_TRANSITIONS: Transition<QuotationStatus>[] = [
  { from: ['DRAFT'], to: 'ADMIN_REVIEW', by: ['STAFF'] },
  { from: ['DRAFT', 'ADMIN_REVIEW'], to: 'SENT', by: ['STAFF'] },
  { from: ['SENT'], to: 'CUSTOMER_APPROVED', by: ['CUSTOMER'] },
  { from: ['SENT'], to: 'REJECTED', by: ['CUSTOMER', 'STAFF'] },
  { from: ['CUSTOMER_APPROVED'], to: 'ADMIN_FINAL_APPROVED', by: ['STAFF'] },
  { from: ['CUSTOMER_APPROVED'], to: 'REJECTED', by: ['STAFF'] },
  { from: ['SENT', 'ADMIN_REVIEW', 'DRAFT'], to: 'EXPIRED', by: ['SYSTEM', 'STAFF'] },
  { from: ['ADMIN_FINAL_APPROVED'], to: 'LOCKED', by: ['SYSTEM', 'STAFF'] },
];

export const CONTRACT_TRANSITIONS: Transition<ContractStatus>[] = [
  { from: ['DRAFT'], to: 'CUSTOMER_REVIEW', by: ['STAFF'] },
  { from: ['CUSTOMER_REVIEW'], to: 'CUSTOMER_APPROVED', by: ['CUSTOMER'] },
  { from: ['CUSTOMER_APPROVED'], to: 'COMPANY_APPROVED', by: ['STAFF'] },
  { from: ['COMPANY_APPROVED'], to: 'EFFECTIVE', by: ['SYSTEM', 'STAFF'] },
  {
    from: ['DRAFT', 'CUSTOMER_REVIEW', 'CUSTOMER_APPROVED', 'COMPANY_APPROVED'],
    to: 'CANCELLED',
    by: ['STAFF'],
  },
];

export function canTransition<S extends string>(table: Transition<S>[], from: S, to: S, by: Actor): boolean {
  return table.some((t) => t.to === to && t.from.includes(from) && t.by.includes(by));
}

export function nextStates<S extends string>(table: Transition<S>[], from: S, by: Actor): S[] {
  return table.filter((t) => t.from.includes(from) && t.by.includes(by)).map((t) => t.to);
}

/** Once issued (SENT or later), a quotation version is immutable; edits create a new version. */
export function isQuotationImmutable(status: QuotationStatus): boolean {
  return status !== 'DRAFT' && status !== 'ADMIN_REVIEW';
}

export const PRODUCTION_STATUSES = [
  'NOT_STARTED',
  'MATERIALS',
  'IN_PRODUCTION',
  'QC',
  'PACKING',
  'COMPLETED',
  'DELAYED',
  'ON_HOLD',
] as const;
export type ProductionStatus = (typeof PRODUCTION_STATUSES)[number];

export const PRODUCTION_STATUS_LABEL_KO: Record<ProductionStatus, string> = {
  NOT_STARTED: '생산 대기',
  MATERIALS: '자재 준비',
  IN_PRODUCTION: '생산 중',
  QC: '품질 검사',
  PACKING: '포장',
  COMPLETED: '생산 완료',
  DELAYED: '지연',
  ON_HOLD: '보류',
};

export const INSPECTION_RESULTS = ['PENDING', 'PASSED', 'PASSED_WITH_REMARKS', 'FAILED', 'WAIVED'] as const;
export type InspectionResult = (typeof INSPECTION_RESULTS)[number];

export const PAYMENT_STATUSES = ['PENDING', 'PARTIAL', 'PAID', 'OVERDUE', 'REFUNDED', 'CANCELLED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
