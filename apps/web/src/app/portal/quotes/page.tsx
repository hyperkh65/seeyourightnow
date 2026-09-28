'use client';

import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { QuotesList } from '@/components/project-parts';
import { Card, EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/ui';

export default function PortalQuotes() {
  const q = useQuery({ queryKey: ['quotes'], queryFn: () => api.get<{ items: Array<{ id: string; number: string; status: string; version: number; total?: string; currency?: string; validUntil?: string | null }> }>('/quotations') });
  return (
    <>
      <PageHeader title="견적" description="받은 견적서를 확인하고 승인할 수 있습니다." />
      <Card>
        {q.isLoading ? <div className="p-5"><LoadingBlock /></div> : q.error ? <ErrorState error={q.error} /> : !q.data?.items.length ? <EmptyState icon={<FileText className="h-5 w-5" />} title="아직 받은 견적이 없습니다" description="제품을 검색하면 담당자가 견적을 준비해 드립니다." /> : <QuotesList quotes={q.data.items} base="/portal/quotes" />}
      </Card>
    </>
  );
}
