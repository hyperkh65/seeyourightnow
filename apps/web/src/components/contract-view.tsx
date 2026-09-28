'use client';

import { Download } from 'lucide-react';
import { openFile } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/utils';
import { useToast } from './providers';
import { ContractStatus } from './status';
import { Alert, Badge, Button, Card, CardBody, CardHeader } from './ui';

export interface ContractDetail {
  id: string;
  number: string;
  status: string;
  projectId: string;
  currentVersion: number;
  legalReviewRequired: boolean;
  legalReviewedAt: string | null;
  effectiveAt: string | null;
  clauses: Array<{ key: string; title: string; body: string }>;
  snapshot: { items?: Array<{ name: string; quantity: number; unitPrice: string; amount: string }>; total?: string; currency?: string; customer?: { name: string } };
  approvals: Array<{ action: string; version: number; at: string; documentHash: string | null }>;
  documents: Array<{ id: string; version: number; sha256: string; createdAt: string }>;
  canApprove: boolean;
}

export function ContractView({ c, staff }: { c: ContractDetail; staff?: boolean }) {
  const toast = useToast();
  const latest = c.documents[0];
  return (
    <div className="space-y-6">
      <Card>
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold">제품 공급 계약서 {c.number}</h2>
              <p className="text-xs text-ink-muted">버전 v{c.currentVersion}{c.effectiveAt ? ` · 체결 ${formatDate(c.effectiveAt)}` : ''}</p>
            </div>
            <div className="flex items-center gap-2">
              <ContractStatus status={c.status} />
              {latest && <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={() => openFile(`/documents/${latest.id}/url`).catch(toast.error)}>PDF</Button>}
            </div>
          </div>
          {staff && c.legalReviewRequired && !c.legalReviewedAt && <Alert tone="warn" title="법률 검토 필요">이 계약서 양식은 법률 검토 완료 표시가 없습니다. 회사 승인 전에 검토해 주세요.</Alert>}
          {c.snapshot.items && (
            <div className="rounded-xl bg-surface-sunken p-4 text-sm">
              {c.snapshot.items.map((i, idx) => (
                <div key={idx} className="flex justify-between gap-3 py-0.5"><span>{i.name} × {i.quantity}</span><span className="tabular">{formatMoney(i.amount, c.snapshot.currency)}</span></div>
              ))}
              <div className="mt-2 flex justify-between border-t border-line pt-2 font-semibold"><span>계약 금액 (VAT 포함)</span><span className="tabular">{formatMoney(c.snapshot.total, c.snapshot.currency)}</span></div>
            </div>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="계약 조항" />
        <CardBody className="space-y-4">
          {c.clauses.map((cl, i) => (
            <div key={cl.key + i}>
              <p className="text-sm font-semibold">제{i + 1}조 ({cl.title})</p>
              <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-ink-soft">{cl.body}</p>
            </div>
          ))}
        </CardBody>
      </Card>
      {c.approvals.length > 0 && (
        <Card>
          <CardHeader title="전자 승인 기록" />
          <CardBody className="space-y-2 text-sm">
            {c.approvals.map((a, i) => (
              <div key={i} className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2"><Badge tone="ok">{a.action === 'CUSTOMER_APPROVED' ? '고객 승인' : a.action === 'COMPANY_APPROVED' ? '회사 승인' : a.action}</Badge>{formatDate(a.at, true)}</span>
                <span className="text-[11px] text-ink-muted">문서 해시 {a.documentHash?.slice(0, 16)}…</span>
              </div>
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
