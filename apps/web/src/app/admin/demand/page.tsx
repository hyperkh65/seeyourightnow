'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Lightbulb, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/utils';
import { useSite } from '@/components/providers';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  Select,
  Table,
  Tabs,
  Td,
  Th,
} from '@/components/ui';

interface Demand {
  query: string;
  category: string | null;
  searches: number;
  buyers: number;
  avgQuantity: number | null;
  avgTargetKrw: number | null;
}
interface Opportunity {
  requestId: string;
  title: string;
  marketMedianKrw: number;
  marketListings: number;
  lowestLandedEstimateKrw: number;
  priceGapPct: number;
  lowMoq: boolean;
  evidence: string;
}

function DemandView() {
  const [days, setDays] = useState('90');
  const q = useQuery({
    queryKey: ['demand', days],
    queryFn: () =>
      api.get<{
        items: Demand[];
        jointSourcingCandidates: Array<Demand & { combinedQuantity: number | null }>;
      }>(`/analytics/demand?days=${days}`),
  });
  if (q.isLoading)
    return (
      <Card className="p-5">
        <LoadingBlock rows={6} />
      </Card>
    );
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Select className="w-40" value={days} onChange={(e) => setDays(e.target.value)} aria-label="기간">
          <option value="30">최근 30일</option>
          <option value="90">최근 90일</option>
          <option value="365">최근 1년</option>
        </Select>
        <span className="text-xs text-ink-muted">개인·회사 정보를 제거한 검색 데이터만 사용합니다.</span>
      </div>
      {q.data.jointSourcingCandidates.length > 0 && (
        <Card>
          <CardHeader
            title="공동 소싱 후보"
            description="여러 고객이 같은 제품을 찾고 있습니다. 수량을 모으면 단가를 낮출 수 있습니다."
          />
          <Table>
            <thead>
              <tr>
                <Th>제품군</Th>
                <Th className="text-right">고객 수</Th>
                <Th className="text-right">합산 예상 수량</Th>
                <Th className="text-right">평균 목표가</Th>
              </tr>
            </thead>
            <tbody>
              {q.data.jointSourcingCandidates.map((d) => (
                <tr key={d.query}>
                  <Td className="font-medium">{d.query}</Td>
                  <Td className="text-right tabular">
                    <Badge tone="brand" icon={<Users className="h-3 w-3" />}>
                      {d.buyers}
                    </Badge>
                  </Td>
                  <Td className="text-right tabular">{d.combinedQuantity?.toLocaleString() ?? '—'}</Td>
                  <Td className="text-right tabular">
                    {d.avgTargetKrw ? formatMoney(d.avgTargetKrw, 'KRW') : '—'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      <Card>
        <CardHeader title="검색 수요" />
        {!q.data.items.length ? (
          <EmptyState title="검색 데이터가 없습니다" className="py-8" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>제품군</Th>
                <Th>카테고리</Th>
                <Th className="text-right">검색</Th>
                <Th className="text-right">고객</Th>
                <Th className="text-right">평균 수량</Th>
                <Th className="text-right">평균 목표가</Th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((d) => (
                <tr key={d.query}>
                  <Td>{d.query}</Td>
                  <Td className="text-xs">{d.category || '—'}</Td>
                  <Td className="text-right tabular">{d.searches}</Td>
                  <Td className="text-right tabular">{d.buyers}</Td>
                  <Td className="text-right tabular">{d.avgQuantity?.toLocaleString() ?? '—'}</Td>
                  <Td className="text-right tabular">
                    {d.avgTargetKrw ? formatMoney(d.avgTargetKrw, 'KRW') : '—'}
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

function Discovery() {
  const q = useQuery({
    queryKey: ['discovery'],
    queryFn: () => api.get<{ items: Opportunity[]; note: string }>('/analytics/discovery'),
    retry: false,
  });
  if (q.isLoading)
    return (
      <Card className="p-5">
        <LoadingBlock rows={6} />
      </Card>
    );
  if (q.error || !q.data) return <ErrorState error={q.error} />;
  return (
    <div className="space-y-4">
      <Alert>{q.data.note} 모든 기회는 실제 수집 데이터에서 계산되며, 근거가 함께 표시됩니다.</Alert>
      <Card>
        {!q.data.items.length ? (
          <EmptyState
            icon={<Lightbulb className="h-6 w-6" />}
            title="아직 계산된 기회가 없습니다"
            description="국내 시장 커넥터(네이버 쇼핑·쿠팡 등)가 연결되어 시장가격이 5건 이상 수집된 요청부터 표시됩니다."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>제품</Th>
                <Th className="text-right">국내 중간가</Th>
                <Th className="text-right">추정 도착원가</Th>
                <Th className="text-right">가격 차이</Th>
                <Th>근거</Th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((o) => (
                <tr key={o.requestId}>
                  <Td className="font-medium">
                    {o.title}
                    {o.lowMoq && (
                      <Badge tone="ok" className="ml-2">
                        소량 가능
                      </Badge>
                    )}
                  </Td>
                  <Td className="text-right tabular">
                    {formatMoney(o.marketMedianKrw, 'KRW')}
                    <div className="text-xs text-ink-muted">{o.marketListings}건</div>
                  </Td>
                  <Td className="text-right tabular">{formatMoney(o.lowestLandedEstimateKrw, 'KRW')}</Td>
                  <Td className="text-right tabular">
                    <Badge tone={o.priceGapPct >= 40 ? 'ok' : 'neutral'}>{o.priceGapPct}%</Badge>
                  </Td>
                  <Td className="max-w-[260px] text-xs text-ink-muted">{o.evidence}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

export default function DemandPage() {
  const site = useSite();
  const discovery = site?.features.includes('PRODUCT_DISCOVERY') ?? false;
  const [tab, setTab] = useState<'demand' | 'discovery'>('demand');
  return (
    <>
      <PageHeader
        title="수요·소싱 기회"
        description="고객 검색 수요와, 수집된 가격 데이터로 계산한 소싱 기회를 보여 드립니다."
      />
      <Tabs
        className="mb-6"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'demand', label: '검색 수요' },
          ...(discovery ? [{ value: 'discovery' as const, label: '오늘의 소싱 기회' }] : []),
        ]}
      />
      {tab === 'demand' ? <DemandView /> : <Discovery />}
    </>
  );
}
