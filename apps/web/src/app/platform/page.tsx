'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/utils';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  LoadingBlock,
  PageHeader,
  Stat,
} from '@/components/ui';

interface Dash {
  tenants: { total: number; active: number; suspended: number };
  activeUsers30d: number;
  monthlyRecurringRevenue: string;
  revenueByPlan: Array<{ plan: string; price: string | null; n: number }>;
  ai30d: { calls: number; failures: number; tokens: number } | null;
  apiErrors: number;
  storageBytes: number;
  jobs: Array<{ status: string; n: number }>;
  email30d: Array<{ status: string; n: number }>;
  searches30d: number;
  topTenantsBySearch: Array<{ tenantId: string; n: number }>;
  incidents: Array<{ component: string; status: string }>;
}

const mb = (b: number) =>
  b > 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${(b / 1024 ** 2).toFixed(1)} MB`;

export default function PlatformDashboard() {
  const q = useQuery({
    queryKey: ['platform-dash'],
    queryFn: () => api.get<Dash>('/platform/dashboard'),
    refetchInterval: 60_000,
  });
  if (q.isLoading)
    return (
      <Card className="p-5">
        <LoadingBlock rows={8} />
      </Card>
    );
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const dead = d.jobs.find((j) => j.status === 'DEAD_LETTER')?.n ?? 0;
  return (
    <>
      <PageHeader title="플랫폼 대시보드" description="전체 테넌트와 시스템 상태를 한눈에 봅니다." />
      {d.incidents.length > 0 && (
        <Alert tone="danger" className="mb-6" title="확인이 필요한 구성 요소">
          {d.incidents.map((i) => `${i.component} (${i.status})`).join(', ')}
        </Alert>
      )}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="테넌트"
          value={d.tenants.total}
          hint={`사용 중 ${d.tenants.active} · 중지 ${d.tenants.suspended}`}
        />
        <Stat label="활성 사용자 (30일)" value={d.activeUsers30d.toLocaleString()} />
        <Stat label="월 반복 매출 (MRR)" value={formatMoney(d.monthlyRecurringRevenue, 'KRW')} />
        <Stat label="검색 (30일)" value={d.searches30d.toLocaleString()} />
        <Stat
          label="AI 호출 (30일)"
          value={(d.ai30d?.calls ?? 0).toLocaleString()}
          hint={`실패 ${d.ai30d?.failures ?? 0} · 토큰 ${(d.ai30d?.tokens ?? 0).toLocaleString()}`}
        />
        <Stat label="오류 상태 API 연결" value={d.apiErrors} tone={d.apiErrors ? 'alert' : 'default'} />
        <Stat
          label="실패 작업"
          value={dead}
          tone={dead ? 'alert' : 'default'}
          icon={dead ? <AlertTriangle className="h-4 w-4" /> : undefined}
        />
        <Stat label="파일 저장 용량" value={mb(d.storageBytes)} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="요금제별 구독" />
          <CardBody className="space-y-2 text-sm">
            {d.revenueByPlan.length ? (
              d.revenueByPlan.map((r) => (
                <div key={r.plan} className="flex justify-between">
                  <span>
                    {r.plan} <span className="text-ink-muted">× {r.n}</span>
                  </span>
                  <span className="tabular">{r.price ? formatMoney(r.price, 'KRW') : '가격 미정'}</span>
                </div>
              ))
            ) : (
              <p className="text-ink-muted">구독이 없습니다.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="메일·작업" />
          <CardBody className="flex flex-wrap gap-2">
            {[
              ...d.email30d.map((e) => ({ k: `메일 ${e.status}`, n: e.n })),
              ...d.jobs.map((j) => ({ k: `작업 ${j.status}`, n: j.n })),
            ].map((x) => (
              <Badge key={x.k}>
                {x.k} {x.n}
              </Badge>
            ))}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
