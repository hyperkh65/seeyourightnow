'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, FileUp, Lock, Plus } from 'lucide-react';
import { TRI_ATTRIBUTE_KEYS, TRI_ATTRIBUTE_LABEL_KO } from '@sos/core';
import { api } from '@/lib/api';
import { formatDate, timeAgo } from '@/lib/utils';
import { useCan, useToast } from '@/components/providers';
import { VerificationBadge } from '@/components/status';
import {
  Alert,
  Badge,
  Button,
  Card,
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
  Table,
  Tabs,
  Td,
  Textarea,
  Th,
} from '@/components/ui';

interface Version {
  id: string;
  version: number;
  hsPrefixes: string[];
  triggerAll: string[];
  triggerAny: string[];
  exceptions: string[];
  mandatory: boolean;
  documentsRequired: string[];
  testsRequired: string[];
  expertType: string | null;
  officialSource: string;
  summary: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  changeNote: string;
}
interface Reg {
  id: string;
  code: string;
  name: string;
  authority: string;
  category: string;
  platformManaged: boolean;
  current: Version | null;
  versions: Array<{
    id: string;
    version: number;
    effectiveFrom: string | null;
    changeNote: string;
    createdAt: string;
  }>;
}
interface Impact {
  affectedProducts: number;
  activeQuotations: number;
  openOrders: number;
  quotations: Array<{ id: string; number: string; status: string }>;
  orders: Array<{ id: string; code: string; stage: string }>;
}
interface Task {
  id: string;
  kind: string;
  title: string;
  status: string;
  projectId: string | null;
  dueAt: string | null;
  submittedAt: string | null;
  createdAt: string;
}
interface Tariff {
  id: string;
  hsCode: string;
  rateType: string;
  ratePct: string | null;
  originCountry: string;
  requiresCertificateOfOrigin: boolean;
  source: string;
  verification: string;
  validFrom: string | null;
  validTo: string | null;
  tenantId: string | null;
}

const EXPERT_LABEL: Record<string, string> = {
  CUSTOMS_BROKER: '관세사',
  CERTIFICATION_EXPERT: '인증 전문가',
  ELECTRICAL_SAFETY_LAB: '전기안전 시험소',
  RRA_EMC_LAB: '전파·EMC 시험소',
  MFDS_EXPERT: '식약처 전문가',
  CHEMICAL_SAFETY_EXPERT: '화학제품 전문가',
  FIRE_CERTIFICATION_EXPERT: '소방 인증 전문가',
  FORWARDER: '포워더',
};
const TASK_KIND: Record<string, string> = {
  HS_REVIEW: 'HS 확인',
  COMPLIANCE_REVIEW: '인증 확인',
  FREIGHT_QUOTE: '운임 견적',
  SUPPLIER_RFQ: '공급자 견적',
};
const TASK_STATUS: Record<string, [string, 'neutral' | 'info' | 'ok' | 'warn']> = {
  OPEN: ['대기', 'warn'],
  IN_PROGRESS: ['진행 중', 'info'],
  SUBMITTED: ['회신 완료', 'ok'],
  CANCELLED: ['취소', 'neutral'],
};

type RuleForm = {
  code: string;
  name: string;
  authority: string;
  category: string;
  hsPrefixes: string;
  triggerAll: string[];
  triggerAny: string[];
  exceptions: string[];
  mandatory: boolean;
  documentsRequired: string;
  testsRequired: string;
  expertType: string;
  officialSource: string;
  summary: string;
  effectiveFrom: string;
  changeNote: string;
};
const EMPTY_RULE: RuleForm = {
  code: '',
  name: '',
  authority: '',
  category: '',
  hsPrefixes: '',
  triggerAll: [],
  triggerAny: [],
  exceptions: [],
  mandatory: true,
  documentsRequired: '',
  testsRequired: '',
  expertType: '',
  officialSource: '',
  summary: '',
  effectiveFrom: '',
  changeNote: '',
};
const lines = (v: string) =>
  v
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);

function versionBody(f: RuleForm) {
  return {
    hsPrefixes: lines(f.hsPrefixes),
    triggerAll: f.triggerAll,
    triggerAny: f.triggerAny,
    exceptions: f.exceptions,
    mandatory: f.mandatory,
    documentsRequired: lines(f.documentsRequired),
    testsRequired: lines(f.testsRequired),
    expertType: f.expertType || null,
    officialSource: f.officialSource,
    summary: f.summary,
    ...(f.effectiveFrom ? { effectiveFrom: f.effectiveFrom } : {}),
    changeNote: f.changeNote,
  };
}

