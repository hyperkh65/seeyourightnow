import type { Decimal } from 'decimal.js';
import { D, FxTable, type CurrencyCode } from './money.js';
import { FREIGHT_SOURCE_PRIORITY, type FreightMode, type FreightSource, type VerificationStatus } from './enums.js';

/**
 * Freight Engine: packing math + mode feasibility + rate application.
 * It never invents a rate: modes without a rate are returned as
 * NO_RATE with the action required (request a forwarder quote).
 */

export interface PackingInput {
  cartonCount: number;
  cartonLengthCm: string;
  cartonWidthCm: string;
  cartonHeightCm: string;
  cartonGrossWeightKg: string;
  cartonNetWeightKg?: string;
  unitsPerCarton?: number;
  palletized?: boolean;
  stackable?: boolean;
}

export interface CargoFlags {
  battery: boolean;
  lithiumBattery: boolean;
  batteryPackedWithOrInEquipment?: boolean;
  dangerousGoods: boolean;
  liquid: boolean;
  magnet: boolean;
  oversize?: boolean;
}

export interface PackingMetrics {
  cbm: string;
  grossWeightKg: string;
  netWeightKg: string | null;
  volumetricWeightCourierKg: string; // /5000
  volumetricWeightAirKg: string; // /6000
  chargeableCourierKg: string;
  chargeableAirKg: string;
  revenueTonLcl: string; // W/M: max(CBM, tonnes)
  oversizeCarton: boolean;
}

export const CONTAINER_CAPACITY: Record<'FCL_20' | 'FCL_40' | 'FCL_40HQ', { usableCbm: number; maxPayloadKg: number; label: string }> = {
  // Typical practical loadable volume (not the internal nominal volume).
  FCL_20: { usableCbm: 28, maxPayloadKg: 21700, label: "20' GP" },
  FCL_40: { usableCbm: 58, maxPayloadKg: 26500, label: "40' GP" },
  FCL_40HQ: { usableCbm: 68, maxPayloadKg: 26300, label: "40' HQ" },
};

export function packingMetrics(p: PackingInput): PackingMetrics {
  if (!Number.isInteger(p.cartonCount) || p.cartonCount <= 0) throw new Error('cartonCount must be a positive integer');
  const l = new D(p.cartonLengthCm);
  const w = new D(p.cartonWidthCm);
  const h = new D(p.cartonHeightCm);
  const n = new D(p.cartonCount);
  const cartonCbm = l.mul(w).mul(h).div(1_000_000);
  const cbm = cartonCbm.mul(n);
  const gw = new D(p.cartonGrossWeightKg).mul(n);
  const nw = p.cartonNetWeightKg ? new D(p.cartonNetWeightKg).mul(n) : null;
  const volCourier = l.mul(w).mul(h).div(5000).mul(n);
  const volAir = l.mul(w).mul(h).div(6000).mul(n);
  const maxSide = D.max(l, w, h);
  return {
    cbm: cbm.toDecimalPlaces(4).toString(),
    grossWeightKg: gw.toDecimalPlaces(2).toString(),
    netWeightKg: nw ? nw.toDecimalPlaces(2).toString() : null,
    volumetricWeightCourierKg: volCourier.toDecimalPlaces(2).toString(),
    volumetricWeightAirKg: volAir.toDecimalPlaces(2).toString(),
    chargeableCourierKg: roundUpHalfKg(D.max(gw, volCourier)).toString(),
    chargeableAirKg: roundUpHalfKg(D.max(gw, volAir)).toString(),
    revenueTonLcl: D.max(cbm, gw.div(1000)).toDecimalPlaces(3).toString(),
    oversizeCarton: maxSide.gt(120) || new D(p.cartonGrossWeightKg).gt(32),
  };
}

function roundUpHalfKg(v: Decimal): Decimal {
  return v.mul(2).ceil().div(2);
}

export interface Feasibility {
  feasible: boolean;
  restrictions: string[];
}

