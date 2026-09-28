'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertOctagon, AlertTriangle, CheckCircle2, ChevronRight, Info, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { cn, timeAgo } from '@/lib/utils';
import { useMe } from '@/components/providers';
import { STAGE_LABEL } from '@/components/status';
import { Button, Card, CardHeader, EmptyState, ErrorState, LoadingBlock, PageHeader, Stat } from '@/components/ui';

interface Dashboard {
  today: { newRequests: number; arrivals: number };
  counters: Record<string, number>;
  attention: Array<{ severity: 'CRITICAL' | 'WARNING' | 'INFO'; kind: string; title: string; detail: string; link: string; at?: string | null }>;
  pipeline: Array<{ stage: string; n: number }>;
}

const COUNTERS: Array<{ key: string; label: string; href: string }> = [
  { key: 'approvalWaiting', label: '승인 대기', href: '/admin/quotes?status=CUSTOMER_APPROVED' },
  { key: 'customsReview', label: '관세사 확인 대기', href: '/admin/compliance?tab=reviews' },
  { key: 'certificationReview', label: '인증 확인 필요', href: '/admin/compliance?tab=reviews' },
  { key: 'forwarderPending', label: '포워더 견적 대기', href: '/admin/freight?tab=rfq' },
  { key: 'productionDelay', label: '생산 지연', href: '/admin/projects?stage=PRODUCTION' },
  { key: 'shipmentDelay', label: '운송 지연', href: '/admin/shipments' },
  { key: 'paymentOverdue', label: '입금 연체', href: '/admin/projects' },
  { key: 'supplierPending', label: '공급처 회신 대기', href: '/admin/suppliers' },
];

export default function AdminDashboard() {
  const me = useMe();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dashboard>('/admin/dashboard'), refetchInterval: 60_000 });
  const d = q.data;
  return (
    <>
      <PageHeader
        title={`안녕하세요, ${me.data?.user?.name ?? ''}님`}
        description="처리가 필요한 일부터 보여드립니다."
        actions={<Link href="/search"><Button icon={<Plus className="h-4 w-4" />}>고객 대신 소싱 요청</Button></Link>}
      />
      {q.isLoading ? (
        <Card className="p-5"><LoadingBlock rows={6} /></Card>
      ) : q.error || !d ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-5">
            <Stat label="오늘 새 요청" value={d.today.newRequests} href="/admin/projects" />
            <Stat label="오늘 도착 예정" value={d.today.arrivals} href="/admin/shipments" />
            {COUNTERS.filter((c) => d.counters[c.key]).map((c) => (
              <Stat key={c.key} label={c.label} value={d.counters[c.key]} tone={['paymentOverdue', 'shipmentDelay', 'productionDelay'].includes(c.key) ? 'alert' : 'default'} href={c.href} />
            ))}
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
            <Card>
              <CardHeader title="확인이 필요한 일" description={d.attention.length ? `${d.attention.length}건 · 중요한 순서` : undefined} />
              {d.attention.length === 0 ? (
                <EmptyState icon={<CheckCircle2 className="h-5 w-5" />} title="지금은 확인할 문제가 없습니다" description="새로운 예외 상황이 생기면 여기에 먼저 표시됩니다." />
              ) : (
                <ul className="divide-y divide-line">
                  {d.attention.map((a, i) => (
                    <li key={i}>
                      <Link href={a.link} className="flex items-start gap-3 px-5 py-3.5 hover:bg-surface-sunken">
                        {a.severity === 'CRITICAL' ? <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-red-600" /> : a.severity === 'WARNING' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />}
                        <div className="min-w-0 flex-1">
                          <p className={cn('text-sm font-medium', a.severity === 'CRITICAL' && 'text-red-700 dark:text-red-300')}>{a.title}</p>
                          {a.detail && <p className="mt-0.5 truncate text-xs text-ink-muted">{a.detail}</p>}
                        </div>
                        {a.at && <span className="shrink-0 text-[11px] text-ink-muted">{timeAgo(a.at)}</span>}
                        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardHeader title="진행 중인 프로젝트" description="단계별 현황" />
              <div className="space-y-2 p-5">
                {d.pipeline.length === 0 ? (
                  <p className="text-sm text-ink-muted">진행 중인 프로젝트가 없습니다.</p>
                ) : (
                  d.pipeline
                    .sort((a, b) => Object.keys(STAGE_LABEL).indexOf(a.stage) - Object.keys(STAGE_LABEL).indexOf(b.stage))
                    .map((p) => {
                      const max = Math.max(...d.pipeline.map((x) => x.n));
                      return (
                        <Link key={p.stage} href={`/admin/projects?stage=${p.stage}`} className="group flex items-center gap-3 text-sm">
                          <span className="w-16 shrink-0 text-ink-soft group-hover:text-ink">{STAGE_LABEL[p.stage] ?? p.stage}</span>
                          <span className="h-2 flex-1 overflow-hidden rounded-full bg-line/60"><span className="block h-full rounded-full bg-brand" style={{ width: `${(p.n / max) * 100}%` }} /></span>
                          <span className="w-6 text-right font-semibold tabular">{p.n}</span>
                        </Link>
                      );
                    })
                )}
              </div>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
