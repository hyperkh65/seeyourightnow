'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Ship } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { ShipmentStatus } from '@/components/status';
import { Card, EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/ui';

export default function PortalShipments() {
  const q = useQuery({
    queryKey: ['shipments'],
    queryFn: () =>
      api.get<{
        items: Array<{
          id: string;
          code: string;
          status: string;
          originPort: string;
          destinationPort: string;
          eta: string | null;
          ata: string | null;
        }>;
      }>('/shipments'),
  });
  return (
    <>
      <PageHeader title="배송 조회" description="선적부터 통관, 국내 배송까지 확인할 수 있습니다." />
      <Card>
        {q.isLoading ? (
          <div className="p-5">
            <LoadingBlock />
          </div>
        ) : q.error ? (
          <ErrorState error={q.error} />
        ) : !q.data?.items.length ? (
          <EmptyState
            icon={<Ship className="h-5 w-5" />}
            title="아직 운송 중인 화물이 없습니다"
            description="생산과 검품이 끝나면 선적 정보가 여기에 표시됩니다."
          />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.items.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/portal/shipments/${s.id}`}
                  className="flex items-center justify-between gap-3 px-5 py-4 hover:bg-surface-sunken"
                >
                  <div>
                    <p className="font-medium">
                      {s.originPort} → {s.destinationPort}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {s.code} ·{' '}
                      {s.ata
                        ? `도착 ${formatDate(s.ata)}`
                        : s.eta
                          ? `도착 예정 ${formatDate(s.eta)} (예상)`
                          : '일정 확인 중'}
                    </p>
                  </div>
                  <ShipmentStatus status={s.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
