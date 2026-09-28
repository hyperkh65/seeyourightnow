'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, RotateCcw } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate, timeAgo } from '@/lib/utils';
import { useCan, useToast } from '@/components/providers';
import { ConnectionStatus, JobStatus } from '@/components/status';
import {
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
  Table,
  Tabs,
  Td,
  Th,
} from '@/components/ui';

type Status = 'OK' | 'DEGRADED' | 'DOWN' | 'DISABLED' | 'NOT_CONFIGURED';
interface SystemStatus {
  health: {
    status: Status;
    time: string;
    components: Record<
      string,
      {
        status: Status;
        latencyMs?: number;
        error?: string | null;
        note?: string | null;
        driver?: string;
        renderer?: string;
        pending?: number | null;
        deadLetter?: number | null;
        lagSeconds?: number;
      }
    >;
  };
  connections: Array<{
    id: string;
    provider: string;
    label: string;
    category: string;
    enabled: boolean;
    status: string;
    lastTestAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
    circuitOpenUntil: string | null;
  }>;
  ai: Array<{
    provider: string;
    task: string;
    calls: number;
    failures: number;
    inputTokens: number | null;
    outputTokens: number | null;
    avgLatencyMs: number | null;
  }>;
  email: Array<{ status: string; n: number }>;
  usage: Array<{ metric: string; count: number; period: string }>;
}
interface Job {
  id: string;
  type: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  runAt: string;
  updatedAt: string;
  finishedAt: string | null;
}
interface Email {
  id: string;
  trigger: string;
  toAddress: string;
  subject: string;
  status: string;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
}

const COMP: Record<string, string> = {
  database: '데이터베이스',
  cache: '캐시',
  storage: '파일 저장소',
  aiWorker: 'AI 워커 (OCR·임베딩)',
  pdfRenderer: 'PDF 생성',
  queue: '작업 큐',
  malwareScan: '악성코드 검사',
  email: '기본 SMTP',
};
const TONE: Record<Status, 'ok' | 'warn' | 'danger' | 'neutral'> = {
  OK: 'ok',
  DEGRADED: 'warn',
  DOWN: 'danger',
  DISABLED: 'neutral',
  NOT_CONFIGURED: 'neutral',
};
const SL: Record<Status, string> = {
  OK: '정상',
  DEGRADED: '저하',
  DOWN: '중단',
  DISABLED: '사용 안 함',
  NOT_CONFIGURED: '미설정',
};

