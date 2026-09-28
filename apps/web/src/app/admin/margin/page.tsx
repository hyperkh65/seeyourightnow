'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Plus, Rocket, Save, Trash2 } from 'lucide-react';
import {
  MARGIN_SCOPES,
  MARGIN_SCOPE_LABEL_KO,
  type MarginConfig,
  type MarginRule,
  type MarginScope,
} from '@sos/core';
import { api } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/utils';
import { useCan, useToast } from '@/components/providers';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Select,
  Stat,
  Switch,
  Table,
  Td,
  Th,
} from '@/components/ui';

interface MarginRes {
  current: { id: string | null; version: number; config: MarginConfig; rules: MarginRule[] };
  draft: null | { id: string; version: number; config: MarginConfig; rules: MarginRule[]; note: string };
  history: Array<{
    id: string;
    version: number;
    status: string;
    note: string;
    publishedAt: string | null;
    createdAt: string;
  }>;
}
interface Sim {
  sampleCount: number;
  before: { revenue: string; profit: string; averageUnitPrice: string; marginPct: string | null };
  after: { revenue: string; profit: string; averageUnitPrice: string; marginPct: string | null };
  delta: { revenue: string; profit: string; averageUnitPrice: string };
  note: string;
}

const COMPONENTS: Record<string, string> = {
  PRODUCT: '제품',
  FREIGHT: '운임',
  INSPECTION: '검품',
  SERVICE: '서비스',
  DOMESTIC_DELIVERY: '국내 배송',
};
const ROUNDING: Record<string, string> = {
  UP: '올림',
  HALF_UP: '반올림',
  HALF_EVEN: '은행가 반올림',
  DOWN: '버림',
  CEIL: '올림(음수 포함)',
  FLOOR: '내림(음수 포함)',
};
const SOURCE: Record<string, string> = {
  PUBLIC_MARKET: '공개 마켓',
  PRIVATE_NETWORK: '자체 공급망',
  DIRECT_FACTORY: '직거래 공장',
  LOCAL_PARTNER: '현지 파트너',
  INTERNAL_PRODUCT: '자사 제품',
  RFQ_RESULT: 'RFQ 회신',
  MANUAL_PROPOSAL: '수동 제안',
  CUSTOMER_NOMINATED: '고객 지정',
};
const pct = /^-?\d+(\.\d+)?$/;

function matchSummary(r: MarginRule): string {
  const m = r.match;
  const parts = [
    m.category && `카테고리=${m.category}`,
    m.subcategory && `세부=${m.subcategory}`,
    m.hsPrefix && `HS ${m.hsPrefix}*`,
    m.sourceType && SOURCE[m.sourceType],
    m.supplierId && `공급자 ${m.supplierId.slice(0, 8)}`,
    (m.costMin || m.costMax) && `원가 ${m.costMin ?? 0}~${m.costMax ?? '∞'}원`,
    (m.qtyMin || m.qtyMax) && `수량 ${m.qtyMin ?? 0}~${m.qtyMax ?? '∞'}`,
    m.belowMoq && 'MOQ 미만',
    m.riskLevels?.length && `리스크 ${m.riskLevels.join('/')}`,
    m.customerTier && `고객 ${m.customerTier}`,
  ].filter(Boolean);
  return parts.join(' · ') || '조건 없음 (전체)';
}

