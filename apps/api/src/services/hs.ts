import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { tokenize, type ProductAttributes } from '@sos/core';
import type { Tx } from '../db/client.js';
import { hsClassifications, hsCodes, tariffRates } from '../db/schema/index.js';
import { aiChat, AiUnavailableError, parseJsonLoose } from './ai/router.js';

/**
 * HS / Customs Engine.
 *   attributes → candidate search over the HS table (keywords + trigram)
 *   → optional LLM re-ranking *restricted to those candidates* (it cannot invent codes)
 *   → top 3 → customs broker review.
 * Tariff rates are read only from imported official data; nothing is generated.
 */

export interface HsCandidate {
  code: string;
  description: string;
  score: number;
  reasons: string[];
  source: string;
}

export async function findHsCandidates(tx: Tx, tenantId: string, attrs: ProductAttributes, extraText = ''): Promise<HsCandidate[]> {
  const words = [attrs.product_name_ko, attrs.product_name_en, attrs.product_name_cn, attrs.category, attrs.subcategory, ...attrs.search_keywords_ko, ...attrs.search_keywords_en, ...attrs.search_keywords_cn, extraText]
    .filter((w) => w && w !== 'UNKNOWN')
    .join(' ');
  if (!words.trim()) return [];
  const rows = await tx
    .select()
    .from(hsCodes)
    .where(or(isNull(hsCodes.tenantId), eq(hsCodes.tenantId, tenantId)))
    .limit(20000);
  const qTokens = new Set(tokenize(words));
  const lower = words.toLowerCase();
  const scored = rows
    .map((r) => {
      const reasons: string[] = [];
      let score = 0;
      for (const k of r.keywords) {
        if (lower.includes(k.toLowerCase())) {
          score += 3;
          reasons.push(`키워드 "${k}"`);
        }
      }
      const dTokens = tokenize(`${r.descriptionKo} ${r.descriptionEn}`);
      let overlap = 0;
      for (const t of dTokens) if (qTokens.has(t)) overlap++;
      if (overlap) {
        score += Math.min(4, overlap * 0.8);
        reasons.push(`품목 설명 일치 ${overlap}개`);
      }
      // Attribute consistency hints
      if (attrs.battery === 'TRUE' && r.code.startsWith('8507')) score += 0.5;
      if (attrs.electrical === 'FALSE' && /^8[45]/.test(r.code)) score -= 2;
      return { code: r.code, description: r.descriptionKo || r.descriptionEn, score, reasons, source: r.source };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  const max = scored[0]?.score ?? 1;
  return scored.map((c) => ({ ...c, score: Math.round((c.score / max) * 100) / 100 }));
}

/** Optional LLM re-rank among existing candidates only. Unknown codes in the answer are discarded. */
export async function rerankWithAi(tenantId: string, attrs: ProductAttributes, candidates: HsCandidate[]): Promise<{ ranked: HsCandidate[]; used: boolean; provider?: string }> {
  if (candidates.length < 2) return { ranked: candidates, used: false };
  try {
    const r = await aiChat(
      tenantId,
      'HS_RERANK',
      [
        { role: 'system', content: 'You help a Korean customs broker. Rank ONLY the given HS candidates for the product. Do not add new codes. Return JSON {"ranking":[{"code":"...","reason":"한국어 한 문장"}]}.' },
        { role: 'user', content: JSON.stringify({ product: { name: attrs.product_name_ko, en: attrs.product_name_en, category: attrs.category, material: attrs.material, electrical: attrs.electrical, battery: attrs.battery, features: attrs.features }, candidates: candidates.map((c) => ({ code: c.code, description: c.description })) }) },
      ],
      { json: true, maxTokens: 600 },
    );
    const parsed = parseJsonLoose<{ ranking?: Array<{ code: string; reason?: string }> }>(r.text);
    const allowed = new Map(candidates.map((c) => [c.code, c]));
    const ranked: HsCandidate[] = [];
    for (const item of parsed?.ranking ?? []) {
      const c = allowed.get(String(item.code).replace(/\D/g, ''));
      if (c && !ranked.includes(c)) ranked.push({ ...c, reasons: item.reason ? [...c.reasons, `AI: ${item.reason}`] : c.reasons });
    }
    for (const c of candidates) if (!ranked.find((x) => x.code === c.code)) ranked.push(c);
    return { ranked, used: true, provider: r.provider };
  } catch (e) {
    if (e instanceof AiUnavailableError) return { ranked: candidates, used: false };
    return { ranked: candidates, used: false };
  }
}

export async function saveEstimatedHs(tx: Tx, tenantId: string, productId: string, candidates: HsCandidate[], source: string): Promise<void> {
  const top = candidates[0] ?? null;
  const values = {
    tenantId,
    productId,
    candidates: candidates.slice(0, 3),
    estimatedHs: top?.code ?? null,
    estimatedConfidence: top ? Math.min(0.9, 0.4 + top.score * 0.4 - (candidates[1] && candidates[1].score > 0.8 ? 0.15 : 0)) : null,
    estimatedSource: source,
    updatedAt: new Date(),
  };
  // Upsert touches ONLY the estimated fields — verified/actual are never overwritten.
  await tx
    .insert(hsClassifications)
    .values(values)
    .onConflictDoUpdate({ target: hsClassifications.productId, set: { candidates: values.candidates, estimatedHs: values.estimatedHs, estimatedConfidence: values.estimatedConfidence, estimatedSource: values.estimatedSource, updatedAt: new Date() } });
}

export interface TariffOption {
  rateType: string;
  ratePct: string | null;
  source: string;
  verification: string;
  requiresCertificateOfOrigin: boolean;
  validFrom: string | null;
  validTo: string | null;
  demo: boolean;
}

/** Applicable tariff rates for an HS code (longest matching prefix), origin-aware. */
export async function tariffOptions(tx: Tx, tenantId: string, hsCode: string | null, originCountry = 'CN'): Promise<TariffOption[]> {
  if (!hsCode) return [];
  const clean = hsCode.replace(/\D/g, '');
  const rows = await tx
    .select()
    .from(tariffRates)
    .where(and(or(isNull(tariffRates.tenantId), eq(tariffRates.tenantId, tenantId)), sql`${clean} like ${tariffRates.hsCode} || '%'`, or(eq(tariffRates.originCountry, '*'), eq(tariffRates.originCountry, originCountry))))
    .orderBy(desc(sql`length(${tariffRates.hsCode})`));
  const best = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!best.has(r.rateType)) best.set(r.rateType, r);
  return [...best.values()].map((r) => ({
    rateType: r.rateType,
    ratePct: r.ratePct,
    source: r.source,
    verification: r.verification,
    requiresCertificateOfOrigin: r.requiresCertificateOfOrigin,
    validFrom: r.validFrom,
    validTo: r.validTo,
    demo: r.source === 'DEMO_DATA',
  }));
}

/** Picks the lowest applicable rate; preferential rates require a certificate of origin (flagged). */
export function bestTariff(options: TariffOption[], preferRateType?: string | null): TariffOption | null {
  const withRate = options.filter((o) => o.ratePct !== null);
  if (!withRate.length) return null;
  if (preferRateType) {
    const p = withRate.find((o) => o.rateType === preferRateType);
    if (p) return p;
  }
  return withRate.reduce((a, b) => (Number(a.ratePct) <= Number(b.ratePct) ? a : b));
}
