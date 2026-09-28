'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/utils';
import { useCan, useToast } from '@/components/providers';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  Select,
  Stat,
  Table,
  Tabs,
  Td,
  Th,
} from '@/components/ui';

interface Summary {
  sourcingRequests: number;
  quotesIssued: number;
  quotesWon: number;
  conversionPct: number | null;
  revenue: number;
  averageOrderValue: number | null;
  grossProfit: number;
  marginPct: number | null;
  averageLeadTimeDays: number | null;
  customerRetentionPct: number | null;
  categories: Array<{ category: string; requests: number }>;
  supplierPerformance: Array<{
    id: string;
    name: string;
    alias: string;
    metrics: { orderCount?: number; qualityScore?: number; claimCount?: number; lateDeliveryCount?: number };
  }>;
}
interface Accuracy {
  hs: { samples: number; top1Pct: number | null; top3Pct: number | null };
  freight: { samples: number; mapePct: number | null };
  landedCost: { samples: number; mapePct: number | null };
  compliance: { samples: number; correctionRatePct: number | null };
  image: { samples: number; top1Pct: number | null; top5Pct: number | null };
  recommendationConversionPct: number | null;
  note: string;
}
interface Pred {
  id: string;
  kind: string;
  entityType: string;
  predicted: unknown;
  model: string;
  confidence: number | null;
  humanValue: unknown;
  actualValue: unknown;
  approvedForTraining: boolean;
  createdAt: string;
}

const p = (v: number | null | undefined, suffix = '%') =>
  v === null || v === undefined ? '—' : `${v}${suffix}`;
const short = (v: unknown) => (v === null || v === undefined ? '—' : JSON.stringify(v).slice(0, 80));

