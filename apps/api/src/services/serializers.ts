import {
  COMPLIANCE_CUSTOMER_LABEL,
  MATCH_TAG_LABEL_KO,
  type ComplianceStatus,
  type MatchTag,
} from '@sos/core';
import type { requestCandidates, sourceListings, suppliers } from '../db/schema/index.js';

/**
 * Audience-aware serializers. Customer payloads are built by *allow-listing*
 * fields (never by deleting from staff objects), so internal cost, supplier
 * identity and source URLs cannot leak through a forgotten field.
 */

type Candidate = typeof requestCandidates.$inferSelect;
type Listing = typeof sourceListings.$inferSelect;
type Supplier = typeof suppliers.$inferSelect;

export function supplierDisplayName(s: Supplier | undefined | null, sourceType: string): string {
  const privateLabel = ['PRIVATE_NETWORK', 'DIRECT_FACTORY', 'LOCAL_PARTNER', 'INTERNAL_PRODUCT'].includes(
    sourceType,
  )
    ? 'Private Sourcing Network'
    : 'Verified Supplier';
  if (!s) return privateLabel;
  if (s.visibility === 'VISIBLE') return s.name;
  if (s.visibility === 'ALIAS') return s.alias || privateLabel;
  return privateLabel;
}

export function sourceLabel(sourceType: string, connector: string): string {
  if (
    ['PRIVATE_NETWORK', 'DIRECT_FACTORY', 'LOCAL_PARTNER', 'INTERNAL_PRODUCT', 'MANUAL_PROPOSAL'].includes(
      sourceType,
    )
  )
    return '자체 공급망';
  if (sourceType === 'RFQ_RESULT') return '견적 요청 결과';
  if (sourceType === 'CUSTOMER_NOMINATED') return '고객 지정';
  if (connector.startsWith('DEV_MOCK')) return '개발용 모의 데이터';
  return '해외 마켓';
}

export interface CustomerCandidate {
  id: string;
  title: string;
  image: string | null;
  supplier: string;
  source: string;
  moq: number | null;
  leadTimeDays: number | null;
  score: number;
  tags: Array<{ key: string; label: string }>;
  reasons: string[];
  cautions: string[];
  estimatedUnitPrice: string | null; // customer-facing estimated price (never internal cost)
  priceBadge: 'ESTIMATED' | 'VERIFIED' | 'FINAL';
  pinned: boolean;
  customerNote: string;
  isDevMock: boolean;
}

export function customerCandidate(
  c: Candidate,
  l: Listing,
  s: Supplier | undefined,
  customerUnitPrice: string | null,
  badge: CustomerCandidate['priceBadge'],
): CustomerCandidate {
  return {
    id: c.id,
    title: l.titleKo || l.title,
    image: l.imageUrls[0] ?? null,
    supplier: supplierDisplayName(s, l.sourceType),
    source: sourceLabel(l.sourceType, l.connector),
    moq: l.moq,
    leadTimeDays: l.leadTimeDays,
    score: c.score,
    tags: c.tags.map((t) => ({ key: t, label: MATCH_TAG_LABEL_KO[t as MatchTag] ?? t })),
    reasons: c.reasons,
    cautions: c.cautions.filter((x) => !x.includes('STALE')),
    estimatedUnitPrice: c.isInternalRecommendation && c.customerPrice ? c.customerPrice : customerUnitPrice,
    priceBadge: badge,
    pinned: c.pinned,
    customerNote: c.customerNote,
    isDevMock: l.isDevMock,
  };
}

export function customerCompliance(
  rows: Array<{ code: string; name: string; authority: string; status: string; reasons: string[] }>,
) {
  // Customers see actionable items only; undecidable items are summarised by the UI as "추가 확인 항목".
  return rows
    .filter((r) => r.status !== 'NOT_APPLICABLE' && r.status !== 'UNKNOWN')
    .map((r) => {
      const label =
        COMPLIANCE_CUSTOMER_LABEL[r.status as ComplianceStatus] ?? COMPLIANCE_CUSTOMER_LABEL.UNKNOWN;
      return {
        code: r.code,
        name: r.name,
        authority: r.authority,
        label: label.ko,
        tone: label.tone,
        reasons: r.reasons.slice(0, 3),
      };
    });
}
