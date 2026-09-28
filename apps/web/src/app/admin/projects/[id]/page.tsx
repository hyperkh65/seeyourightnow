'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate, timeAgo } from '@/lib/utils';
import { DocumentsCard, Timeline, type Overview } from '@/components/project-parts';
import { StageBadge } from '@/components/status';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  KeyValue,
  LoadingBlock,
  PageHeader,
  Table,
  Tabs,
  Td,
  Th,
} from '@/components/ui';
import { SourcingTab } from './sourcing-tab';
import { ComplianceTab } from './compliance-tab';
import { FreightTab } from './freight-tab';
import { ContractsPaymentsTab, ProductionTab, QuotesTab, ShipmentsTab } from './commerce-tab';
import type { StaffResult } from './types';

type StaffOverview = Overview & {
  company: null | {
    id: string;
    name: string;
    businessNumber?: string | null;
    industry?: string | null;
    tier?: string | null;
  };
  attention: Array<{ kind: string; message: string }>;
  purchaseOrders: Array<{ id: string; number: string; total: string; currency: string; status: string }>;
  emails: Array<{
    id: string;
    trigger: string;
    toAddress: string;
    subject: string;
    status: string;
    error: string | null;
    createdAt: string;
    sentAt: string | null;
  }>;
  audit: Array<{
    id: string;
    action: string;
    entityType: string;
    actorRole: string;
    impersonatorId: string | null;
    createdAt: string;
  }>;
};

const TABS = [
  'overview',
  'sourcing',
  'compliance',
  'freight',
  'quotes',
  'contracts',
  'production',
  'shipments',
  'records',
] as const;
type TabKey = (typeof TABS)[number];

