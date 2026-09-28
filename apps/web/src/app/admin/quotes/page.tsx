'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate, formatMoney, timeAgo } from '@/lib/utils';
import { QuoteStatus } from '@/components/status';
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  Select,
  Table,
  Td,
  Th,
} from '@/components/ui';

interface Row {
  id: string;
  number: string;
  status: string;
  version: number;
  projectId: string;
  projectCode?: string;
  projectTitle?: string;
  total?: string;
  currency?: string;
  validUntil?: string | null;
  updatedAt: string;
  internalSummary?: {
    expectedProfit?: string | null;
    marginPct?: string | null;
    costComplete?: boolean;
  } | null;
}

export default function AdminQuotes() {
  const [status, setStatus] = useState('');
  const q = useQuery({
    queryKey: ['quotes', status],
    queryFn: () => api.get<{ items: Row[] }>(`/quotations${status ? `?status=${status}` : ''}`),
  });
  return (
    <>
      <PageHeader
        title="견적"
        description="견적 초안부터 고객 승인, 최종 확정까지 관리합니다."
        actions={
          <Select
            className="w-44"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="상태 필터"
          >
            <option value="">전체 상태</option>
            {[
              ['DRAFT', '초안'],
              ['ADMIN_REVIEW', '내부 검토'],
              ['SENT', '발송됨'],
              ['CUSTOMER_APPROVED', '고객 승인 (최종 승인 필요)'],
              ['LOCKED', '확정'],
              ['REJECTED', '반려'],
              ['EXPIRED', '기한 만료'],
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        }
      />
      <Card>
        {q.isLoading ? (
          <LoadingBlock rows={6} />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data?.items.length ? (
          <EmptyState
            icon={<FileText className="h-6 w-6" />}
            title="견적이 없습니다"
            description="프로젝트의 견적 탭에서 선택한 후보로 견적을 만들 수 있습니다."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>번호</Th>
                <Th>프로젝트</Th>
                <Th>상태</Th>
                <Th className="text-right">합계</Th>
                <Th className="text-right">예상 마진</Th>
                <Th>유효기한</Th>
                <Th>변경</Th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((r) => (
                <tr key={r.id} className="hover:bg-surface-sunken">
                  <Td>
                    <Link href={`/admin/quotes/${r.id}`} className="font-medium text-brand hover:underline">
                      {r.number}
                    </Link>{' '}
                    <span className="text-xs text-ink-muted">v{r.version}</span>
                  </Td>
                  <Td className="max-w-[260px] truncate text-sm">
                    <Link href={`/admin/projects/${r.projectId}`} className="hover:underline">
                      {r.projectTitle}
                    </Link>
                    <div className="text-xs text-ink-muted">{r.projectCode}</div>
                  </Td>
                  <Td>
                    <QuoteStatus status={r.status} />
                  </Td>
                  <Td className="text-right tabular">
                    {r.total ? formatMoney(r.total, r.currency ?? 'KRW') : '—'}
                  </Td>
                  <Td className="text-right text-xs tabular">
                    {r.internalSummary?.marginPct
                      ? `${r.internalSummary.marginPct}%${r.internalSummary.costComplete === false ? ' (원가 일부 추정)' : ''}`
                      : '—'}
                  </Td>
                  <Td className="text-xs">{formatDate(r.validUntil)}</Td>
                  <Td className="text-xs text-ink-muted">{timeAgo(r.updatedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
