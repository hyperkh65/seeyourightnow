'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Boxes, Plus, ShieldAlert } from 'lucide-react';
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
  Select,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { EMPTY_SUPPLIER, SOURCE_TYPE_LABEL, SupplierForm, toSupplierBody } from './supplier-form';

interface Row {
  id: string;
  name: string;
  alias: string;
  sourceType: string;
  businessType: string;
  city: string;
  province: string;
  yearsInBusiness: number | null;
  businessVerified: boolean | null;
  blacklisted: boolean;
  riskFlags: string[];
  metrics: { orderCount?: number; qualityScore?: number; claimCount?: number; lateDeliveryCount?: number };
  updatedAt: string;
}

export default function Suppliers() {
  const router = useRouter();
  const toast = useToast();
  const can = useCan();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [form, setForm] = useState<typeof EMPTY_SUPPLIER | null>(null);
  const list = useQuery({
    queryKey: ['suppliers', query, type],
    queryFn: () =>
      api.get<{ items: Row[] }>(
        `/suppliers?limit=200${query ? `&q=${encodeURIComponent(query)}` : ''}${type ? `&sourceType=${type}` : ''}`,
      ),
  });
  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/suppliers', toSupplierBody(form!)),
    onSuccess: (s) => {
      toast.ok('공급처를 등록했습니다.');
      router.push(`/admin/suppliers/${s.id}`);
    },
    onError: toast.error,
  });
  return (
    <>
      <PageHeader
        title="공급처"
        description="자체 공급망과 검색으로 찾은 공급자를 관리합니다. 거래 이력이 추천 점수에 반영됩니다."
        actions={
          can('supplier.write') && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ ...EMPTY_SUPPLIER })}>
              공급처 등록
            </Button>
          )
        }
      />
      <form
        className="mb-4 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q.trim());
        }}
      >
        <Input
          className="max-w-xs"
          placeholder="상호, 별칭, 도시"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="검색"
        />
        <Select className="w-44" value={type} onChange={(e) => setType(e.target.value)} aria-label="출처">
          <option value="">전체 출처</option>
          {Object.entries(SOURCE_TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
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
            icon={<Boxes className="h-6 w-6" />}
            title="공급처가 없습니다"
            description="자체 공급망의 공장을 등록하면 검색 시 우선 검토됩니다."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>공급처</Th>
                <Th>출처</Th>
                <Th>지역</Th>
                <Th>유형</Th>
                <Th className="text-right">주문</Th>
                <Th className="text-right">품질</Th>
                <Th>상태</Th>
                <Th>변경</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((s) => (
                <tr key={s.id} className="hover:bg-surface-sunken">
                  <Td>
                    <Link
                      href={`/admin/suppliers/${s.id}`}
                      className="font-medium text-brand hover:underline"
                    >
                      {s.name}
                    </Link>
                    {s.alias && <div className="text-xs text-ink-muted">고객 표시: {s.alias}</div>}
                  </Td>
                  <Td className="text-xs">{SOURCE_TYPE_LABEL[s.sourceType] ?? s.sourceType}</Td>
                  <Td className="text-xs">{[s.city, s.province].filter(Boolean).join(', ') || '—'}</Td>
                  <Td className="text-xs">
                    {s.businessType === 'FACTORY' ? '공장' : s.businessType === 'TRADING' ? '무역' : '—'}
                    {s.yearsInBusiness ? ` · ${s.yearsInBusiness}년` : ''}
                  </Td>
                  <Td className="text-right tabular">{s.metrics.orderCount ?? 0}</Td>
                  <Td className="text-right tabular">
                    {s.metrics.qualityScore !== undefined
                      ? `${Math.round(s.metrics.qualityScore * 100)}`
                      : '—'}
                  </Td>
                  <Td>
                    {s.blacklisted ? (
                      <Badge tone="danger" icon={<ShieldAlert className="h-3 w-3" />}>
                        거래 제한
                      </Badge>
                    ) : s.businessVerified ? (
                      <Badge tone="ok">확인됨</Badge>
                    ) : (
                      <Badge>미확인</Badge>
                    )}
                    {s.riskFlags.length > 0 && (
                      <Badge tone="warn" className="ml-1">
                        위험 {s.riskFlags.length}
                      </Badge>
                    )}
                  </Td>
                  <Td className="text-xs text-ink-muted">{timeAgo(s.updatedAt)}</Td>
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
        title="공급처 등록"
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
        {form && <SupplierForm f={form} onChange={setForm} />}
      </Dialog>
    </>
  );
}
