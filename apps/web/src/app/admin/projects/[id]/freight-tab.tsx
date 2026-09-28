'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Send, Truck } from 'lucide-react';
import { api, newIdempotencyKey } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/utils';
import { useToast } from '@/components/providers';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, Dialog, EmptyState, Field, Input, Select, Table, Td, Th } from '@/components/ui';

interface FreightData {
  rfqs: Array<{ id: string; code: string; origin: string; destination: string; cbm: string; grossWeightKg: string; cartons: number; status: string; modes: string[]; createdAt: string }>;
  quotes: Array<{ id: string; rfqId: string | null; kind: string; mode: string; providerName: string; currency: string; freight: string | null; originCharges: string | null; destinationCharges: string | null; total: string; totalBase: string | null; transitDays: string; validUntil: string | null; createdAt: string }>;
  comparison: { estimated: string | null; partnerVerified: string | null; actual: string | null; errorEstimatedVsActualPct: string | null; errorVerifiedVsActualPct: string | null };
}

export function FreightTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['freight', projectId], queryFn: () => api.get<FreightData>(`/projects/${projectId}/freight`) });
  const partners = useQuery({ queryKey: ['partners'], queryFn: () => api.get<{ items: Array<{ id: string; name: string; email: string; role: string }> }>('/partners') });
  const [rfq, setRfq] = useState(false);
  const [actual, setActual] = useState(false);
  const [f, setF] = useState({ origin: 'CNNGB', destination: 'KRPUS', incoterm: 'FOB', cartonCount: '', l: '', w: '', h: '', gw: '', battery: false, dg: false, readyDate: '', modes: ['LCL'] as string[], forwarders: [] as string[] });
  const [a, setA] = useState({ mode: 'LCL', currency: 'USD', freight: '', originCharges: '0', destinationCharges: '0', customsCharges: '0', deliveryCharges: '0', providerName: '' });
  const [key] = useState(newIdempotencyKey);
  const create = useMutation({
    mutationFn: () => api.post(`/projects/${projectId}/freight-rfqs`, { origin: f.origin, destination: f.destination, incoterm: f.incoterm, packing: { cartonCount: Number(f.cartonCount), cartonLengthCm: f.l, cartonWidthCm: f.w, cartonHeightCm: f.h, cartonGrossWeightKg: f.gw }, battery: f.battery, dangerousGoods: f.dg, readyDate: f.readyDate || undefined, modes: f.modes, forwarderUserIds: f.forwarders }, { idempotencyKey: key }),
    onSuccess: () => { toast.ok('포워더에게 운임 견적을 요청했습니다.'); setRfq(false); void qc.invalidateQueries({ queryKey: ['freight', projectId] }); },
    onError: toast.error,
  });
  const saveActual = useMutation({
    mutationFn: () => api.post(`/projects/${projectId}/freight-actuals`, a),
    onSuccess: () => { toast.ok('실제 운임을 기록했습니다.'); setActual(false); void qc.invalidateQueries({ queryKey: ['freight', projectId] }); },
    onError: toast.error,
  });
  const fwds = partners.data?.items.filter((p) => p.role === 'FORWARDER_PARTNER') ?? [];
  const d = q.data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setRfq(true)} icon={<Send className="h-4 w-4" />}>포워더 견적 요청 (RFQ)</Button>
        <Button variant="secondary" onClick={() => setActual(true)}>실제 운임 기록</Button>
      </div>
      {d && (d.comparison.estimated || d.comparison.partnerVerified || d.comparison.actual) && (
        <Card>
          <CardHeader title="예상 · 확인 · 실제 비교" description="세 값은 서로 덮어쓰지 않고 따로 보관됩니다." />
          <CardBody className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-5">
            <div><p className="text-xs text-ink-muted">예상</p><p className="font-semibold tabular">{formatMoney(d.comparison.estimated)}</p></div>
            <div><p className="text-xs text-ink-muted">포워더 확인</p><p className="font-semibold tabular">{formatMoney(d.comparison.partnerVerified)}</p></div>
            <div><p className="text-xs text-ink-muted">실제</p><p className="font-semibold tabular">{formatMoney(d.comparison.actual)}</p></div>
            <div><p className="text-xs text-ink-muted">오차 (예상↔실제)</p><p className="font-semibold">{d.comparison.errorEstimatedVsActualPct ? `${d.comparison.errorEstimatedVsActualPct}%` : '—'}</p></div>
            <div><p className="text-xs text-ink-muted">오차 (확인↔실제)</p><p className="font-semibold">{d.comparison.errorVerifiedVsActualPct ? `${d.comparison.errorVerifiedVsActualPct}%` : '—'}</p></div>
          </CardBody>
        </Card>
      )}
      <Card>
        <CardHeader title="운임 견적" />
        {!d?.quotes.length ? <EmptyState icon={<Truck className="h-5 w-5" />} title="아직 받은 운임 견적이 없습니다" description="포장 정보가 준비되면 포워더에게 견적을 요청하세요." /> : (
          <Table>
            <thead><tr><Th>구분</Th><Th>업체</Th><Th>방식</Th><Th className="text-right">운임</Th><Th className="text-right">합계</Th><Th className="text-right">원화</Th><Th>소요</Th><Th>유효</Th></tr></thead>
            <tbody>
              {d.quotes.map((x) => (
                <tr key={x.id}>
                  <Td><Badge tone={x.kind === 'ACTUAL' ? 'ok' : x.kind === 'PARTNER_VERIFIED' ? 'brand' : 'info'}>{x.kind === 'ACTUAL' ? '실제' : x.kind === 'PARTNER_VERIFIED' ? '포워더 확인' : '예상'}</Badge></Td>
                  <Td>{x.providerName || '—'}</Td>
                  <Td>{x.mode}</Td>
                  <Td className="text-right tabular">{x.freight ? `${x.currency} ${x.freight}` : '—'}</Td>
                  <Td className="text-right tabular">{x.currency} {x.total}</Td>
                  <Td className="text-right tabular">{formatMoney(x.totalBase)}</Td>
                  <Td>{x.transitDays || '—'}</Td>
                  <Td className="text-xs">{x.validUntil ? formatDate(x.validUntil) : '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {!!d?.rfqs.length && (
        <Card>
          <CardHeader title="견적 요청 (RFQ)" />
          <ul className="divide-y divide-line">{d.rfqs.map((r) => <li key={r.id} className="flex items-center justify-between px-5 py-3 text-sm"><span>{r.code} · {r.origin}→{r.destination} · {r.cartons}CT / {Number(r.cbm)}CBM / {Number(r.grossWeightKg)}kg · {r.modes.join(', ')}</span><Badge tone={r.status === 'OPEN' ? 'warn' : 'ok'}>{r.status === 'OPEN' ? '회신 대기' : r.status === 'QUOTED' ? '견적 도착' : r.status}</Badge></li>)}</ul>
        </Card>
      )}
      <Dialog open={rfq} onClose={() => setRfq(false)} size="lg" title="포워더 운임 견적 요청" description="포워더 포털에 요청이 전달되고, 회신하면 자동으로 비교됩니다."
        footer={<><Button variant="secondary" onClick={() => setRfq(false)}>취소</Button><Button loading={create.isPending} disabled={!f.cartonCount || !f.l || !f.w || !f.h || !f.gw || !f.forwarders.length} onClick={() => create.mutate()}>요청 보내기</Button></>}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="출발 (UN/LOCODE)"><Input value={f.origin} onChange={(e) => setF({ ...f, origin: e.target.value.toUpperCase() })} /></Field>
          <Field label="도착"><Input value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value.toUpperCase() })} /></Field>
          <Field label="인코텀즈"><Select value={f.incoterm} onChange={(e) => setF({ ...f, incoterm: e.target.value })}>{['EXW', 'FOB', 'CFR', 'CIF', 'DAP', 'DDP'].map((x) => <option key={x}>{x}</option>)}</Select></Field>
          <Field label="카톤 수"><Input value={f.cartonCount} onChange={(e) => setF({ ...f, cartonCount: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="카톤 크기 L×W×H (cm)" className="sm:col-span-2"><div className="grid grid-cols-3 gap-2"><Input value={f.l} onChange={(e) => setF({ ...f, l: e.target.value })} placeholder="L" /><Input value={f.w} onChange={(e) => setF({ ...f, w: e.target.value })} placeholder="W" /><Input value={f.h} onChange={(e) => setF({ ...f, h: e.target.value })} placeholder="H" /></div></Field>
          <Field label="카톤당 총중량 (kg)"><Input value={f.gw} onChange={(e) => setF({ ...f, gw: e.target.value })} /></Field>
          <Field label="출고 가능일"><Input type="date" value={f.readyDate} onChange={(e) => setF({ ...f, readyDate: e.target.value })} /></Field>
          <div className="flex flex-col gap-2 pt-6"><Checkbox checked={f.battery} onChange={(v) => setF({ ...f, battery: v })} label="배터리 포함" /><Checkbox checked={f.dg} onChange={(v) => setF({ ...f, dg: v })} label="위험물(DG)" /></div>
          <Field label="운송 방식" className="sm:col-span-3"><div className="flex flex-wrap gap-3">{['COURIER', 'AIR', 'LCL', 'FCL_20', 'FCL_40', 'FCL_40HQ'].map((m) => <Checkbox key={m} checked={f.modes.includes(m)} onChange={(v) => setF({ ...f, modes: v ? [...f.modes, m] : f.modes.filter((x) => x !== m) })} label={m} />)}</div></Field>
          <Field label="요청할 포워더" className="sm:col-span-3">
            {fwds.length === 0 ? <Alert tone="info">등록된 포워더가 없습니다. 사용자·협력사 메뉴에서 포워더를 초대하세요.</Alert> : <div className="flex flex-wrap gap-3">{fwds.map((p) => <Checkbox key={p.id} checked={f.forwarders.includes(p.id)} onChange={(v) => setF({ ...f, forwarders: v ? [...f.forwarders, p.id] : f.forwarders.filter((x) => x !== p.id) })} label={p.name || p.email} />)}</div>}
          </Field>
        </div>
      </Dialog>
      <Dialog open={actual} onClose={() => setActual(false)} title="실제 운임 기록" description="정산 후 실제 청구된 운임을 입력하면 예측 정확도에 반영됩니다."
        footer={<><Button variant="secondary" onClick={() => setActual(false)}>취소</Button><Button loading={saveActual.isPending} disabled={!a.freight} onClick={() => saveActual.mutate()}>저장</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="업체"><Input value={a.providerName} onChange={(e) => setA({ ...a, providerName: e.target.value })} /></Field>
          <Field label="방식"><Select value={a.mode} onChange={(e) => setA({ ...a, mode: e.target.value })}>{['COURIER', 'AIR', 'LCL', 'FCL_20', 'FCL_40', 'FCL_40HQ'].map((m) => <option key={m}>{m}</option>)}</Select></Field>
          <Field label="통화"><Select value={a.currency} onChange={(e) => setA({ ...a, currency: e.target.value })}><option>USD</option><option>KRW</option><option>CNY</option></Select></Field>
          <Field label="해상/항공 운임"><Input value={a.freight} onChange={(e) => setA({ ...a, freight: e.target.value })} /></Field>
          <Field label="출발지 비용"><Input value={a.originCharges} onChange={(e) => setA({ ...a, originCharges: e.target.value })} /></Field>
          <Field label="도착지 비용"><Input value={a.destinationCharges} onChange={(e) => setA({ ...a, destinationCharges: e.target.value })} /></Field>
          <Field label="통관 비용"><Input value={a.customsCharges} onChange={(e) => setA({ ...a, customsCharges: e.target.value })} /></Field>
          <Field label="국내 운송"><Input value={a.deliveryCharges} onChange={(e) => setA({ ...a, deliveryCharges: e.target.value })} /></Field>
        </div>
      </Dialog>
    </div>
  );
}
