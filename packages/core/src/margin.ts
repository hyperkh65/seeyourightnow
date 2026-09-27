import type { Decimal } from 'decimal.js';
import { D, markupAndMargin, roundMoney, type CurrencyCode, type RoundingRule } from './money.js';
import type { PricingComponent } from './landed-cost.js';
import type { RiskLevel, SourceType } from './enums.js';

/**
 * Margin Engine.
 *
 * Rules are layered from least to most specific. For each pricing component
 * the most specific matching SET rule defines the base markup; all matching
 * ADD rules are summed on top; then min/max clamps apply; a manual override
 * (if present) replaces everything. The engine returns a full explanation
 * trail so admins can see exactly why a price came out the way it did.
 *
 * Terminology (shown distinctly in the UI):
 *   markup % = profit / cost
 *   margin % = profit / price
 */

export const MARGIN_SCOPES = [
  'GLOBAL',
  'CATEGORY',
  'SUBCATEGORY',
  'HS_PREFIX',
  'SOURCE',
  'SUPPLIER',
  'COST_RANGE',
  'QUANTITY',
  'MOQ',
  'RISK',
  'CUSTOMER_TIER',
  'CUSTOM',
] as const;
export type MarginScope = (typeof MARGIN_SCOPES)[number];

/** Specificity order: later = more specific = wins for SET rules. */
export const SCOPE_LEVEL: Record<MarginScope, number> = Object.fromEntries(MARGIN_SCOPES.map((s, i) => [s, i])) as Record<MarginScope, number>;

export const MARGIN_SCOPE_LABEL_KO: Record<MarginScope, string> = {
  GLOBAL: '전체 기본',
  CATEGORY: '카테고리',
  SUBCATEGORY: '세부 카테고리',
  HS_PREFIX: 'HS 코드',
  SOURCE: '공급 경로',
  SUPPLIER: '공급자',
  COST_RANGE: '원가 구간',
  QUANTITY: '수량',
  MOQ: 'MOQ',
  RISK: '리스크',
  CUSTOMER_TIER: '고객 등급',
  CUSTOM: '사용자 정의',
};

export interface MarginRule {
  id: string;
  name: string;
  scope: MarginScope;
  component: PricingComponent | 'ALL';
  action: 'SET' | 'ADD';
  /** Markup percent as a decimal string, e.g. "12" or "-2". */
  markupPct: string;
  priority: number; // tie-breaker within the same scope level; higher wins
  active: boolean;
  match: {
    category?: string;
    subcategory?: string;
    hsPrefix?: string;
    sourceType?: SourceType;
    supplierId?: string;
    costMin?: string; // unit cost in base currency, inclusive
    costMax?: string; // exclusive
    qtyMin?: number;
    qtyMax?: number; // exclusive
    belowMoq?: boolean;
    riskLevels?: RiskLevel[];
    customerTier?: string;
    attribute?: { key: string; equals: string };
  };
  minMarkupPct?: string;
  maxMarkupPct?: string;
}

export interface MarginContext {
  category?: string;
  subcategory?: string;
  hsCode?: string | null;
  sourceType?: SourceType;
  supplierId?: string;
  unitCostBase: string;
  quantity: number;
  moq?: number | null;
  riskLevel?: RiskLevel;
  customerTier?: string;
  attributes?: Record<string, unknown>;
}

export interface MarginConfig {
  /** Default markups per component when no rule matches. */
  defaults: Record<Exclude<PricingComponent, 'TAX' | 'PASS_THROUGH'>, string>;
  globalMinMarkupPct?: string;
  globalMaxMarkupPct?: string;
  rounding: RoundingRule;
  /** Whether customs duty / VAT are passed through at cost (no markup). */
  taxPassThrough: boolean;
}

export const DEFAULT_MARGIN_CONFIG: MarginConfig = {
  defaults: { PRODUCT: '12', FREIGHT: '5', INSPECTION: '10', SERVICE: '10', DOMESTIC_DELIVERY: '5' },
  globalMinMarkupPct: '0',
  globalMaxMarkupPct: '200',
  rounding: { mode: 'UP', step: '10' },
  taxPassThrough: true,
};

export interface ManualOverride {
  component: PricingComponent | 'ALL';
  markupPct: string;
  reason: string;
}