export function modeFeasibility(mode: FreightMode, m: PackingMetrics, cargo: CargoFlags): Feasibility {
  const r: string[] = [];
  let feasible = true;
  const cbm = new D(m.cbm);
  const gw = new D(m.grossWeightKg);
  switch (mode) {
    case 'COURIER':
      if (cargo.dangerousGoods) {
        feasible = false;
        r.push('위험물(DG)은 일반 특송 불가');
      }
      if (cargo.lithiumBattery) r.push('리튬배터리: 특송사별 허용 조건(UN3481/UN3091, SoC, 포장) 확인 필요');
      if (cargo.liquid) r.push('액체: 특송사 반입 제한 확인 필요');
      if (gw.gt(300)) r.push('중량이 커서 특송은 비효율적일 수 있음');
      if (m.oversizeCarton) r.push('과대 규격 카톤: 추가 요금 가능');
      break;
    case 'AIR':
      if (cargo.dangerousGoods) r.push('항공 위험물 신고(DGD) 및 DG 취급 항공사 필요');
      if (cargo.lithiumBattery) r.push('리튬배터리: IATA DGR 요건(UN38.3, MSDS) 필요');
      if (cargo.magnet) r.push('자성 물질: 자기장 검사(Magnetic test) 필요할 수 있음');
      break;
    case 'LCL':
      if (cargo.dangerousGoods) r.push('LCL 위험물은 콘솔사 수락 여부 확인 필요');
      if (cbm.gt(15)) r.push('15CBM 초과: FCL 비교 권장');
      break;
    case 'FCL_20':
    case 'FCL_40':
    case 'FCL_40HQ': {
      const cap = CONTAINER_CAPACITY[mode];
      if (cbm.gt(cap.usableCbm)) {
        const count = cbm.div(cap.usableCbm).ceil();
        r.push(`적재 용량 초과: ${cap.label} ${count.toString()}대 필요`);
      }
      if (gw.gt(cap.maxPayloadKg)) {
        r.push(`최대 적재중량 초과(${cap.maxPayloadKg}kg)`);
      }
      if (cargo.dangerousGoods) r.push('위험물 컨테이너: IMDG 신고 필요');
      break;
    }
  }
  return { feasible, restrictions: r };
}

export interface FreightRate {
  id: string;
  mode: FreightMode;
  origin: string; // UN/LOCODE or region code
  destination: string;
  source: FreightSource;
  verification: VerificationStatus;
  currency: CurrencyCode;
  /** Unit basis of `rate`. */
  basis: 'PER_KG' | 'PER_CBM' | 'PER_RT' | 'PER_CONTAINER' | 'FLAT';
  rate: string;
  minCharge?: string;
  /** Extra fixed charges (origin/destination/customs etc.) in same currency. */
  fixedCharges?: Array<{ name: string; amount: string }>;
  transitDaysMin?: number;
  transitDaysMax?: number;
  validFrom?: string;
  validUntil?: string;
  providerName?: string;
  collectedAt: string;
}

export interface FreightOption {
  mode: FreightMode;
  status: 'PRICED' | 'NO_RATE' | 'INFEASIBLE';
  feasibility: Feasibility;
  rate?: FreightRate;
  chargeableQuantity?: string;
  chargeableUnit?: string;
  containers?: number;
  costOriginal?: string;
  currency?: string;
  costBase?: string;
  transitDays?: string;
  source?: FreightSource;
  verification?: VerificationStatus;
  expired?: boolean;
  actionRequired?: string;
}

function isExpired(rate: FreightRate, asOf: Date): boolean {
  return !!rate.validUntil && new Date(rate.validUntil).getTime() < asOf.getTime();
}

/** Picks the most trusted, still-valid rate for a lane/mode. Expired rates are used only as a last resort, flagged. */
export function pickRate(rates: FreightRate[], mode: FreightMode, origin: string, destination: string, asOf = new Date()): { rate: FreightRate; expired: boolean } | null {
  const lane = rates.filter((r) => r.mode === mode && laneMatch(r.origin, origin) && laneMatch(r.destination, destination));
  if (lane.length === 0) return null;
  const sorted = [...lane].sort((a, b) => {
    const ea = isExpired(a, asOf) ? 1 : 0;
    const eb = isExpired(b, asOf) ? 1 : 0;
    if (ea !== eb) return ea - eb;
    const pa = FREIGHT_SOURCE_PRIORITY[a.source];
    const pb = FREIGHT_SOURCE_PRIORITY[b.source];
    if (pa !== pb) return pa - pb;
    return new Date(b.collectedAt).getTime() - new Date(a.collectedAt).getTime();
  });
  const best = sorted[0]!;
  return { rate: best, expired: isExpired(best, asOf) };
}

function laneMatch(rateCode: string, want: string): boolean {
  const a = rateCode.toUpperCase();
  const b = want.toUpperCase();
  if (a === '*' || a === b) return true;
  // Country-level wildcard: "CN*" matches "CNNGB"
  if (a.endsWith('*')) return b.startsWith(a.slice(0, -1));
  return false;
}

