'use client';

import { Field, Input, Select, Textarea } from '@/components/ui';

export interface CompanyFormState {
  name: string;
  businessNumber: string;
  ceo: string;
  address: string;
  industry: string;
  categories: string;
  taxInvoiceEmail: string;
  paymentTerms: string;
  tier: string;
  creditLevel: string;
  warnings: string;
  targetMarginPct: string;
  preferredFreight: string;
}

export const EMPTY_COMPANY: CompanyFormState = {
  name: '',
  businessNumber: '',
  ceo: '',
  address: '',
  industry: '',
  categories: '',
  taxInvoiceEmail: '',
  paymentTerms: '',
  tier: 'STANDARD',
  creditLevel: 'NORMAL',
  warnings: '',
  targetMarginPct: '',
  preferredFreight: '',
};

const list = (v: string) =>
  v
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

export function toCompanyBody(f: CompanyFormState) {
  return {
    name: f.name.trim(),
    businessNumber: f.businessNumber,
    ceo: f.ceo,
    address: f.address,
    industry: f.industry,
    categories: list(f.categories),
    taxInvoiceEmail: f.taxInvoiceEmail,
    paymentTerms: f.paymentTerms,
    tier: f.tier,
    creditLevel: f.creditLevel,
    warnings: list(f.warnings),
    preferences: {
      ...(f.targetMarginPct ? { targetMarginPct: f.targetMarginPct } : {}),
      ...(f.preferredFreight ? { preferredFreight: f.preferredFreight } : {}),
    },
  };
}

export function fromCompany(c: {
  name: string;
  businessNumber: string;
  ceo: string;
  address: string;
  industry: string;
  categories: string[];
  taxInvoiceEmail: string;
  paymentTerms: string;
  tier: string;
  creditLevel: string;
  warnings: string[];
  preferences: { targetMarginPct?: string; preferredFreight?: string };
}): CompanyFormState {
  return {
    name: c.name,
    businessNumber: c.businessNumber,
    ceo: c.ceo,
    address: c.address,
    industry: c.industry,
    categories: c.categories.join(', '),
    taxInvoiceEmail: c.taxInvoiceEmail,
    paymentTerms: c.paymentTerms,
    tier: c.tier,
    creditLevel: c.creditLevel,
    warnings: c.warnings.join(', '),
    targetMarginPct: c.preferences.targetMarginPct ?? '',
    preferredFreight: c.preferences.preferredFreight ?? '',
  };
}

export function CompanyForm({
  f,
  onChange,
}: {
  f: CompanyFormState;
  onChange: (f: CompanyFormState) => void;
}) {
  const set = (k: keyof CompanyFormState) => (e: { target: { value: string } }) =>
    onChange({ ...f, [k]: e.target.value });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="회사명" required>
        <Input value={f.name} onChange={set('name')} />
      </Field>
      <Field label="사업자등록번호">
        <Input value={f.businessNumber} onChange={set('businessNumber')} placeholder="000-00-00000" />
      </Field>
      <Field label="대표자">
        <Input value={f.ceo} onChange={set('ceo')} />
      </Field>
      <Field label="업종">
        <Input value={f.industry} onChange={set('industry')} />
      </Field>
      <Field label="주소" className="sm:col-span-2">
        <Input value={f.address} onChange={set('address')} />
      </Field>
      <Field label="세금계산서 이메일">
        <Input value={f.taxInvoiceEmail} onChange={set('taxInvoiceEmail')} />
      </Field>
      <Field label="관심 카테고리 (쉼표 구분)">
        <Input value={f.categories} onChange={set('categories')} />
      </Field>
      <Field label="고객 등급">
        <Select value={f.tier} onChange={set('tier')}>
          {['STANDARD', 'SILVER', 'GOLD', 'VIP'].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </Select>
      </Field>
      <Field label="신용 등급">
        <Select value={f.creditLevel} onChange={set('creditLevel')}>
          <option value="NORMAL">보통</option>
          <option value="GOOD">우수</option>
          <option value="WATCH">주의</option>
          <option value="PREPAY_ONLY">선결제만</option>
        </Select>
      </Field>
      <Field label="목표 마진 (%)" hint="고객별 마진 규칙에 참고로 표시됩니다">
        <Input
          value={f.targetMarginPct}
          onChange={(e) => onChange({ ...f, targetMarginPct: e.target.value.replace(/[^\d.]/g, '') })}
        />
      </Field>
      <Field label="선호 운송">
        <Select value={f.preferredFreight} onChange={set('preferredFreight')}>
          <option value="">지정 안 함</option>
          {['COURIER', 'AIR', 'LCL', 'FCL_20', 'FCL_40'].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </Select>
      </Field>
      <Field label="결제 조건" className="sm:col-span-2">
        <Input value={f.paymentTerms} onChange={set('paymentTerms')} />
      </Field>
      <Field label="주의 사항 (쉼표 구분, 내부용)" className="sm:col-span-2">
        <Textarea rows={2} value={f.warnings} onChange={set('warnings')} />
      </Field>
    </div>
  );
}