function ruleMatches(rule: MarginRule, ctx: MarginContext): boolean {
  const m = rule.match;
  const eqi = (a?: string, b?: string) => a !== undefined && b !== undefined && a.trim().toLowerCase() === b.trim().toLowerCase();
  switch (rule.scope) {
    case 'GLOBAL':
      break;
    case 'CATEGORY':
      if (!eqi(m.category, ctx.category)) return false;
      break;
    case 'SUBCATEGORY':
      if (!eqi(m.subcategory, ctx.subcategory)) return false;
      break;
    case 'HS_PREFIX':
      if (!m.hsPrefix || !ctx.hsCode || !ctx.hsCode.replace(/\D/g, '').startsWith(m.hsPrefix.replace(/\D/g, ''))) return false;
      break;
    case 'SOURCE':
      if (!m.sourceType || m.sourceType !== ctx.sourceType) return false;
      break;
    case 'SUPPLIER':
      if (!m.supplierId || m.supplierId !== ctx.supplierId) return false;
      break;
    case 'COST_RANGE': {
      const c = new D(ctx.unitCostBase);
      if (m.costMin !== undefined && c.lt(m.costMin)) return false;
      if (m.costMax !== undefined && c.gte(m.costMax)) return false;
      if (m.costMin === undefined && m.costMax === undefined) return false;
      break;
    }
    case 'QUANTITY':
      if (m.qtyMin !== undefined && ctx.quantity < m.qtyMin) return false;
      if (m.qtyMax !== undefined && ctx.quantity >= m.qtyMax) return false;
      if (m.qtyMin === undefined && m.qtyMax === undefined) return false;
      break;
    case 'MOQ':
      if (m.belowMoq === undefined || ctx.moq === null || ctx.moq === undefined) return false;
      if ((ctx.quantity < ctx.moq) !== m.belowMoq) return false;
      break;
    case 'RISK':
      if (!m.riskLevels || !ctx.riskLevel || !m.riskLevels.includes(ctx.riskLevel)) return false;
      break;
    case 'CUSTOMER_TIER':
      if (!eqi(m.customerTier, ctx.customerTier)) return false;
      break;
    case 'CUSTOM': {
      if (!m.attribute) return false;
      const v = ctx.attributes?.[m.attribute.key];
      if (v === undefined || String(v).toLowerCase() !== m.attribute.equals.toLowerCase()) return false;
      break;
    }
  }
  return true;
}

export interface ComponentMarkupExplanation {
  component: PricingComponent;
  baseMarkupPct: string;
  baseFrom: { ruleId: string | null; name: string; scope: MarginScope | 'DEFAULT' };
  adjustments: Array<{ ruleId: string; name: string; scope: MarginScope; markupPct: string }>;
  clampedFrom?: string;
  override?: ManualOverride;
  finalMarkupPct: string;
  overriddenRules: Array<{ ruleId: string; name: string; scope: MarginScope; markupPct: string }>;
}

export function resolveMarkup(
  component: Exclude<PricingComponent, 'TAX' | 'PASS_THROUGH'>,
  rules: MarginRule[],
  ctx: MarginContext,
  config: MarginConfig,
  override?: ManualOverride | null,
): ComponentMarkupExplanation {
  const applicable = rules.filter((r) => r.active && (r.component === component || r.component === 'ALL') && ruleMatches(r, ctx));
  const sets = applicable
    .filter((r) => r.action === 'SET')
    .sort((a, b) => SCOPE_LEVEL[b.scope] - SCOPE_LEVEL[a.scope] || b.priority - a.priority || a.id.localeCompare(b.id));
  const winner = sets[0];
  const adds = applicable.filter((r) => r.action === 'ADD');

  let value: Decimal = new D(winner ? winner.markupPct : config.defaults[component]);
  const explanation: ComponentMarkupExplanation = {
    component,
    baseMarkupPct: value.toString(),
    baseFrom: winner ? { ruleId: winner.id, name: winner.name, scope: winner.scope } : { ruleId: null, name: '기본값', scope: 'DEFAULT' },
    adjustments: adds.map((r) => ({ ruleId: r.id, name: r.name, scope: r.scope, markupPct: r.markupPct })),
    finalMarkupPct: '0',
    overriddenRules: sets.slice(1).map((r) => ({ ruleId: r.id, name: r.name, scope: r.scope, markupPct: r.markupPct })),
  };
  for (const a of adds) value = value.add(a.markupPct);

  // Clamp: rule-level limits of the winning rule first, then global.
  const mins = [winner?.minMarkupPct, config.globalMinMarkupPct].filter((v): v is string => v !== undefined);
  const maxs = [winner?.maxMarkupPct, config.globalMaxMarkupPct].filter((v): v is string => v !== undefined);
  const before = value;
  for (const mn of mins) if (value.lt(mn)) value = new D(mn);
  for (const mx of maxs) if (value.gt(mx)) value = new D(mx);
  if (!value.eq(before)) explanation.clampedFrom = before.toString();

  if (override && (override.component === component || override.component === 'ALL')) {
    explanation.override = override;
    value = new D(override.markupPct);
  }
  explanation.finalMarkupPct = value.toString();
  return explanation;
}

