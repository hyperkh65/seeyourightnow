'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Check,
  CircleDashed,
  Clock,
  FileText,
  Loader2,
  PackageCheck,
  ShieldCheck,
  Sparkles,
  Store,
  TrendingUp,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn, formatMoney, formatNumber } from '@/lib/utils';
import { useMe } from '@/components/providers';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Progress,
  Skeleton,
} from '@/components/ui';
import { PriceBadge, RISK_DIMENSION_LABEL, RiskBadge } from '@/components/status';

type Step = { status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'SKIPPED'; message?: string | null };
interface StatusRes {
  id: string;
  status: string;
  progress: Record<string, Step>;
  projectId: string | null;
}
interface Cand {
  id: string;
  title: string;
  image: string | null;
  supplier: string;
  source: string;
  moq: number | null;
  leadTimeDays: number | null;
  score: number;
  tags: Array<{ key: string; label: string }>;
  reasons: string[];
  cautions: string[];
  estimatedUnitPrice: string | null;
  priceBadge: string;
  pinned: boolean;
  customerNote: string;
  isDevMock: boolean;
}
interface ResultRes {
  audience: 'CUSTOMER' | 'ANONYMOUS' | 'STAFF';
  id: string;
  status: string;
  projectId: string | null;
  currency: string;
  input: { query: string; url: string; quantity: number | null; images: string[] };
  product: null | {
    nameKo: string;
    nameEn: string;
    category: string;
    confidence: number;
    attributes: Record<string, unknown> | null;
    risk: { overall: string; items: Array<{ dimension: string; level: string; reasons: string[] }> } | null;
    requiredDocuments: string[];
  };
  best: Cand | null;
  candidates: Cand[];
  compliance: Array<{
    code: string;
    name: string;
    authority: string;
    label: string;
    tone: string;
    reasons: string[];
  }>;
  complianceUnknownCount?: number;
  market: {
    stats: null | {
      count: number;
      min: number;
      median: number;
      avg: number;
      max: number;
      p25: number;
      p75: number;
      histogram: Array<{ from: number; to: number; count: number }>;
    };
    count: number;
    platforms: string[];
    items: Array<{ platform: string; title: string; price: string | null; url: string; isDevMock: boolean }>;
  };
  tariff: { hsVerified: boolean; dutyKnown: boolean };
  estimate: null | { unitPrice: string; badge: string; note: string };
}

const STEPS: Array<{ key: string; label: string; running: string }> = [
  { key: 'analyze', label: '제품 분석', running: '제품을 분석하고 있습니다.' },
  { key: 'search', label: '공급처 검색', running: '공급처를 찾고 있습니다.' },
  { key: 'market', label: '국내 시장가격', running: '국내 판매가격을 확인하고 있습니다.' },
  { key: 'hs', label: '관세 분류', running: 'HS 코드 후보를 찾고 있습니다.' },
  { key: 'compliance', label: '인증 확인', running: '필요한 인증을 확인하고 있습니다.' },
  { key: 'cost', label: '도착가격 계산', running: '운임·관세를 포함한 가격을 계산하고 있습니다.' },
];

