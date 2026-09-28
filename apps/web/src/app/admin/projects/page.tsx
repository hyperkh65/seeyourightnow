'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ClipboardList, PackageSearch } from 'lucide-react';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/utils';
import { STAGE_LABEL, StageBadge } from '@/components/status';
import {
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingBlock,
  PageHeader,
  Select,
  Table,
  Td,
  Th,
} from '@/components/ui';

interface Row {
  id: string;
  code: string;
  title: string;
  stage: string;
  status: string;
  updatedAt: string;
  attention: Array<{ kind: string; message: string }>;
  thumbnail: string | null;
  requestStatus: string | null;
}

function Projects() {
  const sp = useSearchParams();
  const router = useRouter();
  const stage = sp.get('stage') ?? '';
  const [q, setQ] = useState(sp.get('q') ?? '');
  const res = useQuery({
    queryKey: ['projects', stage, sp.get('q')],
    queryFn: () =>
      api.get<{ items: Row[]; total: number }>(
        `/projects?limit=200${stage ? `&stage=${stage}` : ''}${sp.get('q') ? `&q=${encodeURIComponent(sp.get('q')!)}` : ''}`,
      ),
  });
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(sp.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    router.replace(`/admin/projects?${p}`);
  };
  return (
    <>
      <PageHeader title="프로젝트" description={res.data ? `${res.data.total}건` : undefined} />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <form
          className="flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            set('q', q);
          }}
        >
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="제품명 또는 프로젝트 번호로 찾기"
            aria-label="검색"
          />
        </form>
        <Select
          value={stage}
          onChange={(e) => set('stage', e.target.value)}
          className="sm:w-48"
          aria-label="단계"
        >
          <option value="">전체 단계</option>
          {Object.entries(STAGE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </div>
      <Card>
        {res.isLoading ? (
          <div className="p-5">
            <LoadingBlock rows={6} />
          </div>
        ) : res.error ? (
          <ErrorState error={res.error} />
        ) : !res.data?.items.length ? (
          <EmptyState
            icon={<ClipboardList className="h-5 w-5" />}
            title="조건에 맞는 프로젝트가 없습니다"
            description="고객이 제품을 검색하면 프로젝트가 자동으로 만들어집니다."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>프로젝트</Th>
                <Th>단계</Th>
                <Th>확인 필요</Th>
                <Th className="text-right">업데이트</Th>
              </tr>
            </thead>
            <tbody>
              {res.data.items.map((p) => (
                <tr
                  key={p.id}
                  className="cursor-pointer hover:bg-surface-sunken"
                  onClick={() => router.push(`/admin/projects/${p.id}`)}
                >
                  <Td>
                    <Link href={`/admin/projects/${p.id}`} className="flex items-center gap-3">
                      <span className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-line bg-surface-sunken">
                        {p.thumbnail ? (
                          <img src={p.thumbnail} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="flex h-full items-center justify-center text-ink-muted">
                            <PackageSearch className="h-4 w-4" />
                          </span>
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{p.title}</span>
                        <span className="text-xs text-ink-muted">
                          {p.code}
                          {p.requestStatus && p.requestStatus !== 'READY' ? ' · 분석 중' : ''}
                        </span>
                      </span>
                    </Link>
                  </Td>
                  <Td>
                    <StageBadge status={p.stage} />
                  </Td>
                  <Td>
                    {p.attention.length ? (
                      <span className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {p.attention[0]!.message}
                      </span>
                    ) : (
                      <span className="text-xs text-ink-muted">—</span>
                    )}
                  </Td>
                  <Td className="text-right text-xs text-ink-muted">{timeAgo(p.updatedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense>
      <Projects />
    </Suspense>
  );
}
