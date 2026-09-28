'use client';

import { Download, FileText } from 'lucide-react';
import { openFile } from '@/lib/api';
import { formatDate, formatMoney, formatNumber } from '@/lib/utils';
import { useToast } from './providers';
import { PriceBadge, QuoteStatus, QuoteStatusCustomer } from './status';
import { Badge, Button, Card, CardBody, CardHeader, Table, Td, Th } from './ui';

export interface QuoteDetail {
  id: string;
  number: string;
  projectId: string;
  status: string;
  version: number;
  versionId: string;
  versionStatus: string;
  issueDate: string | null;
  validUntil: string | null;
  currency: string;
  subtotal: string;
  shippingTotal: string;
  otherCharges: string;
  vat: string;
  total: string;
  leadTime: string;
  paymentTerms: string;
  notes: string;
  customerCaution: string;
  terms: string;
  contactName: string;
  contactEmail: string;
  documentId: string | null;
  sentAt: string | null;
  items: Array<{
    id: string;
    name: string;
    specification: string;
    quantity: number;
    unit: string;
    unitPrice: string;
    amount: string;
    visibleBreakdown: Array<{ label: string; amount: string }>;
    priceBadge: string;
    candidateId?: string | null;
  }>;
  internalSummary?: {
    customerTotalExVat: string;
    estimatedCost: string | null;
    expectedProfit: string | null;
    markupPct: string | null;
    marginPct: string | null;
    costComplete: boolean;
  } | null;
  itemsInternal?: Array<{
    id: string;
    internalCost: string | null;
    internalMeta: { calculated?: string | null; adminFinal?: string | null } | null;
  }>;
  project: { code: string; title: string };
  versions: Array<{ version: number; status: string; sentAt: string | null; total: string }>;
  approvals: Array<{
    action: string;
    version: number;
    at: string;
    documentHash: string | null;
    comment: string;
    ip?: string;
    userAgent?: string;
  }>;
  canApprove: boolean;
}

const ACTION_LABEL: Record<string, string> = {
  CUSTOMER_APPROVED: '고객 승인',
  ADMIN_FINAL_APPROVED: '최종 승인',
  REJECTED: '반려',
};

