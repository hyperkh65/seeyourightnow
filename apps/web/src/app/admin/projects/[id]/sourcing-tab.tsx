'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Calculator, Check, ChevronDown, EyeOff, Pin, Plus, RefreshCw, Sparkles, Store } from 'lucide-react';
import { TRI_ATTRIBUTE_KEYS, TRI_ATTRIBUTE_LABEL_KO } from '@sos/core';
import { api } from '@/lib/api';
import { cn, formatMoney, formatNumber, timeAgo } from '@/lib/utils';
import { useCan, useToast } from '@/components/providers';
import { RISK_DIMENSION_LABEL, RiskBadge, VerificationBadge } from '@/components/status';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Dialog, EmptyState, Field, Input, KeyValue, Select, Switch, Table, Td, Textarea, Th } from '@/components/ui';
import type { EstimateRes, StaffCandidate, StaffResult } from './types';

const TAG: Record<string, string> = { BEST_MATCH: '가장 적합', LOWEST_COST: '최저 비용', BEST_QUALITY: '품질 우수', BEST_FOR_OEM: 'OEM 추천', LOW_MOQ: '소량 가능', FASTEST_DELIVERY: '빠른 납기', PRIVATE_NETWORK_RECOMMENDED: '자체 공급망 추천' };
const STEP_LABEL: Record<string, string> = { analyze: '제품 분석', search: '공급처 검색', market: '국내 시장', hs: 'HS 분류', compliance: '인증', cost: '원가 계산' };
const PRICE_REASONS = { STRATEGIC_CUSTOMER: '전략 고객', MARKET_PRICE: '시장가 대응', DISCOUNT: '할인', HIGH_RISK: '고위험 반영', LOW_QUANTITY: '소량', MANUAL: '수동 결정', OTHER: '기타' };

