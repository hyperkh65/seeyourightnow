import type { Decimal } from 'decimal.js';
import { D, FxTable, FxMissingError, moneyString, type CurrencyCode } from './money.js';
import { weakestVerification, type CertCostAllocation, type VerificationStatus } from './enums.js';

/**
 * Landed Cost Engine.
 *
 * All inputs are decimal strings. Every cost line carries its source and
 * verification status so the result can express how trustworthy it is.
 * Customs duty and VAT are computed on the Korean customs-value basis
 * (CIF: goods + international freight + insurance), VAT on (CIF + duty).
 * Missing duty rates are *not* assumed: the result is flagged incomplete.
 */

export const COST_ITEM_KEYS = [
  'product_cost',
  'china_inland',
  'inspection',
  'packing',
  'labeling',
  'sample',
  'international_freight',
  'insurance',
  'customs_brokerage',
  'port_charges',
  'certification',
  'testing',
  'domestic_delivery',
  'miscellaneous',
] as const;
export type CostItemKey = (typeof COST_ITEM_KEYS)[number];

export const COST_ITEM_LABEL_KO: Record<CostItemKey | 'customs_duty' | 'vat', string> = {
  product_cost: '제품 원가',
  china_inland: '중국 내륙운송',
  inspection: '검품',
  packing: '포장',
  labeling: '라벨링',
  sample: '샘플',
  international_freight: '국제운송',
  insurance: '보험',
  customs_duty: '관세',
  vat: '부가세',
  customs_brokerage: '통관 수수료',
  port_charges: '항만 비용',
  certification: '인증',
  testing: '시험',
  domestic_delivery: '국내 배송',
  miscellaneous: '기타',
};

/** Which margin component each cost line belongs to (used by the Margin Engine). */
export type PricingComponent = 'PRODUCT' | 'FREIGHT' | 'INSPECTION' | 'SERVICE' | 'DOMESTIC_DELIVERY' | 'TAX' | 'PASS_THROUGH';

export const COST_ITEM_COMPONENT: Record<CostItemKey | 'customs_duty' | 'vat', PricingComponent> = {
  product_cost: 'PRODUCT',
  china_inland: 'FREIGHT',
  inspection: 'INSPECTION',
  packing: 'SERVICE',
  labeling: 'SERVICE',
  sample: 'SERVICE',
  international_freight: 'FREIGHT',
  insurance: 'FREIGHT',
  customs_duty: 'TAX',
  vat: 'TAX',
  customs_brokerage: 'SERVICE',
  port_charges: 'FREIGHT',
  certification: 'SERVICE',
  testing: 'SERVICE',
  domestic_delivery: 'DOMESTIC_DELIVERY',
  miscellaneous: 'SERVICE',
};

export interface CostInput {
  key: CostItemKey;
  amount: string;
  currency: CurrencyCode;
  basis: 'PER_UNIT' | 'TOTAL';
  source: string;
  verification: VerificationStatus;
  note?: string;
}

export interface DutyInput {
  /** Rate in percent, e.g. "8". null means the rate is not known yet. */
  ratePct: string | null;
  rateType?: string; // BASIC, WTO, FTA_KR_CN, RCEP ...
  hsCode?: string | null;
  source: string;
  verification: VerificationStatus;
}

export interface LandedCostInput {
  quantity: number;
  baseCurrency: CurrencyCode;
  items: CostInput[];
  duty: DutyInput;
  vatPct: string; // e.g. "10"
  vatRecoverable: boolean;
  fx: FxTable;
  certificationAllocation: CertCostAllocation;
  /** Units the certification cost is spread across when AMORTIZE is selected. */
  amortizationUnits?: number;
}

export interface CostLine {
  key: CostItemKey | 'customs_duty' | 'vat';
  label: string;
  component: PricingComponent;
  originalAmount: string | null;
  originalCurrency: CurrencyCode | null;
  basis: 'PER_UNIT' | 'TOTAL' | 'DERIVED';
  totalBase: string; // total in base currency for the whole order
  perUnitBase: string;
  source: string;
  verification: VerificationStatus;
  includedInLandedCost: boolean;
  note?: string;
}

export interface LandedCostResult {
  baseCurrency: CurrencyCode;
  quantity: number;
  lines: CostLine[];
  customsValueBase: string;
  dutyBase: string | null;
  vatBase: string | null;
  totalExVatBase: string;
  totalIncVatBase: string;
  landedCostBase: string; // what the business actually bears (VAT excluded when recoverable)
  perUnitLandedCostBase: string;
  customerSeparateBase: string; // certification billed separately to customer
  complete: boolean;
  warnings: string[];
  verification: VerificationStatus;
  fxUsed: Array<{ from: string; to: string; rate: string; rateDate: string | null; source: string | null }>;
}

const CIF_KEYS: CostItemKey[] = ['product_cost', 'international_freight', 'insurance'];

