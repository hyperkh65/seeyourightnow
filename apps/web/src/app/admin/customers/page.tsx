'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Building2, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/utils';
import { useCan, useToast } from '@/components/providers';
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
import { CompanyForm, EMPTY_COMPANY, toCompanyBody } from './company-form';

interface Row {
  id: string;
  name: string;
  businessNumber: string;
  industry: string;
  tier: string;
  creditLevel: string;
  warnings: string[];
  projectCount: number;
  updatedAt: string;
}

export default function Customers() {
  const router = useRouter();
  const toast = useToast();
  const can = useCan();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [form, setForm] = useState<typeof EMPTY_COMPANY | null>(null);
  const list = useQuery({
    queryKey: ['companies', query],
    queryFn: () =>
      api.get<{ items: Row[] }>(`/crm/companies${query ? `?q=${encodeURIComponent(query)}` : ''}`),
  });
  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/crm/companies', toCompanyBody(form!)),
    onSuccess: (c) => {
      toast.ok('고객사를 등록했습니다.');
      router.push(`/admin/customers/${c.id}`);
    },
    onError: toast.error,
  });
  return (
    <>
      <PageHeader
        title="고객"
        description="고객사, 담당자, 거래 이력과 내부 메모를 관리합니다."
        actions={
          can('crm.write') && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ ...EMPTY_COMPANY })}>
              고객사 등록
            </Button>
          )
        }
      />
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q.trim());
        }}
      >
        <Input
          className="max-w-xs"
          placeholder="회사명 또는 사업자번호"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="검색"
        />
        <Button type="submit" variant="secondary">
          검색
        </Button>
      </form>
      <Card>
        {list.isLoading ? (
          <LoadingBlock rows={6} />
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : !list.data?.items.length ? (
          <EmptyState
            icon={<Building2 className="h-6 w-6" />}
            title="고객사가 없습니다"
            description="고객이 가입하거나 요청을 남기면 자동으로 만들어집니다."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>회사</Th>
                <Th>업종</Th>
                <Th>등급</Th>
                <Th className="text-right">프로젝트</Th>
                <Th>주의</Th>
                <Th>변경</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((c) => (
                <tr key={c.id} className="hover:bg-surface-sunken">
                  <Td>
                    <Link
                      href={`/admin/customers/${c.id}`}
                      className="font-medium text-brand hover:underline"
                    >
                      {c.name}
                    </Link>
                    <div className="text-xs text-ink-muted">{c.businessNumber || '사업자번호 미등록'}</div>
                  </Td>
                  <Td className="text-xs">{c.industry || '—'}</Td>
                  <Td>
                    <Badge>{c.tier}</Badge>
                    {c.creditLevel !== 'NORMAL' && (
                      <Badge tone={c.creditLevel === 'GOOD' ? 'ok' : 'warn'} className="ml-1">
                        {c.creditLevel}
                      </Badge>
                    )}
                  </Td>
                  <Td className="text-right tabular">{c.projectCount}</Td>
                  <Td className="text-xs">
                    {c.warnings.length ? <Badge tone="warn">{c.warnings.length}건</Badge> : '—'}
                  </Td>
                  <Td className="text-xs text-ink-muted">{timeAgo(c.updatedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Dialog
        open={!!form}
        onClose={() => setForm(null)}
        size="lg"
        title="고객사 등록"
        footer={
          <>
            <Button variant="secondary" onClick={() => setForm(null)}>
              취소
            </Button>
            <Button loading={create.isPending} disabled={!form?.name.trim()} onClick={() => create.mutate()}>
              등록
            </Button>
          </>
        }
      >
        {form && <CompanyForm f={form} onChange={setForm} />}
      </Dialog>
    </>
  );
}
