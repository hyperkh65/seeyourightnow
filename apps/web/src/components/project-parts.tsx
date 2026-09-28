'use client';

import Link from 'next/link';
import { Check, Download, FileText } from 'lucide-react';
import { openFile } from '@/lib/api';
import { cn, formatDate, formatMoney } from '@/lib/utils';
import { useToast } from './providers';
import { ContractStatus, PaymentStatus, QuoteStatusCustomer, ShipmentStatus } from './status';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Progress } from './ui';

export interface Overview {
  id: string;
  code: string;
  title: string;
  stage: string;
  stageLabel: string;
  status: string;
  createdAt: string;
  audience: 'CUSTOMER' | 'STAFF';
  timeline: Array<{ stage: string; label: string; state: 'DONE' | 'CURRENT' | 'PENDING'; at: string | null }>;
  requests: Array<{ id: string; status: string; createdAt: string; query: string; quantity: number | null }>;
  quotations: Array<{
    id: string;
    number: string;
    status: string;
    version: number;
    total?: string;
    currency?: string;
    validUntil?: string | null;
    sentAt?: string | null;
    internalSummary?: Record<string, string | null>;
  }>;
  contracts: Array<{
    id: string;
    number: string;
    status: string;
    version: number;
    effectiveAt: string | null;
    legalReviewRequired?: boolean;
  }>;
  invoices: Array<{
    id: string;
    type: string;
    number: string;
    total: string;
    currency: string;
    dueDate: string | null;
    paymentStatus: string;
    documentId: string | null;
    issuedAt: string | null;
  }>;
  payments: Array<{
    id: string;
    direction: string;
    kind: string;
    amount: string;
    currency: string;
    dueDate: string | null;
    status: string;
    paidAt: string | null;
  }>;
  production: Array<{
    id: string;
    status: string;
    statusLabel: string;
    plannedStart: string | null;
    plannedEnd: string | null;
    progressPct: number;
    updates: Array<{ at: string; status: string; note: string }>;
  }>;
  inspections: Array<{
    id: string;
    type: string;
    result: string;
    scheduledAt: string | null;
    defectsCritical: number;
    defectsMajor: number;
    defectsMinor: number;
    inspector?: string;
    note?: string;
  }>;
  shipments: Array<{
    id: string;
    code: string;
    mode: string;
    status: string;
    originPort: string;
    destinationPort: string;
    etd: string | null;
    eta: string | null;
    atd: string | null;
    ata: string | null;
    customsStatus: string;
  }>;
  documents: Array<{
    id: string;
    kind: string;
    number: string;
    version: number;
    sha256: string;
    sizeBytes: number;
    createdAt: string;
  }>;
  workflow: {
    status: string;
    currentStep: string | null;
    waitingFor: string | null;
    steps: Array<{ key: string; label: string; human: boolean; state: string; at: string | null }>;
  };
}

export const DOC_KIND_LABEL: Record<string, string> = {
  QUOTATION: '견적서',
  CONTRACT: '계약서',
  PROFORMA_INVOICE: 'Proforma Invoice',
  COMMERCIAL_INVOICE: 'Commercial Invoice',
  PACKING_LIST: 'Packing List',
  SALES_INVOICE: '거래명세서',
  RECEIPT: '영수증',
  PURCHASE_ORDER: 'Purchase Order',
  SHIPPING_NOTICE: '선적 통지',
  DELIVERY_NOTE: '납품서',
};

