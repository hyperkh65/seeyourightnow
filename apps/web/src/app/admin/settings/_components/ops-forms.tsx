'use client';

import { useQuery } from '@tanstack/react-query';
import {
  DEFAULT_MATCH_WEIGHTS,
  DEFAULT_NUMBER_PATTERNS,
  MATCH_COMPONENTS,
  MATCH_COMPONENT_LABEL_KO,
  formatNumber,
  type PricingDisplaySettings,
} from '@sos/core';
import { api } from '@/lib/api';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Field,
  Input,
  Select,
  Switch,
  Textarea,
} from '@/components/ui';

type P<T> = { v: T; set: (v: T) => void; ro: boolean };
const digits = (s: string) => s.replace(/\D/g, '');
const dec = (s: string) => s.replace(/[^\d.]/g, '');

const LINE_LABEL: Record<string, string> = {
  PRODUCT: '제품 가격',
  INTERNATIONAL_FREIGHT: '국제 운송비',
  DOMESTIC_DELIVERY: '국내 배송비',
  SERVICE: '서비스 수수료',
  DUTY_TAX: '관세',
  VAT: '부가세',
};

export function PricingForm({ v, set, ro }: P<PricingDisplaySettings>) {
  const f = <K extends keyof PricingDisplaySettings>(k: K, val: PricingDisplaySettings[K]) =>
    set({ ...v, [k]: val });
  return (
    <div className="space-y-6">
      <Alert>
        고객에게는 여기서 고른 항목만 보입니다. 공급가·내부 원가·마진은 어떤 설정에서도 고객에게 노출되지
        않습니다.
      </Alert>
      <Card>
        <CardHeader title="고객 가격 표시" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="표시 방식">
            <Select
              disabled={ro}
              value={v.mode}
              onChange={(e) => f('mode', e.target.value as PricingDisplaySettings['mode'])}
            >
              <option value="BREAKDOWN">항목별로 표시</option>
              <option value="TOTAL_ONLY">합계만 표시</option>
            </Select>
          </Field>
          <div className="self-end pb-2">
            <Switch
              disabled={ro}
              checked={v.showEstimatedBadge}
              onChange={(x) => f('showEstimatedBadge', x)}
              label="‘예상 가격’ 표시"
            />
          </div>
          {v.mode === 'BREAKDOWN' && (
            <Field label="표시할 항목" className="sm:col-span-2">
              <div className="flex flex-wrap gap-4">
                {Object.entries(LINE_LABEL).map(([k, l]) => (
                  <Checkbox
                    key={k}
                    checked={v.visibleLines.includes(k as never)}
                    onChange={(x) =>
                      f(
                        'visibleLines',
                        x ? [...v.visibleLines, k as never] : v.visibleLines.filter((y) => y !== k),
                      )
                    }
                    label={l}
                  />
                ))}
              </div>
            </Field>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="계산 기준" />
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <Field label="기준 통화">
            <Input
              disabled={ro}
              maxLength={3}
              value={v.baseCurrency}
              onChange={(e) => f('baseCurrency', e.target.value.toUpperCase())}
            />
          </Field>
          <Field label="부가세율 (%)">
            <Input disabled={ro} value={v.vatPct} onChange={(e) => f('vatPct', dec(e.target.value))} />
          </Field>
          <div className="self-end pb-2">
            <Switch
              disabled={ro}
              checked={v.vatRecoverable}
              onChange={(x) => f('vatRecoverable', x)}
              label="수입 부가세 환급 가능 (원가 제외)"
            />
          </div>
          <Field label="견적 유효기간 (일)">
            <Input
              disabled={ro}
              value={String(v.quoteValidityDays)}
              onChange={(e) =>
                f('quoteValidityDays', Math.min(180, Math.max(1, Number(digits(e.target.value) || 1))))
              }
            />
          </Field>
          <Field label="단가 반올림">
            <Select
              disabled={ro}
              value={v.roundingMode}
              onChange={(e) => f('roundingMode', e.target.value as PricingDisplaySettings['roundingMode'])}
            >
              <option value="UP">올림</option>
              <option value="HALF_UP">반올림</option>
              <option value="HALF_EVEN">은행가 반올림</option>
              <option value="DOWN">버림</option>
            </Select>
          </Field>
          <Field label="반올림 단위 (원)">
            <Input
              disabled={ro}
              value={v.roundingStep}
              onChange={(e) => f('roundingStep', dec(e.target.value))}
            />
          </Field>
          <Field
            label="인증 비용 반영"
            className="sm:col-span-3"
            hint="KC 등 인증 비용을 원가에 어떻게 반영할지 정합니다"
          >
            <Select
              disabled={ro}
              value={v.certificationAllocation}
              onChange={(e) =>
                f(
                  'certificationAllocation',
                  e.target.value as PricingDisplaySettings['certificationAllocation'],
                )
              }
            >
              <option value="FULL_ON_ORDER">이번 주문에 전액 반영</option>
              <option value="AMORTIZE">예상 재주문 수량에 나눠 반영</option>
              <option value="COMPANY_EXPENSE">회사 비용 처리 (원가 제외)</option>
              <option value="CUSTOMER_SEPARATE">고객 별도 청구</option>
            </Select>
          </Field>
          <Field label="기본 결제 조건" className="sm:col-span-3">
            <Input
              disabled={ro}
              value={v.defaultPaymentTerms}
              onChange={(e) => f('defaultPaymentTerms', e.target.value)}
            />
          </Field>
        </CardBody>
      </Card>
    </div>
  );
}

const NUMBER_LABEL: Record<string, string> = {
  PROJECT: '프로젝트',
  QUOTATION: '견적서',
  CONTRACT: '계약서',
  PURCHASE_ORDER: '발주서',
  PROFORMA_INVOICE: 'Proforma Invoice',
  COMMERCIAL_INVOICE: 'Commercial Invoice',
  PACKING_LIST: 'Packing List',
  SALES_INVOICE: '거래명세서',
  RECEIPT: '영수증',
  SHIPPING_NOTICE: '선적 통지',
  DELIVERY_NOTE: '납품서',
  SHIPMENT: '선적',
  RFQ: 'RFQ',
};

export function NumberingForm({ v, set, ro }: P<{ patterns: Record<string, string> }>) {
  const patterns = { ...DEFAULT_NUMBER_PATTERNS, ...v.patterns };
  const sample = (p: string) => {
    try {
      return formatNumber(p, 1, new Date());
    } catch {
      return '형식 오류';
    }
  };
  return (
    <Card>
      <CardHeader
        title="문서 번호 규칙"
        description="{YYYY} 연도, {YY} 두 자리 연도, {MM} 월, {DD} 일, {SEQ:4} 4자리 일련번호. 번호는 발급 후 바뀌지 않습니다."
      />
      <CardBody className="grid gap-3 sm:grid-cols-2">
        {Object.keys(DEFAULT_NUMBER_PATTERNS).map((k) => (
          <Field key={k} label={NUMBER_LABEL[k] ?? k} hint={`예: ${sample(patterns[k] ?? '')}`}>
            <Input
              disabled={ro}
              className="font-mono"
              value={patterns[k]}
              onChange={(e) => set({ patterns: { ...patterns, [k]: e.target.value } })}
            />
          </Field>
        ))}
      </CardBody>
    </Card>
  );
}

type Locale = {
  defaultLocale: 'ko' | 'en' | 'zh';
  enabledLocales: Array<'ko' | 'en' | 'zh'>;
  timezone: string;
};
const LANG: Record<string, string> = { ko: '한국어', en: 'English', zh: '中文' };

export function LocaleForm({ v, set, ro }: P<Locale>) {
  return (
    <Card>
      <CardBody className="grid gap-4 sm:grid-cols-2">
        <Field label="기본 언어">
          <Select
            disabled={ro}
            value={v.defaultLocale}
            onChange={(e) => {
              const d = e.target.value as Locale['defaultLocale'];
              set({
                ...v,
                defaultLocale: d,
                enabledLocales: v.enabledLocales.includes(d) ? v.enabledLocales : [...v.enabledLocales, d],
              });
            }}
          >
            {Object.entries(LANG).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="시간대">
          <Input disabled={ro} value={v.timezone} onChange={(e) => set({ ...v, timezone: e.target.value })} />
        </Field>
        <Field label="사용할 언어" className="sm:col-span-2">
          <div className="flex gap-4">
            {(Object.keys(LANG) as Locale['enabledLocales']).map((k) => (
              <Checkbox
                key={k}
                checked={v.enabledLocales.includes(k)}
                onChange={(x) =>
                  set({
                    ...v,
                    enabledLocales: x
                      ? [...v.enabledLocales, k]
                      : v.enabledLocales.filter((y) => y !== k || y === v.defaultLocale),
                  })
                }
                label={LANG[k]}
              />
            ))}
          </div>
        </Field>
      </CardBody>
    </Card>
  );
}

type Search = {
  anonymousSearchEnabled: boolean;
  anonymousDailyLimitPerIp: number;
  matchWeights: Record<string, number>;
  staleDaysWarning: number;
  priceAnomalyLowRatio: string;
  defaultOrigin: string;
  defaultDestination: string;
};

export function SearchForm({ v, set, ro }: P<Search>) {
  const weights = { ...DEFAULT_MATCH_WEIGHTS, ...v.matchWeights };
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="검색 기본값" />
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <Switch
              disabled={ro}
              checked={v.anonymousSearchEnabled}
              onChange={(x) => set({ ...v, anonymousSearchEnabled: x })}
              label="로그인하지 않은 방문자도 검색 가능"
            />
          </div>
          <Field label="비회원 하루 검색 한도 (IP당)">
            <Input
              disabled={ro}
              value={String(v.anonymousDailyLimitPerIp)}
              onChange={(e) => set({ ...v, anonymousDailyLimitPerIp: Number(digits(e.target.value) || 0) })}
            />
          </Field>
          <Field label="오래된 정보 경고 (일)">
            <Input
              disabled={ro}
              value={String(v.staleDaysWarning)}
              onChange={(e) => set({ ...v, staleDaysWarning: Number(digits(e.target.value) || 1) })}
            />
          </Field>
          <Field label="비정상 저가 기준 (중간가 대비)" hint="0.5 = 중간가의 50% 미만이면 경고">
            <Input
              disabled={ro}
              value={v.priceAnomalyLowRatio}
              onChange={(e) => set({ ...v, priceAnomalyLowRatio: dec(e.target.value) })}
            />
          </Field>
          <Field label="기본 출발항">
            <Input
              disabled={ro}
              value={v.defaultOrigin}
              maxLength={5}
              onChange={(e) => set({ ...v, defaultOrigin: e.target.value.toUpperCase() })}
            />
          </Field>
          <Field label="기본 도착항">
            <Input
              disabled={ro}
              value={v.defaultDestination}
              maxLength={5}
              onChange={(e) => set({ ...v, defaultDestination: e.target.value.toUpperCase() })}
            />
          </Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="추천 점수 가중치"
          description={`항목별 비중입니다. 합계 ${total} (자동으로 비율 환산). 데이터가 없는 항목은 계산에서 빠지고 ‘데이터 충분도’가 낮게 표시됩니다.`}
          action={
            !ro && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => set({ ...v, matchWeights: { ...DEFAULT_MATCH_WEIGHTS } })}
              >
                기본값
              </Button>
            )
          }
        />
        <CardBody className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {MATCH_COMPONENTS.map((k) => (
            <label key={k} className="flex items-center gap-3 text-sm">
              <span className="w-28 shrink-0">{MATCH_COMPONENT_LABEL_KO[k]}</span>
              <input
                type="range"
                min={0}
                max={40}
                disabled={ro}
                value={weights[k]}
                onChange={(e) => set({ ...v, matchWeights: { ...weights, [k]: Number(e.target.value) } })}
                className="flex-1 accent-[rgb(var(--brand))]"
              />
              <span className="w-12 text-right tabular text-ink-muted">
                {total ? Math.round((weights[k] / total) * 100) : 0}%
              </span>
            </label>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

type Ai = {
  primaryText: string | null;
  fallbackText: string | null;
  primaryVision: string | null;
  fallbackVision: string | null;
  embedding: string | null;
  ocr: string | null;
  monthlyTokenBudget: number;
};
interface Conn {
  id: string;
  provider: string;
  label: string;
  category: string;
  enabled: boolean;
  status: string;
}

export function AiForm({ v, set, ro }: P<Ai>) {
  const q = useQuery({
    queryKey: ['connections'],
    queryFn: () => api.get<{ items: Conn[] }>('/admin/connections'),
  });
  const ai = (q.data?.items ?? []).filter((c) => c.category === 'AI');
  const llm = ai.filter((c) => c.provider !== 'AI_WORKER');
  const worker = ai.filter((c) => c.provider === 'AI_WORKER');
  const pick = (k: keyof Ai, label: string, list: Conn[], hint?: string) => (
    <Field label={label} hint={hint}>
      <Select
        disabled={ro}
        value={(v[k] as string | null) ?? ''}
        onChange={(e) => set({ ...v, [k]: e.target.value || null })}
      >
        <option value="">{list.length ? '자동 (연결된 순서대로)' : '연결된 제공자 없음'}</option>
        {list.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
            {c.enabled ? '' : ' (꺼짐)'}
            {c.status === 'CONNECTED' ? '' : ` · ${c.status}`}
          </option>
        ))}
      </Select>
    </Field>
  );
  return (
    <div className="space-y-6">
      {!q.isLoading && ai.length === 0 && (
        <Alert tone="warn" title="연결된 AI 제공자가 없습니다">
          설정 → API 연결에서 Groq 등 AI 제공자를 먼저 연결하세요. 연결 전에는 텍스트 분석이 제한되고, 결과에
          ‘AI 미연결’로 표시됩니다.
        </Alert>
      )}
      <Card>
        <CardHeader
          title="AI 라우팅"
          description="기본 제공자가 3번 연속 실패하면 5분 동안 대체 제공자를 사용합니다."
        />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          {pick('primaryText', '텍스트 — 기본', llm)}
          {pick('fallbackText', '텍스트 — 대체', llm)}
          {pick('primaryVision', '이미지 이해 — 기본', llm, '비전 모델이 설정된 제공자')}
          {pick('fallbackVision', '이미지 이해 — 대체', llm)}
          {pick('embedding', '이미지·텍스트 임베딩', worker, '자체 AI 워커')}
          {pick('ocr', 'OCR', worker, '자체 AI 워커')}
          <Field label="월 토큰 예산" hint="0이면 제한 없음. 초과 시 관리자에게 알림">
            <Input
              disabled={ro}
              value={String(v.monthlyTokenBudget)}
              onChange={(e) => set({ ...v, monthlyTokenBudget: Number(digits(e.target.value) || 0) })}
            />
          </Field>
        </CardBody>
      </Card>
    </div>
  );
}

type Notif = {
  emailEnabled: boolean;
  staffAlertEmails: string[];
  senderName: string;
  senderEmail: string;
  replyTo: string;
};

export function NotificationsForm({ v, set, ro }: P<Notif>) {
  return (
    <Card>
      <CardBody className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Switch
            disabled={ro}
            checked={v.emailEnabled}
            onChange={(x) => set({ ...v, emailEnabled: x })}
            label="이메일 알림 사용"
          />
        </div>
        <Field label="보내는 사람 이름">
          <Input
            disabled={ro}
            value={v.senderName}
            onChange={(e) => set({ ...v, senderName: e.target.value })}
          />
        </Field>
        <Field label="보내는 주소" hint="SMTP 연결에 등록된 도메인이어야 합니다">
          <Input
            disabled={ro}
            type="email"
            value={v.senderEmail}
            onChange={(e) => set({ ...v, senderEmail: e.target.value })}
          />
        </Field>
        <Field label="회신 주소">
          <Input
            disabled={ro}
            type="email"
            value={v.replyTo}
            onChange={(e) => set({ ...v, replyTo: e.target.value })}
          />
        </Field>
        <Field label="내부 알림 받을 주소" hint="한 줄에 하나" className="sm:col-span-2">
          <Textarea
            disabled={ro}
            rows={3}
            value={v.staffAlertEmails.join('\n')}
            onChange={(e) =>
              set({
                ...v,
                staffAlertEmails: e.target.value
                  .split(/[\n,]/)
                  .map((x) => x.trim())
                  .filter(Boolean),
              })
            }
          />
        </Field>
      </CardBody>
    </Card>
  );
}

type Privacy = {
  retentionDaysAnonymousSearch: number;
  retentionDaysClosedProjects: number;
  anonymizeInactiveCustomersDays: number;
};

export function PrivacyForm({ v, set, ro }: P<Privacy>) {
  const n = (k: keyof Privacy, label: string, hint: string) => (
    <Field label={label} hint={hint}>
      <Input
        disabled={ro}
        value={String(v[k])}
        onChange={(e) => set({ ...v, [k]: Number(digits(e.target.value) || 0) })}
      />
    </Field>
  );
  return (
    <Card>
      <CardHeader
        title="보관 기간"
        description="기간이 지난 데이터는 매일 새벽 자동으로 삭제되거나 익명 처리됩니다. 계약·세금 관련 문서는 법정 보관 기간을 따릅니다."
      />
      <CardBody className="grid gap-4 sm:grid-cols-3">
        {n('retentionDaysAnonymousSearch', '비회원 검색 기록 (일)', '1~3650일')}
        {n('retentionDaysClosedProjects', '종료된 프로젝트 (일)', '30~3650일')}
        {n('anonymizeInactiveCustomersDays', '비활성 고객 익명 처리 (일)', '30~3650일')}
      </CardBody>
    </Card>
  );
}
