import { and, desc, eq, sql } from 'drizzle-orm';
import {
  calculateLandedCost,
  calculatePrice,
  compareFreightOptions,
  DEFAULT_MARGIN_CONFIG,
  type CostInput,
  type FreightRate,
  type LandedCostResult,
  type MarginConfig,
  type MarginRule,
  type PriceResult,
  type RiskLevel,
  type SourceType,
  type VerificationStatus,
  D,
} from '@sos/core';
import type { Tx } from '../db/client.js';
import {
  companies,
  complianceChecks,
  costCalculations,
  costItems,
  freightQuotes,
  freightRates,
  hsClassifications,
  marginRuleSets,
  pricingSnapshots,
  products,
  requestCandidates,
  sourceListings,
  sourcingProjects,
  sourcingRequests,
} from '../db/schema/index.js';
import { notFound } from '../lib/errors.js';
import { loadFxTable } from './fx.js';
import { bestTariff, tariffOptions } from './hs.js';
import { getPublished } from './settings.js';
import { effectiveAttributes } from './compliance.js';

export async function publishedMarginSet(
  tx: Tx,
  tenantId: string,
): Promise<{ id: string | null; version: number; config: MarginConfig; rules: MarginRule[] }> {
  const [row] = await tx
    .select()
    .from(marginRuleSets)
    .where(and(eq(marginRuleSets.tenantId, tenantId), eq(marginRuleSets.status, 'PUBLISHED')))
    .orderBy(desc(marginRuleSets.version))
    .limit(1);
  if (!row) return { id: null, version: 0, config: DEFAULT_MARGIN_CONFIG, rules: [] };
  return {
    id: row.id,
    version: row.version,
    config: { ...DEFAULT_MARGIN_CONFIG, ...(row.config as Partial<MarginConfig>) },
    rules: row.rules as MarginRule[],
  };
}

/** Unit price for a quantity from price tiers (highest minQty ≤ qty; falls back to the first tier). */
export function tierPrice(tiers: Array<{ minQty: number; unitPrice: string }>, qty: number): string | null {
  if (!tiers.length) return null;
  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);
  let p = sorted[0]!.unitPrice;
  for (const t of sorted) if (qty >= t.minQty) p = t.unitPrice;
  return p;
}

export interface CostOverrides {
  quantity?: number;
  items?: CostInput[]; // manual lines override automatic ones with the same key
  freightMode?: string | null;
  packing?: {
    cartonCount: number;
    cartonLengthCm: string;
    cartonWidthCm: string;
    cartonHeightCm: string;
    cartonGrossWeightKg: string;
  } | null;
  origin?: string;
  destination?: string;
  dutyRateType?: string | null;
}

export interface EstimateResult {
  calculationId: string;
  landed: LandedCostResult;
  price: PriceResult | null;
  freight: ReturnType<typeof compareFreightOptions> | null;
  dutyNote: string;
  pricingSnapshotId: string | null;
}

/**
 * Builds a landed-cost + price estimate for a request candidate from the best
 * available evidence (verified > estimated), stores it as a new cost_calculations
 * row (never overwriting previous ones) and a pricing snapshot.
 */
