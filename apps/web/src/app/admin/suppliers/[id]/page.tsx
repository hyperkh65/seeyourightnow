'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Pencil, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate, formatMoney, timeAgo } from '@/lib/utils';
import { useCan, useToast } from '@/components/providers';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  KeyValue,
  LoadingBlock,
  PageHeader,
  Select,
  Stat,
  Table,
  Td,
  Textarea,
  Th,
} from '@/components/ui';
import {
  SOURCE_TYPE_LABEL,
  SupplierForm,
  fromSupplier,
  toSupplierBody,
  type SupplierFormState,
} from '../supplier-form';

interface Detail {
  id: string;
  name: string;
  nameLocal: string;
  alias: string;
  visibility: string;
  sourceType: string;
  businessType: string;
  country: string;
  province: string;
  city: string;
  address: string;
  nearestPort: string;
  yearsInBusiness: number | null;
  businessVerified: boolean | null;
  verificationNote: string;
  typicalMoq: number | null;
  oemSupported: boolean | null;
  riskFlags: string[];
  blacklisted: boolean;
  blacklistReason: string;
  internalNotes: string;
  metrics: {
    orderCount?: number;
    sampleCount?: number;
    claimCount?: number;
    refundCount?: number;
    lateDeliveryCount?: number;
    qualityScore?: number;
    communicationScore?: number;
  };
  contacts: Array<{
    id: string;
    name: string;
    role: string;
    phone: string;
    email: string;
    wechat: string;
    whatsapp: string;
  }>;
  events: Array<{
    id: string;
    kind: string;
    rating: number | null;
    amount: string | null;
    currency: string | null;
    note: string;
    occurredAt: string;
  }>;
  listings: Array<{
    id: string;
    title: string;
    currency: string;
    supplierListPrice: string | null;
    supplierVerifiedPrice: string | null;
    moq: number | null;
    lastCheckedAt: string;
    sourceType: string;
  }>;
  priceHistory: Array<{
    id: string;
    listingId: string;
    unitPrice: string;
    currency: string;
    observedAt: string;
  }>;
}

const EVENT_KIND: Record<string, string> = {
  SAMPLE: '샘플',
  ORDER: '주문',
  QUALITY_ISSUE: '품질 문제',
  LATE_DELIVERY: '납기 지연',
  CLAIM: '클레임',
  REFUND: '환불',
  COMMUNICATION: '커뮤니케이션',
  PRICE_CHANGE: '가격 변동',
};

