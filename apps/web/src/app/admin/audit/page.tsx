'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { ROLE_LABEL } from '@/components/status';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  LoadingBlock,
  PageHeader,
  Table,
  Td,
  Th,
} from '@/components/ui';

interface Log {
  id: string;
  actorId: string | null;
  actorRole: string;
  impersonatorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  ip: string;
  userAgent: string;
  requestId: string;
  createdAt: string;
}

export default function AuditPage() {
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [filter, setFilter] = useState({ action: '', entityType: '' });
  const [detail, setDetail] = useState<Log | null>(null);
  const q = useQuery({
    queryKey: ['audit', filter],
    queryFn: () =>
      api.get<{ items: Log[] }>(
        `/admin/audit?limit=300${filter.action ? `&action=${encodeURIComponent(filter.action)}` : ''}${filter.entityType ? `&entityType=${encodeURIComponent(filter.entityType)}` : ''}`,
      ),
  });
  return (
    <>
      <PageHeader
        title="감사 로그"
        description="중요한 변경 기록입니다. 기록은 수정하거나 삭제할 수 없습니다."
      />
      <form
        className="mb-4 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter({ action: action.trim(), entityType: entityType.trim() });
        }}
      >
        <Input
          className="w-56"
          placeholder="작업 (예: quote., bank.)"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          aria-label="작업"
        />
        <Input
          className="w-48"
          placeholder="대상 (예: quotation)"
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          aria-label="대상"
        />
        <Button type="submit" variant="secondary">
          검색
        </Button>
      </form>
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
                <Th>역할</Th>
                <Th>IP</Th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((l) => (
                <tr
                  key={l.id}
                  className="cursor-pointer hover:bg-surface-sunken"
                  onClick={() => setDetail(l)}
                >
                  <Td className="whitespace-nowrap text-xs">{formatDate(l.createdAt, true)}</Td>
                  <Td className="font-mono text-xs">
                    {l.action}
                    {l.impersonatorId && (
                      <Badge tone="warn" className="ml-2" icon={<ShieldAlert className="h-3 w-3" />}>
                        대리 접속
                      </Badge>
                    )}
                  </Td>
                  <Td className="text-xs">
                    {l.entityType}
                    <span className="ml-1 text-ink-muted">{l.entityId.slice(0, 8)}</span>
                  </Td>
                  <Td className="text-xs">
                    {l.actorRole
                      .split(',')
                      .map((r) => ROLE_LABEL[r] ?? r)
                      .join(', ') || '시스템'}
                  </Td>
                  <Td className="font-mono text-xs text-ink-muted">{l.ip}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Dialog
        open={!!detail}
        onClose={() => setDetail(null)}
        size="xl"
        title={detail?.action ?? ''}
        description={detail ? `${formatDate(detail.createdAt, true)} · 요청 ${detail.requestId}` : undefined}
      >
        {detail && (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-medium text-ink-muted">변경 전</p>
              <pre className="max-h-80 overflow-auto rounded-lg bg-surface-sunken p-3 text-[11px]">
                {JSON.stringify(detail.before, null, 2) ?? '—'}
              </pre>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-ink-muted">변경 후</p>
              <pre className="max-h-80 overflow-auto rounded-lg bg-surface-sunken p-3 text-[11px]">
                {JSON.stringify(detail.after, null, 2) ?? '—'}
              </pre>
            </div>
            <p className="text-xs text-ink-muted md:col-span-2">
              사용자 {detail.actorId ?? '시스템'}
              {detail.impersonatorId && ` · 대리 접속자 ${detail.impersonatorId}`} · {detail.userAgent}
            </p>
          </div>
        )}
      </Dialog>
    </>
  );
}