function ProgressPanel({ r }: { r: StaffResult }) {
  const qc = useQueryClient();
  const toast = useToast();
  const rerun = useMutation({ mutationFn: (step: string) => api.post(`/sourcing/requests/${r.id}/rerun`, { step }), onSuccess: () => { toast.ok('다시 실행합니다.'); void qc.invalidateQueries({ queryKey: ['staff-result'] }); }, onError: toast.error });
  return (
    <Card>
      <CardHeader title="분석 파이프라인" description={r.status === 'READY' ? '완료' : '진행 중'} />
      <ul className="divide-y divide-line">
        {Object.keys(STEP_LABEL).map((k) => {
          const s = r.progress[k];
          return (
            <li key={k} className="flex items-start justify-between gap-3 px-5 py-2.5 text-sm">
              <div className="min-w-0">
                <span className="font-medium">{STEP_LABEL[k]}</span>{' '}
                <Badge tone={s?.status === 'DONE' ? 'ok' : s?.status === 'FAILED' ? 'danger' : s?.status === 'SKIPPED' ? 'neutral' : 'info'}>{s?.status ?? 'PENDING'}</Badge>
                {s?.message && <p className="mt-0.5 text-xs text-ink-muted">{s.message}</p>}
              </div>
              <Button variant="ghost" size="sm" onClick={() => rerun.mutate(k)} aria-label={`${STEP_LABEL[k]} 다시 실행`} icon={<RefreshCw className="h-3.5 w-3.5" />} />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function AttributesPanel({ r }: { r: StaffResult }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [edit, setEdit] = useState(false);
  const a = (r.product?.attributes ?? {}) as Record<string, unknown>;
  const [changes, setChanges] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () => api.patch(`/products/${r.product!.id}/attributes`, { changes, reason }),
    onSuccess: () => { toast.ok('수정했습니다. 원래 AI 값은 기록으로 남습니다.'); setEdit(false); setChanges({}); void qc.invalidateQueries({ queryKey: ['staff-result'] }); },
    onError: toast.error,
  });
  if (!r.product) return null;
  const tri = TRI_ATTRIBUTE_KEYS.filter((k) => a[k] !== undefined);
  return (
    <Card>
      <CardHeader title="제품 특성" description={`AI 신뢰도 ${Math.round((r.product.confidence ?? 0) * 100)}% · 모르는 값은 UNKNOWN으로 둡니다.`} action={<Button size="sm" variant="secondary" onClick={() => setEdit(true)}>수정</Button>} />
      <CardBody className="space-y-4">
        <KeyValue items={[
          { label: '제품명', value: r.product.nameKo },
          { label: '영문명', value: String(a.product_name_en ?? '—') },
          { label: '중국어명', value: String(a.product_name_cn ?? '—') },
          { label: '카테고리', value: `${String(a.category ?? '—')} / ${String(a.subcategory ?? '—')}` },
          { label: '재질', value: String(a.material ?? '—') },
          { label: '전압 / 전력', value: `${String(a.voltage ?? '—')} / ${String(a.wattage ?? '—')}` },
          { label: '배터리', value: `${String(a.battery_type ?? '—')} ${String(a.battery_capacity ?? '')}` },
          { label: '검색어 (CN)', value: ((a.search_keywords_cn as string[]) ?? []).join(', ') || '—' },
        ]} />
        <div className="flex flex-wrap gap-1.5">
          {tri.map((k) => (
            <Badge key={k} tone={a[k] === 'TRUE' ? 'brand' : a[k] === 'FALSE' ? 'neutral' : 'warn'}>{TRI_ATTRIBUTE_LABEL_KO[k]}: {a[k] === 'TRUE' ? '예' : a[k] === 'FALSE' ? '아니오' : '미확인'}</Badge>
          ))}
        </div>
        {r.product.conflicts.length > 0 && <Alert tone="warn">정보가 서로 달라 확인이 필요한 항목: {r.product.conflicts.join(', ')}</Alert>}
      </CardBody>
      <Dialog open={edit} onClose={() => setEdit(false)} title="제품 특성 수정" description="수정 값은 확정값으로 저장되며, AI 예상값은 그대로 보존됩니다." size="lg"
        footer={<><Button variant="secondary" onClick={() => setEdit(false)}>취소</Button><Button loading={save.isPending} disabled={!Object.keys(changes).length || reason.length < 2} onClick={() => save.mutate()}>저장</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          {['product_name_ko', 'category', 'material', 'voltage', 'battery_type', 'battery_capacity'].map((k) => (
            <Field key={k} label={k}><Input defaultValue={String(a[k] ?? '')} onChange={(e) => setChanges((c) => ({ ...c, [k]: e.target.value }))} /></Field>
          ))}
          {TRI_ATTRIBUTE_KEYS.map((k) => (
            <Field key={k} label={TRI_ATTRIBUTE_LABEL_KO[k]}>
              <Select defaultValue={String(a[k] ?? 'UNKNOWN')} onChange={(e) => setChanges((c) => ({ ...c, [k]: e.target.value }))}>
                <option value="TRUE">예</option><option value="FALSE">아니오</option><option value="UNKNOWN">미확인</option>
              </Select>
            </Field>
          ))}
          <Field label="수정 사유" required className="sm:col-span-2"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 공급처 사양서 확인" /></Field>
        </div>
      </Dialog>
    </Card>
  );
}

export function CostPanel({ est, currency, onFinal }: { est: EstimateRes; currency: string; onFinal?: (snapshotId: string) => void }) {
  const l = est.landed;
  return (
    <div className="space-y-4">
      {!l.complete && <Alert tone="warn" title="일부 비용이 확정되지 않았습니다">{l.warnings.join(' · ')}</Alert>}
      <Table>
        <thead><tr><Th>항목</Th><Th className="text-right">원래 금액</Th><Th className="text-right">합계 ({l.baseCurrency})</Th><Th className="text-right">개당</Th><Th>근거</Th></tr></thead>
        <tbody>
          {l.lines.map((line) => (
            <tr key={line.key} className={cn(!line.includedInLandedCost && 'opacity-60')}>
              <Td><span className="font-medium">{line.label}</span>{line.note && <p className="text-[11px] text-ink-muted">{line.note}</p>}</Td>
              <Td className="text-right tabular text-xs">{line.originalAmount ? `${formatNumber(line.originalAmount)} ${line.originalCurrency} ${line.basis === 'PER_UNIT' ? '/개' : ''}` : '—'}</Td>
              <Td className="text-right tabular">{formatMoney(line.totalBase, l.baseCurrency)}</Td>
              <Td className="text-right tabular text-xs">{formatMoney(line.perUnitBase, l.baseCurrency, { precision: 1 })}</Td>
              <Td><VerificationBadge verification={line.verification} source={line.source} /><p className="mt-0.5 max-w-[180px] truncate text-[10px] text-ink-muted" title={line.source}>{line.source}</p></Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="grid gap-3 rounded-xl bg-surface-sunken p-4 text-sm sm:grid-cols-4">
        <div><p className="text-xs text-ink-muted">과세가격 (CIF)</p><p className="font-semibold tabular">{formatMoney(l.customsValueBase, l.baseCurrency)}</p></div>
        <div><p className="text-xs text-ink-muted">도착원가 합계</p><p className="font-semibold tabular">{formatMoney(l.landedCostBase, l.baseCurrency)}</p></div>
        <div><p className="text-xs text-ink-muted">개당 도착원가</p><p className="text-lg font-bold tabular">{formatMoney(l.perUnitLandedCostBase, l.baseCurrency)}</p></div>
        <div><p className="text-xs text-ink-muted">관세</p><p className="text-xs">{est.dutyNote}</p></div>
      </div>
      {l.fxUsed.length > 0 && <p className="text-[11px] text-ink-muted">적용 환율: {l.fxUsed.map((f) => `${f.from}/${f.to} ${f.rate} (${f.rateDate ?? '?'} · ${f.source ?? '?'})`).join(' · ')}</p>}
      {est.freight && (
        <div>
          <p className="mb-2 text-sm font-semibold">운송 방식 비교 <span className="text-xs font-normal text-ink-muted">· {est.freight.metrics.cbm} CBM · {est.freight.metrics.grossWeightKg} kg</span></p>
          <div className="grid gap-2 sm:grid-cols-3">
            {est.freight.options.map((o) => (
              <div key={o.mode} className={cn('rounded-xl border p-3 text-xs', o.mode === est.freight!.recommended ? 'border-brand/50 bg-brand/5' : 'border-line')}>
                <div className="flex items-center justify-between"><span className="font-semibold">{o.mode}</span>{o.mode === est.freight!.recommended && <Badge tone="brand">추천</Badge>}</div>
                <p className="mt-1 text-sm font-bold tabular">{o.costBase ? formatMoney(o.costBase, currency) : o.status === 'INFEASIBLE' ? '불가' : '운임 없음'}</p>
                {o.transitDays && <p className="text-ink-muted">{o.transitDays}일</p>}
                {o.source && <p className="text-ink-muted">{o.source}</p>}
                {o.actionRequired && <p className="mt-1 text-amber-700 dark:text-amber-300">{o.actionRequired}</p>}
                {o.feasibility.restrictions.slice(0, 2).map((x) => <p key={x} className="mt-1 text-ink-muted">· {x}</p>)}
              </div>
            ))}
          </div>
        </div>
      )}
      {est.price && (
        <div className="rounded-xl border border-violet-200 p-4 dark:border-violet-500/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs text-ink-muted">계산된 고객가 (개당)</p>
              <p className="text-xl font-bold tabular">{formatMoney(est.price.calculatedUnitPriceBase, currency)}</p>
              <p className="text-xs text-ink-muted">마크업 {est.price.markupPct}% · 마진 {est.price.marginPct}% · 예상 이익 {formatMoney(est.price.profitBase, currency)}</p>
            </div>
            {onFinal && est.pricingSnapshotId && <Button size="sm" variant="secondary" onClick={() => onFinal(est.pricingSnapshotId!)}>최종 판매가 지정</Button>}
          </div>
          <ul className="mt-3 space-y-1 text-xs text-ink-soft">
            {est.price.components.filter((c) => c.explanation).map((c) => (
              <li key={c.component}>
                <b>{c.component}</b> {c.markupPct}% ← {c.explanation!.baseFrom.name}
                {c.explanation!.adjustments.map((a) => ` + ${a.name}(${a.markupPct}%)`).join('')}
                {c.explanation!.clampedFrom && ` (한도 적용: ${c.explanation!.clampedFrom}%)`}
                {c.explanation!.override && ` · 수동 지정`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CandidateRow({ c, currency, onEstimate }: { c: StaffCandidate; currency: string; onEstimate: (c: StaffCandidate) => void }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const patch = useMutation({ mutationFn: (body: Record<string, unknown>) => api.patch(`/candidates/${c.id}`, body), onSuccess: () => qc.invalidateQueries({ queryKey: ['staff-result'] }), onError: toast.error });
  const price = c.pricing?.adminFinalPrice ?? c.pricing?.calculatedCustomerPrice;
  return (
    <div className={cn('rounded-2xl border bg-surface', c.selected ? 'border-brand/50 ring-2 ring-brand/10' : 'border-line')}>
      <div className="flex gap-3 p-4">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-line bg-surface-sunken">
          {c.listing.imageUrls[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.listing.imageUrls[0]} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
          ) : <div className="flex h-full items-center justify-center text-ink-muted"><Store className="h-5 w-5" /></div>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-base font-bold tabular">{Math.round(c.score)}</span>
            <span className="text-[11px] text-ink-muted">점 · 데이터 {Math.round(c.coverage * 100)}%</span>
            {c.tags.map((t) => <Badge key={t} tone={t === 'BEST_MATCH' ? 'brand' : 'neutral'}>{TAG[t] ?? t}</Badge>)}
            {c.isInternalRecommendation && <Badge tone="purple">내부 추천</Badge>}
            {c.listing.isDevMock && <Badge tone="warn">DEV MOCK</Badge>}
            {c.pinned && <Badge tone="info" icon={<Pin className="h-3 w-3" />}>고정</Badge>}
            {c.hiddenFromCustomer && <Badge icon={<EyeOff className="h-3 w-3" />}>고객 비공개</Badge>}
          </div>
          <p className="mt-1 truncate text-sm font-medium" title={c.listing.title}>{c.listing.titleKo || c.listing.title}</p>
          <p className="text-xs text-ink-muted">
            {c.supplier?.name ?? '공급자 미상'} {c.supplier && c.supplier.visibility !== 'VISIBLE' && <span>(고객에게 “{c.supplier.displayName}”)</span>} · {c.listing.sourceType} · {c.listing.connector} · {timeAgo(c.listing.lastCheckedAt)} 확인
          </p>
          <p className="mt-1 text-xs text-ink-soft">
            공급가 {c.listing.supplierVerifiedPrice ?? c.listing.supplierListPrice ? `${c.listing.currency} ${c.listing.supplierVerifiedPrice ?? c.listing.supplierListPrice}${c.listing.supplierVerifiedPrice ? ' (확인)' : ''}` : '—'} · MOQ {c.listing.moq ?? '—'} · 납기 {c.listing.leadTimeDays ?? '—'}일
          </p>
          {c.cautions.map((x) => <p key={x} className="mt-1 flex gap-1 text-xs text-amber-700 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{x}</p>)}
        </div>
        <div className="hidden shrink-0 text-right sm:block">
          <p className="text-[11px] text-ink-muted">도착원가 / 고객가 (개당)</p>
          <p className="text-sm tabular">{c.cost ? formatMoney(c.cost.landedCostPerUnit, currency) : '—'}</p>
          <p className="text-base font-bold tabular">{price ? formatMoney(price, currency) : '—'}</p>
          {c.cost && <VerificationBadge verification={c.cost.verification} />}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1 border-t border-line px-3 py-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} icon={<ChevronDown className={cn('h-3.5 w-3.5 transition', open && 'rotate-180')} />}>점수 근거</Button>
        <Button size="sm" variant="ghost" onClick={() => onEstimate(c)} icon={<Calculator className="h-3.5 w-3.5" />}>원가·가격 계산</Button>
        <Button size="sm" variant="ghost" onClick={() => patch.mutate({ pinned: !c.pinned })} icon={<Pin className="h-3.5 w-3.5" />}>{c.pinned ? '고정 해제' : '상단 고정'}</Button>
        <Button size="sm" variant="ghost" onClick={() => patch.mutate({ hiddenFromCustomer: !c.hiddenFromCustomer })} icon={<EyeOff className="h-3.5 w-3.5" />}>{c.hiddenFromCustomer ? '고객에게 보이기' : '고객에게 숨기기'}</Button>
        <Button size="sm" variant={c.selected ? 'primary' : 'ghost'} onClick={() => patch.mutate({ selected: !c.selected })} icon={<Check className="h-3.5 w-3.5" />}>{c.selected ? '견적 대상' : '견적 대상으로'}</Button>
        {c.listing.url && <a href={c.listing.url} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs text-brand hover:underline">원본 보기</a>}
      </div>
      {open && (
        <div className="border-t border-line px-4 py-3">
          <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {c.components.map((x) => (
              <div key={x.key} className="flex items-center gap-2 text-xs">
                <span className="w-20 shrink-0 text-ink-muted">{x.label}</span>
                <span className="h-1.5 w-16 overflow-hidden rounded-full bg-line"><span className="block h-full bg-brand" style={{ width: `${(x.score ?? 0) * 100}%` }} /></span>
                <span className="w-8 tabular">{x.score === null ? '—' : Math.round(x.score * 100)}</span>
                <span className="truncate text-ink-muted" title={x.evidence}>가중치 {x.weight} · {x.evidence}</span>
              </div>
            ))}
          </div>
          {c.privateNote && <p className="mt-3 text-xs text-violet-700">내부 메모: {c.privateNote}</p>}
        </div>
      )}
    </div>
  );
}

function InternalRecoDialog({ open, onClose, requestId }: { open: boolean; onClose: () => void; requestId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ supplierName: '', alias: '', visibility: 'HIDDEN', productTitle: '', internalCost: '', costCurrency: 'CNY', customerPrice: '', moq: '', leadTimeDays: '', qualityLevel: 'STANDARD', reason: '', privateNote: '', customerNote: '', pin: true, unitsPerCarton: '', cartonL: '', cartonW: '', cartonH: '', cartonGw: '' });
  const m = useMutation({
    mutationFn: () =>
      api.post(`/sourcing/requests/${requestId}/internal-recommendations`, {
        newSupplier: { name: f.supplierName, alias: f.alias, visibility: f.visibility },
        productTitle: f.productTitle,
        internalCost: f.internalCost,
        costCurrency: f.costCurrency,
        ...(f.customerPrice ? { customerPrice: f.customerPrice } : {}),
        ...(f.moq ? { moq: Number(f.moq) } : {}),
        ...(f.leadTimeDays ? { leadTimeDays: Number(f.leadTimeDays) } : {}),
        qualityLevel: f.qualityLevel,
        reason: f.reason,
        privateNote: f.privateNote,
        customerNote: f.customerNote,
        pin: f.pin,
        ...(f.unitsPerCarton && f.cartonL ? { packaging: { unitsPerCarton: Number(f.unitsPerCarton), cartonL: f.cartonL, cartonW: f.cartonW, cartonH: f.cartonH, cartonGw: f.cartonGw } } : {}),
      }),
    onSuccess: () => { toast.ok('내부 추천을 추가했습니다.'); onClose(); void qc.invalidateQueries({ queryKey: ['staff-result'] }); },
    onError: toast.error,
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open={open} onClose={onClose} size="lg" title="자체 공급망 추천 추가" description="우리 회사가 직접 확보한 제품을 검색 결과와 같은 기준으로 비교하고 상단에 고정할 수 있습니다."
      footer={<><Button variant="secondary" onClick={onClose}>취소</Button><Button loading={m.isPending} disabled={!f.supplierName || !f.productTitle || !f.internalCost} onClick={() => m.mutate()}>추가</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="공급자 (내부용 실명)" required><Input value={f.supplierName} onChange={set('supplierName')} /></Field>
        <Field label="고객 표시 방식"><Select value={f.visibility} onChange={set('visibility')}><option value="HIDDEN">숨김 (Private Sourcing Network)</option><option value="ALIAS">별칭</option><option value="VISIBLE">실명</option></Select></Field>
        {f.visibility === 'ALIAS' && <Field label="별칭" className="sm:col-span-2"><Input value={f.alias} onChange={set('alias')} placeholder="예: Verified Factory · Ningbo" /></Field>}
        <Field label="제품명" required className="sm:col-span-2"><Input value={f.productTitle} onChange={set('productTitle')} /></Field>
        <Field label="내부 원가 (개당)" required><div className="flex gap-2"><Input value={f.internalCost} onChange={set('internalCost')} inputMode="decimal" /><Select value={f.costCurrency} onChange={set('costCurrency')} className="w-24"><option>CNY</option><option>USD</option><option>KRW</option></Select></div></Field>
        <Field label="고객 제시가 (개당, 원)" hint="비우면 마진 규칙으로 계산합니다."><Input value={f.customerPrice} onChange={set('customerPrice')} inputMode="numeric" /></Field>
        <Field label="MOQ"><Input value={f.moq} onChange={set('moq')} inputMode="numeric" /></Field>
        <Field label="납기 (일)"><Input value={f.leadTimeDays} onChange={set('leadTimeDays')} inputMode="numeric" /></Field>
        <Field label="카톤 입수 / 크기(cm) / 중량(kg)" className="sm:col-span-2" hint="입력하면 운임을 자동 계산합니다.">
          <div className="grid grid-cols-5 gap-2">
            <Input placeholder="입수" value={f.unitsPerCarton} onChange={set('unitsPerCarton')} />
            <Input placeholder="L" value={f.cartonL} onChange={set('cartonL')} />
            <Input placeholder="W" value={f.cartonW} onChange={set('cartonW')} />
            <Input placeholder="H" value={f.cartonH} onChange={set('cartonH')} />
            <Input placeholder="kg" value={f.cartonGw} onChange={set('cartonGw')} />
          </div>
        </Field>
        <Field label="추천 이유 (내부)" className="sm:col-span-2"><Input value={f.reason} onChange={set('reason')} /></Field>
        <Field label="고객에게 보일 메모" className="sm:col-span-2"><Textarea value={f.customerNote} onChange={set('customerNote')} /></Field>
        <Field label="내부 메모 (고객 비공개)" className="sm:col-span-2"><Textarea value={f.privateNote} onChange={set('privateNote')} /></Field>
        <Switch checked={f.pin} onChange={(v) => setF({ ...f, pin: v })} label="검색 결과 상단에 고정" />
      </div>
    </Dialog>
  );
}

function EstimateDialog({ cand, onClose, currency, quantity }: { cand: StaffCandidate | null; onClose: () => void; currency: string; quantity: number | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [qty, setQty] = useState(String(quantity ?? cand?.listing.moq ?? 100));
  const [mode, setMode] = useState('');
  const [est, setEst] = useState<EstimateRes | null>(null);
  const [final, setFinal] = useState<{ snapshotId: string; price: string; reason: string; note: string } | null>(null);
  const run = useMutation({
    mutationFn: () => api.post<EstimateRes>(`/candidates/${cand!.id}/estimate`, { quantity: Number(qty), ...(mode ? { freightMode: mode } : {}) }),
    onSuccess: (r) => { setEst(r); void qc.invalidateQueries({ queryKey: ['staff-result'] }); },
    onError: toast.error,
  });
  const saveFinal = useMutation({
    mutationFn: () => api.post(`/pricing-snapshots/${final!.snapshotId}/final-price`, { unitPrice: final!.price, reason: final!.reason, note: final!.note }),
    onSuccess: () => { toast.ok('최종 판매가를 지정했습니다. 계산가는 그대로 보존됩니다.'); setFinal(null); void qc.invalidateQueries({ queryKey: ['staff-result'] }); },
    onError: toast.error,
  });
  return (
    <Dialog open={!!cand} onClose={() => { setEst(null); onClose(); }} size="xl" title="원가·가격 계산" description={cand?.listing.titleKo || cand?.listing.title}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="수량"><Input value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} className="w-32" /></Field>
          <Field label="운송 방식"><Select value={mode} onChange={(e) => setMode(e.target.value)} className="w-40"><option value="">자동 (최저)</option>{['COURIER', 'AIR', 'LCL', 'FCL_20', 'FCL_40', 'FCL_40HQ'].map((m) => <option key={m}>{m}</option>)}</Select></Field>
          <Button onClick={() => run.mutate()} loading={run.isPending} icon={<Calculator className="h-4 w-4" />}>계산</Button>
        </div>
        {est ? <CostPanel est={est} currency={currency} onFinal={(id) => setFinal({ snapshotId: id, price: est.price?.calculatedUnitPriceBase ?? '', reason: 'MANUAL', note: '' })} /> : <p className="text-sm text-ink-muted">수량을 확인하고 계산을 누르세요. 모든 계산은 새 버전으로 저장되며 이전 결과는 보존됩니다.</p>}
        {final && (
          <div className="space-y-3 rounded-xl border border-line p-4">
            <p className="text-sm font-semibold">최종 판매가 지정 (ADMIN_FINAL_PRICE)</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="개당 판매가 (원)"><Input value={final.price} onChange={(e) => setFinal({ ...final, price: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
              <Field label="사유"><Select value={final.reason} onChange={(e) => setFinal({ ...final, reason: e.target.value })}>{Object.entries(PRICE_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Field label="메모"><Input value={final.note} onChange={(e) => setFinal({ ...final, note: e.target.value })} /></Field>
            </div>
            <Button onClick={() => saveFinal.mutate()} loading={saveFinal.isPending} disabled={!final.price}>저장</Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}

export function SourcingTab({ r }: { r: StaffResult }) {
  const can = useCan();
  const [reco, setReco] = useState(false);
  const [estFor, setEstFor] = useState<StaffCandidate | null>(null);
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-ink-muted">후보 {r.candidates.length}개 · 적합도 순 (고정 항목 우선)</p>
          {can('supplier.write') && <Button size="sm" onClick={() => setReco(true)} icon={<Plus className="h-4 w-4" />}>자체 공급망 추천 추가</Button>}
        </div>
        {r.candidates.length === 0 ? (
          <Card><EmptyState icon={<Sparkles className="h-5 w-5" />} title="아직 공급 후보가 없습니다" description="마켓 커넥터를 연결하거나 자체 공급망 제품을 추가하세요." /></Card>
        ) : r.candidates.map((c) => <CandidateRow key={c.id} c={c} currency={r.currency} onEstimate={setEstFor} />)}
        {r.clusters.length > 0 && (
          <Card>
            <CardHeader title="동일 제품 그룹" description="여러 공급자가 올린 같은 제품을 묶어 가격을 비교합니다." />
            <CardBody className="space-y-2 text-sm">
              {r.clusters.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="truncate">{c.label}</span>
                  <span className="text-xs text-ink-muted">공급자 {c.supplierCount} · 최저 {c.lowestPrice ? formatMoney(c.lowestPrice, c.currency ?? 'KRW') : '—'} · 중앙 {c.medianPrice ? formatMoney(c.medianPrice, c.currency ?? 'KRW') : '—'} · 최고 {c.highestPrice ? formatMoney(c.highestPrice, c.currency ?? 'KRW') : '—'}</span>
                </div>
              ))}
            </CardBody>
          </Card>
        )}
      </div>
      <div className="space-y-4">
        <Card>
          <CardHeader title="요청 내용" />
          <CardBody className="space-y-3">
            {r.input.images.length > 0 && <div className="flex gap-2">{r.input.images.map((u) => <img key={u} src={u} alt="" className="h-16 w-16 rounded-lg border border-line object-cover" />)}</div>}
            <KeyValue cols={1} items={[
              { label: '검색어', value: r.input.query || '—' },
              { label: '링크', value: r.input.url ? <a href={r.input.url} target="_blank" rel="noopener noreferrer" className="break-all text-brand">{r.input.url}</a> : '—', hide: !r.input.url },
              { label: '수량', value: r.input.quantity ? formatNumber(r.input.quantity) : '—' },
              { label: '옵션', value: Object.entries(r.input.options).filter(([, v]) => v).map(([k, v]) => (v === true ? k : `${k}: ${String(v)}`)).join(', ') || '—' },
            ]} />
          </CardBody>
        </Card>
        <AttributesPanel r={r} />
        {r.product?.risk && (
          <Card>
            <CardHeader title="리스크" action={<RiskBadge level={r.product.risk.overall} />} />
            <CardBody className="space-y-2">
              {r.product.risk.items.map((i) => (
                <div key={i.dimension} className="text-sm"><div className="flex justify-between"><span>{RISK_DIMENSION_LABEL[i.dimension] ?? i.dimension}</span><RiskBadge level={i.level} /></div><p className="text-xs text-ink-muted">{i.reasons.join(' · ')}</p></div>
              ))}
            </CardBody>
          </Card>
        )}
        {r.market.count > 0 && r.market.stats && (
          <Card>
            <CardHeader title="국내 시장가격" description={r.market.platforms.join(', ')} />
            <CardBody className="text-sm">
              <p>최저 {formatMoney(String(r.market.stats.min))} · 중앙 {formatMoney(String(r.market.stats.median))} · 최고 {formatMoney(String(r.market.stats.max))}</p>
              <ul className="mt-2 space-y-1 text-xs">{r.market.items.slice(0, 6).map((m, i) => <li key={i} className="flex justify-between gap-2"><a href={m.url} target="_blank" rel="noopener noreferrer" className="truncate text-ink-soft hover:text-brand">{m.title}</a><span className="shrink-0 tabular">{formatMoney(m.price)}</span></li>)}</ul>
            </CardBody>
          </Card>
        )}
        <ProgressPanel r={r} />
      </div>
      <InternalRecoDialog open={reco} onClose={() => setReco(false)} requestId={r.id} />
      <EstimateDialog cand={estFor} onClose={() => setEstFor(null)} currency={r.currency} quantity={r.input.quantity} />
    </div>
  );
}
