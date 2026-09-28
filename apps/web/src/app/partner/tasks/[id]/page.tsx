'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { TRI_ATTRIBUTE_LABEL_KO } from '@sos/core';
import { api, newIdempotencyKey } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { useToast } from '@/components/providers';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  Field,
  Input,
  KeyValue,
  LoadingBlock,
  PageHeader,
  Select,
  Textarea,
} from '@/components/ui';

interface Product {
  id: string;
  nameKo: string;
  nameEn: string;
  category: string;
  attributes: Record<string, unknown>;
  aiConfidence: number;
  images: Array<string | null>;
  ocrText: string | null;
}
interface Detail {
  id: string;
  kind: string;
  title: string;
  status: string;
  dueAt: string | null;
  projectCode: string | null;
  product?: Product | null;
  check?: {
    id: string;
    aiStatus: string;
    aiConfidence: number;
    reasons: string[];
    missingAttributes: string[];
    verifiedStatus: string | null;
    expertNote: string;
    verifiedCost: string | null;
    certificateNumber: string | null;
  };
  regulation?: {
    code: string;
    name: string;
    authority: string;
    summary: string;
    documentsRequired: string[];
    testsRequired: string[];
    officialSource: string;
  };
  hsCandidates?: Array<{ code: string; description: string; score: number }>;
  hs?: {
    id: string;
    candidates: Array<{ code: string; description: string; score: number; reasons?: string[] }>;
    estimatedHs: string | null;
    estimatedConfidence: number | null;
    verifiedHs: string | null;
    verificationNote: string;
  };
  rfq?: {
    id: string;
    code: string;
    origin: string;
    destination: string;
    incoterm: string;
    cartons: number | null;
    cbm: string | null;
    grossWeightKg: string | null;
    cargoType: string;
    battery: boolean;
    dangerousGoods: boolean;
    readyDate: string | null;
    modes: string[];
    status: string;
  };
  myQuotes?: Array<{
    id: string;
    mode: string;
    currency: string;
    total: string;
    transitDays: string;
    createdAt: string;
  }>;
}

const TRI: Record<string, string> = { TRUE: '예', FALSE: '아니오', UNKNOWN: '모름' };
const ATTR_LABEL: Record<string, string> = {
  brand: '브랜드',
  model: '모델명',
  weight: '무게',
  voltage: '전압',
  wattage: '소비전력',
  material: '재질',
  size: '크기',
  color: '색상',
  capacity: '용량',
  batteryType: '배터리 종류',
  batteryCapacity: '배터리 용량',
  plugType: '플러그',
  power: '전원',
};
const HIDDEN_KEYS = new Set([
  'confidence',
  'category',
  'subcategory',
  'conflicts',
  'nameKo',
  'nameEn',
  'nameZh',
]);

function ProductCard({ p }: { p: Product }) {
  const attrs = Object.entries(p.attributes ?? {}).filter(([k]) => k in TRI_ATTRIBUTE_LABEL_KO);
  const other = Object.entries(p.attributes ?? {}).filter(
    ([k, v]) =>
      !(k in TRI_ATTRIBUTE_LABEL_KO) &&
      !HIDDEN_KEYS.has(k) &&
      v !== null &&
      v !== '' &&
      typeof v !== 'object',
  );
  return (
    <Card>
      <CardHeader
        title="제품 정보"
        description={`AI 신뢰도 ${Math.round(p.aiConfidence * 100)}% · 모르는 값은 ‘모름’으로 표시됩니다`}
      />
      <CardBody className="space-y-4">
        {p.images.some(Boolean) && (
          <div className="flex gap-2 overflow-x-auto">
            {p.images.filter(Boolean).map((u, i) => (
              <img
                key={i}
                src={u!}
                alt={`제품 사진 ${i + 1}`}
                className="h-28 w-28 shrink-0 rounded-lg border border-line object-cover"
              />
            ))}
          </div>
        )}
        <KeyValue
          items={[
            { label: '제품명', value: p.nameKo || '—' },
            { label: '영문명', value: p.nameEn || '—' },
            { label: '분류', value: p.category && p.category !== 'UNKNOWN' ? p.category : '모름' },
            ...other
              .slice(0, 10)
              .map(([k, v]) => ({ label: ATTR_LABEL[k] ?? k, value: v === 'UNKNOWN' ? '모름' : String(v) })),
          ]}
        />
        <div className="flex flex-wrap gap-1.5">
          {attrs.map(([k, v]) => (
            <Badge key={k} tone={v === 'TRUE' ? 'info' : v === 'UNKNOWN' ? 'warn' : 'neutral'}>
              {TRI_ATTRIBUTE_LABEL_KO[k as keyof typeof TRI_ATTRIBUTE_LABEL_KO]}:{' '}
              {TRI[String(v)] ?? String(v)}
            </Badge>
          ))}
        </div>
        {p.ocrText && (
          <details>
            <summary className="cursor-pointer text-xs text-ink-muted">사진 속 글자 (OCR)</summary>
            <p className="mt-2 whitespace-pre-wrap rounded bg-surface-sunken p-2 text-xs">{p.ocrText}</p>
          </details>
        )}
      </CardBody>
    </Card>
  );
}

