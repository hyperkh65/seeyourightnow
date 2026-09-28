'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ShipmentView, type ShipmentDetail } from '@/components/shipment-view';
import { Card, ErrorState, LoadingBlock, PageHeader } from '@/components/ui';

export default function PortalShipment() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({
    queryKey: ['shipment', id],
    queryFn: () => api.get<ShipmentDetail>(`/shipments/${id}`),
    refetchInterval: 120_000,
  });
  if (q.isLoading)
    return (
      <Card className="p-5">
        <LoadingBlock rows={6} />
      </Card>
    );
  if (q.error || !q.data) return <ErrorState error={q.error} />;
  return (
    <>
      <PageHeader title="배송 조회" />
      <ShipmentView s={q.data} />
    </>
  );
}
