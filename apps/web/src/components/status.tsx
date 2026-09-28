'use client';

import { BadgeCheck, Bot, CircleDashed, FlaskConical, Scale, Ship } from 'lucide-react';
import { Badge } from './ui';

type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'danger' | 'info' | 'purple';

const QUOTE: Record<string, [string, Tone]> = {
  DRAFT: ['초안', 'neutral'],
  ADMIN_REVIEW: ['내부 검토', 'info'],
  SENT: ['발송됨 · 고객 확인 대기', 'brand'],
  CUSTOMER_APPROVED: ['고객 승인', 'warn'],
  ADMIN_FINAL_APPROVED: ['최종 승인', 'ok'],
  LOCKED: ['확정', 'ok'],
  REJECTED: ['반려', 'danger'],
  EXPIRED: ['기한 만료', 'neutral'],
};
const QUOTE_CUSTOMER: Record<string, [string, Tone]> = {
  SENT: ['확인이 필요해요', 'brand'],
  CUSTOMER_APPROVED: ['승인 완료 · 최종 확인 중', 'info'],
  ADMIN_FINAL_APPROVED: ['확정', 'ok'],
  LOCKED: ['확정', 'ok'],
  REJECTED: ['거절됨', 'neutral'],
  EXPIRED: ['기한 만료', 'neutral'],
};
const CONTRACT: Record<string, [string, Tone]> = {
  DRAFT: ['초안', 'neutral'],
  CUSTOMER_REVIEW: ['고객 검토 중', 'brand'],
  CUSTOMER_APPROVED: ['고객 승인 · 회사 승인 필요', 'warn'],
  COMPANY_APPROVED: ['회사 승인', 'info'],
  EFFECTIVE: ['체결 완료', 'ok'],
  CANCELLED: ['취소', 'neutral'],
};
const SHIPMENT: Record<string, [string, Tone]> = {
  PLANNED: ['준비 중', 'neutral'],
  BOOKED: ['선적 예약', 'info'],
  IN_TRANSIT: ['운송 중', 'brand'],
  ARRIVED: ['도착', 'purple'],
  RELEASED: ['반출', 'purple'],
  DELIVERING: ['국내 배송 중', 'brand'],
  DELIVERED: ['배송 완료', 'ok'],
  CANCELLED: ['취소', 'neutral'],
};
const PAYMENT: Record<string, [string, Tone]> = {
  PENDING: ['입금 대기', 'warn'],
  PARTIAL: ['부분 입금', 'info'],
  PAID: ['입금 완료', 'ok'],
  OVERDUE: ['연체', 'danger'],
  REFUNDED: ['환불', 'neutral'],
  CANCELLED: ['취소', 'neutral'],
};
const STAGE: Record<string, [string, Tone]> = {
  REQUESTED: ['요청 접수', 'neutral'],
  SEARCHING: ['제품 검색', 'info'],
  QUOTE_PREPARING: ['견적 준비', 'brand'],
  QUOTE_APPROVED: ['견적 승인', 'brand'],
  CONTRACT: ['계약', 'purple'],
  PRODUCTION: ['생산', 'purple'],
  INSPECTION: ['검품', 'purple'],
  READY_TO_SHIP: ['출고', 'info'],
  SHIPPED: ['선적', 'info'],
  ARRIVED: ['입항', 'info'],
  CUSTOMS: ['통관', 'info'],
  DELIVERING: ['배송', 'info'],
  COMPLETED: ['완료', 'ok'],
  CANCELLED: ['취소', 'neutral'],
};
const JOB: Record<string, [string, Tone]> = {
  PENDING: ['대기', 'neutral'],
  RUNNING: ['실행 중', 'info'],
  SUCCESS: ['성공', 'ok'],
  FAILED: ['실패', 'danger'],
  RETRYING: ['재시도 대기', 'warn'],
  DEAD_LETTER: ['실패 (중단)', 'danger'],
};
const CONN: Record<string, [string, Tone]> = { CONNECTED: ['연결됨', 'ok'], DISCONNECTED: ['연결 안 됨', 'neutral'], ERROR: ['오류', 'danger'] };