export async function estimateForCandidate(
  tx: Tx,
  tenantId: string,
  candidateId: string,
  userId: string | null,
  o: CostOverrides = {},
): Promise<EstimateResult> {
  const [cand] = await tx
    .select()
    .from(requestCandidates)
    .where(eq(requestCandidates.id, candidateId))
    .limit(1);
  if (!cand) throw notFound('후보를 찾을 수 없습니다.');
  const [listing] = await tx
    .select()
    .from(sourceListings)
    .where(eq(sourceListings.id, cand.listingId))
    .limit(1);
  const [req] = await tx
    .select()
    .from(sourcingRequests)
    .where(eq(sourcingRequests.id, cand.requestId))
    .limit(1);
  if (!listing || !req) throw notFound();
  const pricing = await getPublished(tx, tenantId, 'pricing');
  const search = await getPublished(tx, tenantId, 'search');
  const qty = o.quantity ?? req.quantity ?? listing.moq ?? 100;
  const { table: fx } = await loadFxTable(tx, tenantId);
  const base = pricing.baseCurrency;

  const items: CostInput[] = [];
  // Product cost: internal recommendation cost > verified supplier price > list/tier price
  if (cand.isInternalRecommendation && cand.internalCost) {
    items.push({
      key: 'product_cost',
      amount: cand.internalCost,
      currency: listing.currency,
      basis: 'PER_UNIT',
      source: 'INTERNAL_RECOMMENDATION',
      verification: 'PARTNER_VERIFIED',
    });
  } else if (listing.supplierVerifiedPrice) {
    items.push({
      key: 'product_cost',
      amount: listing.supplierVerifiedPrice,
      currency: listing.currency,
      basis: 'PER_UNIT',
      source: `SUPPLIER_VERIFIED:${listing.connector}`,
      verification: 'PARTNER_VERIFIED',
    });
  } else {
    const p = tierPrice(listing.priceTiers, qty) ?? listing.supplierListPrice;
    if (p)
      items.push({
        key: 'product_cost',
        amount: p,
        currency: listing.currency,
        basis: 'PER_UNIT',
        source: `LISTING:${listing.connector}`,
        verification: listing.isDevMock ? 'UNVERIFIED' : 'AI_ESTIMATE',
      });
  }

  // Freight: forwarder-confirmed quote for the project > engine with rate table (needs packing data)
  let freight: EstimateResult['freight'] = null;
  const pk = o.packing ?? packingFromListing(listing.packaging, qty);
  const [product] = req.productId
    ? await tx.select().from(products).where(eq(products.id, req.productId)).limit(1)
    : [];
  const attrs = product ? effectiveAttributes(product) : null;
  const [verifiedFreight] = req.projectId
    ? await tx
        .select()
        .from(freightQuotes)
        .where(
          and(
            eq(freightQuotes.projectId, req.projectId),
            sql`${freightQuotes.kind} in ('PARTNER_VERIFIED','ACTUAL')`,
          ),
        )
        .orderBy(desc(freightQuotes.createdAt))
        .limit(1)
    : [];
  if (verifiedFreight) {
    items.push({
      key: 'international_freight',
      amount: verifiedFreight.total,
      currency: verifiedFreight.currency,
      basis: 'TOTAL',
      source: `FORWARDER:${verifiedFreight.providerName}`,
      verification: verifiedFreight.kind === 'ACTUAL' ? 'ACTUAL' : 'PARTNER_VERIFIED',
    });
  } else if (pk) {
    const rateRows = await tx.select().from(freightRates).where(eq(freightRates.tenantId, tenantId));
    const rates: FreightRate[] = rateRows.map((r) => ({
      id: r.id,
      mode: r.mode as FreightRate['mode'],
      origin: r.origin,
      destination: r.destination,
      source: r.source as FreightRate['source'],
      verification: r.verification as VerificationStatus,
      currency: r.currency,
      basis: r.basis as FreightRate['basis'],
      rate: r.rate,
      minCharge: r.minCharge ?? undefined,
      fixedCharges: r.fixedCharges,
      transitDaysMin: r.transitDaysMin ?? undefined,
      transitDaysMax: r.transitDaysMax ?? undefined,
      validFrom: r.validFrom ?? undefined,
      validUntil: r.validUntil ?? undefined,
      providerName: r.providerName,
      collectedAt: r.collectedAt.toISOString(),
    }));
    freight = compareFreightOptions({
      packing: pk,
      cargo: {
        battery: attrs?.battery === 'TRUE',
        lithiumBattery: attrs?.battery === 'TRUE' && /리튬|lithium|li-ion/i.test(attrs.battery_type ?? ''),
        dangerousGoods: attrs?.flammable === 'TRUE' || attrs?.pressure_vessel === 'TRUE',
        liquid: attrs?.liquid === 'TRUE',
        magnet: attrs?.magnet === 'TRUE',
      },
      origin: o.origin ?? (listing.shippingOrigin || search.defaultOrigin),
      destination: o.destination ?? search.defaultDestination,
      rates,
      baseCurrency: base,
      fx,
    });
    const chosen = freight.options.find(
      (x) => x.mode === (o.freightMode ?? freight!.recommended) && x.status === 'PRICED',
    );
    if (chosen?.costOriginal && chosen.currency && chosen.source && chosen.verification) {
      items.push({
        key: 'international_freight',
        amount: chosen.costOriginal,
        currency: chosen.currency,
        basis: 'TOTAL',
        source: `${chosen.source}:${chosen.rate?.providerName ?? chosen.mode}`,
        verification: chosen.verification,
      });
    }
  }

  // Certification costs: expert-verified cost, else explicit estimate. Never guessed.
  if (product) {
    const checks = await tx.select().from(complianceChecks).where(eq(complianceChecks.productId, product.id));
    let certTotal = new D(0);
    let certVer: VerificationStatus = 'EXPERT_VERIFIED';
    for (const c of checks) {
      const amt = c.actualCost ?? c.verifiedCost ?? c.estimatedCost;
      if (!amt) continue;
      certTotal = certTotal.add(amt);
      if (!c.verifiedCost && !c.actualCost) certVer = 'AI_ESTIMATE';
    }
    if (certTotal.gt(0))
      items.push({
        key: 'certification',
        amount: certTotal.toString(),
        currency: 'KRW',
        basis: 'TOTAL',
        source: 'COMPLIANCE_CHECKS',
        verification: certVer,
      });
  }

  // Manual overrides replace automatic lines with the same key.
  for (const m of o.items ?? []) {
    const idx = items.findIndex((i) => i.key === m.key);
    if (idx >= 0) items.splice(idx, 1);
    items.push(m);
  }

  // Duty from HS (actual > verified > estimated) and official tariff data only.
  const [hs] = product
    ? await tx.select().from(hsClassifications).where(eq(hsClassifications.productId, product.id)).limit(1)
    : [];
  const hsCode = hs?.actualHs ?? hs?.verifiedHs ?? hs?.estimatedHs ?? null;
  const tariffs = await tariffOptions(tx, tenantId, hsCode);
  const tariff = bestTariff(tariffs, o.dutyRateType ?? hs?.selectedRateType);
  const dutyNote = !hsCode
    ? 'HS 코드 미확정'
    : !tariff
      ? `HS ${hsCode} 관세율 데이터 없음`
      : `${tariff.rateType} ${tariff.ratePct}%${tariff.requiresCertificateOfOrigin ? ' (원산지증명서 필요)' : ''}${tariff.demo ? ' · 데모 데이터' : ''}`;

  const landed = calculateLandedCost({
    quantity: qty,
    baseCurrency: base,
    items,
    duty: tariff
      ? {
          ratePct: tariff.ratePct,
          rateType: tariff.rateType,
          hsCode,
          source: tariff.source,
          verification:
            hs?.verifiedHs || hs?.actualHs ? (tariff.verification as VerificationStatus) : 'AI_ESTIMATE',
        }
      : { ratePct: null, source: 'NONE', verification: 'UNVERIFIED', hsCode },
    vatPct: pricing.vatPct,
    vatRecoverable: pricing.vatRecoverable,
    fx,
    certificationAllocation: pricing.certificationAllocation,
  });

  const [prev] = await tx
    .select({ v: sql<number>`coalesce(max(${costCalculations.version}),0)::int` })
    .from(costCalculations)
    .where(eq(costCalculations.candidateId, candidateId));
  const [calc] = await tx
    .insert(costCalculations)
    .values({
      tenantId,
      projectId: req.projectId,
      requestId: req.id,
      candidateId,
      productId: product?.id ?? null,
      version: (prev?.v ?? 0) + 1,
      kind: 'ESTIMATED',
      quantity: qty,
      baseCurrency: base,
      inputs: { items, overrides: o, dutyNote, tariffOptions: tariffs } as unknown as Record<string, unknown>,
      result: landed as unknown as Record<string, unknown>,
      landedCostTotal: landed.landedCostBase,
      landedCostPerUnit: landed.perUnitLandedCostBase,
      complete: landed.complete,
      verification: landed.verification,
      fxSnapshot: landed.fxUsed,
      createdBy: userId,
    })
    .returning({ id: costCalculations.id });
  for (const l of landed.lines) {
    await tx.insert(costItems).values({
      tenantId,
      calculationId: calc!.id,
      key: l.key,
      component: l.component,
      totalBase: l.totalBase,
      perUnitBase: l.perUnitBase,
      originalAmount: l.originalAmount,
      originalCurrency: l.originalCurrency,
      source: l.source,
      verification: l.verification,
      included: l.includedInLandedCost,
    });
  }

  // Price via the Margin Engine (only when product cost exists).
  let price: PriceResult | null = null;
  let snapshotId: string | null = null;
  if (landed.lines.some((l) => l.key === 'product_cost')) {
    const margin = await publishedMarginSet(tx, tenantId);
    const [project] = req.projectId
      ? await tx
          .select({ companyId: sourcingProjects.companyId })
          .from(sourcingProjects)
          .where(eq(sourcingProjects.id, req.projectId))
          .limit(1)
      : [];
    const [company] = project?.companyId
      ? await tx
          .select({ tier: companies.tier })
          .from(companies)
          .where(eq(companies.id, project.companyId))
          .limit(1)
      : [];
    const components = landed.lines
      .filter((l) => l.includedInLandedCost)
      .map((l) => ({ component: l.component, totalCostBase: l.totalBase }));
    price = calculatePrice(
      components,
      qty,
      base,
      margin.rules,
      {
        category: attrs?.category,
        subcategory: attrs?.subcategory,
        hsCode,
        sourceType: listing.sourceType as SourceType,
        supplierId: listing.supplierId ?? undefined,
        unitCostBase: landed.perUnitLandedCostBase,
        quantity: qty,
        moq: listing.moq,
        riskLevel: (product?.risk?.overall as RiskLevel | undefined) ?? undefined,
        customerTier: company?.tier,
        attributes: attrs as unknown as Record<string, unknown>,
      },
      { ...margin.config, rounding: { mode: pricing.roundingMode, step: pricing.roundingStep } },
    );
    const [snap] = await tx
      .insert(pricingSnapshots)
      .values({
        tenantId,
        projectId: req.projectId,
        candidateId,
        costCalculationId: calc!.id,
        marginRuleSetId: margin.id,
        quantity: qty,
        currency: base,
        supplierListPrice: listing.supplierListPrice,
        supplierVerifiedPrice: listing.supplierVerifiedPrice,
        supplierPriceCurrency: listing.currency,
        estimatedLandedCost: landed.landedCostBase,
        calculatedCustomerPrice: price.calculatedUnitPriceBase,
        priceResult: price as unknown as Record<string, unknown>,
        createdBy: userId,
      })
      .returning({ id: pricingSnapshots.id });
    snapshotId = snap!.id;
  }
  await tx
    .update(requestCandidates)
    .set({ unitPriceBase: landed.perUnitLandedCostBase, updatedAt: new Date() })
    .where(eq(requestCandidates.id, candidateId));
  return { calculationId: calc!.id, landed, price, freight, dutyNote, pricingSnapshotId: snapshotId };
}

function packingFromListing(p: Record<string, unknown>, qty: number) {
  const upc = Number(p.unitsPerCarton ?? 0);
  if (!upc || !p.cartonL || !p.cartonW || !p.cartonH || !p.cartonGw) return null;
  return {
    cartonCount: Math.max(1, Math.ceil(qty / upc)),
    cartonLengthCm: String(p.cartonL),
    cartonWidthCm: String(p.cartonW),
    cartonHeightCm: String(p.cartonH),
    cartonGrossWeightKg: String(p.cartonGw),
  };
}
