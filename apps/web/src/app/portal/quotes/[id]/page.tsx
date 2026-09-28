'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronLeft } from 'lucide-react';
import { api, newIdempotencyKey } from '@/lib/api';
import { formatMoney } from '@/lib/utils';
import { useToast } from '@/components/providers';
import { QuoteView, type QuoteDetail } from '@/components/quote-view';
import {
  Alert,
  Button,
  Card,
  CardBody,
  Checkbox,
  Dialog,
  ErrorState,
  Field,
  LoadingBlock,
  PageHeader,
  Textarea,
} from '@/components/ui';

export default function PortalQuote() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['quote', id], queryFn: () => api.get<QuoteDetail>(`/quotations/${id}`) });
  const [dialog, setDialog] = useState<null | 'APPROVE' | 'REJECT'>(null);
  const [agree, setAgree] = useState(false);
  const [comment, setComment] = useState('');
  const [key] = useState(newIdempotencyKey);
  const decide = useMutation({
    mutationFn: (decision: 'APPROVE' | 'REJECT') =>
      api.post(
        `/quotations/${id}/customer-decision`,
        { decision, comment, versionId: q.data!.versionId },
        { idempotencyKey: `${key}-${decision}` },
      ),
    onSuccess: (_d, decision) => {
      toast.ok(
        decision === 'APPROVE' ? '견적을 승인했습니다. 담당자가 계약을 준비합니다.' : '견적을 거절했습니다.',
      );
      setDialog(null);
      void qc.invalidateQueries();
    },
    onError: toast.error,
  });
  if (q.isLoading)
    return (
      <Card className="p-5">
        <LoadingBlock rows={8} />
      </Card>
    );
  if (q.error || !q.data) return <ErrorState error={q.error} />;
  const d = q.data;
  return (
    <>
      <PageHeader
        back={
          <Link
            href={`/portal/projects/${d.projectId}`}
            className="mb-2 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
          >
            <ChevronLeft className="h-4 w-4" />
            프로젝트
          </Link>
        }
        title="견적서"
      />
      {d.canApprove && (
        <Card className="mb-6 border-brand/30">
          <CardBody className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <p className="font-semibold">견적 내용을 확인하고 승인해 주세요</p>
              <p className="text-sm text-ink-muted">
                합계 {formatMoney(d.total, d.currency)} · 승인 후 계약서가 준비됩니다.
              </p>
            </div>
            <div className="flex w-full gap-2 sm:w-auto">
              <Button variant="secondary" className="flex-1 sm:flex-none" onClick={() => setDialog('REJECT')}>
                거절
              </Button>
              <Button
                className="flex-1 sm:flex-none"
                icon={<CheckCircle2 className="h-4 w-4" />}
                onClick={() => setDialog('APPROVE')}
              >
                승인하기
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
      {d.status === 'EXPIRED' && (
        <Alert tone="warn" className="mb-6">
          유효기한이 지난 견적입니다. 담당자에게 재견적을 요청해 주세요.
        </Alert>
      )}
      <QuoteView q={d} />
      <Dialog
        open={!!dialog}
        onClose={() => setDialog(null)}
        title={dialog === 'APPROVE' ? '견적 승인' : '견적 거절'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              취소
            </Button>
            <Button
              variant={dialog === 'REJECT' ? 'danger' : 'primary'}
              disabled={dialog === 'APPROVE' && !agree}
              loading={decide.isPending}
              onClick={() => dialog && decide.mutate(dialog)}
            >
              {dialog === 'APPROVE' ? '승인합니다' : '거절합니다'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {dialog === 'APPROVE' ? (
            <>
              <p className="text-sm text-ink-soft">
                승인 시점의 견적 내용(버전 v{d.version}, 문서 해시)과 승인 기록(일시, 접속 정보)이 함께
                저장됩니다.
              </p>
              <Checkbox
                checked={agree}
                onChange={setAgree}
                label={`견적 ${d.number} v${d.version} 내용을 확인했으며 승인합니다.`}
              />
            </>
          ) : (
            <Field label="거절 사유 (선택)">
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="가격, 납기 등 조정이 필요한 부분을 알려주시면 다시 검토해 드립니다."
              />
            </Field>
          )}
        </div>
      </Dialog>
    </>
  );
}