function RuleDialog({
  rule,
  onSave,
  onClose,
}: {
  rule: MarginRule | null;
  onSave: (r: MarginRule) => void;
  onClose: () => void;
}) {
  const [r, setR] = useState<MarginRule | null>(rule);
  useEffect(() => setR(rule), [rule]);
  if (!r) return null;
  const m = r.match;
  const setM = (patch: Partial<MarginRule['match']>) =>
    setR({
      ...r,
      match: Object.fromEntries(
        Object.entries({ ...m, ...patch }).filter(
          ([, v]) => v !== '' && v !== undefined && !(Array.isArray(v) && !v.length),
        ),
      ) as MarginRule['match'],
    });
  const valid =
    r.name.trim() &&
    pct.test(r.markupPct) &&
    (!r.minMarkupPct || pct.test(r.minMarkupPct)) &&
    (!r.maxMarkupPct || pct.test(r.maxMarkupPct));
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="마진 규칙"
      description="‘지정’ 규칙은 가장 구체적인 범위 하나만 적용되고, ‘가산’ 규칙은 해당하는 만큼 더해집니다."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
          <Button disabled={!valid} onClick={() => onSave(r)}>
            적용
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="규칙 이름" required className="sm:col-span-2">
          <Input value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} />
        </Field>
        <Field label="적용 범위">
          <Select value={r.scope} onChange={(e) => setR({ ...r, scope: e.target.value as MarginScope })}>
            {MARGIN_SCOPES.map((s) => (
              <option key={s} value={s}>
                {MARGIN_SCOPE_LABEL_KO[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="대상 항목">
          <Select
            value={r.component}
            onChange={(e) => setR({ ...r, component: e.target.value as MarginRule['component'] })}
          >
            <option value="ALL">전체</option>
            {Object.entries(COMPONENTS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="방식">
          <Select value={r.action} onChange={(e) => setR({ ...r, action: e.target.value as 'SET' | 'ADD' })}>
            <option value="SET">지정</option>
            <option value="ADD">가산</option>
          </Select>
        </Field>
        <Field label="마진율 (%)" required>
          <Input
            value={r.markupPct}
            onChange={(e) => setR({ ...r, markupPct: e.target.value.replace(/[^\d.-]/g, '') })}
          />
        </Field>
        <Field label="최소 (%)">
          <Input
            value={r.minMarkupPct ?? ''}
            onChange={(e) =>
              setR({ ...r, minMarkupPct: e.target.value.replace(/[^\d.-]/g, '') || undefined })
            }
          />
        </Field>
        <Field label="최대 (%)">
          <Input
            value={r.maxMarkupPct ?? ''}
            onChange={(e) =>
              setR({ ...r, maxMarkupPct: e.target.value.replace(/[^\d.-]/g, '') || undefined })
            }
          />
        </Field>
        <Field label="우선순위" hint="같은 범위 안에서 높은 값이 우선">
          <Input
            value={String(r.priority)}
            onChange={(e) => setR({ ...r, priority: Number(e.target.value.replace(/[^\d-]/g, '') || 0) })}
          />
        </Field>
        <p className="text-xs font-semibold text-ink-muted sm:col-span-3">적용 조건</p>
        <Field label="카테고리">
          <Input value={m.category ?? ''} onChange={(e) => setM({ category: e.target.value })} />
        </Field>
        <Field label="세부 카테고리">
          <Input value={m.subcategory ?? ''} onChange={(e) => setM({ subcategory: e.target.value })} />
        </Field>
        <Field label="HS 앞자리">
          <Input
            value={m.hsPrefix ?? ''}
            onChange={(e) => setM({ hsPrefix: e.target.value.replace(/\D/g, '') })}
          />
        </Field>
        <Field label="공급 경로">
          <Select
            value={m.sourceType ?? ''}
            onChange={(e) =>
              setM({ sourceType: (e.target.value || undefined) as MarginRule['match']['sourceType'] })
            }
          >
            <option value="">전체</option>
            {Object.entries(SOURCE).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="원가 이상 (원)">
          <Input
            value={m.costMin ?? ''}
            onChange={(e) => setM({ costMin: e.target.value.replace(/[^\d.]/g, '') })}
          />
        </Field>
        <Field label="원가 미만 (원)">
          <Input
            value={m.costMax ?? ''}
            onChange={(e) => setM({ costMax: e.target.value.replace(/[^\d.]/g, '') })}
          />
        </Field>
        <Field label="수량 이상">
          <Input
            value={m.qtyMin?.toString() ?? ''}
            onChange={(e) =>
              setM({ qtyMin: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : undefined })
            }
          />
        </Field>
        <Field label="수량 미만">
          <Input
            value={m.qtyMax?.toString() ?? ''}
            onChange={(e) =>
              setM({ qtyMax: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : undefined })
            }
          />
        </Field>
        <Field label="고객 등급">
          <Input
            value={m.customerTier ?? ''}
            onChange={(e) => setM({ customerTier: e.target.value })}
            placeholder="VIP"
          />
        </Field>
        <Field label="리스크 등급" className="sm:col-span-2">
          <div className="flex flex-wrap gap-3">
            {(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map((lv) => (
              <Checkbox
                key={lv}
                checked={!!m.riskLevels?.includes(lv)}
                onChange={(v) =>
                  setM({
                    riskLevels: v
                      ? [...(m.riskLevels ?? []), lv]
                      : (m.riskLevels ?? []).filter((x) => x !== lv),
                  })
                }
                label={lv}
              />
            ))}
          </div>
        </Field>
        <div className="self-end pb-2">
          <Checkbox
            checked={!!m.belowMoq}
            onChange={(v) => setM({ belowMoq: v || undefined })}
            label="MOQ 미만 주문"
          />
        </div>
      </div>
    </Dialog>
  );
}

export default function MarginPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const q = useQuery({ queryKey: ['margin'], queryFn: () => api.get<MarginRes>('/admin/margin') });
  const [config, setConfig] = useState<MarginConfig | null>(null);
  const [rules, setRules] = useState<MarginRule[]>([]);
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState<{ idx: number; rule: MarginRule } | null>(null);
  const [sim, setSim] = useState<Sim | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  useEffect(() => {
    if (!q.data || dirty) return;
    const src = q.data.draft ?? q.data.current;
    setConfig(src.config);
    setRules(src.rules);
    setNote(q.data.draft?.note ?? '');
  }, [q.data, dirty]);
  const manage = can('margin.manage');
  const body = () => ({ config: config!, rules });
  const saveDraft = useMutation({
    mutationFn: () => api.put('/admin/margin/draft', { ...body(), note }),
    onSuccess: () => {
      toast.ok('초안을 저장했습니다. 게시 전까지 견적에는 반영되지 않습니다.');
      setDirty(false);
      void qc.invalidateQueries({ queryKey: ['margin'] });
    },
    onError: toast.error,
  });
  const simulate = useMutation({
    mutationFn: () => api.post<Sim>('/admin/margin/simulate', { ...body(), sampleSize: 100 }),
    onSuccess: setSim,
    onError: toast.error,
  });
  const publish = useMutation({
    mutationFn: async () => {
      await api.put('/admin/margin/draft', { ...body(), note });
      return api.post<{ version: number }>('/admin/margin/publish', {});
    },
    onSuccess: (r) => {
      toast.ok(`v${r.version}을 게시했습니다. 새 원가 계산부터 적용됩니다.`);
      setConfirmPublish(false);
      setDirty(false);
      void qc.invalidateQueries({ queryKey: ['margin'] });
    },
    onError: toast.error,
  });
  if (q.isLoading || (q.data && !config))
    return (
      <Card className="p-5">
        <LoadingBlock rows={8} />
      </Card>
    );
  if (q.error || !q.data || !config) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const touch = () => setDirty(true);
  const setDefault = (k: keyof MarginConfig['defaults'], v: string) => {
    setConfig({ ...config, defaults: { ...config.defaults, [k]: v } });
    touch();
  };
  const newRule = (): MarginRule => ({
    id: `r${Date.now().toString(36)}`,
    name: '',
    scope: 'CATEGORY',
    component: 'PRODUCT',
    action: 'SET',
    markupPct: '15',
    priority: 0,
    active: true,
    match: {},
  });
  const allValid = Object.values(config.defaults).every((v) => pct.test(v));
  return (
    <>
      <PageHeader
        title="마진·가격"
        description={`게시 중: v${d.current.version || '기본값'}${d.draft ? ` · 초안 v${d.draft.version} 편집 중` : ''}`}
        actions={
          manage && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                icon={<FlaskConical className="h-4 w-4" />}
                loading={simulate.isPending}
                disabled={!allValid}
                onClick={() => simulate.mutate()}
              >
                시뮬레이션
              </Button>
              <Button
                variant="secondary"
                icon={<Save className="h-4 w-4" />}
                loading={saveDraft.isPending}
                disabled={!allValid}
                onClick={() => saveDraft.mutate()}
              >
                초안 저장
              </Button>
              <Button
                icon={<Rocket className="h-4 w-4" />}
                disabled={!allValid}
                onClick={() => setConfirmPublish(true)}
              >
                게시
              </Button>
            </div>
          )
        }
      />
      <Alert className="mb-6">
        마진은 내부 정보이며 고객 화면과 고객용 API에는 절대 노출되지 않습니다. 변경은 초안 → 시뮬레이션 →
        게시 순으로 진행되고, 게시 시 추가 인증이 필요합니다. 이미 발행된 견적 가격은 바뀌지 않습니다.
      </Alert>
      {dirty && (
        <Alert tone="warn" className="mb-6">
          저장하지 않은 변경이 있습니다.
        </Alert>
      )}
      {sim && (
        <Card className="mb-6">
          <CardHeader
            title="시뮬레이션 결과"
            description={sim.note}
            action={
              <Button size="sm" variant="ghost" onClick={() => setSim(null)}>
                닫기
              </Button>
            }
          />
          <CardBody className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat
              label="매출 (현재 → 변경)"
              value={formatMoney(sim.after.revenue, 'KRW')}
              hint={`현재 ${formatMoney(sim.before.revenue, 'KRW')}`}
            />
            <Stat
              label="이익 변화"
              value={`${sim.delta.profit.startsWith('-') ? '' : '+'}${formatMoney(sim.delta.profit, 'KRW')}`}
              hint={`현재 ${formatMoney(sim.before.profit, 'KRW')}`}
            />
            <Stat
              label="마진율"
              value={`${sim.after.marginPct ?? '—'}%`}
              hint={`현재 ${sim.before.marginPct ?? '—'}%`}
            />
            <Stat
              label="평균 단가 변화"
              value={formatMoney(sim.delta.averageUnitPrice, 'KRW')}
              hint={`표본 ${sim.sampleCount}건`}
            />
          </CardBody>
        </Card>
      )}
      <div className="grid gap-6 xl:grid-cols-[1fr_1.6fr]">
        <Card>
          <CardHeader title="기본 마진" description="규칙에 해당하지 않을 때 적용합니다." />
          <CardBody className="grid gap-3 sm:grid-cols-2">
            {(Object.keys(COMPONENTS) as Array<keyof MarginConfig['defaults']>).map((k) => (
              <Field
                key={k}
                label={`${COMPONENTS[k]} (%)`}
                error={pct.test(config.defaults[k]) ? null : '숫자를 입력하세요'}
              >
                <Input
                  disabled={!manage}
                  value={config.defaults[k]}
                  onChange={(e) => setDefault(k, e.target.value.replace(/[^\d.-]/g, ''))}
                />
              </Field>
            ))}
            <Field label="전체 최소 (%)">
              <Input
                disabled={!manage}
                value={config.globalMinMarkupPct ?? ''}
                onChange={(e) => {
                  setConfig({
                    ...config,
                    globalMinMarkupPct: e.target.value.replace(/[^\d.-]/g, '') || undefined,
                  });
                  touch();
                }}
              />
            </Field>
            <Field label="전체 최대 (%)">
              <Input
                disabled={!manage}
                value={config.globalMaxMarkupPct ?? ''}
                onChange={(e) => {
                  setConfig({
                    ...config,
                    globalMaxMarkupPct: e.target.value.replace(/[^\d.-]/g, '') || undefined,
                  });
                  touch();
                }}
              />
            </Field>
            <Field label="단가 반올림">
              <Select
                disabled={!manage}
                value={config.rounding.mode}
                onChange={(e) => {
                  setConfig({
                    ...config,
                    rounding: {
                      ...config.rounding,
                      mode: e.target.value as MarginConfig['rounding']['mode'],
                    },
                  });
                  touch();
                }}
              >
                {Object.entries(ROUNDING).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="반올림 단위 (원)">
              <Input
                disabled={!manage}
                value={config.rounding.step ?? ''}
                onChange={(e) => {
                  setConfig({
                    ...config,
                    rounding: {
                      ...config.rounding,
                      step: e.target.value.replace(/[^\d.]/g, '') || undefined,
                    },
                  });
                  touch();
                }}
              />
            </Field>
            <div className="sm:col-span-2">
              <Switch
                checked={config.taxPassThrough}
                disabled={!manage}
                onChange={(v) => {
                  setConfig({ ...config, taxPassThrough: v });
                  touch();
                }}
                label="관세·부가세는 마진 없이 원가 그대로 반영"
              />
            </div>
            <Field label="변경 메모" className="sm:col-span-2">
              <Input
                disabled={!manage}
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  touch();
                }}
                placeholder="예: 소형가전 마진 조정"
              />
            </Field>
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title={`규칙 ${rules.length}개`}
            action={
              manage && (
                <Button
                  size="sm"
                  icon={<Plus className="h-4 w-4" />}
                  onClick={() => setEditing({ idx: -1, rule: newRule() })}
                >
                  규칙 추가
                </Button>
              )
            }
          />
          {rules.length === 0 ? (
            <EmptyState
              title="규칙이 없습니다"
              description="카테고리·공급 경로·수량·리스크별로 마진을 다르게 설정할 수 있습니다."
              className="py-10"
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>규칙</Th>
                  <Th>범위</Th>
                  <Th className="text-right">마진</Th>
                  <Th>사용</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rules.map((r, i) => (
                  <tr key={r.id} className={r.active ? '' : 'opacity-50'}>
                    <Td>
                      <button
                        type="button"
                        className="text-left font-medium text-brand hover:underline disabled:text-ink"
                        disabled={!manage}
                        onClick={() => setEditing({ idx: i, rule: r })}
                      >
                        {r.name}
                      </button>
                      <div className="text-xs text-ink-muted">{matchSummary(r)}</div>
                    </Td>
                    <Td className="text-xs">
                      {MARGIN_SCOPE_LABEL_KO[r.scope]} ·{' '}
                      {r.component === 'ALL' ? '전체' : COMPONENTS[r.component]}
                    </Td>
                    <Td className="text-right tabular">
                      <Badge tone={r.action === 'ADD' ? 'info' : 'neutral'}>
                        {r.action === 'ADD' ? '+' : '='}
                        {r.markupPct}%
                      </Badge>
                    </Td>
                    <Td>
                      <Switch
                        checked={r.active}
                        disabled={!manage}
                        onChange={(v) => {
                          setRules(rules.map((x, j) => (j === i ? { ...x, active: v } : x)));
                          touch();
                        }}
                        label={<span className="sr-only">{r.name} 사용</span>}
                      />
                    </Td>
                    <Td>
                      {manage && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="삭제"
                          onClick={() => {
                            setRules(rules.filter((_, j) => j !== i));
                            touch();
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
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
      <Card className="mt-6">
        <CardHeader title="버전 기록" />
        <Table>
          <thead>
            <tr>
              <Th>버전</Th>
              <Th>상태</Th>
              <Th>메모</Th>
              <Th>게시일</Th>
            </tr>
          </thead>
          <tbody>
            {d.history.map((h) => (
              <tr key={h.id}>
                <Td>v{h.version}</Td>
                <Td>
                  <Badge tone={h.status === 'PUBLISHED' ? 'ok' : h.status === 'DRAFT' ? 'warn' : 'neutral'}>
                    {h.status === 'PUBLISHED' ? '게시 중' : h.status === 'DRAFT' ? '초안' : '보관'}
                  </Badge>
                </Td>
                <Td className="text-sm">{h.note || '—'}</Td>
                <Td className="text-xs">{formatDate(h.publishedAt ?? h.createdAt, true)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <RuleDialog
        rule={editing?.rule ?? null}
        onClose={() => setEditing(null)}
        onSave={(r) => {
          setRules(editing!.idx < 0 ? [...rules, r] : rules.map((x, j) => (j === editing!.idx ? r : x)));
          setEditing(null);
          touch();
        }}
      />
      <Dialog
        open={confirmPublish}
        onClose={() => setConfirmPublish(false)}
        title="마진 규칙 게시"
        description="게시 후 새로 계산되는 원가·견적부터 적용됩니다. 변경 내용은 감사 로그에 남습니다."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmPublish(false)}>
              취소
            </Button>
            <Button loading={publish.isPending} onClick={() => publish.mutate()}>
              게시
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-soft">게시 전에 시뮬레이션으로 영향을 확인하는 것을 권장합니다.</p>
      </Dialog>
    </>
  );
}