export default function PartnerTask() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['partner-task', id],
    queryFn: () => api.get<Detail>(`/partner/tasks/${id}`),
  });
  const [f, setF] = useState<Record<string, string>>({});
  const [key] = useState(newIdempotencyKey);
  const set = (k: string) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const start = useMutation({ mutationFn: () => api.post(`/partner/tasks/${id}/start`, {}) });
  useEffect(() => {
    if (q.data?.status === 'OPEN' && !start.isPending && !start.isSuccess) start.mutate();
  }, [q.data?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = useMutation({
    mutationFn: async () => {
      const d = q.data!;
      if (d.kind === 'COMPLIANCE_REVIEW')
        return api.post(`/compliance-checks/${d.check!.id}/review`, {
          status: f.status,
          note: f.note ?? '',
          ...(f.verifiedCost ? { verifiedCost: f.verifiedCost } : {}),
          ...(f.certificateNumber ? { certificateNumber: f.certificateNumber } : {}),
        });
      if (d.kind === 'HS_REVIEW')
        return api.post(`/products/${d.product!.id}/hs/verify`, {
          hsCode: (f.hsCode ?? '').replace(/\D/g, ''),
          note: f.note ?? '',
        });
      if (d.kind === 'FREIGHT_QUOTE')
        return api.post(
          `/freight-rfqs/${d.rfq!.id}/quotes`,
          {
            mode: f.mode,
            currency: f.currency || 'USD',
            freight: f.freight,
            originCharges: f.originCharges || '0',
            destinationCharges: f.destinationCharges || '0',
            customsCharges: f.customsCharges || '0',
            deliveryCharges: f.deliveryCharges || '0',
            transitDays: f.transitDays ?? '',
            ...(f.validUntil ? { validUntil: f.validUntil } : {}),
            note: f.note ?? '',
          },
          { idempotencyKey: `${key}-${f.mode}` },
        );
      throw new Error('지원하지 않는 작업입니다.');
    },
    onSuccess: () => {
      toast.ok('회신했습니다. 감사합니다.');
      void qc.invalidateQueries();
    },
    onError: toast.error,
  });
  if (q.isLoading)
    return (
      <Card className="p-5">
        <LoadingBlock rows={8} />
      </Card>
    );
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const done = d.status === 'SUBMITTED';
  const money = (k: string, label: string) => (
    <Field label={label}>
      <Input
        inputMode="decimal"
        value={f[k] ?? ''}
        onChange={(e) => setF({ ...f, [k]: e.target.value.replace(/[^\d.]/g, '') })}
      />
    </Field>
  );
  return (
    <>
      <PageHeader
        back={
          <Link
            href="/partner"
            className="mb-2 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
          >
            <ChevronLeft className="h-4 w-4" />
            작업 목록
          </Link>
        }
        eyebrow={d.projectCode ?? undefined}
        title={d.title}
        description={d.dueAt ? `기한 ${formatDate(d.dueAt)}` : undefined}
        actions={done ? <Badge tone="ok">회신 완료</Badge> : undefined}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-6">
          {d.product && <ProductCard p={d.product} />}
          {d.regulation && (
            <Card>
              <CardHeader
                title={d.regulation.name}
                description={`${d.regulation.authority} · ${d.regulation.code}`}
              />
              <CardBody className="space-y-3 text-sm">
                <p className="whitespace-pre-wrap text-ink-soft">{d.regulation.summary}</p>
                {d.regulation.documentsRequired.length > 0 && (
                  <p>
                    <span className="text-xs text-ink-muted">필요 서류</span>
                    <br />
                    {d.regulation.documentsRequired.join(', ')}
                  </p>
                )}
                {d.regulation.testsRequired.length > 0 && (
                  <p>
                    <span className="text-xs text-ink-muted">필요 시험</span>
                    <br />
                    {d.regulation.testsRequired.join(', ')}
                  </p>
                )}
                {d.regulation.officialSource && (
                  <p className="text-xs text-ink-muted">근거: {d.regulation.officialSource}</p>
                )}
              </CardBody>
            </Card>
          )}
          {d.rfq && (
            <Card>
              <CardHeader title={`운임 견적 요청 ${d.rfq.code}`} />
              <CardBody>
                <KeyValue
                  items={[
                    { label: '구간', value: `${d.rfq.origin} → ${d.rfq.destination}` },
                    { label: '인코텀즈', value: d.rfq.incoterm },
                    { label: '카톤', value: d.rfq.cartons ?? '—' },
                    { label: 'CBM', value: d.rfq.cbm ?? '—' },
                    { label: '총중량 (kg)', value: d.rfq.grossWeightKg ?? '—' },
                    {
                      label: '화물',
                      value: `${d.rfq.cargoType}${d.rfq.battery ? ' · 배터리 포함' : ''}${d.rfq.dangerousGoods ? ' · 위험물' : ''}`,
                    },
                    { label: '출고 가능일', value: formatDate(d.rfq.readyDate) },
                    { label: '요청 방식', value: d.rfq.modes.join(', ') },
                  ]}
                />
              </CardBody>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          {d.check && (
            <Card>
              <CardHeader title="AI 판단" description="참고용 추정입니다. 전문가 판단으로 확정됩니다." />
              <CardBody className="space-y-2 text-sm">
                <p>
                  <Badge>{d.check.aiStatus}</Badge>{' '}
                  <span className="text-xs text-ink-muted">
                    신뢰도 {Math.round(d.check.aiConfidence * 100)}%
                  </span>
                </p>
                {d.check.reasons.length > 0 && (
                  <ul className="list-inside list-disc text-ink-soft">
                    {d.check.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                )}
                {d.check.missingAttributes.length > 0 && (
                  <Alert tone="warn">
                    확인되지 않은 속성:{' '}
                    {d.check.missingAttributes
                      .map((k) => TRI_ATTRIBUTE_LABEL_KO[k as keyof typeof TRI_ATTRIBUTE_LABEL_KO] ?? k)
                      .join(', ')}
                  </Alert>
                )}
              </CardBody>
            </Card>
          )}
          {d.hs && (
            <Card>
              <CardHeader title="HS 후보 (AI 추정)" description="관세율은 공식 자료 기준으로만 계산됩니다." />
              <CardBody className="space-y-2 text-sm">
                {d.hs.candidates.map((c) => (
                  <button
                    key={c.code}
                    type="button"
                    disabled={done}
                    onClick={() => setF({ ...f, hsCode: c.code })}
                    className={`flex w-full items-start justify-between gap-3 rounded-lg border p-2.5 text-left ${f.hsCode === c.code ? 'border-brand bg-brand/5' : 'border-line hover:bg-surface-sunken'}`}
                  >
                    <span>
                      <span className="font-mono">{c.code}</span>{' '}
                      <span className="text-ink-soft">{c.description}</span>
                    </span>
                    <span className="shrink-0 text-xs text-ink-muted">{Math.round(c.score * 100)}%</span>
                  </button>
                ))}
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title={done ? '회신 내용' : '회신하기'} />
            <CardBody className="space-y-3">
              {done && d.check && (
                <KeyValue
                  items={[
                    { label: '판단', value: d.check.verifiedStatus ?? '—' },
                    { label: '메모', value: d.check.expertNote || '—' },
                    { label: '예상 비용', value: d.check.verifiedCost ?? '—' },
                  ]}
                />
              )}
              {done && d.hs && (
                <KeyValue
                  items={[
                    { label: 'HS 코드', value: d.hs.verifiedHs ?? '—' },
                    { label: '메모', value: d.hs.verificationNote || '—' },
                  ]}
                />
              )}
              {d.kind === 'COMPLIANCE_REVIEW' && !done && (
                <>
                  <Field label="판단" required>
                    <Select value={f.status ?? ''} onChange={set('status')}>
                      <option value="">선택하세요</option>
                      <option value="CONFIRMED">인증 대상입니다</option>
                      <option value="REJECTED">인증 대상이 아닙니다</option>
                      <option value="VERIFIED">확인 완료 (기존 인증 보유 등)</option>
                      <option value="EXPERT_REVIEW_REQUIRED">추가 자료가 필요합니다</option>
                    </Select>
                  </Field>
                  {money('verifiedCost', '예상 인증 비용 (원, 선택)')}
                  <Field label="인증 번호 (보유 시)">
                    <Input value={f.certificateNumber ?? ''} onChange={set('certificateNumber')} />
                  </Field>
                  <Field label="의견" hint="근거나 필요한 추가 자료를 적어 주세요">
                    <Textarea rows={4} value={f.note ?? ''} onChange={set('note')} />
                  </Field>
                </>
              )}
              {d.kind === 'HS_REVIEW' && !done && (
                <>
                  <Field label="HS 코드 (6~10자리)" required>
                    <Input
                      className="font-mono"
                      value={f.hsCode ?? ''}
                      onChange={(e) => setF({ ...f, hsCode: e.target.value.replace(/[^\d.]/g, '') })}
                      placeholder="8414.59-0000"
                    />
                  </Field>
                  <Field label="의견">
                    <Textarea rows={4} value={f.note ?? ''} onChange={set('note')} />
                  </Field>
                </>
              )}
              {d.kind === 'FREIGHT_QUOTE' &&
                d.rfq &&
                d.rfq.status !== 'AWARDED' &&
                d.rfq.status !== 'CANCELLED' && (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="운송 방식" required>
                        <Select value={f.mode ?? ''} onChange={set('mode')}>
                          <option value="">선택</option>
                          {d.rfq.modes.map((m) => (
                            <option key={m}>{m}</option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="통화">
                        <Input
                          maxLength={3}
                          value={f.currency ?? 'USD'}
                          onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })}
                        />
                      </Field>
                      {money('freight', '해상·항공 운임')}
                      {money('originCharges', '출발지 비용')}
                      {money('destinationCharges', '도착지 비용')}
                      {money('customsCharges', '통관 수수료')}
                      {money('deliveryCharges', '국내 운송')}
                      <Field label="운송 기간">
                        <Input
                          value={f.transitDays ?? ''}
                          onChange={set('transitDays')}
                          placeholder="예: 3~5일"
                        />
                      </Field>
                      <Field label="견적 유효일">
                        <Input type="date" value={f.validUntil ?? ''} onChange={set('validUntil')} />
                      </Field>
                    </div>
                    <Field label="조건·메모">
                      <Textarea rows={3} value={f.note ?? ''} onChange={set('note')} />
                    </Field>
                    {d.myQuotes && d.myQuotes.length > 0 && (
                      <p className="text-xs text-ink-muted">
                        보낸 견적: {d.myQuotes.map((x) => `${x.mode} ${x.currency} ${x.total}`).join(' · ')}
                      </p>
                    )}
                  </>
                )}
              {!(done && d.kind !== 'FREIGHT_QUOTE') && (
                <Button
                  className="w-full"
                  loading={submit.isPending}
                  disabled={
                    d.kind === 'COMPLIANCE_REVIEW'
                      ? !f.status
                      : d.kind === 'HS_REVIEW'
                        ? (f.hsCode ?? '').replace(/\D/g, '').length < 6
                        : !f.mode || !f.freight
                  }
                  onClick={() => submit.mutate()}
                >
                  회신 보내기
                </Button>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