function make(map: Record<string, [string, Tone]>) {
  return function S({ status, className }: { status: string; className?: string }) {
    const [label, tone] = map[status] ?? [status, 'neutral' as Tone];
    return (
      <Badge tone={tone} className={className}>
        {label}
      </Badge>
    );
  };
}

export const QuoteStatus = make(QUOTE);
export const QuoteStatusCustomer = make({ ...QUOTE, ...QUOTE_CUSTOMER });
export const ContractStatus = make(CONTRACT);
export const ShipmentStatus = make(SHIPMENT);
export const PaymentStatus = make(PAYMENT);
export const StageBadge = make(STAGE);
export const JobStatus = make(JOB);
export const ConnectionStatus = make(CONN);

export const STAGE_LABEL: Record<string, string> = Object.fromEntries(Object.entries(STAGE).map(([k, v]) => [k, v[0]]));

/** Trust badge: tells users how a number was obtained. */
export function VerificationBadge({ verification, source }: { verification: string; source?: string | null }) {
  const demo = source?.includes('DEMO');
  const map: Record<string, { label: string; tone: Tone; icon: React.ReactNode }> = {
    UNVERIFIED: { label: demo ? '데모 데이터' : '미검증', tone: demo ? 'warn' : 'neutral', icon: <CircleDashed className="h-3 w-3" /> },
    AI_ESTIMATE: { label: 'AI 예상', tone: 'info', icon: <Bot className="h-3 w-3" /> },
    SYSTEM_CALCULATED: { label: '계산값', tone: 'neutral', icon: <CircleDashed className="h-3 w-3" /> },
    PARTNER_VERIFIED: { label: source?.startsWith('FORWARDER') ? '포워더 확인' : '협력사 확인', tone: 'brand', icon: <Ship className="h-3 w-3" /> },
    EXPERT_VERIFIED: { label: source?.includes('CUSTOMS') ? '관세사 확인' : '전문가 확인', tone: 'purple', icon: <Scale className="h-3 w-3" /> },
    ACTUAL: { label: '실제 확정', tone: 'ok', icon: <BadgeCheck className="h-3 w-3" /> },
  };
  const m = map[verification] ?? { label: verification, tone: 'neutral' as Tone, icon: <FlaskConical className="h-3 w-3" /> };
  return (
    <Badge tone={m.tone} icon={m.icon}>
      {m.label}
    </Badge>
  );
}

export function PriceBadge({ badge }: { badge: 'ESTIMATED' | 'VERIFIED' | 'FINAL' | string }) {
  if (badge === 'FINAL') return <Badge tone="ok" icon={<BadgeCheck className="h-3 w-3" />}>확정가</Badge>;
  if (badge === 'VERIFIED') return <Badge tone="brand">협력사 확인 반영</Badge>;
  return <Badge tone="info" icon={<Bot className="h-3 w-3" />}>AI 예상</Badge>;
}

const RISK_TONE: Record<string, Tone> = { LOW: 'ok', MEDIUM: 'warn', HIGH: 'danger', CRITICAL: 'danger' };
const RISK_LABEL: Record<string, string> = { LOW: '낮음', MEDIUM: '보통', HIGH: '높음', CRITICAL: '매우 높음' };
export function RiskBadge({ level }: { level: string }) {
  return <Badge tone={RISK_TONE[level] ?? 'neutral'}>{RISK_LABEL[level] ?? level}</Badge>;
}
export const RISK_DIMENSION_LABEL: Record<string, string> = {
  COMPLIANCE: '규제',
  CUSTOMS: '통관',
  FREIGHT: '운송',
  BATTERY: '배터리',
  DG: '위험물',
  QUALITY: '품질',
  SUPPLIER: '공급자',
  DELIVERY: '납기',
  IP: '지식재산권',
  PACKAGING: '포장·표시',
  FX: '환율',
  PAYMENT: '결제',
  MARKET: '시장',
  CERTIFICATION: '인증',
};