export function calculateLandedCost(input: LandedCostInput): LandedCostResult {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new Error('quantity must be a positive integer');
  const base = input.baseCurrency.toUpperCase();
  const qty = new D(input.quantity);
  const warnings: string[] = [];
  const lines: CostLine[] = [];
  const fxUsed = new Map<string, LandedCostResult['fxUsed'][number]>();
  let complete = true;

  const toBase = (amount: string, currency: string): Decimal | null => {
    try {
      const found = input.fx.find(currency, base);
      if (!found) throw new FxMissingError(currency, base);
      if (currency.toUpperCase() !== base) {
        fxUsed.set(`${currency}/${base}`, {
          from: currency.toUpperCase(),
          to: base,
          rate: found.rate.toString(),
          rateDate: found.info?.rateDate ?? null,
          source: found.info?.source ?? null,
        });
      }
      return new D(amount).mul(found.rate);
    } catch (e) {
      if (e instanceof FxMissingError) {
        warnings.push(`환율 정보 없음: ${currency} → ${base}`);
        complete = false;
        return null;
      }
      throw e;
    }
  };

  let customerSeparate = new D(0);
  const hasProductCost = input.items.some((i) => i.key === 'product_cost');
  if (!hasProductCost) {
    warnings.push('제품 원가가 입력되지 않았습니다.');
    complete = false;
  }

  for (const item of input.items) {
    const converted = toBase(item.amount, item.currency);
    if (converted === null) continue;
    let total = item.basis === 'PER_UNIT' ? converted.mul(qty) : converted;
    let included = true;
    let note = item.note;
    if (item.key === 'certification') {
      switch (input.certificationAllocation) {
        case 'FULL_ON_ORDER':
          break;
        case 'AMORTIZE': {
          const units = input.amortizationUnits && input.amortizationUnits > 0 ? input.amortizationUnits : null;
          if (!units) {
            warnings.push('인증비 분할 기준 수량이 없어 이번 주문에 전액 반영했습니다.');
          } else {
            // Only this order's share of the certification cost is carried.
            const perUnit = (item.basis === 'PER_UNIT' ? converted : converted.div(units));
            total = perUnit.mul(Math.min(units, input.quantity));
            note = `인증비 ${units}개 기준 분할`;
          }
          break;
        }
        case 'COMPANY_EXPENSE':
          included = false;
          note = '회사 비용 처리 (견적 미반영)';
          break;
        case 'CUSTOMER_SEPARATE':
          included = false;
          customerSeparate = customerSeparate.add(total);
          note = '고객 별도 청구';
          break;
      }
    }
    lines.push({
      key: item.key,
      label: COST_ITEM_LABEL_KO[item.key],
      component: COST_ITEM_COMPONENT[item.key],
      originalAmount: item.amount,
      originalCurrency: item.currency.toUpperCase(),
      basis: item.basis,
      totalBase: total.toString(),
      perUnitBase: total.div(qty).toString(),
      source: item.source,
      verification: item.verification,
      includedInLandedCost: included,
      ...(note ? { note } : {}),
    });
  }

  const cifTotal = lines.filter((l) => (CIF_KEYS as string[]).includes(l.key)).reduce((a, l) => a.add(l.totalBase), new D(0));
  if (!lines.some((l) => l.key === 'international_freight')) {
    warnings.push('국제운송비가 없어 과세가격(CIF)이 과소 계산될 수 있습니다.');
    complete = false;
  }

  let dutyBase: Decimal | null = null;
  if (input.duty.ratePct === null) {
    warnings.push('관세율이 확인되지 않았습니다. 관세사 확인이 필요합니다.');
    complete = false;
  } else {
    dutyBase = cifTotal.mul(new D(input.duty.ratePct).div(100));
    lines.push({
      key: 'customs_duty',
      label: COST_ITEM_LABEL_KO.customs_duty,
      component: 'TAX',
      originalAmount: null,
      originalCurrency: null,
      basis: 'DERIVED',
      totalBase: dutyBase.toString(),
      perUnitBase: dutyBase.div(qty).toString(),
      source: input.duty.source,
      verification: input.duty.verification,
      includedInLandedCost: true,
      note: `과세가격 × ${input.duty.ratePct}%${input.duty.rateType ? ` (${input.duty.rateType})` : ''}${input.duty.hsCode ? ` · HS ${input.duty.hsCode}` : ''}`,
    });
  }

  const vatBaseAmount = cifTotal.add(dutyBase ?? 0);
  const vat = vatBaseAmount.mul(new D(input.vatPct).div(100));
  lines.push({
    key: 'vat',
    label: COST_ITEM_LABEL_KO.vat,
    component: 'TAX',
    originalAmount: null,
    originalCurrency: null,
    basis: 'DERIVED',
    totalBase: vat.toString(),
    perUnitBase: vat.div(qty).toString(),
    source: 'SYSTEM',
    verification: dutyBase === null ? 'UNVERIFIED' : 'SYSTEM_CALCULATED',
    includedInLandedCost: !input.vatRecoverable,
    note: `(과세가격 + 관세) × ${input.vatPct}%${input.vatRecoverable ? ' · 매입세액 공제 대상' : ''}`,
  });

  const exVat = lines.filter((l) => l.includedInLandedCost && l.key !== 'vat').reduce((a, l) => a.add(l.totalBase), new D(0));
  const incVat = exVat.add(vat);
  const landed = input.vatRecoverable ? exVat : incVat;

  const verification = weakestVerification(lines.filter((l) => l.includedInLandedCost).map((l) => l.verification));

  return {
    baseCurrency: base,
    quantity: input.quantity,
    lines: lines.map((l) => ({
      ...l,
      totalBase: moneyString(l.totalBase, base),
      perUnitBase: new D(l.perUnitBase).toDecimalPlaces(4).toString(),
    })),
    customsValueBase: moneyString(cifTotal, base),
    dutyBase: dutyBase === null ? null : moneyString(dutyBase, base),
    vatBase: moneyString(vat, base),
    totalExVatBase: moneyString(exVat, base),
    totalIncVatBase: moneyString(incVat, base),
    landedCostBase: moneyString(landed, base),
    perUnitLandedCostBase: landed.div(qty).toDecimalPlaces(2).toFixed(2),
    customerSeparateBase: moneyString(customerSeparate, base),
    complete,
    warnings,
    verification,
    fxUsed: [...fxUsed.values()],
  };
}

export { FxTable };