function Overview() {
  const q = useQuery({
    queryKey: ['system-status'],
    queryFn: () => api.get<SystemStatus>('/admin/system-status'),
    refetchInterval: 30_000,
  });
  if (q.isLoading)
    return (
      <Card className="p-5">
        <LoadingBlock rows={6} />
      </Card>
    );
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="구성 요소"
          action={<Badge tone={TONE[s.health.status]}>전체 {SL[s.health.status]}</Badge>}
        />
        <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(s.health.components).map(([k, c]) => (
            <div key={k} className="rounded-xl border border-line p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{COMP[k] ?? k}</p>
                <Badge tone={TONE[c.status]}>{SL[c.status]}</Badge>
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                {c.latencyMs !== undefined && `${c.latencyMs}ms `}
                {c.driver ?? c.renderer ?? ''}
                {k === 'queue' &&
                  ` 대기 ${c.pending ?? 0} · 실패 ${c.deadLetter ?? 0} · 지연 ${c.lagSeconds ?? 0}초`}
                {c.note ? ` · ${c.note}` : ''}
              </p>
            </div>
          ))}
        </CardBody>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="외부 연결" />
          {!s.connections.length ? (
            <EmptyState title="연결된 서비스가 없습니다" className="py-8" />
          ) : (
            <ul className="divide-y divide-line">
              {s.connections.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  <span className="min-w-0 truncate">
                    {c.label}
                    <span className="ml-1 text-xs text-ink-muted">{c.category}</span>
                    {c.lastError && (
                      <span className="block truncate text-xs text-red-600">{c.lastError}</span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-ink-muted">
                    {c.lastSuccessAt ? timeAgo(c.lastSuccessAt) : ''}
                    {c.circuitOpenUntil && new Date(c.circuitOpenUntil) > new Date() && (
                      <Badge tone="danger">일시 차단</Badge>
                    )}
                    <ConnectionStatus status={c.enabled ? c.status : 'DISABLED'} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="AI 사용량 (최근 30일)" />
          {!s.ai.length ? (
            <EmptyState title="AI 호출 기록이 없습니다" className="py-8" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>제공자</Th>
                  <Th>작업</Th>
                  <Th className="text-right">호출</Th>
                  <Th className="text-right">실패</Th>
                  <Th className="text-right">토큰</Th>
                  <Th className="text-right">평균</Th>
                </tr>
              </thead>
              <tbody>
                {s.ai.map((a, i) => (
                  <tr key={i}>
                    <Td className="text-xs">{a.provider}</Td>
                    <Td className="text-xs">{a.task}</Td>
                    <Td className="text-right tabular">{a.calls}</Td>
                    <Td className="text-right tabular">{a.failures}</Td>
                    <Td className="text-right tabular">
                      {((a.inputTokens ?? 0) + (a.outputTokens ?? 0)).toLocaleString()}
                    </Td>
                    <Td className="text-right text-xs tabular">{a.avgLatencyMs ?? '—'}ms</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="이메일 (최근 30일)" />
          <CardBody className="flex flex-wrap gap-2">
            {s.email.length ? (
              s.email.map((e) => (
                <Badge
                  key={e.status}
                  tone={e.status === 'SENT' ? 'ok' : e.status === 'FAILED' ? 'danger' : 'neutral'}
                >
                  {e.status} {e.n}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-ink-muted">발송 기록 없음</span>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="이번 달 사용량" />
          <CardBody className="flex flex-wrap gap-2">
            {s.usage.length ? (
              s.usage.map((u) => (
                <Badge key={u.metric}>
                  {u.metric} {u.count.toLocaleString()}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-ink-muted">기록 없음</span>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Jobs() {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState('DEAD_LETTER');
  const q = useQuery({
    queryKey: ['jobs', status],
    queryFn: () =>
      api.get<{ counts: Array<{ status: string; n: number }>; items: Job[] }>(
        `/admin/jobs${status ? `?status=${status}` : ''}`,
      ),
    refetchInterval: 15_000,
  });
  const retry = useMutation({
    mutationFn: (id: string) => api.post(`/admin/jobs/${id}/retry`, {}),
    onSuccess: () => {
      toast.ok('다시 실행하도록 예약했습니다.');
      void qc.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: toast.error,
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select className="w-44" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="상태">
          <option value="">전체</option>
          {['PENDING', 'RUNNING', 'RETRYING', 'SUCCESS', 'DEAD_LETTER'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </Select>
        {q.data?.counts.map((c) => (
          <Badge key={c.status}>
            {c.status} {c.n}
          </Badge>
        ))}
      </div>
      <Card>
        {q.isLoading ? (
          <LoadingBlock rows={5} />
        ) : !q.data?.items.length ? (
          <EmptyState icon={<Activity className="h-6 w-6" />} title="해당 작업이 없습니다" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>작업</Th>
                <Th>상태</Th>
                <Th>시도</Th>
                <Th>오류</Th>
                <Th>변경</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((j) => (
                <tr key={j.id}>
                  <Td className="font-mono text-xs">{j.type}</Td>
                  <Td>
                    <JobStatus status={j.status} />
                  </Td>
                  <Td className="text-xs">
                    {j.attempts}/{j.maxAttempts}
                  </Td>
                  <Td className="max-w-[320px] truncate text-xs text-red-600" title={j.lastError ?? ''}>
                    {j.lastError ?? ''}
                  </Td>
                  <Td className="text-xs text-ink-muted">{timeAgo(j.updatedAt)}</Td>
                  <Td>
                    {['DEAD_LETTER', 'RETRYING'].includes(j.status) && (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<RotateCcw className="h-3.5 w-3.5" />}
                        onClick={() => retry.mutate(j.id)}
                      >
                        재시도
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

function Emails() {
  const q = useQuery({ queryKey: ['emails'], queryFn: () => api.get<{ items: Email[] }>('/admin/emails') });
  return (
    <Card>
      {q.isLoading ? (
        <LoadingBlock rows={5} />
      ) : !q.data?.items.length ? (
        <EmptyState title="발송 기록이 없습니다" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>시각</Th>
              <Th>종류</Th>
              <Th>받는 사람</Th>
              <Th>제목</Th>
              <Th>상태</Th>
            </tr>
          </thead>
          <tbody>
            {q.data.items.map((m) => (
              <tr key={m.id}>
                <Td className="text-xs">{formatDate(m.createdAt, true)}</Td>
                <Td className="text-xs">{m.trigger}</Td>
                <Td className="text-xs">{m.toAddress}</Td>
                <Td className="max-w-[280px] truncate">{m.subject}</Td>
                <Td>
                  <Badge
                    tone={m.status === 'SENT' ? 'ok' : m.status === 'FAILED' ? 'danger' : 'neutral'}
                    title={m.error ?? undefined}
                  >
                    {m.status}
                  </Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

export default function SystemPage() {
  const can = useCan();
  const [tab, setTab] = useState<'status' | 'jobs' | 'emails'>('status');
  return (
    <>
      <PageHeader
        title="시스템 상태"
        description="구성 요소, 외부 연결, 백그라운드 작업과 메일 발송 상태입니다."
      />
      <Tabs
        className="mb-6"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'status', label: '상태' },
          ...(can('tenant.jobs.manage') ? [{ value: 'jobs' as const, label: '작업 큐' }] : []),
          ...(can('email.manage') ? [{ value: 'emails' as const, label: '메일 발송' }] : []),
        ]}
      />
      {tab === 'status' && <Overview />}
      {tab === 'jobs' && <Jobs />}
      {tab === 'emails' && <Emails />}
    </>
  );
}
