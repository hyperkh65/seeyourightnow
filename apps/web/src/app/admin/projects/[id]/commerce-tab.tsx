'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FilePlus2, Plus } from 'lucide-react';
import { api, newIdempotencyKey } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/utils';
import { useCan, useToast } from '@/components/providers';
import { ContractStatus, PaymentStatus, QuoteStatus, ShipmentStatus } from '@/components/status';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Dialog,
  EmptyState,
  Field,
  Input,
  Select,
  Table,
  Td,
  Textarea,
  Th,
} from '@/components/ui';
import type { Overview } from '@/components/project-parts';
import type { StaffResult } from './types';

function useInvalidate() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries();
}

export function QuotesTab({ ov, r }: { ov: Overview; r: StaffResult | undefined }) {
  const toast = useToast();
  const can = useCan();
  const invalidate = useInvalidate();
  const selected = r?.candidates.filter((c) => c.selected) ?? [];
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<
    Array<{ candidateId: string; name: string; specification: string; quantity: string; unitPrice: string }>
  >([]);
  const [meta, setMeta] = useState({
    leadTime: '샘플 확정 후 20~25일',
    contactName: '',
    customerCaution: '운임·관세·인증 비용은 실제 발생 금액에 따라 정산될 수 있습니다.',
    notes: '',
    shippingTotal: '0',
    otherCharges: '0',
  });
  const start = () => {
    setItems(
      selected.map((c) => ({
        candidateId: c.id,
        name: c.listing.titleKo || r?.product?.nameKo || c.listing.title,
        specification: Object.entries(c.listing.specs)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', '),
        quantity: String(r?.input.quantity ?? c.listing.moq ?? 100),
        unitPrice: '',
      })),
    );
    setOpen(true);
  };
  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>(`/projects/${ov.id}/quotations`, {
        ...meta,
        items: items.map((i) => ({
          candidateId: i.candidateId,
          name: i.name,
          specification: i.specification,
          quantity: Number(i.quantity),
          ...(i.unitPrice ? { unitPrice: i.unitPrice } : {}),
        })),
      }),
    onSuccess: (d) => {
      toast.ok('견적 초안을 만들었습니다.');
      setOpen(false);
      invalidate();
      window.location.href = `/admin/quotes/${d.id}`;
    },
    onError: toast.error,
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {can('quote.write') && (
          <Button onClick={start} disabled={!selected.length} icon={<FilePlus2 className="h-4 w-4" />}>
            선택한 후보로 견적 만들기
          </Button>
        )}
        {!selected.length && (
          <span className="text-xs text-ink-muted">
            공급처 탭에서 ‘견적 대상으로’를 선택하세요. 원가 계산이 된 후보는 계산 가격이 자동 적용됩니다.
          </span>
        )}
      </div>
      <Card>
        {ov.quotations.length === 0 ? (
          <EmptyState title="아직 견적이 없습니다" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>번호</Th>
                <Th>상태</Th>
                <Th className="text-right">합계</Th>
                <Th className="text-right">예상 이익 / 마진</Th>
                <Th>유효기한</Th>
              </tr>
            </thead>
            <tbody>
              {ov.quotations.map((q) => (
                <tr key={q.id} className="hover:bg-surface-sunken">
                  <Td>
                    <Link href={`/admin/quotes/${q.id}`} className="font-medium text-brand hover:underline">
                      {q.number}
                    </Link>{' '}
                    <span className="text-xs text-ink-muted">v{q.version}</span>
                  </Td>
                  <Td>
                    <QuoteStatus status={q.status} />
                  </Td>
                  <Td className="text-right tabular">{formatMoney(q.total, q.currency)}</Td>
                  <Td className="text-right text-xs tabular">
                    {q.internalSummary?.expectedProfit
                      ? `${formatMoney(q.internalSummary.expectedProfit, q.currency)} / ${q.internalSummary.marginPct}%`
                      : '—'}
                  </Td>
                  <Td className="text-xs">{formatDate(q.validUntil)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="xl"
        title="견적 초안 만들기"
        description="단가를 비우면 관리자 확정가 → 계산 가격 순으로 적용됩니다."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button loading={create.isPending} onClick={() => create.mutate()} disabled={!items.length}>
              초안 만들기
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {items.map((it, idx) => (
            <div key={it.candidateId} className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-6">
              <Field label="제품명" className="sm:col-span-3">
                <Input
                  value={it.name}
                  onChange={(e) =>
                    setItems(items.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))
                  }
                />
              </Field>
              <Field label="수량">
                <Input
                  value={it.quantity}
                  onChange={(e) =>
                    setItems(
                      items.map((x, i) =>
                        i === idx ? { ...x, quantity: e.target.value.replace(/\D/g, '') } : x,
                      ),
                    )
                  }
                />
              </Field>
              <Field label="단가 (선택)" className="sm:col-span-2">
                <Input
                  value={it.unitPrice}
                  placeholder="자동"
                  onChange={(e) =>
                    setItems(
                      items.map((x, i) =>
                        i === idx ? { ...x, unitPrice: e.target.value.replace(/[^\d.]/g, '') } : x,
                      ),
                    )
                  }
                />
              </Field>
              <Field label="사양" className="sm:col-span-6">
                <Input
                  value={it.specification}
                  onChange={(e) =>
                    setItems(items.map((x, i) => (i === idx ? { ...x, specification: e.target.value } : x)))
                  }
                />
              </Field>
            </div>
          ))}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="납기">
              <Input value={meta.leadTime} onChange={(e) => setMeta({ ...meta, leadTime: e.target.value })} />
            </Field>
            <Field label="고객 담당자">
              <Input
                value={meta.contactName}
                onChange={(e) => setMeta({ ...meta, contactName: e.target.value })}
              />
            </Field>
            <Field label="별도 운송비 (원)">
              <Input
                value={meta.shippingTotal}
                onChange={(e) =>
                  setMeta({ ...meta, shippingTotal: e.target.value.replace(/[^\d.]/g, '') || '0' })
                }
              />
            </Field>
            <Field label="기타 비용 (원)">
              <Input
                value={meta.otherCharges}
                onChange={(e) =>
                  setMeta({ ...meta, otherCharges: e.target.value.replace(/[^\d.]/g, '') || '0' })
                }
              />
            </Field>
            <Field label="고객 안내" className="sm:col-span-2">
              <Textarea
                value={meta.customerCaution}
                onChange={(e) => setMeta({ ...meta, customerCaution: e.target.value })}
              />
            </Field>
            <Field label="비고" className="sm:col-span-2">
              <Textarea value={meta.notes} onChange={(e) => setMeta({ ...meta, notes: e.target.value })} />
            </Field>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

export function ContractsPaymentsTab({ ov }: { ov: Overview }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const locked = ov.quotations.find((q) => ['LOCKED', 'ADMIN_FINAL_APPROVED'].includes(q.status));
  const [inv, setInv] = useState<null | { type: string; depositPct: string; dueDate: string; notes: string }>(
    null,
  );
  const [key] = useState(newIdempotencyKey);
  const createContract = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>(`/quotations/${locked!.id}/contract`, {}, { idempotencyKey: `${key}-ct` }),
    onSuccess: (d) => {
      toast.ok('계약서 초안을 만들었습니다.');
      invalidate();
      window.location.href = `/admin/contracts/${d.id}`;
    },
    onError: toast.error,
  });
  const issue = useMutation({
    mutationFn: () =>
      api.post(
        `/projects/${ov.id}/invoices`,
        {
          type: inv!.type,
          ...(inv!.depositPct ? { depositPct: Number(inv!.depositPct) } : {}),
          ...(inv!.dueDate ? { dueDate: inv!.dueDate } : {}),
          notes: inv!.notes,
        },
        { idempotencyKey: newIdempotencyKey() },
      ),
    onSuccess: () => {
      toast.ok('문서를 발행했습니다.');
      setInv(null);
      invalidate();
    },
    onError: toast.error,
  });
  const markPaid = useMutation({
    mutationFn: (id: string) =>
      api.patch(`/payments/${id}`, { status: 'PAID' }, { idempotencyKey: `${id}-paid` }),
    onSuccess: () => {
      toast.ok('입금 완료로 표시했습니다.');
      invalidate();
    },
    onError: toast.error,
  });
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader
          title="계약"
          action={
            locked && !ov.contracts.some((c) => c.status !== 'CANCELLED') ? (
              <Button size="sm" loading={createContract.isPending} onClick={() => createContract.mutate()}>
                계약서 만들기
              </Button>
            ) : undefined
          }
        />
        {ov.contracts.length === 0 ? (
          <EmptyState
            title={
              locked
                ? '확정된 견적으로 계약서를 만들 수 있습니다'
                : '견적이 최종 승인되면 계약서를 만들 수 있습니다'
            }
            className="py-8"
          />
        ) : (
          <ul className="divide-y divide-line">
            {ov.contracts.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/admin/contracts/${c.id}`}
                  className="flex items-center justify-between px-5 py-3 hover:bg-surface-sunken"
                >
                  <span className="text-sm font-medium">
                    {c.number} <span className="text-xs text-ink-muted">v{c.version}</span>
                    {c.legalReviewRequired && (
                      <Badge tone="warn" className="ml-2">
                        법률 검토 필요
                      </Badge>
                    )}
                  </span>
                  <ContractStatus status={c.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader
          title="인보이스 · 무역 서류"
          action={
            <Select
              className="h-8 w-auto text-xs"
              value=""
              onChange={(e) =>
                e.target.value &&
                setInv({
                  type: e.target.value,
                  depositPct: e.target.value === 'PROFORMA_INVOICE' ? '30' : '',
                  dueDate: '',
                  notes: '',
                })
              }
              aria-label="문서 발행"
            >
              <option value="">+ 문서 발행</option>
              <option value="PROFORMA_INVOICE">Proforma Invoice</option>
              <option value="COMMERCIAL_INVOICE">Commercial Invoice</option>
              <option value="PACKING_LIST">Packing List</option>
              <option value="SALES_INVOICE">거래명세서</option>
              <option value="RECEIPT">영수증</option>
              <option value="SHIPPING_NOTICE">선적 통지</option>
              <option value="DELIVERY_NOTE">납품서</option>
            </Select>
          }
        />
        {ov.invoices.length === 0 ? (
          <EmptyState title="발행된 인보이스가 없습니다" className="py-8" />
        ) : (
          <ul className="divide-y divide-line">
            {ov.invoices.map((i) => (
              <li key={i.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <span>
                  {i.number} <span className="text-xs text-ink-muted">{i.type}</span>
                </span>
                <span className="flex items-center gap-2 tabular">
                  {formatMoney(i.total, i.currency)}
                  <PaymentStatus status={i.paymentStatus} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="xl:col-span-2">
        <CardHeader title="결제" />
        {ov.payments.length === 0 ? (
          <EmptyState
            title="결제 일정이 없습니다"
            description="PI를 발행하면 입금 예정 항목이 만들어집니다."
            className="py-8"
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>구분</Th>
                <Th>종류</Th>
                <Th className="text-right">금액</Th>
                <Th>기한</Th>
                <Th>상태</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {ov.payments.map((p) => (
                <tr key={p.id}>
                  <Td>{p.direction === 'INBOUND' ? '입금' : '지급'}</Td>
                  <Td>{p.kind}</Td>
                  <Td className="text-right tabular">{formatMoney(p.amount, p.currency)}</Td>
                  <Td className="text-xs">{formatDate(p.dueDate)}</Td>
                  <Td>
                    <PaymentStatus status={p.status} />
                  </Td>
                  <Td className="text-right">
                    {p.status !== 'PAID' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={markPaid.isPending}
                        onClick={() => markPaid.mutate(p.id)}
                      >
                        입금 확인
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Dialog
        open={!!inv}
        onClose={() => setInv(null)}
        title="문서 발행"
        description="확정된 견적 품목으로 발행합니다. 발행된 문서는 변경할 수 없습니다."
        footer={
          <>
            <Button variant="secondary" onClick={() => setInv(null)}>
              취소
            </Button>
            <Button loading={issue.isPending} onClick={() => issue.mutate()}>
              발행
            </Button>
          </>
        }
      >
        {inv && (
          <div className="grid gap-3 sm:grid-cols-2">
            {inv.type === 'PROFORMA_INVOICE' && (
              <Field label="청구 비율 (%)" hint="계약금 청구 시 30 등">
                <Input
                  value={inv.depositPct}
                  onChange={(e) => setInv({ ...inv, depositPct: e.target.value.replace(/[^\d.]/g, '') })}
                />
              </Field>
            )}
            <Field label="결제 기한">
              <Input
                type="date"
                value={inv.dueDate}
                onChange={(e) => setInv({ ...inv, dueDate: e.target.value })}
              />
            </Field>
            <Field label="비고" className="sm:col-span-2">
              <Textarea value={inv.notes} onChange={(e) => setInv({ ...inv, notes: e.target.value })} />
            </Field>
            {!locked && (
              <Alert tone="warn" className="sm:col-span-2">
                최종 승인된 견적이 없어 발행할 수 없습니다.
              </Alert>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}

export function ProductionTab({
  ov,
  r,
}: {
  ov: Overview & {
    purchaseOrders?: Array<{ id: string; number: string; total: string; currency: string; status: string }>;
  };
  r: StaffResult | undefined;
}) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const suppliers = (r?.candidates ?? [])
    .filter((c) => c.supplier)
    .map((c) => ({
      id: c.supplier!.id,
      name: c.supplier!.name,
      price: c.listing.supplierVerifiedPrice ?? c.listing.supplierListPrice,
      currency: c.listing.currency,
      title: c.listing.title,
      selected: c.selected,
    }));
  const [po, setPo] = useState<null | {
    supplierId: string;
    currency: string;
    name: string;
    quantity: string;
    unitPrice: string;
  }>(null);
  const [upd, setUpd] = useState<null | {
    id: string;
    status: string;
    plannedEnd: string;
    progressPct: string;
    delayReason: string;
    note: string;
  }>(null);
  const [insp, setInsp] = useState<null | {
    id?: string;
    result: string;
    sampleSize: string;
    defectsCritical: string;
    defectsMajor: string;
    defectsMinor: string;
    note: string;
    inspector: string;
  }>(null);
  const createPo = useMutation({
    mutationFn: () =>
      api.post(
        `/projects/${ov.id}/purchase-orders`,
        {
          supplierId: po!.supplierId,
          currency: po!.currency,
          lines: [{ name: po!.name, quantity: Number(po!.quantity), unitPrice: po!.unitPrice }],
        },
        { idempotencyKey: newIdempotencyKey() },
      ),
    onSuccess: () => {
      toast.ok('발주서를 발행했습니다.');
      setPo(null);
      invalidate();
    },
    onError: toast.error,
  });
  const saveUpd = useMutation({
    mutationFn: () =>
      api.patch(`/production-orders/${upd!.id}`, {
        status: upd!.status,
        ...(upd!.plannedEnd ? { plannedEnd: upd!.plannedEnd } : {}),
        ...(upd!.progressPct ? { progressPct: Number(upd!.progressPct) } : {}),
        ...(upd!.delayReason ? { delayReason: upd!.delayReason } : {}),
        note: upd!.note,
      }),
    onSuccess: () => {
      toast.ok('생산 현황을 업데이트했습니다.');
      setUpd(null);
      invalidate();
    },
    onError: toast.error,
  });
  const saveInsp = useMutation({
    mutationFn: async () => {
      let id = insp!.id;
      if (!id)
        id = (
          await api.post<{ id: string }>(`/projects/${ov.id}/inspections`, {
            type: 'PRE_SHIPMENT',
            inspector: insp!.inspector,
          })
        ).id;
      if (insp!.result !== 'PENDING')
        await api.patch(`/inspections/${id}`, {
          result: insp!.result,
          ...(insp!.sampleSize ? { sampleSize: Number(insp!.sampleSize) } : {}),
          defectsCritical: Number(insp!.defectsCritical || 0),
          defectsMajor: Number(insp!.defectsMajor || 0),
          defectsMinor: Number(insp!.defectsMinor || 0),
          note: insp!.note,
        });
    },
    onSuccess: () => {
      toast.ok('검품 정보를 저장했습니다.');
      setInsp(null);
      invalidate();
    },
    onError: toast.error,
  });
  const first = suppliers.find((s) => s.selected) ?? suppliers[0];
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader
          title="공장 발주"
          action={
            <Button
              size="sm"
              disabled={!first}
              onClick={() =>
                setPo({
                  supplierId: first!.id,
                  currency: first!.currency,
                  name: first!.title,
                  quantity: String(r?.input.quantity ?? ''),
                  unitPrice: first!.price ?? '',
                })
              }
              icon={<Plus className="h-4 w-4" />}
            >
              발주서 발행
            </Button>
          }
        />
        <CardBody>
          {(ov.purchaseOrders ?? []).length === 0 ? (
            <p className="text-sm text-ink-muted">아직 발주하지 않았습니다.</p>
          ) : (
            (ov.purchaseOrders ?? []).map((p) => (
              <div key={p.id} className="flex justify-between text-sm">
                <span>{p.number}</span>
                <span className="tabular">{formatMoney(p.total, p.currency)}</span>
              </div>
            ))
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="생산 현황" />
        <CardBody className="space-y-3">
          {ov.production.length === 0 ? (
            <p className="text-sm text-ink-muted">발주 후 생산 현황을 기록할 수 있습니다.</p>
          ) : (
            ov.production.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 text-sm">
                <span>
                  {p.statusLabel} · {p.progressPct}%
                  {p.plannedEnd ? ` · 완료 예정 ${formatDate(p.plannedEnd)}` : ''}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setUpd({
                      id: p.id,
                      status: p.status,
                      plannedEnd: p.plannedEnd ?? '',
                      progressPct: String(p.progressPct),
                      delayReason: '',
                      note: '',
                    })
                  }
                >
                  업데이트
                </Button>
              </div>
            ))
          )}
        </CardBody>
      </Card>
      <Card className="xl:col-span-2">
        <CardHeader
          title="검품"
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                setInsp({
                  result: 'PENDING',
                  sampleSize: '',
                  defectsCritical: '0',
                  defectsMajor: '0',
                  defectsMinor: '0',
                  note: '',
                  inspector: '',
                })
              }
            >
              검품 등록
            </Button>
          }
        />
        <CardBody className="space-y-2">
          {ov.inspections.length === 0 ? (
            <p className="text-sm text-ink-muted">등록된 검품이 없습니다.</p>
          ) : (
            ov.inspections.map((i) => (
              <div key={i.id} className="flex items-center justify-between text-sm">
                <span>
                  {i.type} · 치명 {i.defectsCritical} / 중 {i.defectsMajor} / 경 {i.defectsMinor}
                  {i.inspector ? ` · ${i.inspector}` : ''}
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={i.result === 'PASSED' ? 'ok' : i.result === 'FAILED' ? 'danger' : 'neutral'}>
                    {i.result}
                  </Badge>
                  {i.result === 'PENDING' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setInsp({
                          id: i.id,
                          result: 'PASSED',
                          sampleSize: '',
                          defectsCritical: '0',
                          defectsMajor: '0',
                          defectsMinor: '0',
                          note: '',
                          inspector: i.inspector ?? '',
                        })
                      }
                    >
                      결과 입력
                    </Button>
                  )}
                </span>
              </div>
            ))
          )}
        </CardBody>
      </Card>
      <Dialog
        open={!!po}
        onClose={() => setPo(null)}
        title="공장 발주서 발행"
        description="발주서는 고객에게 공개되지 않습니다."
        footer={
          <>
            <Button variant="secondary" onClick={() => setPo(null)}>
              취소
            </Button>
            <Button
              loading={createPo.isPending}
              onClick={() => createPo.mutate()}
              disabled={!po?.quantity || !po?.unitPrice}
            >
              발행
            </Button>
          </>
        }
      >
        {po && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="공급자" className="sm:col-span-2">
              <Select
                value={po.supplierId}
                onChange={(e) => {
                  const s = suppliers.find((x) => x.id === e.target.value)!;
                  setPo({
                    ...po,
                    supplierId: s.id,
                    currency: s.currency,
                    unitPrice: s.price ?? '',
                    name: s.title,
                  });
                }}
              >
                {suppliers.map((s) => (
                  <option key={s.id + s.title} value={s.id}>
                    {s.name} — {s.title.slice(0, 40)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="품목" className="sm:col-span-2">
              <Input value={po.name} onChange={(e) => setPo({ ...po, name: e.target.value })} />
            </Field>
            <Field label="수량">
              <Input
                value={po.quantity}
                onChange={(e) => setPo({ ...po, quantity: e.target.value.replace(/\D/g, '') })}
              />
            </Field>
            <Field label={`단가 (${po.currency})`}>
              <Input
                value={po.unitPrice}
                onChange={(e) => setPo({ ...po, unitPrice: e.target.value.replace(/[^\d.]/g, '') })}
              />
            </Field>
          </div>
        )}
      </Dialog>
      <Dialog
        open={!!upd}
        onClose={() => setUpd(null)}
        title="생산 현황 업데이트"
        description="시작·지연·완료는 고객에게 자동으로 안내됩니다."
        footer={
          <>
            <Button variant="secondary" onClick={() => setUpd(null)}>
              취소
            </Button>
            <Button loading={saveUpd.isPending} onClick={() => saveUpd.mutate()}>
              저장
            </Button>
          </>
        }
      >
        {upd && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="상태">
              <Select value={upd.status} onChange={(e) => setUpd({ ...upd, status: e.target.value })}>
                {[
                  ['NOT_STARTED', '생산 대기'],
                  ['MATERIALS', '자재 준비'],
                  ['IN_PRODUCTION', '생산 중'],
                  ['QC', '품질 검사'],
                  ['PACKING', '포장'],
                  ['COMPLETED', '생산 완료'],
                  ['DELAYED', '지연'],
                  ['ON_HOLD', '보류'],
                ].map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="완료 예정일">
              <Input
                type="date"
                value={upd.plannedEnd}
                onChange={(e) => setUpd({ ...upd, plannedEnd: e.target.value })}
              />
            </Field>
            <Field label="진행률 (%)">
              <Input
                value={upd.progressPct}
                onChange={(e) => setUpd({ ...upd, progressPct: e.target.value.replace(/\D/g, '') })}
              />
            </Field>
            {upd.status === 'DELAYED' && (
              <Field label="지연 사유">
                <Input
                  value={upd.delayReason}
                  onChange={(e) => setUpd({ ...upd, delayReason: e.target.value })}
                />
              </Field>
            )}
            <Field label="메모 (고객 공개)" className="sm:col-span-2">
              <Textarea value={upd.note} onChange={(e) => setUpd({ ...upd, note: e.target.value })} />
            </Field>
          </div>
        )}
      </Dialog>
      <Dialog
        open={!!insp}
        onClose={() => setInsp(null)}
        title="검품"
        footer={
          <>
            <Button variant="secondary" onClick={() => setInsp(null)}>
              취소
            </Button>
            <Button loading={saveInsp.isPending} onClick={() => saveInsp.mutate()}>
              저장
            </Button>
          </>
        }
      >
        {insp && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="검품 기관/담당">
              <Input
                value={insp.inspector}
                onChange={(e) => setInsp({ ...insp, inspector: e.target.value })}
              />
            </Field>
            <Field label="결과">
              <Select value={insp.result} onChange={(e) => setInsp({ ...insp, result: e.target.value })}>
                <option value="PENDING">예정</option>
                <option value="PASSED">합격</option>
                <option value="PASSED_WITH_REMARKS">조건부 합격</option>
                <option value="FAILED">불합격</option>
                <option value="WAIVED">면제</option>
              </Select>
            </Field>
            <Field label="샘플 수">
              <Input
                value={insp.sampleSize}
                onChange={(e) => setInsp({ ...insp, sampleSize: e.target.value.replace(/\D/g, '') })}
              />
            </Field>
            <Field label="결함 (치명/중/경)">
              <div className="grid grid-cols-3 gap-2">
                <Input
                  value={insp.defectsCritical}
                  onChange={(e) => setInsp({ ...insp, defectsCritical: e.target.value })}
                />
                <Input
                  value={insp.defectsMajor}
                  onChange={(e) => setInsp({ ...insp, defectsMajor: e.target.value })}
                />
                <Input
                  value={insp.defectsMinor}
                  onChange={(e) => setInsp({ ...insp, defectsMinor: e.target.value })}
                />
              </div>
            </Field>
            <Field label="메모" className="sm:col-span-2">
              <Textarea value={insp.note} onChange={(e) => setInsp({ ...insp, note: e.target.value })} />
            </Field>
          </div>
        )}
      </Dialog>
    </div>
  );
}

export function ShipmentsTab({ ov }: { ov: Overview }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    mode: 'LCL',
    carrierCode: '',
    carrierName: '',
    bookingNumber: '',
    blNumber: '',
    originPort: 'CNNGB',
    destinationPort: 'KRPUS',
    etd: '',
    eta: '',
  });
  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>(`/projects/${ov.id}/shipments`, {
        ...f,
        etd: f.etd ? new Date(f.etd).toISOString() : undefined,
        eta: f.eta ? new Date(f.eta).toISOString() : undefined,
      }),
    onSuccess: (d) => {
      toast.ok('선적을 등록했습니다.');
      setOpen(false);
      invalidate();
      window.location.href = `/admin/shipments/${d.id}`;
    },
    onError: toast.error,
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  return (
    <div className="space-y-4">
      <Button onClick={() => setOpen(true)} icon={<Plus className="h-4 w-4" />}>
        선적 등록
      </Button>
      <Card>
        {ov.shipments.length === 0 ? (
          <EmptyState title="등록된 선적이 없습니다" />
        ) : (
          <ul className="divide-y divide-line">
            {ov.shipments.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/admin/shipments/${s.id}`}
                  className="flex items-center justify-between px-5 py-3 hover:bg-surface-sunken"
                >
                  <span className="text-sm">
                    <b>{s.code}</b> · {s.originPort} → {s.destinationPort} · ETA {formatDate(s.eta)}
                  </span>
                  <ShipmentStatus status={s.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title="선적 등록"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button loading={create.isPending} onClick={() => create.mutate()}>
              등록
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="운송 방식">
            <Select value={f.mode} onChange={set('mode')}>
              {['COURIER', 'AIR', 'LCL', 'FCL_20', 'FCL_40', 'FCL_40HQ'].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </Field>
          <Field label="선사 코드 (SCAC)" hint="선사 추적 API 연결 시 사용">
            <Input value={f.carrierCode} onChange={set('carrierCode')} />
          </Field>
          <Field label="선사/항공사">
            <Input value={f.carrierName} onChange={set('carrierName')} />
          </Field>
          <Field label="출발항">
            <Input
              value={f.originPort}
              onChange={(e) => setF({ ...f, originPort: e.target.value.toUpperCase() })}
            />
          </Field>
          <Field label="도착항">
            <Input
              value={f.destinationPort}
              onChange={(e) => setF({ ...f, destinationPort: e.target.value.toUpperCase() })}
            />
          </Field>
          <Field label="부킹 번호">
            <Input value={f.bookingNumber} onChange={set('bookingNumber')} />
          </Field>
          <Field label="B/L 번호">
            <Input value={f.blNumber} onChange={set('blNumber')} />
          </Field>
          <Field label="출항 예정 (ETD)">
            <Input type="date" value={f.etd} onChange={set('etd')} />
          </Field>
          <Field label="도착 예정 (ETA)">
            <Input type="date" value={f.eta} onChange={set('eta')} />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
