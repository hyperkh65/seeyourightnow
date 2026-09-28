'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Bell, PackageSearch, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { formatMoney, timeAgo } from '@/lib/utils';
import { useMe } from '@/components/providers';
import { StageBadge } from '@/components/status';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  Progress,
} from '@/components/ui';

interface ProjectRow {
  id: string;
  code: string;
  title: string;
  stage: string;
  updatedAt: string;
  thumbnail: string | null;
  requestId: string | null;
  requestStatus: string | null;
}
const ORDER = [
  'REQUESTED',
  'SEARCHING',
  'QUOTE_PREPARING',
  'QUOTE_APPROVED',
  'CONTRACT',
  'PRODUCTION',
  'INSPECTION',
  'READY_TO_SHIP',
  'SHIPPED',
  'ARRIVED',
  'CUSTOMS',
  'DELIVERING',
  'COMPLETED',
];

export default function MySourcing() {
  const me = useMe();
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ items: ProjectRow[] }>('/projects'),
  });
  const quotes = useQuery({
    queryKey: ['quotes'],
    queryFn: () =>
      api.get<{
        items: Array<{
          id: string;
          number: string;
          status: string;
          total?: string;
          currency?: string;
          projectTitle?: string;
        }>;
      }>('/quotations'),
  });
  const waiting = quotes.data?.items.filter((q) => q.status === 'SENT') ?? [];

  return (
    <>
      <PageHeader
        title={`${me.data?.user?.name ? `${me.data.user.name}님의 ` : ''}소싱`}
        description="요청한 제품의 진행 상황을 한눈에 확인하세요."
        actions={
          <Link href="/search">
            <Button icon={<Search className="h-4 w-4" />}>새 제품 찾기</Button>
          </Link>
        }
      />
      {waiting.length > 0 && (
        <div className="mb-6 space-y-2">
          {waiting.map((q) => (
            <Alert
              key={q.id}
              tone="info"
              title={`견적 ${q.number} 확인이 필요해요`}
              action={
                <Link href={`/portal/quotes/${q.id}`}>
                  <Button size="sm">확인하기</Button>
                </Link>
              }
            >
              <span className="flex items-center gap-1.5">
                <Bell className="h-3.5 w-3.5" />
                {q.projectTitle} · {formatMoney(q.total, q.currency)}
              </span>
            </Alert>
          ))}
        </div>
      )}
      {projects.isLoading ? (
        <Card className="p-5">
          <LoadingBlock rows={4} />
        </Card>
      ) : projects.error ? (
        <ErrorState error={projects.error} onRetry={() => projects.refetch()} />
      ) : !projects.data?.items.length ? (
        <Card>
          <EmptyState
            icon={<PackageSearch className="h-5 w-5" />}
            title="아직 진행 중인 소싱이 없습니다"
            description="찾고 싶은 제품의 사진을 올려 첫 소싱을 시작해 보세요."
            action={
              <Link href="/search">
                <Button>제품 찾기</Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.data.items.map((p) => {
            const idx = Math.max(0, ORDER.indexOf(p.stage));
            return (
              <Link key={p.id} href={`/portal/projects/${p.id}`} className="group">
                <Card className="h-full p-4 transition group-hover:border-brand/40 group-hover:shadow-md">
                  <div className="flex gap-3">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-line bg-surface-sunken">
                      {p.thumbnail ? (
                        <img src={p.thumbnail} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-ink-muted">
                          <PackageSearch className="h-6 w-6" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] text-ink-muted">{p.code}</p>
                      <p className="truncate font-semibold">{p.title}</p>
                      <div className="mt-1">
                        <StageBadge status={p.stage} />
                      </div>
                    </div>
                  </div>
                  <Progress
                    className="mt-4"
                    value={(idx / (ORDER.length - 1)) * 100}
                    tone={p.stage === 'COMPLETED' ? 'ok' : 'brand'}
                  />
                  <div className="mt-2 flex items-center justify-between text-xs text-ink-muted">
                    <span>{timeAgo(p.updatedAt)} 업데이트</span>
                    <ArrowRight className="h-4 w-4 opacity-0 transition group-hover:opacity-100" />
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