export function Timeline({ items, compact }: { items: Overview['timeline']; compact?: boolean }) {
  const current = items.findIndex((i) => i.state === 'CURRENT');
  const doneCount = items.filter((i) => i.state === 'DONE').length;
  if (compact) {
    return (
      <div>
        <Progress value={(doneCount / Math.max(1, items.length - 1)) * 100} />
        <p className="mt-1.5 text-xs text-ink-muted">{items[current]?.label ?? items.at(-1)?.label}</p>
      </div>
    );
  }
  return (
    <ol className="scroll-thin flex gap-0 overflow-x-auto pb-2" aria-label="진행 단계">
      {items.map((s, i) => (
        <li key={s.stage} className="flex min-w-[76px] flex-1 flex-col items-center text-center">
          <div className="flex w-full items-center">
            <span
              className={cn(
                'h-0.5 flex-1',
                i === 0 ? 'bg-transparent' : s.state === 'PENDING' ? 'bg-line' : 'bg-brand',
              )}
            />
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold',
                s.state === 'DONE'
                  ? 'border-brand bg-brand text-brand-fg'
                  : s.state === 'CURRENT'
                    ? 'border-brand bg-surface text-brand ring-4 ring-brand/15'
                    : 'border-line bg-surface text-ink-muted',
              )}
              aria-current={s.state === 'CURRENT' ? 'step' : undefined}
            >
              {s.state === 'DONE' ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span
              className={cn(
                'h-0.5 flex-1',
                i === items.length - 1
                  ? 'bg-transparent'
                  : items[i + 1]?.state === 'PENDING'
                    ? 'bg-line'
                    : 'bg-brand',
              )}
            />
          </div>
          <span
            className={cn(
              'mt-2 text-xs',
              s.state === 'CURRENT' ? 'font-semibold text-ink' : 'text-ink-muted',
            )}
          >
            {s.label}
          </span>
          {s.at && s.state !== 'PENDING' && (
            <span className="text-[10px] text-ink-muted">{formatDate(s.at).slice(5)}</span>
          )}
        </li>
      ))}
    </ol>
  );
}

