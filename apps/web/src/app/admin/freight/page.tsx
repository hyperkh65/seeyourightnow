'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Truck } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/utils';
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
  Textarea,
  Th,
} from '@/components/ui';

interface Rate {
  id: string;
  mode: string;
  origin: string;
  destination: string;
  source: string;
  verification: string;
  providerName: string;
  currency: string;
  basis: string;
  rate: string;
  minCharge: string | null;
  fixedCharges: Array<{ name: string; amount: string }>;
  transitDaysMin: number | null;
  transitDaysMax: number | null;
  validFrom: string | null;
  validUntil: string | null;
  note: string;
  collectedAt: string;
}

const FREIGHT_SOURCE_LABEL: Record<string, string> = {
  REAL_TIME_API: '실시간 API',
  FORWARDER_VERIFIED: '포워더 확인',
  CONTRACT_RATE: '계약 운임',
  MARKET_RATE: '시장 운임',
  GOVERNMENT_STATISTICS: '정부 통계',
  HISTORICAL_ACTUAL: '과거 실적',
  AI_ESTIMATE: 'AI 추정',
};
const BASIS: Record<string, string> = {
  PER_KG: 'kg당',
  PER_CBM: 'CBM당',
  PER_RT: 'R/T당',
  PER_CONTAINER: '컨테이너당',
  FLAT: '건당',
};
const EMPTY = {
  mode: 'LCL',
  origin: 'CN*',
  destination: 'KRPUS',
  source: 'FORWARDER_VERIFIED',
  verification: 'PARTNER_VERIFIED',
  providerName: '',
  currency: 'USD',
  basis: 'PER_RT',
  rate: '',
  minCharge: '',
  fixed: '',
  transitDaysMin: '',
  transitDaysMax: '',
  validFrom: '',
  validUntil: '',
  note: '',
};

