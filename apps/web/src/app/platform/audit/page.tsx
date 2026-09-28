'use client';

import { useQuery } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
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

interface Log {
  id: string;
  tenantId: string | null;
  actorRole: string;
  impersonatorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  ip: string;
  createdAt: string;
}

export default function PlatformAudit() {
  const q = useQuery({
    queryKey: ['platform-audit'],
    queryFn: () => api.get<{ items: Log[] }>('/platform/audit?limit=300'),
  });
  return (
    <>
      <PageHeader
        title="플랫폼 감사 로그"
        description="모든 테넌트의 중요 변경과 플랫폼 관리자 작업(대리 접속 포함)입니다."
      />
      <Card>
        {q.isLoading ? (
          <LoadingBlock rows={8} />
        ) : q.error ? (
          <ErrorState error={q.error} />
        ) : !q.data?.items.length ? (
          <EmptyState title="기록이 없습니다" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>시각</Th>
                <Th>작업</Th>
                <Th>대상</Th>
                <Th>테넌트</Th>
                <Th>IP</Th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((l) => (
                <tr key={l.id}>
                  <Td className="whitespace-nowrap text-xs">{formatDate(l.createdAt, true)}</Td>
                  <Td className="font-mono text-xs">
                    {l.action}
                    {(l.impersonatorId || l.action.startsWith('platform.impersonation')) && (
                      <Badge tone="warn" className="ml-2" icon={<ShieldAlert className="h-3 w-3" />}>
                        대리 접속
                      </Badge>
                    )}
                  </Td>
                  <Td className="text-xs">
                    {l.entityType} <span className="text-ink-muted">{l.entityId.slice(0, 8)}</span>
                  </Td>
                  <Td className="font-mono text-xs text-ink-muted">{l.tenantId?.slice(0, 8) ?? '플랫폼'}</Td>
                  <Td className="font-mono text-xs text-ink-muted">{l.ip}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