export function DocumentsCard({ docs }: { docs: Overview['documents'] }) {
  const toast = useToast();
  return (
    <Card>
      <CardHeader title="문서" description="발행된 문서는 변경되지 않으며, 수정 시 새 버전으로 발행됩니다." />
      {docs.length === 0 ? (
        <EmptyState
          title="아직 발행된 문서가 없습니다"
          description="견적서, 계약서, 인보이스가 발행되면 여기에 모입니다."
          className="py-8"
        />
      ) : (
        <ul className="divide-y divide-line">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                  <FileText className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {DOC_KIND_LABEL[d.kind] ?? d.kind} · {d.number}
                    {d.version > 1 && <span className="text-ink-muted"> v{d.version}</span>}
                  </p>
                  <p className="truncate text-[11px] text-ink-muted" title={`SHA-256 ${d.sha256}`}>
                    {formatDate(d.createdAt, true)} · SHA-256 {d.sha256.slice(0, 12)}…
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                icon={<Download className="h-4 w-4" />}
                onClick={() => openFile(`/documents/${d.id}/url`).catch(toast.error)}
              >
                <span className="hidden sm:inline">다운로드</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function QuotesList({ quotes, base }: { quotes: Overview['quotations']; base: string }) {
  if (!quotes.length)
    return (
      <EmptyState
        title="아직 견적이 없습니다"
        description="담당자가 공급처와 비용을 확인한 뒤 견적서를 보내드립니다."
        className="py-8"
      />
    );
  return (
    <ul className="divide-y divide-line">
      {quotes.map((q) => (
        <li key={q.id}>
          <Link
            href={`${base}/${q.id}`}
            className="flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-surface-sunken"
          >
            <div>
              <p className="text-sm font-medium">
                {q.number} <span className="text-ink-muted">v{q.version}</span>
              </p>
              <p className="text-xs text-ink-muted">
                {q.validUntil ? `유효기한 ${formatDate(q.validUntil)}` : '작성 중'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {q.total && (
                <span className="text-sm font-semibold tabular">{formatMoney(q.total, q.currency)}</span>
              )}
              <QuoteStatusCustomer status={q.status} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function PaymentsCard({ ov, bankNote }: { ov: Overview; bankNote?: boolean }) {
  const inbound = ov.payments.filter((p) => p.direction === 'INBOUND');
  if (!inbound.length && !ov.invoices.length) return null;
  return (
    <Card>
      <CardHeader title="결제" />
      <CardBody className="space-y-3">
        {inbound.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-3 text-sm">
            <div>
              <p className="font-medium">
                {p.kind === 'DEPOSIT'
                  ? '계약금'
                  : p.kind === 'BALANCE'
                    ? '잔금'
                    : p.kind === 'FULL'
                      ? '전액'
                      : p.kind}
              </p>
              <p className="text-xs text-ink-muted">
                {p.paidAt ? `입금 ${formatDate(p.paidAt)}` : p.dueDate ? `기한 ${formatDate(p.dueDate)}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold tabular">{formatMoney(p.amount, p.currency)}</span>
              <PaymentStatus status={p.status} />
            </div>
          </div>
        ))}
        {bankNote && inbound.some((p) => p.status === 'PENDING') && (
          <p className="rounded-lg bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
            입금 계좌는 인보이스(PI) 문서에 안내되어 있습니다.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

export function ProductionCard({ ov }: { ov: Overview }) {
  if (!ov.production.length && !ov.inspections.length) return null;
  return (
    <Card>
      <CardHeader title="생산 · 검품" />
      <CardBody className="space-y-4">
        {ov.production.map((p) => (
          <div key={p.id}>
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{p.statusLabel}</span>
              <span className="text-xs text-ink-muted">
                {p.plannedEnd ? `완료 예정 ${formatDate(p.plannedEnd)}` : ''}
              </span>
            </div>
            <Progress
              className="mt-2"
              value={p.progressPct}
              tone={p.status === 'DELAYED' ? 'warn' : p.status === 'COMPLETED' ? 'ok' : 'brand'}
            />
            {p.updates.length > 0 && (
              <ul className="mt-3 space-y-1.5 border-l-2 border-line pl-3 text-xs text-ink-muted">
                {[...p.updates]
                  .reverse()
                  .slice(0, 4)
                  .map((u, i) => (
                    <li key={i}>
                      <span className="text-ink-soft">{formatDate(u.at)}</span> · {u.note || u.status}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        ))}
        {ov.inspections.map((i) => (
          <div
            key={i.id}
            className="flex items-center justify-between rounded-xl bg-surface-sunken px-3 py-2 text-sm"
          >
            <span>검품 ({i.type === 'PRE_SHIPMENT' ? '선적 전' : i.type})</span>
            <Badge
              tone={
                i.result === 'PASSED'
                  ? 'ok'
                  : i.result === 'FAILED'
                    ? 'danger'
                    : i.result === 'PENDING'
                      ? 'neutral'
                      : 'warn'
              }
            >
              {{
                PENDING: '예정',
                PASSED: '합격',
                PASSED_WITH_REMARKS: '조건부 합격',
                FAILED: '불합격',
                WAIVED: '면제',
              }[i.result] ?? i.result}
            </Badge>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

export function ShipmentsMini({ ov, base }: { ov: Overview; base: string }) {
  if (!ov.shipments.length) return null;
  return (
    <Card>
      <CardHeader title="운송" />
      <ul className="divide-y divide-line">
        {ov.shipments.map((s) => (
          <li key={s.id}>
            <Link
              href={`${base}/${s.id}`}
              className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface-sunken"
            >
              <div>
                <p className="text-sm font-medium">
                  {s.originPort} → {s.destinationPort}
                </p>
                <p className="text-xs text-ink-muted">
                  {s.ata
                    ? `도착 ${formatDate(s.ata)}`
                    : s.eta
                      ? `도착 예정 ${formatDate(s.eta)} (예상)`
                      : s.code}
                </p>
              </div>
              <ShipmentStatus status={s.status} />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ContractsMini({ ov, base }: { ov: Overview; base: string }) {
  if (!ov.contracts.length) return null;
  return (
    <Card>
      <CardHeader title="계약" />
      <ul className="divide-y divide-line">
        {ov.contracts.map((c) => (
          <li key={c.id}>
            <Link
              href={`${base}/${c.id}`}
              className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface-sunken"
            >
              <span className="text-sm font-medium">{c.number}</span>
              <ContractStatus status={c.status} />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