export default function FreightRates() {
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const q = useQuery({
    queryKey: ['freight-rates'],
    queryFn: () => api.get<{ items: Rate[] }>('/freight/rates'),
  });
  const [f, setF] = useState<typeof EMPTY | null>(null);
  const [mode, setMode] = useState('');
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) =>
    setF((x) => x && { ...x, [k]: e.target.value });
  const num = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) =>
    setF((x) => x && { ...x, [k]: e.target.value.replace(/[^\d.]/g, '') });
  const save = useMutation({
    mutationFn: () =>
      api.post('/freight/rates', {
        mode: f!.mode,
        origin: f!.origin.toUpperCase(),
        destination: f!.destination.toUpperCase(),
        source: f!.source,
        verification: f!.verification,
        providerName: f!.providerName,
        currency: f!.currency.toUpperCase(),
        basis: f!.basis,
        rate: f!.rate,
        ...(f!.minCharge ? { minCharge: f!.minCharge } : {}),
        fixedCharges: f!.fixed
          .split('\n')
          .map((l) => l.split(':'))
          .filter((p) => p.length === 2 && /^\d+(\.\d+)?$/.test(p[1]!.trim()))
          .map(([name, amount]) => ({ name: name!.trim(), amount: amount!.trim() })),
        ...(f!.transitDaysMin ? { transitDaysMin: Number(f!.transitDaysMin) } : {}),
        ...(f!.transitDaysMax ? { transitDaysMax: Number(f!.transitDaysMax) } : {}),
        ...(f!.validFrom ? { validFrom: f!.validFrom } : {}),
        ...(f!.validUntil ? { validUntil: f!.validUntil } : {}),
        note: f!.note,
      }),
    onSuccess: () => {
      toast.ok('운임을 등록했습니다.');
      setF(null);
      void qc.invalidateQueries({ queryKey: ['freight-rates'] });
    },
    onError: toast.error,
  });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/freight/rates/${id}`),
    onSuccess: () => {
      toast.ok('삭제했습니다.');
      void qc.invalidateQueries({ queryKey: ['freight-rates'] });
    },
    onError: toast.error,
  });
  const today = new Date().toISOString().slice(0, 10);
  const items = (q.data?.items ?? []).filter((r) => !mode || r.mode === mode);
  return (
    <>
      <PageHeader
        title="운임"
        description="구간별 운임표입니다. 원가 계산은 실시간 → 포워더 확인 → 계약 → 시장 → 통계 → 과거 실적 → AI 추정 순으로 신뢰도가 높은 운임을 사용합니다."
        actions={
          can('freight.write') && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setF({ ...EMPTY })}>
              운임 등록
            </Button>
          )
        }
      />
      <div className="mb-4 flex gap-2">
        <Select
          className="w-44"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          aria-label="운송 방식"
        >
          <option value="">전체 방식</option>
          {['COURIER', 'AIR', 'LCL', 'FCL_20', 'FCL_40', 'FCL_40HQ'].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </Select>
      </div>
      <Card>
        {q.isLoading ? (
          <LoadingBlock rows={6} />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !items.length ? (
          <EmptyState
            icon={<Truck className="h-6 w-6" />}
            title="등록된 운임이 없습니다"
            description="포워더 견적이나 계약 운임을 등록하면 원가 계산에 사용됩니다."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>방식</Th>
                <Th>구간</Th>
                <Th className="text-right">운임</Th>
                <Th>부대비용</Th>
                <Th>기간</Th>
                <Th>출처</Th>
                <Th>유효</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {items.map((r) => {
                const expired = r.validUntil && r.validUntil < today;
                return (
                  <tr key={r.id} className={expired ? 'opacity-60' : ''}>
                    <Td className="text-xs font-medium">{r.mode}</Td>
                    <Td className="text-sm">
                      {r.origin} → {r.destination}
                      {r.providerName && <div className="text-xs text-ink-muted">{r.providerName}</div>}
                    </Td>
                    <Td className="text-right tabular">
                      {formatMoney(r.rate, r.currency)}{' '}
                      <span className="text-xs text-ink-muted">{BASIS[r.basis] ?? r.basis}</span>
                      {r.minCharge && (
                        <div className="text-xs text-ink-muted">
                          최소 {formatMoney(r.minCharge, r.currency)}
                        </div>
                      )}
                    </Td>
                    <Td className="text-xs">
                      {r.fixedCharges.length
                        ? r.fixedCharges
                            .map((c) => `${c.name} ${formatMoney(c.amount, r.currency)}`)
                            .join(', ')
                        : '—'}
                    </Td>
                    <Td className="text-xs">
                      {r.transitDaysMin || r.transitDaysMax
                        ? `${r.transitDaysMin ?? '?'}~${r.transitDaysMax ?? '?'}일`
                        : '—'}
                    </Td>
                    <Td>
                      <Badge>{FREIGHT_SOURCE_LABEL[r.source] ?? r.source}</Badge>{' '}
                      <VerificationBadge verification={r.verification} />
                    </Td>
                    <Td className="text-xs">
                      {expired ? (
                        <span className="text-red-600">만료 {formatDate(r.validUntil)}</span>
                      ) : r.validUntil ? (
                        `~${formatDate(r.validUntil)}`
                      ) : (
                        '기한 없음'
                      )}
                    </Td>
                    <Td>
                      {can('freight.write') && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="삭제"
                          onClick={() => {
                            if (confirm('이 운임을 삭제할까요?')) del.mutate(r.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <Dialog
        open={!!f}
        onClose={() => setF(null)}
        size="lg"
        title="운임 등록"
        footer={
          <>
            <Button variant="secondary" onClick={() => setF(null)}>
              취소
            </Button>
            <Button loading={save.isPending} disabled={!f?.rate} onClick={() => save.mutate()}>
              등록
            </Button>
          </>
        }
      >
        {f && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="방식">
              <Select value={f.mode} onChange={set('mode')}>
                {['COURIER', 'AIR', 'LCL', 'FCL_20', 'FCL_40', 'FCL_40HQ'].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
            </Field>
            <Field label="출발" hint="UN/LOCODE 또는 CN* (중국 전체)">
              <Input value={f.origin} onChange={set('origin')} />
            </Field>
            <Field label="도착">
              <Input value={f.destination} onChange={set('destination')} />
            </Field>
            <Field label="출처">
              <Select value={f.source} onChange={set('source')}>
                {Object.entries(FREIGHT_SOURCE_LABEL)
                  .filter(([k]) => k !== 'REAL_TIME_API' && k !== 'AI_ESTIMATE')
                  .map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="검증">
              <Select value={f.verification} onChange={set('verification')}>
                <option value="UNVERIFIED">미확인</option>
                <option value="PARTNER_VERIFIED">포워더 확인</option>
                <option value="EXPERT_VERIFIED">전문가 확인</option>
                <option value="ACTUAL">실제 청구</option>
              </Select>
            </Field>
            <Field label="업체">
              <Input value={f.providerName} onChange={set('providerName')} />
            </Field>
            <Field label="통화">
              <Input value={f.currency} maxLength={3} onChange={set('currency')} />
            </Field>
            <Field label="기준">
              <Select value={f.basis} onChange={set('basis')}>
                {Object.entries(BASIS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="운임" required>
              <Input value={f.rate} onChange={num('rate')} />
            </Field>
            <Field label="최소 운임">
              <Input value={f.minCharge} onChange={num('minCharge')} />
            </Field>
            <Field label="운송일 (최소)">
              <Input value={f.transitDaysMin} onChange={num('transitDaysMin')} />
            </Field>
            <Field label="운송일 (최대)">
              <Input value={f.transitDaysMax} onChange={num('transitDaysMax')} />
            </Field>
            <Field label="유효 시작">
              <Input type="date" value={f.validFrom} onChange={set('validFrom')} />
            </Field>
            <Field label="유효 종료">
              <Input type="date" value={f.validUntil} onChange={set('validUntil')} />
            </Field>
            <div />
            <Field label="고정 부대비용" hint="한 줄에 하나, ‘항목:금액’" className="sm:col-span-3">
              <Textarea rows={3} value={f.fixed} onChange={set('fixed')} placeholder={'THC:120\nDOC:50'} />
            </Field>
            <Field label="메모" className="sm:col-span-3">
              <Input value={f.note} onChange={set('note')} />
            </Field>
          </div>
        )}
      </Dialog>
      <Alert className="mt-6">
        실제 청구 운임은 프로젝트의 운임 탭에서 기록하세요. 과거 실적으로 쌓여 다음 견적의 추정 정확도를
        높입니다.
      </Alert>
    </>
  );
}