function Overview() {
  const [days, setDays] = useState('90');
  const from = new Date(Date.now() - Number(days) * 86_400_000).toISOString().slice(0, 10);
  const q = useQuery({
    queryKey: ['analytics', days],
    queryFn: () => api.get<Summary>(`/analytics/summary?from=${from}`),
  });
  if (q.isLoading)
    return (
      <Card className="p-5">
        <LoadingBlock rows={6} />
      </Card>
    );
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  const maxCat = Math.max(1, ...s.categories.map((c) => c.requests));
  return (
    <div className="space-y-6">
      <Select className="w-40" value={days} onChange={(e) => setDays(e.target.value)} aria-label="기간">
        <option value="30">최근 30일</option>
        <option value="90">최근 90일</option>
        <option value="365">최근 1년</option>
      </Select>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="소싱 요청" value={s.sourcingRequests.toLocaleString()} />
        <Stat
          label="견적 발행 / 수주"
          value={`${s.quotesIssued} / ${s.quotesWon}`}
          hint={`전환율 ${p(s.conversionPct)}`}
        />
        <Stat
          label="수주 금액"
          value={formatMoney(s.revenue, 'KRW')}
          hint={`건당 평균 ${formatMoney(s.averageOrderValue, 'KRW')}`}
        />
        <Stat label="예상 이익" value={formatMoney(s.grossProfit, 'KRW')} hint={`마진율 ${p(s.marginPct)}`} />
        <Stat label="평균 완료 기간" value={p(s.averageLeadTimeDays, '일')} />
        <Stat label="재주문 고객 비율" value={p(s.customerRetentionPct)} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="많이 요청된 카테고리" />
          <CardBody className="space-y-2">
            {s.categories.length === 0 ? (
              <p className="text-sm text-ink-muted">데이터가 없습니다.</p>
            ) : (
              s.categories.map((c) => (
                <div key={c.category || '미분류'} className="text-sm">
                  <div className="flex justify-between">
                    <span>{c.category || '미분류'}</span>
                    <span className="tabular text-ink-muted">{c.requests}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-surface-sunken">
                    <div
                      className="h-full rounded-full bg-brand"
                      style={{ width: `${(c.requests / maxCat) * 100}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="공급자 성과" />
          {s.supplierPerformance.length === 0 ? (
            <EmptyState title="거래 이력이 있는 공급자가 없습니다" className="py-8" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>공급자</Th>
                  <Th className="text-right">주문</Th>
                  <Th className="text-right">품질</Th>
                  <Th className="text-right">클레임</Th>
                  <Th className="text-right">지연</Th>
                </tr>
              </thead>
              <tbody>
                {s.supplierPerformance.map((x) => (
                  <tr key={x.id}>
                    <Td className="text-sm">{x.name}</Td>
                    <Td className="text-right tabular">{x.metrics.orderCount ?? 0}</Td>
                    <Td className="text-right tabular">
                      {x.metrics.qualityScore !== undefined ? Math.round(x.metrics.qualityScore * 100) : '—'}
                    </Td>
                    <Td className="text-right tabular">{x.metrics.claimCount ?? 0}</Td>
                    <Td className="text-right tabular">{x.metrics.lateDeliveryCount ?? 0}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}

function AccuracyView() {
  const q = useQuery({ queryKey: ['accuracy'], queryFn: () => api.get<Accuracy>('/analytics/accuracy') });
  if (q.isLoading)
    return (
      <Card className="p-5">
        <LoadingBlock rows={6} />
      </Card>
    );
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const a = q.data;
  return (
    <div className="space-y-6">
      <Alert>{a.note} AI 예측값·전문가 수정값·실제값은 모두 따로 보관되며 서로 덮어쓰지 않습니다.</Alert>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Stat
          label="HS 분류 Top-1 / Top-3"
          value={`${p(a.hs.top1Pct)} / ${p(a.hs.top3Pct)}`}
          hint={`표본 ${a.hs.samples}건`}
        />
        <Stat
          label="운임 추정 오차 (MAPE)"
          value={p(a.freight.mapePct)}
          hint={`표본 ${a.freight.samples}건`}
        />
        <Stat
          label="도착원가 오차 (MAPE)"
          value={p(a.landedCost.mapePct)}
          hint={`표본 ${a.landedCost.samples}건`}
        />
        <Stat
          label="인증 판단 수정률"
          value={p(a.compliance.correctionRatePct)}
          hint={`전문가 확인 ${a.compliance.samples}건`}
        />
        <Stat
          label="이미지 검색 Top-1 / Top-5"
          value={`${p(a.image.top1Pct)} / ${p(a.image.top5Pct)}`}
          hint={`선택 ${a.image.samples}건`}
        />
        <Stat
          label="추천 채택률"
          value={p(a.recommendationConversionPct)}
          hint="‘가장 적합’ 후보가 견적에 선택된 비율"
        />
      </div>
    </div>
  );
}

function Feedback() {
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const [kind, setKind] = useState('');
  const q = useQuery({
    queryKey: ['feedback', kind],
    queryFn: () =>
      api.get<{ items: Pred[] }>(`/analytics/feedback?corrected=true${kind ? `&kind=${kind}` : ''}`),
  });
  const approve = useMutation({
    mutationFn: ({ id, approved }: { id: string; approved: boolean }) =>
      api.post(`/analytics/feedback/${id}/approve`, { approved }),
    onSuccess: () => {
      toast.ok('저장했습니다.');
      void qc.invalidateQueries({ queryKey: ['feedback'] });
    },
    onError: toast.error,
  });
  return (
    <div className="space-y-4">
      <Alert>
        사람이 수정했거나 실제 값이 확인된 예측입니다. 승인한 항목만 향후 모델 개선 데이터로 사용할 수
        있습니다.
      </Alert>
      <Select className="w-44" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="종류">
        <option value="">전체</option>
        {['HS', 'COMPLIANCE', 'FREIGHT', 'LANDED_COST', 'ATTRIBUTES'].map((k) => (
          <option key={k}>{k}</option>
        ))}
      </Select>
      <Card>
        {q.isLoading ? (
          <LoadingBlock rows={5} />
        ) : q.error ? (
          <ErrorState error={q.error} />
        ) : !q.data?.items.length ? (
          <EmptyState title="수정된 예측이 없습니다" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>종류</Th>
                <Th>AI 예측</Th>
                <Th>사람 수정</Th>
                <Th>실제</Th>
                <Th>일시</Th>
                <Th>학습 데이터</Th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((x) => (
                <tr key={x.id}>
                  <Td className="text-xs">{x.kind}</Td>
                  <Td
                    className="max-w-[200px] truncate font-mono text-[11px]"
                    title={JSON.stringify(x.predicted)}
                  >
                    {short(x.predicted)}
                  </Td>
                  <Td
                    className="max-w-[200px] truncate font-mono text-[11px]"
                    title={JSON.stringify(x.humanValue)}
                  >
                    {short(x.humanValue)}
                  </Td>
                  <Td className="max-w-[160px] truncate font-mono text-[11px]">{short(x.actualValue)}</Td>
                  <Td className="text-xs">{formatDate(x.createdAt)}</Td>
                  <Td>
                    {x.approvedForTraining ? <Badge tone="ok">승인</Badge> : null}
                    {can('tenant.settings.write') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => approve.mutate({ id: x.id, approved: !x.approvedForTraining })}
                      >
                        {x.approvedForTraining ? '승인 취소' : '승인'}
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

export default function AnalyticsPage() {
  const [tab, setTab] = useState<'overview' | 'accuracy' | 'feedback'>('overview');
  return (
    <>
      <PageHeader title="분석" description="영업 성과와 AI 추정의 정확도를 확인합니다." />
      <Tabs
        className="mb-6"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'overview', label: '성과' },
          { value: 'accuracy', label: '정확도' },
          { value: 'feedback', label: '학습 피드백' },
        ]}
      />
      {tab === 'overview' && <Overview />}
      {tab === 'accuracy' && <AccuracyView />}
      {tab === 'feedback' && <Feedback />}
    </>
  );
}