function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const tab = (TABS as readonly string[]).includes(sp.get('tab') ?? '')
    ? (sp.get('tab') as TabKey)
    : 'overview';
  const ov = useQuery({
    queryKey: ['overview', id],
    queryFn: () => api.get<StaffOverview>(`/projects/${id}/overview`),
    refetchInterval: 30_000,
  });
  const requestId = ov.data?.requests[0]?.id;
  const res = useQuery({
    queryKey: ['staff-result', requestId],
    queryFn: () => api.get<StaffResult>(`/sourcing/requests/${requestId}/result`),
    enabled: !!requestId,
    refetchInterval: (q) =>
      q.state.data && ['READY', 'FAILED', 'PARTIAL'].includes(q.state.data.status) ? false : 3000,
  });
  if (ov.isLoading)
    return (
      <Card className="p-5">
        <LoadingBlock rows={8} />
      </Card>
    );
  if (ov.error || !ov.data) return <ErrorState error={ov.error} onRetry={() => ov.refetch()} />;
  const p = ov.data;
  const r = res.data;
  const openReviews =
    r?.compliance.filter((c) => !c.verifiedStatus && c.status !== 'NOT_APPLICABLE').length ?? 0;
  const setTab = (t: TabKey) => router.replace(`/admin/projects/${id}?tab=${t}`, { scroll: false });
  const needsResult = (node: (x: StaffResult) => React.ReactNode) =>
    !requestId ? (
      <Alert>이 프로젝트에는 소싱 요청이 없습니다.</Alert>
    ) : res.error ? (
      <ErrorState error={res.error} onRetry={() => res.refetch()} />
    ) : !r ? (
      <Card className="p-5">
        <LoadingBlock rows={6} />
      </Card>
    ) : (
      node(r)
    );

  return (
    <>
      <PageHeader
        back={
          <Link
            href="/admin/projects"
            className="mb-2 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
          >
            <ChevronLeft className="h-4 w-4" />
            프로젝트
          </Link>
        }
        eyebrow={p.code}
        title={p.title}
        description={`${p.company?.name ?? '고객 미지정'} · 생성 ${formatDate(p.createdAt)}`}
        actions={<StageBadge status={p.stage} />}
      />
      {p.attention.length > 0 && (
        <Alert tone="warn" className="mb-4" title="확인이 필요한 항목">
          <ul className="list-inside list-disc">
            {p.attention.map((a, i) => (
              <li key={i}>{a.message}</li>
            ))}
          </ul>
        </Alert>
      )}
      <Tabs<TabKey>
        className="mb-6"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'overview', label: '개요' },
          { value: 'sourcing', label: '공급처', count: r?.candidates.length },
          {
            value: 'compliance',
            label: '인증·통관',
            count: openReviews || undefined,
            alert: openReviews > 0,
          },
          { value: 'freight', label: '운임' },
          { value: 'quotes', label: '견적', count: p.quotations.length || undefined },
          { value: 'contracts', label: '계약·결제' },
          { value: 'production', label: '발주·생산' },
          { value: 'shipments', label: '선적', count: p.shipments.length || undefined },
          { value: 'records', label: '기록' },
        ]}
      />

      {tab === 'overview' && (
        <div className="space-y-6">
          <Card>
            <CardBody>
              <Timeline items={p.timeline} />
            </CardBody>
          </Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="진행 흐름"
                description={p.workflow.waitingFor ? `대기 중: ${p.workflow.waitingFor}` : undefined}
              />
              <ul className="divide-y divide-line">
                {p.workflow.steps.map((s) => (
                  <li key={s.key} className="flex items-center justify-between px-5 py-2.5 text-sm">
                    <span>
                      {s.label}
                      {s.human && <span className="ml-1.5 text-xs text-ink-muted">(담당자 확인)</span>}
                    </span>
                    <span className="flex items-center gap-2 text-xs text-ink-muted">
                      {s.at && timeAgo(s.at)}
                      <Badge
                        tone={
                          s.state === 'DONE'
                            ? 'ok'
                            : s.state === 'WAITING' || s.state === 'RUNNING'
                              ? 'info'
                              : s.state === 'FAILED'
                                ? 'danger'
                                : 'neutral'
                        }
                      >
                        {s.state}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
            <div className="space-y-6">
              <Card>
                <CardHeader
                  title="고객"
                  action={
                    p.company ? (
                      <Link
                        href={`/admin/customers/${p.company.id}`}
                        className="text-sm text-brand hover:underline"
                      >
                        상세
                      </Link>
                    ) : undefined
                  }
                />
                <CardBody>
                  {p.company ? (
                    <KeyValue
                      items={[
                        { label: '회사', value: p.company.name },
                        { label: '사업자번호', value: p.company.businessNumber || '—' },
                        { label: '업종', value: p.company.industry || '—' },
                        { label: '등급', value: p.company.tier || '—' },
                      ]}
                    />
                  ) : (
                    <p className="text-sm text-ink-muted">고객 회사가 연결되지 않았습니다.</p>
                  )}
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="소싱 요청" />
                <CardBody className="space-y-2 text-sm">
                  {p.requests.map((q) => (
                    <div key={q.id} className="flex justify-between gap-3">
                      <span className="truncate">
                        {q.query || '이미지 검색'}
                        {q.quantity ? ` · ${q.quantity.toLocaleString()}개` : ''}
                      </span>
                      <Badge>{q.status}</Badge>
                    </div>
                  ))}
                </CardBody>
              </Card>
            </div>
          </div>
        </div>
      )}
      {tab === 'sourcing' && needsResult((x) => <SourcingTab r={x} />)}
      {tab === 'compliance' && needsResult((x) => <ComplianceTab r={x} />)}
      {tab === 'freight' && <FreightTab projectId={p.id} />}
      {tab === 'quotes' && <QuotesTab ov={p} r={r} />}
      {tab === 'contracts' && <ContractsPaymentsTab ov={p} />}
      {tab === 'production' && <ProductionTab ov={p} r={r} />}
      {tab === 'shipments' && <ShipmentsTab ov={p} />}
      {tab === 'records' && (
        <div className="space-y-6">
          <DocumentsCard docs={p.documents} />
          <Card>
            <CardHeader title="발송 메일" />
            {p.emails.length === 0 ? (
              <CardBody>
                <p className="text-sm text-ink-muted">발송된 메일이 없습니다.</p>
              </CardBody>
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
                  {p.emails.map((m) => (
                    <tr key={m.id}>
                      <Td className="text-xs">{timeAgo(m.createdAt)}</Td>
                      <Td className="text-xs">{m.trigger}</Td>
                      <Td className="text-xs">{m.toAddress}</Td>
                      <Td>{m.subject}</Td>
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
          <Card>
            <CardHeader
              title="변경 기록"
              description="중요한 변경은 모두 기록되며 수정·삭제할 수 없습니다."
            />
            <Table>
              <thead>
                <tr>
                  <Th>시각</Th>
                  <Th>작업</Th>
                  <Th>대상</Th>
                  <Th>역할</Th>
                </tr>
              </thead>
              <tbody>
                {p.audit.map((a) => (
                  <tr key={a.id}>
                    <Td className="text-xs">{formatDate(a.createdAt, true)}</Td>
                    <Td className="font-mono text-xs">
                      {a.action}
                      {a.impersonatorId && (
                        <Badge tone="warn" className="ml-2" icon={<AlertTriangle className="h-3 w-3" />}>
                          대리 접속
                        </Badge>
                      )}
                    </Td>
                    <Td className="text-xs">{a.entityType}</Td>
                    <Td className="text-xs">{a.actorRole}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <ProjectDetail />
    </Suspense>
  );
}
