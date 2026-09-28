'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import {
  ContractsMini,
  DocumentsCard,
  PaymentsCard,
  ProductionCard,
  QuotesList,
  ShipmentsMini,
  Timeline,
  type Overview,
} from '@/components/project-parts';
import { StageBadge } from '@/components/status';
import { Button, Card, CardBody, CardHeader, ErrorState, LoadingBlock, PageHeader } from '@/components/ui';

export default function PortalProject() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({
    queryKey: ['overview', id],
    queryFn: () => api.get<Overview>(`/projects/${id}/overview`),
    refetchInterval: 30_000,
  });
  if (q.isLoading)
    return (
      <Card className="p-5">
        <LoadingBlock rows={6} />
      </Card>
    );
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const ov = q.data;
  const req = ov.requests[0];
  return (
    <>
      <PageHeader
        back={
          <Link
            href="/portal"
            className="mb-2 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
          >
            <ChevronLeft className="h-4 w-4" />내 소싱
          </Link>
        }
        eyebrow={ov.code}
        title={ov.title}
        description={`요청일 ${formatDate(ov.createdAt)}`}
        actions={<StageBadge status={ov.stage} />}
      />
      <Card className="mb-6">
        <CardBody>
          <Timeline items={ov.timeline} />
          {ov.workflow.waitingFor && ov.stage !== 'COMPLETED' && (
            <p className="mt-3 text-center text-xs text-ink-muted">현재 단계: {ov.workflow.waitingFor}</p>
          )}
        </CardBody>
      </Card>
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="견적" />
            <QuotesList quotes={ov.quotations} base="/portal/quotes" />
          </Card>
          <ContractsMini ov={ov} base="/portal/contracts" />
          <ProductionCard ov={ov} />
          <ShipmentsMini ov={ov} base="/portal/shipments" />
        </div>
        <div className="space-y-6">
          {req && (
            <Card>
              <CardHeader title="검색 결과" description="AI가 찾은 공급처와 예상 가격" />
              <CardBody>
                <Link href={`/r/${req.id}`}>
                  <Button variant="secondary" className="w-full" icon={<Search className="h-4 w-4" />}>
                    분석 결과 다시 보기
                  </Button>
                </Link>
              </CardBody>
            </Card>
          )}
          <PaymentsCard ov={ov} bankNote />
          <DocumentsCard docs={ov.documents} />
        </div>
      </div>
    </>
  );
}