export default function SupplierDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const q = useQuery({ queryKey: ['supplier', id], queryFn: () => api.get<Detail>(`/suppliers/${id}`) });
  const [edit, setEdit] = useState<SupplierFormState | null>(null);
  const [modal, setModal] = useState<null | 'event' | 'contact' | 'listing' | 'price'>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const refresh = () => void qc.invalidateQueries({ queryKey: ['supplier', id] });
  const save = useMutation({
    mutationFn: () => api.patch(`/suppliers/${id}`, toSupplierBody(edit!)),
    onSuccess: () => {
      toast.ok('저장했습니다.');
      setEdit(null);
      refresh();
    },
    onError: toast.error,
  });
  const submit = useMutation({
    mutationFn: async () => {
      if (modal === 'event')
        return api.post(`/suppliers/${id}/events`, {
          kind: f.kind,
          note: f.note ?? '',
          ...(f.rating ? { rating: Number(f.rating) } : {}),
          ...(f.amount ? { amount: f.amount, currency: f.currency || 'CNY' } : {}),
        });
      if (modal === 'contact')
        return api.post(`/suppliers/${id}/contacts`, {
          name: f.name,
          role: f.role ?? '',
          phone: f.phone ?? '',
          email: f.email ?? '',
          wechat: f.wechat ?? '',
          whatsapp: f.whatsapp ?? '',
        });
      if (modal === 'listing')
        return api.post(`/suppliers/${id}/listings`, {
          title: f.title,
          titleKo: f.titleKo ?? '',
          model: f.model ?? '',
          currency: f.currency || 'CNY',
          priceTiers: [{ minQty: Number(f.minQty || 1), unitPrice: f.unitPrice }],
          ...(f.moq ? { moq: Number(f.moq) } : {}),
          ...(f.leadTimeDays ? { leadTimeDays: Number(f.leadTimeDays) } : {}),
          packaging: Object.fromEntries(
            Object.entries({
              unitsPerCarton: f.unitsPerCarton ? Number(f.unitsPerCarton) : undefined,
              cartonL: f.cartonL,
              cartonW: f.cartonW,
              cartonH: f.cartonH,
              cartonGw: f.cartonGw,
            }).filter(([, v]) => v !== undefined && v !== ''),
          ),
        });
      if (modal === 'price')
        return api.patch(`/listings/${f.listingId}`, {
          ...(f.supplierVerifiedPrice ? { supplierVerifiedPrice: f.supplierVerifiedPrice } : {}),
          ...(f.actualPurchasePrice ? { actualPurchasePrice: f.actualPurchasePrice } : {}),
        });
    },
    onSuccess: () => {
      toast.ok('저장했습니다.');
      setModal(null);
      refresh();
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
  const s = q.data;
  const m = s.metrics;
  const writable = can('supplier.write');
  const secret = can('supplier.secret');
  return (
    <>
      <PageHeader
        back={
          <Link
            href="/admin/suppliers"
            className="mb-2 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
          >
            <ChevronLeft className="h-4 w-4" />
            공급처
          </Link>
        }
        eyebrow={SOURCE_TYPE_LABEL[s.sourceType] ?? s.sourceType}
        title={s.name}
        description={[s.nameLocal, s.city, s.province].filter(Boolean).join(' · ')}
        actions={
          writable &&
          secret && (
            <Button
              variant="secondary"
              icon={<Pencil className="h-4 w-4" />}
              onClick={() => setEdit(fromSupplier(s as unknown as Record<string, unknown>))}
            >
              정보 수정
            </Button>
          )
        }
      />
      {s.blacklisted && (
        <Alert tone="danger" className="mb-6" title="거래 제한 공급처">
          {s.blacklistReason || '사유 미기재'} — 검색 결과와 추천에서 제외됩니다.
        </Alert>
      )}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="주문" value={m.orderCount ?? 0} />
        <Stat label="샘플" value={m.sampleCount ?? 0} />
        <Stat label="클레임" value={m.claimCount ?? 0} />
        <Stat label="납기 지연" value={m.lateDeliveryCount ?? 0} />
        <Stat
          label="품질 점수"
          value={m.qualityScore !== undefined ? Math.round(m.qualityScore * 100) : '—'}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="기본 정보" />
            <CardBody>
              <KeyValue
                items={[
                  {
                    label: '고객 표시',
                    value:
                      s.visibility === 'VISIBLE'
                        ? '상호 공개'
                        : s.visibility === 'HIDDEN'
                          ? '숨김'
                          : `별칭: ${s.alias || '—'}`,
                  },
                  {
                    label: '업체 유형',
                    value:
                      s.businessType === 'FACTORY'
                        ? '제조 공장'
                        : s.businessType === 'TRADING'
                          ? '무역회사'
                          : '확인 안 됨',
                  },
                  { label: '업력', value: s.yearsInBusiness ? `${s.yearsInBusiness}년` : '—' },
                  {
                    label: '사업자 확인',
                    value:
                      s.businessVerified === null ? '확인 안 됨' : s.businessVerified ? '확인됨' : '불일치',
                  },
                  { label: '일반 MOQ', value: s.typicalMoq ?? '—' },
                  {
                    label: 'OEM',
                    value: s.oemSupported === null ? '모름' : s.oemSupported ? '가능' : '불가',
                  },
                  { label: '가까운 항구', value: s.nearestPort || '—' },
                  {
                    label: '주소',
                    value: s.address || (secret ? '—' : '권한 없음'),
                    hide: !secret && !s.address,
                  },
                ]}
              />
              {s.riskFlags.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1">
                  {s.riskFlags.map((r) => (
                    <Badge key={r} tone="warn">
                      {r}
                    </Badge>
                  ))}
                </div>
              )}
              {s.internalNotes && (
                <p className="mt-4 whitespace-pre-wrap rounded-lg bg-surface-sunken p-3 text-sm">
                  {s.internalNotes}
                </p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="담당자"
              description={secret ? undefined : '담당자 연락처는 권한이 있는 사용자만 볼 수 있습니다.'}
              action={
                secret && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setF({});
                      setModal('contact');
                    }}
                  >
                    추가
                  </Button>
                )
              }
            />
            <CardBody className="space-y-3">
              {s.contacts.length === 0 ? (
                <p className="text-sm text-ink-muted">등록된 담당자가 없습니다.</p>
              ) : (
                s.contacts.map((c) => (
                  <div key={c.id} className="text-sm">
                    <b>{c.name}</b> <span className="text-ink-muted">{c.role}</span>
                    <div className="text-xs text-ink-muted">
                      {[
                        c.phone,
                        c.email,
                        c.wechat && `WeChat ${c.wechat}`,
                        c.whatsapp && `WhatsApp ${c.whatsapp}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="상품"
              action={
                writable && (
                  <Button
                    size="sm"
                    icon={<Plus className="h-4 w-4" />}
                    onClick={() => {
                      setF({ currency: 'CNY', minQty: '1' });
                      setModal('listing');
                    }}
                  >
                    상품 등록
                  </Button>
                )
              }
            />
            {s.listings.length === 0 ? (
              <EmptyState title="등록된 상품이 없습니다" className="py-8" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>상품</Th>
                    <Th className="text-right">표시가</Th>
                    <Th className="text-right">확인가</Th>
                    <Th>MOQ</Th>
                    <Th>확인</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {s.listings.map((l) => (
                    <tr key={l.id}>
                      <Td className="max-w-[240px] truncate text-sm">{l.title}</Td>
                      <Td className="text-right text-xs tabular">
                        {l.supplierListPrice ? formatMoney(l.supplierListPrice, l.currency) : '—'}
                      </Td>
                      <Td className="text-right text-xs tabular">
                        {l.supplierVerifiedPrice ? formatMoney(l.supplierVerifiedPrice, l.currency) : '—'}
                      </Td>
                      <Td className="text-xs">{l.moq ?? '—'}</Td>
                      <Td className="text-xs text-ink-muted">{timeAgo(l.lastCheckedAt)}</Td>
                      <Td>
                        {writable && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setF({ listingId: l.id, supplierVerifiedPrice: l.supplierVerifiedPrice ?? '' });
                              setModal('price');
                            }}
                          >
                            가격
                          </Button>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          <Card>
            <CardHeader
              title="거래 이력"
              description="주문·클레임·지연 이력은 추천 점수와 리스크에 반영됩니다."
              action={
                writable && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setF({ kind: 'ORDER' });
                      setModal('event');
                    }}
                  >
                    기록 추가
                  </Button>
                )
              }
            />
            {s.events.length === 0 ? (
              <EmptyState title="거래 이력이 없습니다" className="py-8" />
            ) : (
              <ul className="divide-y divide-line">
                {s.events.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
                    <div>
                      <Badge
                        tone={
                          ['QUALITY_ISSUE', 'CLAIM', 'LATE_DELIVERY', 'REFUND'].includes(e.kind)
                            ? 'warn'
                            : 'neutral'
                        }
                      >
                        {EVENT_KIND[e.kind] ?? e.kind}
                      </Badge>{' '}
                      <span className="ml-1">{e.note}</span>
                      {e.amount && (
                        <span className="ml-2 text-xs text-ink-muted">
                          {formatMoney(e.amount, e.currency ?? 'CNY')}
                        </span>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-ink-muted">{formatDate(e.occurredAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {s.priceHistory.length > 0 && (
            <Card>
              <CardHeader title="가격 변동 기록" />
              <Table>
                <thead>
                  <tr>
                    <Th>시점</Th>
                    <Th>상품</Th>
                    <Th className="text-right">단가</Th>
                  </tr>
                </thead>
                <tbody>
                  {s.priceHistory.slice(0, 30).map((h) => (
                    <tr key={h.id}>
                      <Td className="text-xs">{formatDate(h.observedAt)}</Td>
                      <Td className="max-w-[240px] truncate text-xs">
                        {s.listings.find((l) => l.id === h.listingId)?.title}
                      </Td>
                      <Td className="text-right text-xs tabular">{formatMoney(h.unitPrice, h.currency)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </div>
      </div>

      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        size="lg"
        title="공급처 정보 수정"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEdit(null)}>
              취소
            </Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              저장
            </Button>
          </>
        }
      >
        {edit && <SupplierForm f={edit} onChange={setEdit} />}
      </Dialog>
      <Dialog
        open={!!modal}
        onClose={() => setModal(null)}
        size={modal === 'listing' ? 'lg' : 'md'}
        title={
          { event: '거래 이력 추가', contact: '담당자 추가', listing: '상품 등록', price: '가격 업데이트' }[
            modal ?? 'event'
          ]
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>
              취소
            </Button>
            <Button loading={submit.isPending} onClick={() => submit.mutate()}>
              저장
            </Button>
          </>
        }
      >
        {modal === 'event' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="종류">
              <Select value={f.kind} onChange={set('kind')}>
                {Object.entries(EVENT_KIND).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="평가 (0~5, 선택)">
              <Input value={f.rating ?? ''} onChange={set('rating')} />
            </Field>
            <Field label="금액 (선택)">
              <Input
                value={f.amount ?? ''}
                onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })}
              />
            </Field>
            <Field label="통화">
              <Input value={f.currency ?? 'CNY'} maxLength={3} onChange={set('currency')} />
            </Field>
            <Field label="내용" className="sm:col-span-2">
              <Textarea value={f.note ?? ''} onChange={set('note')} />
            </Field>
          </div>
        )}
        {modal === 'contact' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="이름" required>
              <Input value={f.name ?? ''} onChange={set('name')} />
            </Field>
            <Field label="직책">
              <Input value={f.role ?? ''} onChange={set('role')} />
            </Field>
            <Field label="전화">
              <Input value={f.phone ?? ''} onChange={set('phone')} />
            </Field>
            <Field label="이메일">
              <Input value={f.email ?? ''} onChange={set('email')} />
            </Field>
            <Field label="WeChat">
              <Input value={f.wechat ?? ''} onChange={set('wechat')} />
            </Field>
            <Field label="WhatsApp">
              <Input value={f.whatsapp ?? ''} onChange={set('whatsapp')} />
            </Field>
          </div>
        )}
        {modal === 'listing' && (
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="상품명 (원문)" required className="sm:col-span-4">
              <Input value={f.title ?? ''} onChange={set('title')} />
            </Field>
            <Field label="한국어 상품명" className="sm:col-span-2">
              <Input value={f.titleKo ?? ''} onChange={set('titleKo')} />
            </Field>
            <Field label="모델명" className="sm:col-span-2">
              <Input value={f.model ?? ''} onChange={set('model')} />
            </Field>
            <Field label="통화">
              <Input value={f.currency ?? 'CNY'} maxLength={3} onChange={set('currency')} />
            </Field>
            <Field label="단가" required>
              <Input
                value={f.unitPrice ?? ''}
                onChange={(e) => setF({ ...f, unitPrice: e.target.value.replace(/[^\d.]/g, '') })}
              />
            </Field>
            <Field label="적용 최소 수량">
              <Input value={f.minQty ?? '1'} onChange={set('minQty')} />
            </Field>
            <Field label="MOQ">
              <Input value={f.moq ?? ''} onChange={set('moq')} />
            </Field>
            <Field label="생산 기간 (일)">
              <Input value={f.leadTimeDays ?? ''} onChange={set('leadTimeDays')} />
            </Field>
            <Field label="카톤 입수">
              <Input value={f.unitsPerCarton ?? ''} onChange={set('unitsPerCarton')} />
            </Field>
            <Field label="카톤 총중량 (kg)">
              <Input value={f.cartonGw ?? ''} onChange={set('cartonGw')} />
            </Field>
            <Field label="카톤 크기 L/W/H (cm)">
              <div className="grid grid-cols-3 gap-1">
                <Input value={f.cartonL ?? ''} onChange={set('cartonL')} aria-label="길이" />
                <Input value={f.cartonW ?? ''} onChange={set('cartonW')} aria-label="너비" />
                <Input value={f.cartonH ?? ''} onChange={set('cartonH')} aria-label="높이" />
              </div>
            </Field>
          </div>
        )}
        {modal === 'price' && (
          <div className="space-y-3">
            <Field label="공급자 확인 가격" hint="변경 시 이 상품이 들어간 진행 중 견적에 알림이 갑니다">
              <Input
                value={f.supplierVerifiedPrice ?? ''}
                onChange={(e) => setF({ ...f, supplierVerifiedPrice: e.target.value.replace(/[^\d.]/g, '') })}
              />
            </Field>
            <Field label="실제 구매 가격">
              <Input
                value={f.actualPurchasePrice ?? ''}
                onChange={(e) => setF({ ...f, actualPurchasePrice: e.target.value.replace(/[^\d.]/g, '') })}
              />
            </Field>
          </div>
        )}
      </Dialog>
    </>
  );
}
