'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronLeft, CopyPlus, Pencil, Send } from 'lucide-react';
import { api, newIdempotencyKey } from '@/lib/api';
import { useCan, useToast } from '@/components/providers';
import { QuoteView, type QuoteDetail } from '@/components/quote-view';
import { QuoteStatus } from '@/components/status';
import {
  Alert,
  Button,
  Card,
  CardBody,
  Dialog,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Textarea,
} from '@/components/ui';

type Draft = {
  items: Array<{
    candidateId?: string | null;
    name: string;
    specification: string;
    quantity: string;
    unit: string;
    unitPrice: string;
  }>;
  contactName: string;
  contactEmail: string;
  leadTime: string;
  paymentTerms: string;
  notes: string;
  customerCaution: string;
  terms: string;
  shippingTotal: string;
  otherCharges: string;
};

export default function AdminQuote() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const q = useQuery({ queryKey: ['quote', id], queryFn: () => api.get<QuoteDetail>(`/quotations/${id}`) });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirm, setConfirm] = useState<null | 'ISSUE' | 'FINAL' | 'REJECT'>(null);
  const [comment, setComment] = useState('');
  const [validDays, setValidDays] = useState('14');
  const [key] = useState(newIdempotencyKey);
  const done = (msg: string) => {
    toast.ok(msg);
    setConfirm(null);
    void qc.invalidateQueries();
  };
  const act = useMutation({
    mutationFn: async (a: 'REVIEW' | 'ISSUE' | 'FINAL' | 'REJECT' | 'VERSION' | 'CONTRACT') => {
      switch (a) {
        case 'REVIEW':
          return api.post(`/quotations/${id}/review`, {});
        case 'ISSUE':
          return api.post(
            `/quotations/${id}/issue`,
            { validDays: Number(validDays) || undefined },
            { idempotencyKey: `${key}-issue-${q.data?.version}` },
          );
        case 'FINAL':
          return api.post(`/quotations/${id}/final-approve`, { comment }, { idempotencyKey: `${key}-final` });
        case 'REJECT':
          return api.post(`/quotations/${id}/reject`, { comment });
        case 'VERSION':
          return api.post(`/quotations/${id}/versions`, {});
        case 'CONTRACT':
          return api.post<{ id: string }>(
            `/quotations/${id}/contract`,
            {},
            { idempotencyKey: `${key}-contract` },
          );
      }
    },
    onSuccess: (res, a) => {
      const msg = {
        REVIEW: '내부 검토를 요청했습니다.',
        ISSUE: '견적서를 발행해 고객에게 보냈습니다.',
        FINAL: '최종 승인했습니다. 견적이 확정되었습니다.',
        REJECT: '견적을 반려했습니다.',
        VERSION: '새 버전 초안을 만들었습니다.',
        CONTRACT: '계약서 초안을 만들었습니다.',
      }[a];
      done(msg);
      if (a === 'CONTRACT' && res && typeof res === 'object' && 'id' in res)
        router.push(`/admin/contracts/${(res as { id: string }).id}`);
    },
    onError: toast.error,
  });
  const save = useMutation({
    mutationFn: () =>
      api.put(`/quotations/${id}/draft`, {
        ...draft!,
        items: draft!.items.map((i) => ({
          ...(i.candidateId ? { candidateId: i.candidateId } : {}),
          name: i.name,
          specification: i.specification,
          quantity: Number(i.quantity),
          unit: i.unit || 'EA',
          ...(i.unitPrice ? { unitPrice: i.unitPrice } : {}),
        })),
      }),
    onSuccess: () => {
      toast.ok('초안을 저장했습니다.');
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ['quote', id] });
    },
    onError: toast.error,
  });
  if (q.isLoading)
    return (
      <Card className="p-5">
        <LoadingBlock rows={8} />
      </Card>
    );
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const editable = d.status === 'DRAFT' || d.status === 'ADMIN_REVIEW';
  const startEdit = () =>
    setDraft({
      items: d.items.map((i) => ({
        candidateId: i.candidateId ?? null,
        name: i.name,
        specification: i.specification,
        quantity: String(i.quantity),
        unit: i.unit,
        unitPrice: i.unitPrice,
      })),
      contactName: d.contactName,
      contactEmail: d.contactEmail,
      leadTime: d.leadTime,
      paymentTerms: d.paymentTerms,
      notes: d.notes,
      customerCaution: d.customerCaution,
      terms: d.terms,
      shippingTotal: d.shippingTotal,
      otherCharges: d.otherCharges,
    });
  const setItem = (idx: number, k: keyof Draft['items'][number], v: string) =>
    setDraft((x) => x && { ...x, items: x.items.map((it, i) => (i === idx ? { ...it, [k]: v } : it)) });
  return (
    <>
      <PageHeader
        back={
          <Link
            href={`/admin/projects/${d.projectId}?tab=quotes`}
            className="mb-2 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
          >
            <ChevronLeft className="h-4 w-4" />
            {d.project.code}
          </Link>
        }
        eyebrow={`${d.number} · v${d.version}`}
        title={d.project.title}
        actions={<QuoteStatus status={d.status} />}
      />
      {can('quote.write') && (
        <Card className="mb-6">
          <CardBody className="flex flex-wrap items-center gap-2">
            {editable && (
              <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={startEdit}>
                초안 수정
              </Button>
            )}
            {d.status === 'DRAFT' && (
              <Button variant="secondary" loading={act.isPending} onClick={() => act.mutate('REVIEW')}>
                내부 검토 요청
              </Button>
            )}
            {editable && (
              <Button icon={<Send className="h-4 w-4" />} onClick={() => setConfirm('ISSUE')}>
                발행 · 고객 발송
              </Button>
            )}
            {d.status === 'CUSTOMER_APPROVED' && can('quote.approve_final') && (
              <>
                <Button icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setConfirm('FINAL')}>
                  최종 승인
                </Button>
                <Button variant="danger" onClick={() => setConfirm('REJECT')}>
                  반려
                </Button>
              </>
            )}
            {['SENT', 'REJECTED', 'EXPIRED', 'CUSTOMER_APPROVED'].includes(d.status) && (
              <Button
                variant="secondary"
                icon={<CopyPlus className="h-4 w-4" />}
                loading={act.isPending}
                onClick={() => act.mutate('VERSION')}
              >
                새 버전으로 수정
              </Button>
            )}
            {['LOCKED', 'ADMIN_FINAL_APPROVED'].includes(d.status) && (
              <Button loading={act.isPending} onClick={() => act.mutate('CONTRACT')}>
                계약서 만들기
              </Button>
            )}
            <span className="ml-auto text-xs text-ink-muted">
              발행된 버전은 수정할 수 없고, 변경이 필요하면 새 버전을 만듭니다.
            </span>
          </CardBody>
        </Card>
      )}
      {d.status === 'CUSTOMER_APPROVED' && (
        <Alert tone="warn" className="mb-6">
          고객이 승인했습니다. 원가와 마진을 확인한 뒤 최종 승인해 주세요.
        </Alert>
      )}
      <QuoteView q={d} staff />

      <Dialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm === 'ISSUE' ? '견적서 발행' : confirm === 'FINAL' ? '최종 승인' : '견적 반려'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              취소
            </Button>
            <Button
              variant={confirm === 'REJECT' ? 'danger' : 'primary'}
              loading={act.isPending}
              onClick={() => confirm && act.mutate(confirm)}
            >
              {confirm === 'ISSUE' ? '발행하고 보내기' : confirm === 'FINAL' ? '최종 승인' : '반려'}
            </Button>
          </>
        }
      >
        {confirm === 'ISSUE' ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-soft">
              PDF가 생성되고 문서 해시가 기록됩니다. 발행 후에는 이 버전을 수정할 수 없습니다.
            </p>
            <Field label="유효기간 (일)">
              <Input value={validDays} onChange={(e) => setValidDays(e.target.value.replace(/\D/g, ''))} />
            </Field>
          </div>
        ) : (
          <Field label={confirm === 'FINAL' ? '메모 (선택)' : '반려 사유'}>
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
        )}
      </Dialog>

      <Dialog
        open={!!draft}
        onClose={() => setDraft(null)}
        size="xl"
        title="견적 초안 수정"
        description="단가를 비우면 관리자 확정가 → 계산 가격 순으로 적용됩니다."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDraft(null)}>
              취소
            </Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              저장
            </Button>
          </>
        }
      >
        {draft && (
          <div className="space-y-4">
            {draft.items.map((it, idx) => (
              <div key={idx} className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-6">
                <Field label="제품명" className="sm:col-span-3">
                  <Input value={it.name} onChange={(e) => setItem(idx, 'name', e.target.value)} />
                </Field>
                <Field label="수량">
                  <Input
                    value={it.quantity}
                    onChange={(e) => setItem(idx, 'quantity', e.target.value.replace(/\D/g, ''))}
                  />
                </Field>
                <Field label="단가" className="sm:col-span-2">
                  <Input
                    value={it.unitPrice}
                    onChange={(e) => setItem(idx, 'unitPrice', e.target.value.replace(/[^\d.]/g, ''))}
                  />
                </Field>
                <Field label="사양" className="sm:col-span-6">
                  <Input
                    value={it.specification}
                    onChange={(e) => setItem(idx, 'specification', e.target.value)}
                  />
                </Field>
              </div>
            ))}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="담당자">
                <Input
                  value={draft.contactName}
                  onChange={(e) => setDraft({ ...draft, contactName: e.target.value })}
                />
              </Field>
              <Field label="담당자 이메일">
                <Input
                  value={draft.contactEmail}
                  onChange={(e) => setDraft({ ...draft, contactEmail: e.target.value })}
                />
              </Field>
              <Field label="납기">
                <Input
                  value={draft.leadTime}
                  onChange={(e) => setDraft({ ...draft, leadTime: e.target.value })}
                />
              </Field>
              <Field label="결제 조건">
                <Input
                  value={draft.paymentTerms}
                  onChange={(e) => setDraft({ ...draft, paymentTerms: e.target.value })}
                />
              </Field>
              <Field label="별도 운송비">
                <Input
                  value={draft.shippingTotal}
                  onChange={(e) =>
                    setDraft({ ...draft, shippingTotal: e.target.value.replace(/[^\d.]/g, '') || '0' })
                  }
                />
              </Field>
              <Field label="기타 비용">
                <Input
                  value={draft.otherCharges}
                  onChange={(e) =>
                    setDraft({ ...draft, otherCharges: e.target.value.replace(/[^\d.]/g, '') || '0' })
                  }
                />
              </Field>
              <Field label="고객 안내" className="sm:col-span-2">
                <Textarea
                  value={draft.customerCaution}
                  onChange={(e) => setDraft({ ...draft, customerCaution: e.target.value })}
                />
              </Field>
              <Field label="거래 조건" className="sm:col-span-2">
                <Textarea
                  value={draft.terms}
                  onChange={(e) => setDraft({ ...draft, terms: e.target.value })}
                />
              </Field>
              <Field label="비고" className="sm:col-span-2">
                <Textarea
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                />
              </Field>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
