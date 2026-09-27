import { Decimal } from 'decimal.js';

/**
 * Money primitives. Floating point is never used for monetary values:
 * amounts travel as decimal strings (matching Postgres NUMERIC) and are
 * computed with decimal.js.
 */

export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = Decimal;

export type CurrencyCode = string; // ISO 4217

/** Minor-unit precision per currency (ISO 4217). Unknown currencies default to 2. */
export const CURRENCY_PRECISION: Record<string, number> = {
  KRW: 0,
  JPY: 0,
  VND: 0,
  CNY: 2,
  USD: 2,
  EUR: 2,
  HKD: 2,
  TWD: 2,
  GBP: 2,
  SGD: 2,
  THB: 2,
};

export function currencyPrecision(currency: CurrencyCode): number {
  return CURRENCY_PRECISION[currency.toUpperCase()] ?? 2;
}

export type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'UP' | 'DOWN' | 'CEIL' | 'FLOOR';

const ROUNDING_MAP: Record<RoundingMode, Decimal.Rounding> = {
  HALF_UP: Decimal.ROUND_HALF_UP,
  HALF_EVEN: Decimal.ROUND_HALF_EVEN,
  UP: Decimal.ROUND_UP,
  DOWN: Decimal.ROUND_DOWN,
  CEIL: Decimal.ROUND_CEIL,
  FLOOR: Decimal.ROUND_FLOOR,
};

export interface RoundingRule {
  mode: RoundingMode;
  /**
   * Round to a multiple of this step expressed in major units, e.g. 10 for
   * "round to the nearest 10 won". When omitted, the currency's minor unit is used.
   */
  step?: string;
}

export function dec(v: Decimal.Value | null | undefined): Decimal {
  if (v === null || v === undefined || v === '') return new D(0);
  return new D(v);
}

export function isDecimalString(v: unknown): v is string {
  if (typeof v !== 'string' || v.trim() === '') return false;
  try {
    const d = new D(v);
    return d.isFinite();
  } catch {
    return false;
  }
}

export function roundMoney(value: Decimal.Value, currency: CurrencyCode, rule?: RoundingRule): Decimal {
  const d = new D(value);
  const mode = ROUNDING_MAP[rule?.mode ?? 'HALF_UP'];
  if (rule?.step && !new D(rule.step).isZero()) {
    const step = new D(rule.step);
    return d.div(step).toDecimalPlaces(0, mode).mul(step).toDecimalPlaces(currencyPrecision(currency), mode);
  }
  return d.toDecimalPlaces(currencyPrecision(currency), mode);
}

/** Serialize a decimal for storage / transport, fixed to currency precision. */
export function moneyString(value: Decimal.Value, currency: CurrencyCode, rule?: RoundingRule): string {
  return roundMoney(value, currency, rule).toFixed(currencyPrecision(currency));
}

export interface Money {
  amount: string;
  currency: CurrencyCode;
}

export function money(amount: Decimal.Value, currency: CurrencyCode): Money {
  return { amount: new D(amount).toString(), currency: currency.toUpperCase() };
}

/** An FX quote: 1 unit of `base` = `rate` units of `quote`, valid on `rateDate`. */
export interface FxRate {
  base: CurrencyCode;
  quote: CurrencyCode;
  rate: string;
  rateDate: string; // ISO date the rate applies to (기준일)
  source: string;
}

export class FxTable {
  private readonly rates = new Map<string, FxRate>();

  constructor(rates: FxRate[] = []) {
    for (const r of rates) this.add(r);
  }

  add(rate: FxRate): void {
    this.rates.set(`${rate.base.toUpperCase()}/${rate.quote.toUpperCase()}`, rate);
  }

  list(): FxRate[] {
    return [...this.rates.values()];
  }

  /** Returns the rate to convert `from` → `to`, or null when unknown. Inverse rates are derived. */
  find(from: CurrencyCode, to: CurrencyCode): { rate: Decimal; info: FxRate | null } | null {
    const f = from.toUpperCase();
    const t = to.toUpperCase();
    if (f === t) return { rate: new D(1), info: null };
    const direct = this.rates.get(`${f}/${t}`);
    if (direct) return { rate: new D(direct.rate), info: direct };
    const inverse = this.rates.get(`${t}/${f}`);
    if (inverse && !new D(inverse.rate).isZero()) return { rate: new D(1).div(inverse.rate), info: inverse };
    return null;
  }

  convert(amount: Decimal.Value, from: CurrencyCode, to: CurrencyCode): Decimal {
    const r = this.find(from, to);
    if (!r) throw new FxMissingError(from, to);
    return new D(amount).mul(r.rate);
  }
}

export class FxMissingError extends Error {
  constructor(
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`FX rate ${from}->${to} is not available`);
    this.name = 'FxMissingError';
  }
}

export function sum(values: Decimal.Value[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.add(v), new D(0));
}

export function median(values: Decimal.Value[]): Decimal | null {
  if (values.length === 0) return null;
  const sorted = values.map((v) => new D(v)).sort((a, b) => a.comparedTo(b));
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return sorted[mid - 1]!.add(sorted[mid]!).div(2);
}

export function percentile(values: Decimal.Value[], p: number): Decimal | null {
  if (values.length === 0) return null;
  const sorted = values.map((v) => new D(v)).sort((a, b) => a.comparedTo(b));
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]!.add(sorted[hi]!.sub(sorted[lo]!).mul(idx - lo));
}

/** markup = (price - cost) / cost ; margin = (price - cost) / price. Both returned as percentages. */
export function markupAndMargin(cost: Decimal.Value, price: Decimal.Value): { markupPct: Decimal | null; marginPct: Decimal | null; profit: Decimal } {
  const c = new D(cost);
  const p = new D(price);
  const profit = p.sub(c);
  return {
    profit,
    markupPct: c.isZero() ? null : profit.div(c).mul(100),
    marginPct: p.isZero() ? null : profit.div(p).mul(100),
  };
}

/** Converts a target margin % into the equivalent markup %. */
export function marginToMarkup(marginPct: Decimal.Value): Decimal {
  const m = new D(marginPct).div(100);
  if (m.gte(1)) throw new Error('Margin must be below 100%');
  return m.div(new D(1).sub(m)).mul(100);
}

export function markupToMargin(markupPct: Decimal.Value): Decimal {
  const k = new D(markupPct).div(100);
  return k.div(new D(1).add(k)).mul(100);
}