export interface PriceComponentCost {
  component: PricingComponent;
  totalCostBase: string; // for the whole order
}

export interface PriceResult {
  currency: CurrencyCode;
  quantity: number;
  components: Array<{
    component: PricingComponent;
    costBase: string;
    markupPct: string;
    priceBase: string;
    explanation?: ComponentMarkupExplanation;
  }>;
  totalCostBase: string;
  calculatedTotalBase: string; // CALCULATED_PRICE (order total, before rounding of unit price)
  calculatedUnitPriceBase: string; // rounded per tenant rounding rule
  roundedTotalBase: string;
  profitBase: string;
  markupPct: string | null;
  marginPct: string | null;
}

export function calculatePrice(
  costs: PriceComponentCost[],
  quantity: number,
  currency: CurrencyCode,
  rules: MarginRule[],
  ctx: MarginContext,
  config: MarginConfig = DEFAULT_MARGIN_CONFIG,
  overrides: ManualOverride[] = [],
): PriceResult {
  const comps: PriceResult['components'] = [];
  let totalCost = new D(0);
  let total = new D(0);
  const grouped = new Map<PricingComponent, Decimal>();
  for (const c of costs) grouped.set(c.component, (grouped.get(c.component) ?? new D(0)).add(c.totalCostBase));

  for (const [component, cost] of grouped) {
    totalCost = totalCost.add(cost);
    if (component === 'TAX' || component === 'PASS_THROUGH') {
      const markup = component === 'TAX' && !config.taxPassThrough ? config.defaults.SERVICE : '0';
      const price = cost.mul(new D(1).add(new D(markup).div(100)));
      total = total.add(price);
      comps.push({ component, costBase: cost.toString(), markupPct: markup, priceBase: price.toString() });
      continue;
    }
    const override = overrides.find((o) => o.component === component) ?? overrides.find((o) => o.component === 'ALL') ?? null;
    const expl = resolveMarkup(component, rules, ctx, config, override);
    const price = cost.mul(new D(1).add(new D(expl.finalMarkupPct).div(100)));
    total = total.add(price);
    comps.push({ component, costBase: cost.toString(), markupPct: expl.finalMarkupPct, priceBase: price.toString(), explanation: expl });
  }

  const qty = new D(quantity);
  const unit = roundMoney(total.div(qty), currency, config.rounding);
  const roundedTotal = unit.mul(qty);
  const mm = markupAndMargin(totalCost, roundedTotal);
  return {
    currency,
    quantity,
    components: comps.map((c) => ({ ...c, costBase: new D(c.costBase).toFixed(2), priceBase: new D(c.priceBase).toFixed(2) })),
    totalCostBase: totalCost.toFixed(2),
    calculatedTotalBase: total.toFixed(2),
    calculatedUnitPriceBase: unit.toString(),
    roundedTotalBase: roundedTotal.toString(),
    profitBase: mm.profit.toFixed(2),
    markupPct: mm.markupPct ? mm.markupPct.toFixed(2) : null,
    marginPct: mm.marginPct ? mm.marginPct.toFixed(2) : null,
  };
}

/**
 * Margin simulation: re-price historical cost snapshots with a candidate rule set
 * and compare aggregate revenue/profit with the current rule set.
 */
export interface SimulationSample {
  costs: PriceComponentCost[];
  quantity: number;
  ctx: MarginContext;
}

export function simulateMarginChange(
  samples: SimulationSample[],
  currency: CurrencyCode,
  current: { rules: MarginRule[]; config: MarginConfig },
  candidate: { rules: MarginRule[]; config: MarginConfig },
) {
  const agg = (set: { rules: MarginRule[]; config: MarginConfig }) => {
    let revenue = new D(0);
    let profit = new D(0);
    let unitSum = new D(0);
    for (const s of samples) {
      const r = calculatePrice(s.costs, s.quantity, currency, set.rules, s.ctx, set.config);
      revenue = revenue.add(r.roundedTotalBase);
      profit = profit.add(r.profitBase);
      unitSum = unitSum.add(r.calculatedUnitPriceBase);
    }
    const n = samples.length || 1;
    return {
      revenue: revenue.toFixed(0),
      profit: profit.toFixed(0),
      averageUnitPrice: unitSum.div(n).toFixed(2),
      marginPct: revenue.isZero() ? null : profit.div(revenue).mul(100).toFixed(2),
    };
  };
  const before = agg(current);
  const after = agg(candidate);
  return {
    sampleCount: samples.length,
    before,
    after,
    delta: {
      revenue: new D(after.revenue).sub(before.revenue).toFixed(0),
      profit: new D(after.profit).sub(before.profit).toFixed(0),
      averageUnitPrice: new D(after.averageUnitPrice).sub(before.averageUnitPrice).toFixed(2),
    },
  };
}
