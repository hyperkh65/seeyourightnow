'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { useCan, useToast } from '@/components/providers';
import { VerificationBadge } from '@/components/status';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Select,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { SettingsBack } from '../_components/editor';

interface Rate {
  base: string;
  quote: string;
  rate: string;
  rateDate: string | null;
  source: string | null;
  verification: string;
  collectedAt: string;
  tenantScoped: boolean;
}

export default function FxRates() {
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const q = useQuery({ queryKey: ['fx'], queryFn: () => api.get<{ items: Rate[] }>('/fx/rates') });
  const [f, setF] = useState<null | {
    base: string;
    rate: string;
    rateDate: string;
    source: string;
    verification: string;
  }>(null);
  const refresh = useMutation({
    mutationFn: () => api.post('/fx/refresh', {}),
    onSuccess: () => {
      toast.ok('환율을 새로 받아오도록 요청했습니다. 잠시 후 반영됩니다.');
      setTimeout(() => void qc.invalidateQueries({ queryKey: ['fx'] }), 4000);
    },
    onError: toast.error,
  });
  const save = useMutation({
    mutationFn: () => api.post('/fx/rates', f),
    onSuccess: () => {
      toast.ok('환율을 등록했습니다. 새로 계산하는 원가부터 적용됩니다.');
      setF(null);
      void qc.invalidateQueries({ queryKey: ['fx'] });
    },
    onError: toast.error,
  });
  const today = new Date().toISOString().slice(0, 10);
  const stale = (d: string | null) => !d || (Date.now() - new Date(d).getTime()) / 86_400_000 > 3;
  return (
    <>
      <PageHeader
        back={<SettingsBack />}
        title="환율"
        description="원가 계산에 쓰는 환율입니다. 모든 환율은 기준일과 출처가 함께 기록되고, 견적 원가 스냅샷에 사용한 환율이 남습니다."
        actions={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              icon={<RefreshCw className="h-4 w-4" />}
              loading={refresh.isPending}
              onClick={() => refresh.mutate()}
            >
              API에서 받기
            </Button>
            {can('margin.manage') && (
              <Button
                icon={<Plus className="h-4 w-4" />}
                onClick={() =>
                  setF({ base: 'CNY', rate: '', rateDate: today, source: '', verification: 'UNVERIFIED' })
                }
              >
                직접 입력
              </Button>
            )}
          </div>
        }
      />
      <Alert className="mb-6">
        자동 환율은{' '}
        <Link href="/admin/settings/connections" className="text-brand hover:underline">
          API 연결
        </Link>
        에서 한국수출입은행 환율 API를 연결하면 매일 갱신됩니다. 직접 입력은 추가 인증 후 가능하며 감사 로그에
        남습니다.
      </Alert>
      <Card>
        {q.isLoading ? (
          <LoadingBlock rows={5} />
        ) : q.error ? (
          <ErrorState error={q.error} />
        ) : !q.data?.items.length ? (
          <EmptyState
            title="등록된 환율이 없습니다"
            description="환율이 없으면 외화 원가를 계산할 수 없어 ‘환율 확인 필요’로 표시됩니다."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>통화</Th>
                <Th className="text-right">1단위당 원화</Th>
                <Th>기준일</Th>
                <Th>출처</Th>
                <Th>검증</Th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((r) => (
                <tr key={`${r.base}/${r.quote}`}>
                  <Td className="font-medium">
                    {r.base}/{r.quote}
                  </Td>
                  <Td className="text-right tabular">
                    {Number(r.rate).toLocaleString('ko-KR', { maximumFractionDigits: 4 })}
                  </Td>
                  <Td className="text-xs">
                    {r.rateDate ?? '—'}
                    {stale(r.rateDate) && (
                      <Badge tone="warn" className="ml-2">
                        오래됨
                      </Badge>
                    )}
                  </Td>
                  <Td className="text-xs">
                    {r.source ?? '—'}
                    {!r.tenantScoped && <Badge className="ml-1">공통</Badge>}
                    <div className="text-ink-muted">{formatDate(r.collectedAt, true)}</div>
                  </Td>
                  <Td>
                    <VerificationBadge verification={r.verification} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Dialog
        open={!!f}
        onClose={() => setF(null)}
        title="환율 직접 입력"
        footer={
          <>
            <Button variant="secondary" onClick={() => setF(null)}>
              취소
            </Button>
            <Button
              loading={save.isPending}
              disabled={!f?.rate || !f?.source || Number(f.rate) <= 0}
              onClick={() => save.mutate()}
            >
              등록
            </Button>
          </>
        }
      >
        {f && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="통화 (3자리)">
              <Input
                value={f.base}
                maxLength={3}
                onChange={(e) => setF({ ...f, base: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })}
              />
            </Field>
            <Field label="1단위당 원화">
              <Input
                inputMode="decimal"
                value={f.rate}
                onChange={(e) => setF({ ...f, rate: e.target.value.replace(/[^\d.]/g, '') })}
                placeholder="예: 190.52"
              />
            </Field>
            <Field label="기준일">
              <Input
                type="date"
                value={f.rateDate}
                onChange={(e) => setF({ ...f, rateDate: e.target.value })}
              />
            </Field>
            <Field label="검증">
              <Select value={f.verification} onChange={(e) => setF({ ...f, verification: e.target.value })}>
                <option value="UNVERIFIED">참고용</option>
                <option value="PARTNER_VERIFIED">은행 고시 확인</option>
                <option value="ACTUAL">실제 환전 환율</option>
              </Select>
            </Field>
            <Field label="출처" required className="sm:col-span-2">
              <Input
                value={f.source}
                onChange={(e) => setF({ ...f, source: e.target.value })}
                placeholder="예: OO은행 2026-09-28 11시 고시 매매기준율"
              />
            </Field>
          </div>
        )}
      </Dialog>
    </>
  );
}