function Progressive({ status }: { status: StatusRes }) {
  const done = STEPS.filter((s) =>
    ['DONE', 'SKIPPED', 'FAILED'].includes(status.progress[s.key]?.status ?? ''),
  ).length;
  return (
    <Card className="overflow-hidden">
      <div className="bg-gradient-to-br from-brand/10 to-transparent px-5 py-5 sm:px-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-brand">
          <Sparkles className="h-4 w-4" /> AI가 분석하고 있어요
        </div>
        <p className="mt-1 text-xs text-ink-muted">
          보통 몇 초면 첫 결과가 나옵니다. 이 화면을 닫아도 분석은 계속됩니다.
        </p>
        <Progress className="mt-4" value={(done / STEPS.length) * 100} />
      </div>
      <ul className="divide-y divide-line">
        {STEPS.map((s) => {
          const st = status.progress[s.key]?.status ?? 'PENDING';
          return (
            <li key={s.key} className="flex items-start gap-3 px-5 py-3 sm:px-6">
              <span
                className={cn(
                  'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                  st === 'DONE'
                    ? 'bg-emerald-500 text-white'
                    : st === 'RUNNING'
                      ? 'text-brand'
                      : st === 'FAILED'
                        ? 'bg-amber-500 text-white'
                        : 'text-ink-muted',
                )}
              >
                {st === 'DONE' ? (
                  <Check className="h-3.5 w-3.5" />
                ) : st === 'RUNNING' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : st === 'FAILED' ? (
                  <AlertTriangle className="h-3 w-3" />
                ) : (
                  <CircleDashed className="h-4 w-4" />
                )}
              </span>
              <div className="min-w-0">
                <p className={cn('text-sm font-medium', st === 'PENDING' ? 'text-ink-muted' : 'text-ink')}>
                  {st === 'RUNNING' ? s.running : s.label}
                </p>
                {status.progress[s.key]?.message && st !== 'RUNNING' && (
                  <p className="mt-0.5 text-xs text-ink-muted">{status.progress[s.key]!.message}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function CandidateCard({ c, currency, highlight }: { c: Cand; currency: string; highlight?: boolean }) {
  return (
    <div
      className={cn(
        'flex gap-4 rounded-2xl border bg-surface p-4 shadow-card',
        highlight ? 'border-brand/40 ring-2 ring-brand/10' : 'border-line',
      )}
    >
      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-line bg-surface-sunken">
        {c.image ? (
          <img
            src={c.image}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-ink-muted">
            <Store className="h-6 w-6" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {c.tags.map((t) => (
            <Badge
              key={t.key}
              tone={
                t.key === 'BEST_MATCH'
                  ? 'brand'
                  : t.key === 'PRIVATE_NETWORK_RECOMMENDED'
                    ? 'purple'
                    : 'neutral'
              }
            >
              {t.label}
            </Badge>
          ))}
          {c.isDevMock && <Badge tone="warn">개발용 모의 데이터</Badge>}
        </div>
        <p className="mt-1.5 line-clamp-2 text-sm font-medium text-ink">{c.title}</p>
        <p className="mt-0.5 text-xs text-ink-muted">
          {c.supplier} · {c.source}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft">
          <span>MOQ {c.moq ? formatNumber(c.moq) : '확인 필요'}</span>
          <span>납기 {c.leadTimeDays ? `${c.leadTimeDays}일` : '확인 필요'}</span>
          <span>적합도 {Math.round(c.score)}점</span>
        </div>
        {c.reasons.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-xs text-ink-muted">
            {c.reasons.slice(0, 3).map((r) => (
              <li key={r} className="flex gap-1.5">
                <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                {r}
              </li>
            ))}
          </ul>
        )}
        {c.cautions.length > 0 && (
          <p className="mt-2 flex gap-1.5 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            {c.cautions[0]}
          </p>
        )}
        {c.customerNote && (
          <p className="mt-2 rounded-lg bg-brand/5 px-2.5 py-1.5 text-xs text-ink-soft">{c.customerNote}</p>
        )}
      </div>
      <div className="hidden shrink-0 text-right sm:block">
        <div className="text-xs text-ink-muted">예상 도착가 (개당)</div>
        <div className="mt-0.5 text-lg font-bold tabular">
          {c.estimatedUnitPrice ? formatMoney(c.estimatedUnitPrice, currency) : '계산 중'}
        </div>
        {c.estimatedUnitPrice && (
          <div className="mt-1">
            <PriceBadge badge={c.priceBadge} />
          </div>
        )}
      </div>
    </div>
  );
}

function MarketHistogram({ stats }: { stats: NonNullable<ResultRes['market']['stats']> }) {
  const max = Math.max(...stats.histogram.map((h) => h.count), 1);
  return (
    <div>
      <div className="flex h-24 items-end gap-1.5" aria-label="국내 판매가격 분포">
        {stats.histogram.map((h, i) => (
          <div
            key={i}
            className="flex flex-1 flex-col items-center gap-1"
            title={`${formatMoney(String(h.from))} ~ ${formatMoney(String(h.to))}: ${h.count}개`}
          >
            <div
              className="w-full rounded-t-md bg-brand/70"
              style={{ height: `${Math.max(4, (h.count / max) * 88)}px` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-ink-muted tabular">
        <span>{formatMoney(String(stats.min))}</span>
        <span>{formatMoney(String(stats.max))}</span>
      </div>
    </div>
  );
}

function ResultPage() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const me = useMe();
  const token = sp.get('t') ?? '';
  const q = token ? `?token=${encodeURIComponent(token)}` : '';

  const status = useQuery({
    queryKey: ['req-status', id],
    queryFn: () => api.get<StatusRes>(`/sourcing/requests/${id}/status${q}`),
    refetchInterval: (query) => (query.state.data?.status === 'READY' || query.state.error ? false : 1500),
  });
  const ready = status.data?.status === 'READY';
  const analyzeDone = status.data?.progress.search?.status === 'DONE';
  const result = useQuery({
    queryKey: ['req-result', id, ready, analyzeDone],
    queryFn: () => api.get<ResultRes>(`/sourcing/requests/${id}/result${q}`),
    enabled: !!status.data && (ready || analyzeDone),
  });

  useEffect(() => {
    if (result.data?.audience === 'STAFF' && result.data.projectId)
      router.replace(`/admin/projects/${result.data.projectId}`);
  }, [result.data, router]);

  const r = result.data;
  const user = me.data?.user;
  const signupHref = useMemo(() => `/signup?claim=${id}&t=${encodeURIComponent(token)}`, [id, token]);

  if (status.error) {
    const notFound = status.error instanceof ApiError && status.error.status === 404;
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <EmptyState
          icon={<AlertTriangle className="h-5 w-5" />}
          title={notFound ? '검색 결과를 찾을 수 없습니다' : '결과를 불러오지 못했습니다'}
          description={notFound ? '링크가 만료되었거나 다른 계정의 요청입니다.' : String(status.error)}
          action={
            <Link href="/search">
              <Button>새로 검색하기</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          {/* Summary */}
          <Card>
            <CardBody className="flex flex-col gap-5 sm:flex-row">
              <div className="h-32 w-32 shrink-0 overflow-hidden rounded-2xl border border-line bg-surface-sunken">
                {r?.input.images[0] ? (
                  <img src={r.input.images[0]} alt="검색한 제품" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-ink-muted">
                    <PackageCheck className="h-8 w-8" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                {r?.product ? (
                  <>
                    <p className="text-xs font-medium text-ink-muted">
                      {r.product.category !== 'UNKNOWN' ? r.product.category : '분석한 제품'}
                    </p>
                    <h1 className="mt-0.5 text-xl font-bold tracking-tight sm:text-2xl">
                      {r.product.nameKo}
                    </h1>
                    {r.product.nameEn && <p className="text-sm text-ink-muted">{r.product.nameEn}</p>}
                  </>
                ) : (
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-6 w-64" />
                  </div>
                )}
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div>
                    <div className="text-xs text-ink-muted">예상 한국 도착가</div>
                    <div className="mt-0.5 text-lg font-bold tabular text-brand">
                      {r?.estimate
                        ? formatMoney(r.estimate.unitPrice, r.currency)
                        : ready
                          ? '견적 시 안내'
                          : '계산 중'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-ink-muted">MOQ</div>
                    <div className="mt-0.5 text-lg font-bold tabular">
                      {r?.best?.moq ? formatNumber(r.best.moq) : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-ink-muted">생산 납기</div>
                    <div className="mt-0.5 text-lg font-bold tabular">
                      {r?.best?.leadTimeDays ? `${r.best.leadTimeDays}일` : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-ink-muted">국내 판매가 범위</div>
                    <div className="mt-0.5 text-[15px] font-bold tabular">
                      {r?.market.stats
                        ? `${formatMoney(String(r.market.stats.p25))}~${formatMoney(String(r.market.stats.p75), 'KRW', { symbol: false })}`
                        : '—'}
                    </div>
                  </div>
                </div>
                {r?.estimate && <p className="mt-3 text-xs text-ink-muted">{r.estimate.note}</p>}
              </div>
            </CardBody>
          </Card>

          {!ready && status.data && <Progressive status={status.data} />}

          {/* Best match */}
          {r?.best && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold">
                <BadgeCheck className="h-4 w-4 text-brand" /> 가장 적합한 공급처
              </h2>
              <CandidateCard c={r.best} currency={r.currency} highlight />
            </section>
          )}

          {r && r.candidates.length > 1 && (
            <section>
              <h2 className="mb-3 text-[15px] font-semibold">다른 공급처 비교</h2>
              <div className="space-y-3">
                {r.candidates
                  .filter((c) => c.id !== r.best?.id)
                  .slice(0, 8)
                  .map((c) => (
                    <CandidateCard key={c.id} c={c} currency={r.currency} />
                  ))}
              </div>
              <p className="mt-3 text-xs text-ink-muted">
                적합도는 이미지·스펙·목표가·MOQ·공급자 신뢰도·납기 등을 종합한 점수이며, 최저가만으로 추천하지
                않습니다.
              </p>
            </section>
          )}
          {ready && r && r.candidates.length === 0 && (
            <Card>
              <EmptyState
                icon={<Store className="h-5 w-5" />}
                title="아직 맞는 공급처를 찾지 못했습니다"
                description="담당자가 자체 공급망과 직접 견적 요청으로 찾아드릴 수 있습니다."
                action={
                  user ? undefined : (
                    <Link href={signupHref}>
                      <Button>담당자에게 요청하기</Button>
                    </Link>
                  )
                }
              />
            </Card>
          )}

          {/* Market */}
          {r && (
            <Card>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-brand" /> 국내 시장가격
                  </span>
                }
                description={
                  r.market.count
                    ? `${r.market.platforms.join(', ')} · ${r.market.count}개 상품 기준`
                    : undefined
                }
              />
              <CardBody>
                {r.market.stats ? (
                  <div className="grid gap-6 sm:grid-cols-[1fr_1.2fr]">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      {[
                        ['최저', r.market.stats.min],
                        ['중앙값', r.market.stats.median],
                        ['평균', r.market.stats.avg],
                        ['최고', r.market.stats.max],
                      ].map(([l, v]) => (
                        <div key={l as string} className="rounded-xl bg-surface-sunken p-3">
                          <div className="text-xs text-ink-muted">{l}</div>
                          <div className="mt-0.5 font-bold tabular">{formatMoney(String(v))}</div>
                        </div>
                      ))}
                    </div>
                    <MarketHistogram stats={r.market.stats} />
                  </div>
                ) : (
                  <p className="text-sm text-ink-muted">
                    {ready
                      ? '국내 시장가격 데이터가 아직 연결되지 않았습니다. 담당자가 견적 시 함께 안내해 드립니다.'
                      : '확인 중입니다.'}
                  </p>
                )}
              </CardBody>
            </Card>
          )}
        </div>

        {/* Right rail */}
        <aside className="space-y-4">
          <Card className="lg:sticky lg:top-20">
            <CardBody className="space-y-4">
              <div>
                <p className="text-sm font-semibold">정확한 견적 받기</p>
                <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                  운임·관세·인증 비용은 협력사 확인을 거쳐 견적서에서 확정해 드립니다.
                </p>
              </div>
              {user?.audience === 'CUSTOMER' && r?.projectId ? (
                <Link href={`/portal/projects/${r.projectId}`}>
                  <Button className="w-full">
                    내 소싱에서 진행 상황 보기 <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              ) : user ? null : (
                <>
                  <Link href={signupHref}>
                    <Button className="w-full">가입하고 견적 요청하기</Button>
                  </Link>
                  <Link
                    href={`/login?claim=${id}&t=${encodeURIComponent(token)}`}
                    className="block text-center text-xs text-ink-muted hover:text-ink"
                  >
                    이미 계정이 있어요
                  </Link>
                </>
              )}
            </CardBody>
          </Card>

          {r?.compliance && (
            <Card>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-brand" /> 필요한 인증·규제
                  </span>
                }
              />
              <CardBody className="space-y-3">
                {r.compliance.length === 0 && !r.complianceUnknownCount && (
                  <p className="text-sm text-ink-muted">
                    {ready ? '확인이 필요한 인증 후보가 없습니다.' : '확인 중입니다.'}
                  </p>
                )}
                {r.compliance.map((c) => (
                  <div key={c.code} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-ink-muted">{c.authority}</p>
                    </div>
                    <Badge tone={c.tone === 'warn' ? 'warn' : c.tone === 'ok' ? 'ok' : 'info'}>
                      {c.label}
                    </Badge>
                  </div>
                ))}
                {!!r.complianceUnknownCount && (
                  <p className="text-xs text-ink-muted">
                    그 밖에 제품 정보가 더 필요한 항목 {r.complianceUnknownCount}건은 전문가가 확인합니다.
                  </p>
                )}
                <p className="border-t border-line pt-3 text-[11px] text-ink-muted">
                  AI와 규칙으로 찾은 후보이며, 최종 판단은 인증 전문가가 합니다.
                </p>
              </CardBody>
            </Card>
          )}

          {r?.product?.risk && r.product.risk.items.length > 0 && (
            <Card>
              <CardHeader title="확인할 점" />
              <CardBody className="space-y-3">
                {r.product.risk.items.slice(0, 5).map((i) => (
                  <div key={i.dimension} className="text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{RISK_DIMENSION_LABEL[i.dimension] ?? i.dimension}</span>
                      <RiskBadge level={i.level} />
                    </div>
                    <p className="mt-0.5 text-xs text-ink-muted">{i.reasons.join(' · ')}</p>
                  </div>
                ))}
              </CardBody>
            </Card>
          )}

          {r?.product && r.product.requiredDocuments.length > 0 && (
            <Card>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-brand" /> 준비하면 좋은 서류
                  </span>
                }
              />
              <CardBody>
                <ul className="space-y-1.5 text-sm text-ink-soft">
                  {r.product.requiredDocuments.slice(0, 8).map((d) => (
                    <li key={d} className="flex gap-2">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-muted" />
                      {d}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
          {r && !r.tariff.hsVerified && (
            <Alert tone="info">
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" /> 관세율은 관세사 확인 후 견적에 반영됩니다.
              </span>
            </Alert>
          )}
        </aside>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <ResultPage />
    </Suspense>
  );
}