export function compareFreightOptions(params: {
  packing: PackingInput;
  cargo: CargoFlags;
  origin: string;
  destination: string;
  rates: FreightRate[];
  baseCurrency: CurrencyCode;
  fx: FxTable;
  modes?: FreightMode[];
  asOf?: Date;
}): { metrics: PackingMetrics; options: FreightOption[]; recommended: FreightMode | null } {
  const metrics = packingMetrics(params.packing);
  const modes = params.modes ?? (['COURIER', 'AIR', 'LCL', 'FCL_20', 'FCL_40', 'FCL_40HQ'] as FreightMode[]);
  const options: FreightOption[] = [];
  for (const mode of modes) {
    const feas = modeFeasibility(mode, metrics, params.cargo);
    if (!feas.feasible) {
      options.push({ mode, status: 'INFEASIBLE', feasibility: feas });
      continue;
    }
    const picked = pickRate(params.rates, mode, params.origin, params.destination, params.asOf);
    if (!picked) {
      options.push({ mode, status: 'NO_RATE', feasibility: feas, actionRequired: '해당 구간 운임 데이터가 없습니다. 포워더 견적을 요청하세요.' });
      continue;
    }
    const { rate, expired } = picked;
    let qty: Decimal;
    let unit: string;
    let containers: number | undefined;
    switch (rate.basis) {
      case 'PER_KG':
        qty = new D(mode === 'COURIER' ? metrics.chargeableCourierKg : metrics.chargeableAirKg);
        unit = 'kg';
        break;
      case 'PER_CBM':
        qty = D.max(new D(metrics.cbm), 1);
        unit = 'CBM';
        break;
      case 'PER_RT':
        qty = D.max(new D(metrics.revenueTonLcl), 1);
        unit = 'R/T';
        break;
      case 'PER_CONTAINER': {
        const cap = CONTAINER_CAPACITY[mode as 'FCL_20' | 'FCL_40' | 'FCL_40HQ'];
        const byVol = cap ? new D(metrics.cbm).div(cap.usableCbm).ceil() : new D(1);
        const byWt = cap ? new D(metrics.grossWeightKg).div(cap.maxPayloadKg).ceil() : new D(1);
        qty = D.max(byVol, byWt, 1);
        containers = qty.toNumber();
        unit = 'container';
        break;
      }
      case 'FLAT':
        qty = new D(1);
        unit = 'shipment';
        break;
    }
    let cost = qty.mul(rate.rate);
    if (rate.minCharge && cost.lt(rate.minCharge)) cost = new D(rate.minCharge);
    for (const fc of rate.fixedCharges ?? []) cost = cost.add(fc.amount);
    let costBase: string | undefined;
    try {
      costBase = params.fx.convert(cost, rate.currency, params.baseCurrency).toFixed(0);
    } catch {
      costBase = undefined;
    }
    options.push({
      mode,
      status: 'PRICED',
      feasibility: feas,
      rate,
      chargeableQuantity: qty.toString(),
      chargeableUnit: unit,
      ...(containers !== undefined ? { containers } : {}),
      costOriginal: cost.toFixed(2),
      currency: rate.currency,
      ...(costBase !== undefined ? { costBase } : {}),
      transitDays: rate.transitDaysMin !== undefined ? `${rate.transitDaysMin}${rate.transitDaysMax && rate.transitDaysMax !== rate.transitDaysMin ? `-${rate.transitDaysMax}` : ''}` : undefined,
      source: rate.source,
      verification: rate.verification,
      expired,
      ...(expired ? { actionRequired: '운임 유효기간이 지났습니다. 재확인이 필요합니다.' } : {}),
    } as FreightOption);
  }
  const priced = options.filter((o) => o.status === 'PRICED' && o.costBase !== undefined && !o.expired);
  const recommended = priced.length ? priced.reduce((a, b) => (new D(a.costBase!).lte(b.costBase!) ? a : b)).mode : null;
  return { metrics, options, recommended };
}

/** Estimated / partner-verified / actual are stored separately; this computes the error rate between two of them. */
export function errorRatePct(predicted: string, actual: string): string | null {
  const a = new D(actual);
  if (a.isZero()) return null;
  return new D(predicted).sub(a).abs().div(a).mul(100).toFixed(2);
}

/** Mean absolute percentage error over pairs. */
export function mape(pairs: Array<{ predicted: string; actual: string }>): string | null {
  const valid = pairs.filter((p) => !new D(p.actual).isZero());
  if (!valid.length) return null;
  const total = valid.reduce((acc, p) => acc.add(new D(p.predicted).sub(p.actual).abs().div(p.actual)), new D(0));
  return total.div(valid.length).mul(100).toFixed(2);
}
