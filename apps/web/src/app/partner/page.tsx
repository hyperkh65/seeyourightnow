'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate, timeAgo } from '@/lib/utils';
import { Alert, Badge, Card, EmptyState, ErrorState, LoadingBlock, PageHeader, Tabs } from '@/components/ui';

interface Task {
  id: string;
  kind: string;
  title: string;
  status: string;
  dueAt: string | null;
  createdAt: string;
  submittedAt: string | null;
}
const TASK_KIND: Record<string, string> = {
  HS_REVIEW: 'HS 코드 확인',
  COMPLIANCE_REVIEW: '인증 대상 확인',
  FREIGHT_QUOTE: '운임 견적',
  SUPPLIER_RFQ: '공급 견적',
};

export default function PartnerHome() {
  const [tab, setTab] = useState<'OPEN' | 'DONE'>('OPEN');
  const q = useQuery({
    queryKey: ['partner-tasks'],
    queryFn: () => api.get<{ items: Task[] }>('/partner/tasks'),
    refetchInterval: 60_000,
  });
  const items = (q.data?.items ?? []).filter((t) =>
    tab === 'OPEN'
      ? ['OPEN', 'IN_PROGRESS'].includes(t.status)
      : ['SUBMITTED', 'CANCELLED'].includes(t.status),
  );
  const open = (q.data?.items ?? []).filter((t) => ['OPEN', 'IN_PROGRESS'].includes(t.status)).length;
  return (
    <>
      <PageHeader
        title="배정된 작업"
        description="확인이 필요한 항목만 보여 드립니다. 고객 정보와 거래 금액은 표시되지 않습니다."
      />
      <Tabs
        className="mb-6"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'OPEN', label: '처리할 작업', count: open || undefined, alert: open > 0 },
          { value: 'DONE', label: '완료' },
        ]}
      />
      <Card>
        {q.isLoading ? (
          <LoadingBlock rows={5} />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !items.length ? (
          <EmptyState
            icon={<ClipboardList className="h-6 w-6" />}
            title={tab === 'OPEN' ? '처리할 작업이 없습니다' : '완료한 작업이 없습니다'}
          />
        ) : (
          <ul className="divide-y divide-line">
            {items.map((t) => {
              const overdue = t.dueAt && !t.submittedAt && new Date(t.dueAt) < new Date();
              return (
                <li key={t.id}>
                  <Link
                    href={`/partner/tasks/${t.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-surface-sunken"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{t.title}</p>
                      <p className="text-xs text-ink-muted">
                        {TASK_KIND[t.kind] ?? t.kind} · 요청 {timeAgo(t.createdAt)}
                        {t.dueAt && ` · 기한 ${formatDate(t.dueAt)}`}
                      </p>
                    </div>
                    <span className="flex items-center gap-2">
                      {overdue && <Badge tone="danger">기한 지남</Badge>}
                      <Badge
                        tone={
                          t.status === 'OPEN'
                            ? 'warn'
                            : t.status === 'IN_PROGRESS'
                              ? 'info'
                              : t.status === 'SUBMITTED'
                                ? 'ok'
                                : 'neutral'
                        }
                      >
                        {{
                          OPEN: '새 작업',
                          IN_PROGRESS: '진행 중',
                          SUBMITTED: '회신 완료',
                          CANCELLED: '취소',
                        }[t.status] ?? t.status}
                      </Badge>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Alert className="mt-6">회신한 내용은 AI 추정값과 별도로 저장되며, 수정 이력이 모두 남습니다.</Alert>
    </>
  );
}