function AttrPicker({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <Field label={label} hint={hint} className="sm:col-span-2">
      <div className="flex flex-wrap gap-1.5">
        {TRI_ATTRIBUTE_KEYS.map((k) => {
          const on = value.includes(k);
          return (
            <button
              type="button"
              key={k}
              onClick={() => onChange(on ? value.filter((x) => x !== k) : [...value, k])}
              className={`rounded-full px-2.5 py-1 text-xs ring-1 ring-inset ${on ? 'bg-brand text-brand-fg ring-brand' : 'text-ink-soft ring-line hover:bg-surface-sunken'}`}
              aria-pressed={on}
            >
              {TRI_ATTRIBUTE_LABEL_KO[k]}
            </button>
          );
        })}
      </div>
    </Field>
  );
}

function Regulations() {
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const q = useQuery({ queryKey: ['regulations'], queryFn: () => api.get<{ items: Reg[] }>('/regulations') });
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<null | { mode: 'new' | 'version'; id?: string; f: RuleForm }>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const impactQ = useQuery({
    queryKey: ['reg-impact', open],
    queryFn: () => api.get<Impact>(`/regulations/${open}/impact`),
    enabled: !!open,
  });
  const save = useMutation({
    mutationFn: () =>
      form!.mode === 'new'
        ? api.post('/regulations', {
            code: form!.f.code,
            name: form!.f.name,
            authority: form!.f.authority,
            category: form!.f.category,
            version: versionBody(form!.f),
          })
        : api.post<{ impact: Impact }>(`/regulations/${form!.id}/versions`, versionBody(form!.f)),
    onSuccess: (res) => {
      toast.ok(
        form!.mode === 'new'
          ? '규정을 추가했습니다.'
          : '새 버전을 등록했습니다. 영향받는 제품을 다시 평가합니다.',
      );
      if (res && typeof res === 'object' && 'impact' in res) setImpact((res as { impact: Impact }).impact);
      setForm(null);
      void qc.invalidateQueries({ queryKey: ['regulations'] });
    },
    onError: toast.error,
  });
  const set = (k: keyof RuleForm) => (e: { target: { value: string } }) =>
    setForm((x) => x && { ...x, f: { ...x.f, [k]: e.target.value } });
  const manage = can('compliance.rules.manage');
  if (q.isLoading)
    return (
      <Card className="p-5">
        <LoadingBlock rows={8} />
      </Card>
    );
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const groups = q.data.items.reduce<Record<string, Reg[]>>(
    (a, r) => ({ ...a, [r.category]: [...(a[r.category] ?? []), r] }),
    {},
  );
  const fromVersion = (r: Reg): RuleForm => {
    const v = r.current;
    return {
      ...EMPTY_RULE,
      code: r.code,
      name: r.name,
      authority: r.authority,
      category: r.category,
      ...(v
        ? {
            hsPrefixes: v.hsPrefixes.join(', '),
            triggerAll: v.triggerAll,
            triggerAny: v.triggerAny,
            exceptions: v.exceptions,
            mandatory: v.mandatory,
            documentsRequired: v.documentsRequired.join('\n'),
            testsRequired: v.testsRequired.join('\n'),
            expertType: v.expertType ?? '',
            officialSource: v.officialSource,
            summary: v.summary,
          }
        : {}),
    };
  };
  return (
    <div className="space-y-4">
      <Alert>
        규정은 버전으로 관리됩니다. 새 버전을 등록하면 이전 판단 기록은 그대로 남고, 영향받는 제품·견적·주문을
        알려 드립니다. 규정 판단은 참고용이며 최종 판단은 전문가 확인이 필요합니다.
      </Alert>
      {manage && (
        <Button
          icon={<Plus className="h-4 w-4" />}
          onClick={() => setForm({ mode: 'new', f: { ...EMPTY_RULE } })}
        >
          자체 규정 추가
        </Button>
      )}
      {Object.entries(groups).map(([cat, regs]) => (
        <Card key={cat}>
          <CardHeader title={cat} />
          <ul className="divide-y divide-line">
            {regs.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-surface-sunken"
                  onClick={() => setOpen(open === r.id ? null : r.id)}
                  aria-expanded={open === r.id}
                >
                  {open === r.id ? (
                    <ChevronDown className="h-4 w-4 shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{r.name}</span>{' '}
                    <span className="text-xs text-ink-muted">
                      {r.authority} · {r.code}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-ink-muted">
                    v{r.current?.version ?? '—'}
                    {r.platformManaged ? (
                      <Badge icon={<Lock className="h-3 w-3" />}>플랫폼 관리</Badge>
                    ) : (
                      <Badge tone="brand">자체 규정</Badge>
                    )}
                  </span>
                </button>
                {open === r.id && r.current && (
                  <div className="space-y-4 bg-surface-sunken/50 px-5 py-4 text-sm">
                    <p className="whitespace-pre-wrap">{r.current.summary || '요약 없음'}</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className="text-xs font-medium text-ink-muted">HS 범위</p>
                        <p>{r.current.hsPrefixes.join(', ') || '—'}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-ink-muted">확인 전문가</p>
                        <p>
                          {r.current.expertType
                            ? (EXPERT_LABEL[r.current.expertType] ?? r.current.expertType)
                            : '—'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-ink-muted">모두 해당 시</p>
                        <p>
                          {r.current.triggerAll
                            .map((k) => TRI_ATTRIBUTE_LABEL_KO[k as keyof typeof TRI_ATTRIBUTE_LABEL_KO] ?? k)
                            .join(', ') || '—'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-ink-muted">하나라도 해당 시</p>
                        <p>
                          {r.current.triggerAny
                            .map((k) => TRI_ATTRIBUTE_LABEL_KO[k as keyof typeof TRI_ATTRIBUTE_LABEL_KO] ?? k)
                            .join(', ') || '—'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-ink-muted">필요 서류</p>
                        <p>{r.current.documentsRequired.join(', ') || '—'}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-ink-muted">필요 시험</p>
                        <p>{r.current.testsRequired.join(', ') || '—'}</p>
                      </div>
                    </div>
                    {r.current.officialSource && (
                      <p className="text-xs text-ink-muted">근거: {r.current.officialSource}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                      영향 범위:{' '}
                      {impactQ.data
                        ? `제품 ${impactQ.data.affectedProducts} · 진행 중 견적 ${impactQ.data.activeQuotations} · 진행 중 주문 ${impactQ.data.openOrders}`
                        : '확인 중…'}
                    </div>
                    <details>
                      <summary className="cursor-pointer text-xs text-ink-muted">
                        버전 기록 ({r.versions.length})
                      </summary>
                      <ul className="mt-2 space-y-1 text-xs">
                        {r.versions.map((v) => (
                          <li key={v.id}>
                            v{v.version} · {formatDate(v.createdAt)}
                            {v.effectiveFrom ? ` · 시행 ${v.effectiveFrom}` : ''} · {v.changeNote || '—'}
                          </li>
                        ))}
                      </ul>
                    </details>
                    {manage && !r.platformManaged && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setForm({ mode: 'version', id: r.id, f: fromVersion(r) })}
                      >
                        새 버전 등록
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ))}
      <Dialog
        open={!!form}
        onClose={() => setForm(null)}
        size="xl"
        title={form?.mode === 'new' ? '자체 규정 추가' : '새 규정 버전'}
        description="판단 조건은 제품 속성(예/아니오/모름) 기준입니다. ‘모름’인 속성은 전문가 확인 대상으로 분류됩니다."
        footer={
          <>
            <Button variant="secondary" onClick={() => setForm(null)}>
              취소
            </Button>
            <Button
              loading={save.isPending}
              disabled={!form?.f.name || !form?.f.code}
              onClick={() => save.mutate()}
            >
              저장
            </Button>
          </>
        }
      >
        {form && (
          <div className="grid gap-3 sm:grid-cols-2">
            {form.mode === 'new' && (
              <>
                <Field label="코드" hint="영문 대문자·숫자·밑줄" required>
                  <Input
                    value={form.f.code}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        f: { ...form.f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') },
                      })
                    }
                  />
                </Field>
                <Field label="규정명" required>
                  <Input value={form.f.name} onChange={set('name')} />
                </Field>
                <Field label="관할 기관">
                  <Input value={form.f.authority} onChange={set('authority')} />
                </Field>
                <Field label="분류">
                  <Input value={form.f.category} onChange={set('category')} placeholder="예: 전기·전자" />
                </Field>
              </>
            )}
            <Field label="HS 코드 앞자리 (쉼표 구분)" className="sm:col-span-2">
              <Input value={form.f.hsPrefixes} onChange={set('hsPrefixes')} placeholder="8414, 8516" />
            </Field>
            <AttrPicker
              label="모두 해당할 때"
              hint="선택한 속성이 모두 ‘예’일 때 적용"
              value={form.f.triggerAll}
              onChange={(v) => setForm({ ...form, f: { ...form.f, triggerAll: v } })}
            />
            <AttrPicker
              label="하나라도 해당할 때"
              hint="선택한 속성 중 하나라도 ‘예’면 적용"
              value={form.f.triggerAny}
              onChange={(v) => setForm({ ...form, f: { ...form.f, triggerAny: v } })}
            />
            <AttrPicker
              label="예외"
              hint="해당하면 적용하지 않음"
              value={form.f.exceptions}
              onChange={(v) => setForm({ ...form, f: { ...form.f, exceptions: v } })}
            />
            <Field label="필요 서류 (줄바꿈 구분)">
              <Textarea rows={3} value={form.f.documentsRequired} onChange={set('documentsRequired')} />
            </Field>
            <Field label="필요 시험 (줄바꿈 구분)">
              <Textarea rows={3} value={form.f.testsRequired} onChange={set('testsRequired')} />
            </Field>
            <Field label="확인 전문가">
              <Select value={form.f.expertType} onChange={set('expertType')}>
                <option value="">지정 안 함</option>
                {Object.entries(EXPERT_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="시행일">
              <Input type="date" value={form.f.effectiveFrom} onChange={set('effectiveFrom')} />
            </Field>
            <div className="sm:col-span-2">
              <Checkbox
                checked={form.f.mandatory}
                onChange={(v) => setForm({ ...form, f: { ...form.f, mandatory: v } })}
                label="의무 인증 (수입 전 반드시 필요)"
              />
            </div>
            <Field label="공식 근거 (법령·고시 URL)" className="sm:col-span-2">
              <Input value={form.f.officialSource} onChange={set('officialSource')} />
            </Field>
            <Field label="요약" className="sm:col-span-2">
              <Textarea value={form.f.summary} onChange={set('summary')} />
            </Field>
            <Field label="변경 사유" className="sm:col-span-2">
              <Input value={form.f.changeNote} onChange={set('changeNote')} />
            </Field>
          </div>
        )}
      </Dialog>
      <Dialog
        open={!!impact}
        onClose={() => setImpact(null)}
        title="규정 변경 영향"
        footer={<Button onClick={() => setImpact(null)}>확인</Button>}
      >
        {impact && (
          <div className="space-y-3 text-sm">
            <p>
              제품 {impact.affectedProducts}개 · 진행 중 견적 {impact.activeQuotations}건 · 진행 중 주문{' '}
              {impact.openOrders}건이 영향을 받습니다. 해당 제품은 자동으로 다시 평가됩니다.
            </p>
            {impact.quotations.length > 0 && (
              <ul className="list-inside list-disc">
                {impact.quotations.map((x) => (
                  <li key={x.id}>
                    <Link className="text-brand hover:underline" href={`/admin/quotes/${x.id}`}>
                      {x.number}
                    </Link>{' '}
                    ({x.status})
                  </li>
                ))}
              </ul>
            )}
            {impact.orders.length > 0 && (
              <ul className="list-inside list-disc">
                {impact.orders.map((x) => (
                  <li key={x.id}>
                    <Link className="text-brand hover:underline" href={`/admin/projects/${x.id}`}>
                      {x.code}
                    </Link>{' '}
                    ({x.stage})
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}

function Tariffs() {
  const toast = useToast();
  const can = useCan();
  const qc = useQueryClient();
  const [hs, setHs] = useState('');
  const [query, setQuery] = useState('');
  const [imp, setImp] = useState<null | {
    source: string;
    sourceUrl: string;
    verification: string;
    csv: string;
  }>(null);
  const q = useQuery({
    queryKey: ['tariffs', query],
    queryFn: () => api.get<{ items: Tariff[] }>(`/tariff-rates${query ? `?hsCode=${query}` : ''}`),
  });
  const parsed = (() => {
    if (!imp) return { rows: [], errors: [] as string[] };
    const errors: string[] = [];
    const rows = imp.csv
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !/^hs/i.test(l))
      .map((l, i) => {
        const [hsCode = '', rateType = '', ratePct = '', originCountry = '*', co = ''] = l
          .split(',')
          .map((x) => x.trim());
        if (!/^\d{4,10}$/.test(hsCode) || !rateType || (ratePct !== '' && !/^\d+(\.\d+)?$/.test(ratePct)))
          errors.push(`${i + 1}행: ${l}`);
        return {
          hsCode,
          rateType,
          ratePct: ratePct === '' ? null : ratePct,
          originCountry: originCountry || '*',
          requiresCertificateOfOrigin: /^(y|yes|true|1)$/i.test(co),
        };
      });
    return { rows, errors };
  })();
  const doImport = useMutation({
    mutationFn: () =>
      api.post<{ imported: number }>('/tariff-rates/import', {
        source: imp!.source,
        sourceUrl: imp!.sourceUrl,
        verification: imp!.verification,
        rows: parsed.rows,
      }),
    onSuccess: (r) => {
      toast.ok(`${r.imported}건을 가져왔습니다.`);
      setImp(null);
      void qc.invalidateQueries({ queryKey: ['tariffs'] });
    },
    onError: toast.error,
  });
  return (
    <div className="space-y-4">
      <Alert tone="warn" title="관세율은 AI가 만들지 않습니다">
        관세율은 관세청·관세사 등 공식 출처에서 가져온 값만 사용합니다. 관세율이 없는 HS 코드는 ‘확인 필요’로
        표시되고 원가 계산에서 추정 표시됩니다.
      </Alert>
      <div className="flex flex-wrap gap-2">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(hs.replace(/\D/g, ''));
          }}
        >
          <Input
            className="w-48"
            placeholder="HS 코드 앞자리"
            value={hs}
            onChange={(e) => setHs(e.target.value)}
            aria-label="HS 코드"
          />
          <Button type="submit" variant="secondary">
            조회
          </Button>
        </form>
        {can('compliance.rules.manage') && (
          <Button
            icon={<FileUp className="h-4 w-4" />}
            onClick={() => setImp({ source: '', sourceUrl: '', verification: 'UNVERIFIED', csv: '' })}
          >
            관세율 가져오기
          </Button>
        )}
      </div>
      <Card>
        {q.isLoading ? (
          <LoadingBlock rows={5} />
        ) : q.error ? (
          <ErrorState error={q.error} />
        ) : !q.data?.items.length ? (
          <EmptyState
            title="등록된 관세율이 없습니다"
            description="관세청 품목분류·세율 자료를 CSV로 가져오세요."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>HS</Th>
                <Th>구분</Th>
                <Th className="text-right">세율</Th>
                <Th>원산지</Th>
                <Th>C/O</Th>
                <Th>출처</Th>
                <Th>검증</Th>
                <Th>적용 기간</Th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((t) => (
                <tr key={t.id}>
                  <Td className="font-mono text-xs">{t.hsCode}</Td>
                  <Td className="text-xs">{t.rateType}</Td>
                  <Td className="text-right tabular">{t.ratePct === null ? '—' : `${Number(t.ratePct)}%`}</Td>
                  <Td className="text-xs">{t.originCountry}</Td>
                  <Td className="text-xs">{t.requiresCertificateOfOrigin ? '필요' : '—'}</Td>
                  <Td className="max-w-[200px] truncate text-xs">
                    {t.source}
                    {t.tenantId === null && <Badge className="ml-1">공통</Badge>}
                  </Td>
                  <Td>
                    <VerificationBadge verification={t.verification} />
                  </Td>
                  <Td className="text-xs">
                    {t.validFrom ?? '—'} ~ {t.validTo ?? ''}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Dialog
        open={!!imp}
        onClose={() => setImp(null)}
        size="lg"
        title="관세율 가져오기"
        description="형식: HS코드,세율구분,세율(%),원산지,원산지증명필요(Y/N) — 한 줄에 하나"
        footer={
          <>
            <Button variant="secondary" onClick={() => setImp(null)}>
              취소
            </Button>
            <Button
              loading={doImport.isPending}
              disabled={!imp?.source || !parsed.rows.length || parsed.errors.length > 0}
              onClick={() => doImport.mutate()}
            >
              {parsed.rows.length}건 가져오기
            </Button>
          </>
        }
      >
        {imp && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="출처" required>
              <Input
                value={imp.source}
                onChange={(e) => setImp({ ...imp, source: e.target.value })}
                placeholder="관세청 관세율표 2026"
              />
            </Field>
            <Field label="검증 상태">
              <Select
                value={imp.verification}
                onChange={(e) => setImp({ ...imp, verification: e.target.value })}
              >
                <option value="UNVERIFIED">공식 자료 (내부 미확인)</option>
                <option value="PARTNER_VERIFIED">관세사·파트너 확인</option>
                <option value="EXPERT_VERIFIED">전문가 확인</option>
              </Select>
            </Field>
            <Field label="출처 URL" className="sm:col-span-2">
              <Input value={imp.sourceUrl} onChange={(e) => setImp({ ...imp, sourceUrl: e.target.value })} />
            </Field>
            <Field label="CSV" className="sm:col-span-2">
              <Textarea
                rows={8}
                className="font-mono text-xs"
                value={imp.csv}
                onChange={(e) => setImp({ ...imp, csv: e.target.value })}
                placeholder={'8414590000,BASIC,8,*,N\n8414590000,FTA_KR_CN,0,CN,Y'}
              />
            </Field>
            <label className="text-xs text-ink-muted sm:col-span-2">
              파일에서 읽기{' '}
              <input
                type="file"
                accept=".csv,text/csv"
                className="ml-2 text-xs"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) setImp({ ...imp, csv: await file.text() });
                }}
              />
            </label>
            {parsed.errors.length > 0 && (
              <Alert tone="danger" className="sm:col-span-2" title="형식 오류">
                {parsed.errors.slice(0, 5).join(' / ')}
              </Alert>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}

function Tasks() {
  const q = useQuery({
    queryKey: ['partner-tasks-all'],
    queryFn: () => api.get<{ items: Task[] }>('/partner-tasks'),
  });
  if (q.isLoading)
    return (
      <Card className="p-5">
        <LoadingBlock rows={5} />
      </Card>
    );
  if (q.error || !q.data) return <ErrorState error={q.error} />;
  return (
    <Card>
      {!q.data.items.length ? (
        <EmptyState
          title="전문가 요청이 없습니다"
          description="프로젝트의 인증·통관 탭에서 전문가에게 확인을 요청할 수 있습니다."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>요청</Th>
              <Th>종류</Th>
              <Th>상태</Th>
              <Th>기한</Th>
              <Th>요청일</Th>
            </tr>
          </thead>
          <tbody>
            {q.data.items.map((t) => {
              const overdue = t.dueAt && !t.submittedAt && new Date(t.dueAt) < new Date();
              const [label, tone] = TASK_STATUS[t.status] ?? [t.status, 'neutral'];
              return (
                <tr key={t.id}>
                  <Td>
                    {t.projectId ? (
                      <Link
                        href={`/admin/projects/${t.projectId}?tab=compliance`}
                        className="text-brand hover:underline"
                      >
                        {t.title}
                      </Link>
                    ) : (
                      t.title
                    )}
                  </Td>
                  <Td className="text-xs">{TASK_KIND[t.kind] ?? t.kind}</Td>
                  <Td>
                    <Badge tone={tone}>{label}</Badge>
                  </Td>
                  <Td className={`text-xs ${overdue ? 'font-semibold text-red-600' : ''}`}>
                    {formatDate(t.dueAt)}
                    {overdue ? ' (지남)' : ''}
                  </Td>
                  <Td className="text-xs text-ink-muted">{timeAgo(t.createdAt)}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

export default function CompliancePage() {
  const [tab, setTab] = useState<'rules' | 'tariffs' | 'tasks'>('rules');
  return (
    <>
      <PageHeader
        title="인증·규제"
        description="한국 수입 인증 규정, 관세율, 전문가 확인 요청을 관리합니다."
      />
      <Tabs
        className="mb-6"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'rules', label: '규정' },
          { value: 'tariffs', label: '관세율' },
          { value: 'tasks', label: '전문가 요청' },
        ]}
      />
      {tab === 'rules' && <Regulations />}
      {tab === 'tariffs' && <Tariffs />}
      {tab === 'tasks' && <Tasks />}
    </>
  );
}
