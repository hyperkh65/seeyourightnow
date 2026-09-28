'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Ship } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate, timeAgo } from '@/lib/utils';
import { ShipmentStatus } from '@/components/status';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  Table,
  Td,
  Th,
} from '@/components/ui';

interface Row {
  id: string;
  code: string;
  projectId: string;
  mode: string;
  status: string;
  originPort: string;
  destinationPort: string;
  etd: string | null;
  eta: string | null;
  atd: string | null;
  ata: string | null;
  carrierName: string;
  customsStatus: string;
  trackingError?: string | null;
  lastTrackedAt?: string | null;
  blNumber?: string;
}

const CUSTOMS: Record<string, string> = {
  NOT_STARTED: '대기',
  IN_PROGRESS: '진행 중',
  HOLD: '보류',
  CLEARED: '수리',
};

export default function AdminShipments() {
  const q = useQuery({
    queryKey: ['shipments'],
    queryFn: () => api.get<{ items: Row[] }>('/shipments'),
    refetchInterval: 60_000,
  });
  const items = q.data?.items ?? [];
  const problems = items.filter((s) => s.trackingError || s.customsStatus === 'HOLD');
  return (
    <>
      <PageHeader
        title="운송"
        description="선적·입항·통관·배송 현황입니다. 문제가 있는 건을 먼저 보여 드립니다."
      />
      {problems.length > 0 && (
        <Card className="mb-6 border-amber-300/60">
          <ul className="divide-y divide-line">
            {problems.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/admin/shipments/${s.id}`}
                  className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-surface-sunken"
                >
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  <b>{s.code}</b>
                  <span className="text-ink-muted">
                    {s.customsStatus === 'HOLD' ? '통관 보류' : `추적 오류: ${s.trackingError}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card>
        {q.isLoading ? (
          <LoadingBlock rows={6} />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !items.length ? (
          <EmptyState
            icon={<Ship className="h-6 w-6" />}
            title="등록된 선적이 없습니다"
            description="프로젝트의 선적 탭에서 등록할 수 있습니다."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>선적</Th>
                <Th>구간</Th>
                <Th>방식</Th>
                <Th>ETD / ATD</Th>
                <Th>ETA / ATA</Th>
                <Th>통관</Th>
                <Th>상태</Th>
                <Th>추적</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="hover:bg-surface-sunken">
                  <Td>
                    <Link
                      href={`/admin/shipments/${s.id}`}
                      className="font-medium text-brand hover:underline"
                    >
                      {s.code}
                    </Link>
                    <div className="text-xs text-ink-muted">
                      {s.carrierName || '—'}
                      {s.blNumber ? ` · B/L ${s.blNumber}` : ''}
                    </div>
                  </Td>
                  <Td className="text-sm">
                    {s.originPort} → {s.destinationPort}
                  </Td>
                  <Td className="text-xs">{s.mode}</Td>
                  <Td className="text-xs">{s.atd ? <b>{formatDate(s.atd)}</b> : formatDate(s.etd)}</Td>
                  <Td className="text-xs">
                    {s.ata ? <b>{formatDate(s.ata)}</b> : s.eta ? `${formatDate(s.eta)} (예정)` : '—'}
                  </Td>
                  <Td>
                    <Badge
                      tone={
                        s.customsStatus === 'CLEARED'
                          ? 'ok'
                          : s.customsStatus === 'HOLD'
                            ? 'danger'
                            : 'neutral'
                      }
                    >
                      {CUSTOMS[s.customsStatus] ?? s.customsStatus}
                    </Badge>
                  </Td>
                  <Td>
                    <ShipmentStatus status={s.status} />
                  </Td>
                  <Td className="text-xs text-ink-muted">
                    {s.trackingError ? (
                      <span className="text-red-600">오류</span>
                    ) : s.lastTrackedAt ? (
                      timeAgo(s.lastTrackedAt)
                    ) : (
                      '수동'
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