export function QuoteView({ q, staff }: { q: QuoteDetail; staff?: boolean }) {
  const toast = useToast();
  return (
    <div className="space-y-6">
      <Card>
        <CardBody className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs text-ink-muted">
                {q.project.code} · {q.project.title}
              </p>
              <h2 className="mt-1 text-xl font-bold">
                견적서 {q.number} <span className="text-base font-medium text-ink-muted">v{q.version}</span>
              </h2>
              <p className="mt-1 text-xs text-ink-muted">
                {q.issueDate ? `발행 ${formatDate(q.issueDate)}` : '작성 중'}{' '}
                {q.validUntil && `· 유효기한 ${formatDate(q.validUntil)}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {staff ? <QuoteStatus status={q.status} /> : <QuoteStatusCustomer status={q.status} />}
              {q.documentId && (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Download className="h-4 w-4" />}
                  onClick={() => openFile(`/documents/${q.documentId}/url`).catch(toast.error)}
                >
                  PDF
                </Button>
              )}
            </div>
          </div>
          <Table>
            <thead>
              <tr>
                <Th>제품 / 사양</Th>
                <Th className="text-right">수량</Th>
                <Th className="text-right">단가</Th>
                <Th className="text-right">금액</Th>
              </tr>
            </thead>
            <tbody>
              {q.items.map((i) => {
                const internal = q.itemsInternal?.find((x) => x.id === i.id);
                return (
                  <tr key={i.id}>
                    <Td>
                      <p className="font-medium">{i.name}</p>
                      {i.specification && <p className="text-xs text-ink-muted">{i.specification}</p>}
                      {i.visibleBreakdown.length > 0 && (
                        <p className="mt-1 text-[11px] text-ink-muted">
                          {i.visibleBreakdown
                            .map((b) => `${b.label} ${formatMoney(b.amount, q.currency)}`)
                            .join(' · ')}
                        </p>
                      )}
                      <div className="mt-1">
                        <PriceBadge badge={i.priceBadge} />
                      </div>
                      {staff && internal && (
                        <p className="mt-1.5 text-[11px] text-violet-700 dark:text-violet-300">
                          내부 원가(예상){' '}
                          {internal.internalCost ? formatMoney(internal.internalCost, q.currency) : '미산출'}
                          {internal.internalMeta?.calculated &&
                            ` · 계산가 ${formatMoney(internal.internalMeta.calculated, q.currency)}`}
                          {internal.internalMeta?.adminFinal &&
                            ` · 관리자 확정가 ${formatMoney(internal.internalMeta.adminFinal, q.currency)}`}
                        </p>
                      )}
                    </Td>
                    <Td className="text-right tabular">
                      {formatNumber(i.quantity)} {i.unit}
                    </Td>
                    <Td className="text-right tabular">{formatMoney(i.unitPrice, q.currency)}</Td>
                    <Td className="text-right font-medium tabular">{formatMoney(i.amount, q.currency)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <dl className="ml-auto w-full max-w-xs space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-muted">공급가액</dt>
              <dd className="tabular">{formatMoney(q.subtotal, q.currency)}</dd>
            </div>
            {q.shippingTotal !== '0' && Number(q.shippingTotal) > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-muted">운송비</dt>
                <dd className="tabular">{formatMoney(q.shippingTotal, q.currency)}</dd>
              </div>
            )}
            {Number(q.otherCharges) > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-muted">기타</dt>
                <dd className="tabular">{formatMoney(q.otherCharges, q.currency)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-ink-muted">부가세</dt>
              <dd className="tabular">{formatMoney(q.vat, q.currency)}</dd>
            </div>
            <div className="flex justify-between border-t border-line pt-2 text-base font-bold">
              <dt>합계</dt>
              <dd className="tabular">{formatMoney(q.total, q.currency)}</dd>
            </div>
          </dl>
          <div className="grid gap-4 rounded-xl bg-surface-sunken p-4 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs text-ink-muted">납기</p>
              <p>{q.leadTime || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">결제 조건</p>
              <p>{q.paymentTerms || '—'}</p>
            </div>
            {q.customerCaution && (
              <div className="sm:col-span-2">
                <p className="text-xs text-ink-muted">안내</p>
                <p className="whitespace-pre-line">{q.customerCaution}</p>
              </div>
            )}
            {q.notes && (
              <div className="sm:col-span-2">
                <p className="text-xs text-ink-muted">비고</p>
                <p className="whitespace-pre-line">{q.notes}</p>
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      {staff && q.internalSummary && (
        <Card className="border-violet-200 dark:border-violet-500/30">
          <CardHeader
            title="수익 미리보기 (내부 전용)"
            description="고객 화면과 문서에는 표시되지 않습니다."
          />
          <CardBody className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <div>
              <p className="text-xs text-ink-muted">고객 금액 (VAT 제외)</p>
              <p className="font-semibold tabular">
                {formatMoney(q.internalSummary.customerTotalExVat, q.currency)}
              </p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">예상 원가</p>
              <p className="font-semibold tabular">
                {q.internalSummary.estimatedCost
                  ? formatMoney(q.internalSummary.estimatedCost, q.currency)
                  : '일부 미산출'}
              </p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">예상 이익</p>
              <p className="font-semibold tabular text-emerald-600">
                {q.internalSummary.expectedProfit
                  ? formatMoney(q.internalSummary.expectedProfit, q.currency)
                  : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">마크업 (이익/원가)</p>
              <p className="font-semibold tabular">
                {q.internalSummary.markupPct ? `${q.internalSummary.markupPct}%` : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">마진 (이익/판매가)</p>
              <p className="font-semibold tabular">
                {q.internalSummary.marginPct ? `${q.internalSummary.marginPct}%` : '—'}
              </p>
            </div>
          </CardBody>
        </Card>
      )}

      {(q.approvals.length > 0 || q.versions.length > 1) && (
        <Card>
          <CardHeader title="승인 · 버전 이력" />
          <CardBody className="space-y-3 text-sm">
            {q.approvals.map((a, i) => (
              <div key={i} className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <Badge tone={a.action === 'REJECTED' ? 'danger' : 'ok'}>
                    {ACTION_LABEL[a.action] ?? a.action}
                  </Badge>{' '}
                  v{a.version} · {formatDate(a.at, true)}
                </span>
                <span className="truncate text-[11px] text-ink-muted" title={a.documentHash ?? ''}>
                  문서 해시 {a.documentHash?.slice(0, 16)}… {staff && a.ip ? `· IP ${a.ip}` : ''}
                </span>
              </div>
            ))}
            {q.versions.length > 1 && (
              <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                {q.versions.map((v) => (
                  <Badge
                    key={v.version}
                    tone={v.version === q.version ? 'brand' : 'neutral'}
                    icon={<FileText className="h-3 w-3" />}
                  >
                    v{v.version} · {formatMoney(v.total, q.currency)}
                  </Badge>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
