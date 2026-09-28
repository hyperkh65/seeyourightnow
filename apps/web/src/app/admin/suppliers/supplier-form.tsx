'use client';

import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui';

export interface SupplierFormState {
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
  yearsInBusiness: string;
  businessVerified: string;
  verificationNote: string;
  typicalMoq: string;
  oemSupported: string;
  riskFlags: string;
  blacklisted: boolean;
  blacklistReason: string;
  internalNotes: string;
}

export const EMPTY_SUPPLIER: SupplierFormState = {
  name: '',
  nameLocal: '',
  alias: '',
  visibility: 'ALIAS',
  sourceType: 'PRIVATE_NETWORK',
  businessType: 'UNKNOWN',
  country: 'CN',
  province: '',
  city: '',
  address: '',
  nearestPort: '',
  yearsInBusiness: '',
  businessVerified: '',
  verificationNote: '',
  typicalMoq: '',
  oemSupported: '',
  riskFlags: '',
  blacklisted: false,
  blacklistReason: '',
  internalNotes: '',
};

export const SOURCE_TYPE_LABEL: Record<string, string> = {
  PUBLIC_MARKET: '공개 마켓',
  PRIVATE_NETWORK: '자체 공급망',
  DIRECT_FACTORY: '직거래 공장',
  LOCAL_PARTNER: '현지 파트너',
  INTERNAL_PRODUCT: '자사 제품',
  RFQ_RESULT: 'RFQ 회신',
  MANUAL_PROPOSAL: '수동 제안',
  CUSTOMER_NOMINATED: '고객 지정',
};

const tri = (v: string) => (v === '' ? null : v === 'true');

export function toSupplierBody(f: SupplierFormState) {
  return {
    name: f.name.trim(),
    nameLocal: f.nameLocal,
    alias: f.alias,
    visibility: f.visibility,
    sourceType: f.sourceType,
    businessType: f.businessType,
    country: f.country.toUpperCase(),
    province: f.province,
    city: f.city,
    address: f.address,
    nearestPort: f.nearestPort.toUpperCase(),
    yearsInBusiness: f.yearsInBusiness ? Number(f.yearsInBusiness) : null,
    businessVerified: tri(f.businessVerified),
    verificationNote: f.verificationNote,
    typicalMoq: f.typicalMoq ? Number(f.typicalMoq) : null,
    oemSupported: tri(f.oemSupported),
    riskFlags: f.riskFlags
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
    blacklisted: f.blacklisted,
    blacklistReason: f.blacklistReason,
    internalNotes: f.internalNotes,
  };
}

export function fromSupplier(s: Record<string, unknown>): SupplierFormState {
  const str = (k: string) => (s[k] === null || s[k] === undefined ? '' : String(s[k]));
  return {
    ...EMPTY_SUPPLIER,
    ...Object.fromEntries(Object.keys(EMPTY_SUPPLIER).map((k) => [k, str(k)])),
    riskFlags: ((s.riskFlags as string[]) ?? []).join(', '),
    blacklisted: Boolean(s.blacklisted),
  };
}

export function SupplierForm({
  f,
  onChange,
}: {
  f: SupplierFormState;
  onChange: (f: SupplierFormState) => void;
}) {
  const set = (k: keyof SupplierFormState) => (e: { target: { value: string } }) =>
    onChange({ ...f, [k]: e.target.value });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="공급자 상호 (내부용)" required>
        <Input value={f.name} onChange={set('name')} />
      </Field>
      <Field label="현지어 상호">
        <Input value={f.nameLocal} onChange={set('nameLocal')} />
      </Field>
      <Field label="고객 표시명 (별칭)" hint="공급자 정보는 고객에게 별칭으로만 보입니다">
        <Input value={f.alias} onChange={set('alias')} placeholder="예: Verified Factory · Ningbo" />
      </Field>
      <Field label="고객 표시 방식">
        <Select value={f.visibility} onChange={set('visibility')}>
          <option value="ALIAS">별칭으로 표시</option>
          <option value="HIDDEN">숨김</option>
          <option value="VISIBLE">상호 공개</option>
        </Select>
      </Field>
      <Field label="출처">
        <Select value={f.sourceType} onChange={set('sourceType')}>
          {Object.entries(SOURCE_TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="업체 유형">
        <Select value={f.businessType} onChange={set('businessType')}>
          <option value="UNKNOWN">확인 안 됨</option>
          <option value="FACTORY">제조 공장</option>
          <option value="TRADING">무역회사</option>
        </Select>
      </Field>
      <Field label="국가 (2자리)">
        <Input value={f.country} maxLength={2} onChange={set('country')} />
      </Field>
      <Field label="성/지역">
        <Input value={f.province} onChange={set('province')} />
      </Field>
      <Field label="도시">
        <Input value={f.city} onChange={set('city')} />
      </Field>
      <Field label="가까운 항구 (UN/LOCODE)">
        <Input value={f.nearestPort} maxLength={5} onChange={set('nearestPort')} placeholder="CNNGB" />
      </Field>
      <Field label="주소" className="sm:col-span-2">
        <Input value={f.address} onChange={set('address')} />
      </Field>
      <Field label="업력 (년)">
        <Input
          value={f.yearsInBusiness}
          onChange={(e) => onChange({ ...f, yearsInBusiness: e.target.value.replace(/\D/g, '') })}
        />
      </Field>
      <Field label="일반 MOQ">
        <Input
          value={f.typicalMoq}
          onChange={(e) => onChange({ ...f, typicalMoq: e.target.value.replace(/\D/g, '') })}
        />
      </Field>
      <Field label="사업자 확인">
        <Select value={f.businessVerified} onChange={set('businessVerified')}>
          <option value="">확인 안 됨</option>
          <option value="true">확인됨</option>
          <option value="false">불일치</option>
        </Select>
      </Field>
      <Field label="OEM">
        <Select value={f.oemSupported} onChange={set('oemSupported')}>
          <option value="">모름</option>
          <option value="true">가능</option>
          <option value="false">불가</option>
        </Select>
      </Field>
      <Field label="확인 메모" className="sm:col-span-2">
        <Input value={f.verificationNote} onChange={set('verificationNote')} />
      </Field>
      <Field label="리스크 태그 (쉼표 구분)" className="sm:col-span-2">
        <Input value={f.riskFlags} onChange={set('riskFlags')} />
      </Field>
      <Field label="내부 메모" className="sm:col-span-2">
        <Textarea value={f.internalNotes} onChange={set('internalNotes')} />
      </Field>
      <div className="sm:col-span-2">
        <Checkbox
          checked={f.blacklisted}
          onChange={(v) => onChange({ ...f, blacklisted: v })}
          label="거래 제한 (블랙리스트) — 검색 결과에서 제외됩니다"
        />
      </div>
      {f.blacklisted && (
        <Field label="제한 사유" className="sm:col-span-2">
          <Input value={f.blacklistReason} onChange={set('blacklistReason')} />
        </Field>
      )}
    </div>
  );
}
