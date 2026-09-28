'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Pencil, Plus, Scale, Send, Stamp, Trash2 } from 'lucide-react';
import { api, newIdempotencyKey } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { useCan, useToast } from '@/components/providers';
import { ContractView, type ContractDetail } from '@/components/contract-view';
import { ContractStatus } from '@/components/status';
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

type Clause = ContractDetail['clauses'][number];

export default function AdminContract() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const q = useQuery({
    queryKey: ['contract', id],
    queryFn: () => api.get<ContractDetail & { number: string }>(`/contracts/${id}`),
  });
  const [clauses, setClauses] = useState<Clause[] | null>(null);
  const [cancel, setCancel] = useState<string | null>(null);
  const [key] = useState(newIdempotencyKey);
  const act = useMutation({
    mutationFn: (a: 'SEND' | 'LEGAL' | 'COMPANY' | 'CANCEL') =>
      a === 'SEND'
        ? api.post(`/contracts/${id}/send`, {}, { idempotencyKey: `${key}-send-${q.data?.currentVersion}` })
        : a === 'LEGAL'
          ? api.post(`/contracts/${id}/legal-review`, {})
          : a === 'COMPANY'
            ? api.post(`/contracts/${id}/company-approve`, {}, { idempotencyKey: `${key}-company` })
            : api.post(`/contracts/${id}/cancel`, { reason: cancel ?? '' }),
    onSuccess: (_r, a) => {
      toast.ok(
        {
          SEND: '계약서를 고객에게 보냈습니다.',
          LEGAL: '법률 검토 완료로 표시했습니다.',
          COMPANY: '회사 승인을 완료했습니다. 계약이 체결되었습니다.',
          CANCEL: '계약을 취소했습니다.',
        }[a],
      );
      setCancel(null);
      void qc.invalidateQueries();
    },
    onError: toast.error,
  });
  const save = useMutation({
    mutationFn: () =>
      api.put(`/contracts/${id}/clauses`, {
        clauses: clauses!.map((c, i) => ({ ...c, key: c.key || `c${i + 1}` })),
      }),
    onSuccess: () => {
      toast.ok('조항을 저장했습니다. 새 계약서 버전이 만들어졌습니다.');
      setClauses(null);
      void qc.invalidateQueries({ queryKey: ['contract', id] });
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
  const c = q.data;
  const legalPending = c.legalReviewRequired && !c.legalReviewedAt;
  return (
    <>
      <PageHeader
        back={
          <Link
            href={`/admin/projects/${c.projectId}?tab=contracts`}
            className="mb-2 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
          >
            <ChevronLeft className="h-4 w-4" />
            프로젝트
          </Link>
        }
        eyebrow={`v${c.currentVersion}`}
        title={`계약서 ${c.number}`}
        actions={<ContractStatus status={c.status} />}
      />
      <Card className="mb-6">
        <CardBody className="flex flex-wrap items-center gap-2">
          {c.status === 'DRAFT' && can('contract.write') && (
            <Button
              variant="secondary"
              icon={<Pencil className="h-4 w-4" />}
              onClick={() => setClauses(c.clauses.map((x) => ({ ...x })))}
            >
              조항 수정
            </Button>
          )}
          {legalPending && can('contract.approve_company') && (
            <Button
              variant="secondary"
              icon={<Scale className="h-4 w-4" />}
              loading={act.isPending}
              onClick={() => act.mutate('LEGAL')}
            >
              법률 검토 완료 표시
            </Button>
          )}
          {c.status === 'DRAFT' && can('contract.write') && (
            <Button
              icon={<Send className="h-4 w-4" />}
              loading={act.isPending}
              onClick={() => act.mutate('SEND')}
            >
              고객에게 보내기
            </Button>
          )}
          {c.status === 'CUSTOMER_APPROVED' && can('contract.approve_company') && (
            <Button
              icon={<Stamp className="h-4 w-4" />}
              disabled={legalPending}
              loading={act.isPending}
              onClick={() => act.mutate('COMPANY')}
            >
              회사 승인 · 체결
            </Button>
          )}
          {!['EFFECTIVE', 'CANCELLED'].includes(c.status) && can('contract.approve_company') && (
            <Button variant="ghost" onClick={() => setCancel('')}>
              계약 취소
            </Button>
          )}
          {c.effectiveAt && (
            <span className="text-sm text-ink-muted">체결일 {formatDate(c.effectiveAt, true)}</span>
          )}
        </CardBody>
      </Card>
      {legalPending && (
        <Alert tone="warn" className="mb-6" title="법률 검토가 필요한 계약입니다">
          계약 금액이나 조건이 기준을 넘었습니다. 검토 완료 표시 후 회사 승인할 수 있습니다.
        </Alert>
      )}
      <ContractView c={c} staff />

      <Dialog
        open={!!clauses}
        onClose={() => setClauses(null)}
        size="xl"
        title="계약 조항 수정"
        description="저장하면 새 버전이 만들어지고 이전 버전은 그대로 보존됩니다."
        footer={
          <>
            <Button variant="secondary" onClick={() => setClauses(null)}>
              취소
            </Button>
            <Button
              loading={save.isPending}
              onClick={() => save.mutate()}
              disabled={!clauses?.length || clauses.some((x) => !x.title.trim() || !x.body.trim())}
            >
              저장
            </Button>
          </>
        }
      >
        {clauses && (
          <div className="space-y-4">
            {clauses.map((cl, i) => (
              <div key={i} className="space-y-2 rounded-xl border border-line p-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-ink-muted">제{i + 1}조</span>
                  <Input
                    value={cl.title}
                    aria-label="조항 제목"
                    onChange={(e) =>
                      setClauses(clauses.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
                    }
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="조항 삭제"
                    onClick={() => setClauses(clauses.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <Textarea
                  rows={4}
                  value={cl.body}
                  aria-label="조항 내용"
                  onChange={(e) =>
                    setClauses(clauses.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))
                  }
                />
              </div>
            ))}
            <Button
              variant="secondary"
              icon={<Plus className="h-4 w-4" />}
              onClick={() =>
                setClauses([...clauses, { key: `c${Date.now().toString(36)}`, title: '', body: '' }])
              }
            >
              조항 추가
            </Button>
          </div>
        )}
      </Dialog>
      <Dialog
        open={cancel !== null}
        onClose={() => setCancel(null)}
        title="계약 취소"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancel(null)}>
              닫기
            </Button>
            <Button
              variant="danger"
              disabled={(cancel ?? '').trim().length < 2}
              loading={act.isPending}
              onClick={() => act.mutate('CANCEL')}
            >
              취소 처리
            </Button>
          </>
        }
      >
        <Field label="취소 사유" required>
          <Textarea value={cancel ?? ''} onChange={(e) => setCancel(e.target.value)} />
        </Field>
      </Dialog>
    </>
  );
}
