import { D, median, type CurrencyCode } from './money.js';
import type { SourceType } from './enums.js';

/**
 * Product clustering + explainable Best Match ranking + price anomaly detection.
 * No black-box "AI 95점": every score is a weighted sum of named components,
 * each with its own evidence, and the weights are tenant-configurable.
 */

// ───────────────────────────── similarity primitives ─────────────────────────────

/** Hamming distance between two hex-encoded perceptual hashes. */
export function hammingHex(a: string, b: string): number | null {
  if (!a || !b || a.length !== b.length) return null;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (x) {
      dist += x & 1;
      x >>= 1;
    }
  }
  return dist;
}

/** Similarity in [0,1] from pHash hamming distance (64-bit hash assumed when hex length 16). */
export function phashSimilarity(a?: string | null, b?: string | null): number | null {
  if (!a || !b) return null;
  const d = hammingHex(a, b);
  if (d === null) return null;
  const bits = a.length * 4;
  return 1 - d / bits;
}

export function cosine(a?: number[] | null, b?: number[] | null): number | null {
  if (!a || !b || a.length === 0 || a.length !== b.length) return null;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return null;
  return dot / Math.sqrt(na * nb);
}

const CJK = /[぀-ヿ㐀-鿿가-힯]/;

/** Tokenizer that handles Latin words and CJK/Hangul bigrams. */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase().normalize('NFKC');
  const tokens: string[] = [];
  for (const chunk of lower.split(/[\s,.;:/|()[\]{}"'!?+\-_*#&]+/)) {
    if (!chunk) continue;
    if (CJK.test(chunk)) {
      const chars = [...chunk];
      if (chars.length === 1) tokens.push(chunk);
      for (let i = 0; i < chars.length - 1; i++) tokens.push(chars[i]! + chars[i + 1]!);
    } else if (chunk.length > 1) {
      tokens.push(chunk);
    }
  }
  return tokens;
}

export function jaccard(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export function normalizeModel(m?: string | null): string | null {
  if (!m || m === 'UNKNOWN') return null;
  const n = m.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return n.length >= 3 ? n : null;
}

// ───────────────────────────── clustering ─────────────────────────────

export interface ClusterableListing {
  id: string;
  title: string;
  phash?: string | null;
  embedding?: number[] | null;
  model?: string | null;
  specs?: Record<string, string>;
  unitPrice?: string | null; // in listing currency
  currency?: CurrencyCode;
  moq?: number | null;
  supplierId?: string | null;
  sellerQuality?: number | null; // 0..1
}

export interface ClusterThresholds {
  embedding: number; // cosine >= → same product
  phash: number; // similarity >=
  title: number; // jaccard >= (only combined with another signal)
}

export const DEFAULT_CLUSTER_THRESHOLDS: ClusterThresholds = { embedding: 0.92, phash: 0.9, title: 0.55 };

export function pairSimilarity(a: ClusterableListing, b: ClusterableListing) {
  const emb = cosine(a.embedding, b.embedding);
  const ph = phashSimilarity(a.phash, b.phash);
  const title = jaccard(a.title, b.title);
  const ma = normalizeModel(a.model);
  const mb = normalizeModel(b.model);
  const model = ma && mb ? (ma === mb ? 1 : 0) : null;
  let specAgree = 0;
  let specTotal = 0;
  for (const [k, v] of Object.entries(a.specs ?? {})) {
    const o = b.specs?.[k];
    if (o === undefined || v === 'UNKNOWN' || o === 'UNKNOWN') continue;
    specTotal++;
    if (o.trim().toLowerCase() === v.trim().toLowerCase()) specAgree++;
  }
  const spec = specTotal ? specAgree / specTotal : null;
  return { embedding: emb, phash: ph, title, model, spec };
}

export function sameProduct(a: ClusterableListing, b: ClusterableListing, t: ClusterThresholds = DEFAULT_CLUSTER_THRESHOLDS): { same: boolean; reasons: string[] } {
  const s = pairSimilarity(a, b);
  const reasons: string[] = [];
  if (s.model === 0) return { same: false, reasons: ['모델번호 불일치'] };
  if (s.model === 1) reasons.push('모델번호 일치');
  if (s.embedding !== null && s.embedding >= t.embedding) reasons.push(`이미지 임베딩 유사도 ${(s.embedding * 100).toFixed(0)}%`);
  if (s.phash !== null && s.phash >= t.phash) reasons.push(`이미지 해시 유사도 ${(s.phash * 100).toFixed(0)}%`);
  const strongImage = reasons.some((r) => r.startsWith('이미지'));
  const titleOk = s.title >= t.title;
  if (titleOk) reasons.push(`제목 유사도 ${(s.title * 100).toFixed(0)}%`);
  if (s.spec !== null && s.spec < 0.5) return { same: false, reasons: [...reasons, '주요 스펙 불일치'] };
  const same = s.model === 1 || strongImage || (titleOk && s.spec !== null && s.spec >= 0.8);
  return { same, reasons };
}

export interface ClusterStats {
  memberIds: string[];
  supplierCount: number;
  lowestPrice: string | null;
  medianPrice: string | null;
  highestPrice: string | null;
  currency: CurrencyCode | null;
  moqDistribution: { min: number | null; median: number | null; max: number | null };
  avgSellerQuality: number | null;
  reasons: string[];
}

/** Union-find clustering. Prices are compared only within the same currency. */
export function clusterListings(items: ClusterableListing[], t: ClusterThresholds = DEFAULT_CLUSTER_THRESHOLDS): ClusterStats[] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const reasonsByRoot = new Map<number, Set<string>>();
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const r = sameProduct(items[i]!, items[j]!, t);
      if (r.same) {
        const a = find(i);
        const b = find(j);
        if (a !== b) parent[b] = a;
        const root = find(i);
        const set = reasonsByRoot.get(root) ?? new Set<string>();
        r.reasons.forEach((x) => set.add(x));
        reasonsByRoot.set(root, set);
      }
    }
  }
  const groups = new Map<number, ClusterableListing[]>();
  items.forEach((it, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), it]);
  });
  return [...groups.entries()].map(([root, members]) => {
    const currencies = [...new Set(members.map((m) => m.currency).filter(Boolean))] as string[];
    const currency = currencies.length === 1 ? currencies[0]! : null;
    const prices = currency ? members.map((m) => m.unitPrice).filter((p): p is string => !!p) : [];
    const sortedPrices = prices.map((p) => new D(p)).sort((a, b) => a.comparedTo(b));
    const moqs = members.map((m) => m.moq).filter((m): m is number => typeof m === 'number').sort((a, b) => a - b);
    const quality = members.map((m) => m.sellerQuality).filter((q): q is number => typeof q === 'number');
    return {
      memberIds: members.map((m) => m.id),
      supplierCount: new Set(members.map((m) => m.supplierId ?? m.id)).size,
      lowestPrice: sortedPrices[0]?.toString() ?? null,
      medianPrice: median(prices)?.toString() ?? null,
      highestPrice: sortedPrices.at(-1)?.toString() ?? null,
      currency,
      moqDistribution: {
        min: moqs[0] ?? null,
        median: moqs.length ? moqs[Math.floor(moqs.length / 2)]! : null,
        max: moqs.at(-1) ?? null,
      },
      avgSellerQuality: quality.length ? quality.reduce((a, b) => a + b, 0) / quality.length : null,
      reasons: [...(reasonsByRoot.get(root) ?? [])],
    };
  });
}

// ───────────────────────────── price anomaly ─────────────────────────────

export interface PriceAnomaly {
  anomalous: boolean;
  ratioToMedian: string | null;
  message: string | null;
}

export function detectPriceAnomaly(price: string, clusterMedian: string | null, lowRatio = 0.5, highRatio = 2.5): PriceAnomaly {
  if (!clusterMedian || new D(clusterMedian).isZero()) return { anomalous: false, ratioToMedian: null, message: null };
  const ratio = new D(price).div(clusterMedian);
  if (ratio.lt(lowRatio)) {
    return {
      anomalous: true,
      ratioToMedian: ratio.toFixed(2),
      message: `비정상적으로 낮은 가격입니다 (중앙값의 ${ratio.mul(100).toFixed(0)}%). MOQ·옵션·미끼가격 여부를 확인하세요.`,
    };
  }
  if (ratio.gt(highRatio)) {
    return { anomalous: true, ratioToMedian: ratio.toFixed(2), message: `동일 제품 중앙값 대비 ${ratio.toFixed(1)}배 높은 가격입니다.` };
  }
  return { anomalous: false, ratioToMedian: ratio.toFixed(2), message: null };
}

// ───────────────────────────── best match ranking ─────────────────────────────

export const MATCH_COMPONENTS = [
  'image_match',
  'spec_match',
  'target_price_match',
  'moq_match',
  'supplier_reliability',
  'quality_history',
  'lead_time',
  'oem',
  'compliance',
  'logistics',
  'communication',
  'past_orders',
] as const;
export type MatchComponent = (typeof MATCH_COMPONENTS)[number];

export const MATCH_COMPONENT_LABEL_KO: Record<MatchComponent, string> = {
  image_match: '이미지 일치',
  spec_match: '스펙 일치',
  target_price_match: '목표가 부합',
  moq_match: 'MOQ 부합',
  supplier_reliability: '공급자 신뢰도',
  quality_history: '품질 이력',
  lead_time: '납기',
  oem: 'OEM 대응',
  compliance: '인증 준비도',
  logistics: '물류 조건',
  communication: '소통 품질',
  past_orders: '거래 이력',
};

export type MatchWeights = Record<MatchComponent, number>;

export const DEFAULT_MATCH_WEIGHTS: MatchWeights = {
  image_match: 20,
  spec_match: 12,
  target_price_match: 14,
  moq_match: 8,
  supplier_reliability: 12,
  quality_history: 8,
  lead_time: 6,
  oem: 4,
  compliance: 6,
  logistics: 4,
  communication: 3,
  past_orders: 3,
};

export interface CandidateInput {
  id: string;
  sourceType: SourceType;
  unitPriceBase: string | null; // comparable unit cost in base currency
  moq: number | null;
  leadTimeDays: number | null;
  imageSimilarity: number | null; // 0..1
  specMatch: number | null; // 0..1
  supplierReliability: number | null; // 0..1
  qualityHistory: number | null; // 0..1
  oemSupported: boolean | null;
  complianceReadiness: number | null; // 0..1
  logisticsScore: number | null; // 0..1
  communication: number | null; // 0..1
  pastOrders: number | null; // count
  pinned?: boolean;
}

export interface MatchRequest {
  targetUnitPriceBase: string | null;
  quantity: number | null;
  wantsOem: boolean;
  desiredLeadTimeDays: number | null;
}

export interface ScoredCandidate {
  id: string;
  total: number; // 0..100, weighted over components with data
  coverage: number; // share of weight that had data
  components: Array<{ key: MatchComponent; label: string; score: number | null; weight: number; evidence: string }>;
  tags: MatchTag[];
  reasons: string[];
  cautions: string[];
  pinned: boolean;
}

export const MATCH_TAGS = [
  'BEST_MATCH',
  'LOWEST_COST',
  'BEST_QUALITY',
  'BEST_FOR_OEM',
  'LOW_MOQ',
  'FASTEST_DELIVERY',
  'PRIVATE_NETWORK_RECOMMENDED',
] as const;
export type MatchTag = (typeof MATCH_TAGS)[number];

export const MATCH_TAG_LABEL_KO: Record<MatchTag, string> = {
  BEST_MATCH: '가장 적합',
  LOWEST_COST: '최저 비용',
  BEST_QUALITY: '품질 우수',
  BEST_FOR_OEM: 'OEM 추천',
  LOW_MOQ: '소량 가능',
  FASTEST_DELIVERY: '빠른 납기',
  PRIVATE_NETWORK_RECOMMENDED: '자체 공급망 추천',
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function componentScores(c: CandidateInput, req: MatchRequest): Array<{ key: MatchComponent; score: number | null; evidence: string }> {
  const out: Array<{ key: MatchComponent; score: number | null; evidence: string }> = [];
  out.push({ key: 'image_match', score: c.imageSimilarity, evidence: c.imageSimilarity === null ? '이미지 비교 불가' : `이미지 유사도 ${(c.imageSimilarity * 100).toFixed(0)}%` });
  out.push({ key: 'spec_match', score: c.specMatch, evidence: c.specMatch === null ? '스펙 정보 부족' : `스펙 ${(c.specMatch * 100).toFixed(0)}% 일치` });

  if (c.unitPriceBase && req.targetUnitPriceBase && !new D(req.targetUnitPriceBase).isZero()) {
    const ratio = new D(c.unitPriceBase).div(req.targetUnitPriceBase).toNumber();
    // At or below target → 1; linearly down to 0 at 2× target.
    const s = ratio <= 1 ? 1 : clamp01(2 - ratio);
    out.push({ key: 'target_price_match', score: s, evidence: `목표가 대비 ${(ratio * 100).toFixed(0)}%` });
  } else {
    out.push({ key: 'target_price_match', score: null, evidence: '목표가 또는 단가 정보 없음' });
  }

  if (c.moq !== null && req.quantity !== null) {
    const s = req.quantity >= c.moq ? 1 : clamp01(req.quantity / c.moq);
    out.push({ key: 'moq_match', score: s, evidence: req.quantity >= c.moq ? `MOQ ${c.moq} 충족` : `MOQ ${c.moq} (희망 ${req.quantity})` });
  } else {
    out.push({ key: 'moq_match', score: null, evidence: 'MOQ 정보 없음' });
  }
  out.push({ key: 'supplier_reliability', score: c.supplierReliability, evidence: c.supplierReliability === null ? '공급자 정보 부족' : `신뢰도 ${(c.supplierReliability * 100).toFixed(0)}점` });
  out.push({ key: 'quality_history', score: c.qualityHistory, evidence: c.qualityHistory === null ? '품질 이력 없음' : `품질 이력 ${(c.qualityHistory * 100).toFixed(0)}점` });
  if (c.leadTimeDays !== null) {
    const target = req.desiredLeadTimeDays ?? 30;
    const s = c.leadTimeDays <= target ? 1 : clamp01(1 - (c.leadTimeDays - target) / target);
    out.push({ key: 'lead_time', score: s, evidence: `생산 ${c.leadTimeDays}일` });
  } else {
    out.push({ key: 'lead_time', score: null, evidence: '납기 정보 없음' });
  }
  out.push({
    key: 'oem',
    score: req.wantsOem ? (c.oemSupported === null ? null : c.oemSupported ? 1 : 0) : null,
    evidence: !req.wantsOem ? 'OEM 불필요' : c.oemSupported === null ? 'OEM 가능 여부 미확인' : c.oemSupported ? 'OEM 가능' : 'OEM 불가',
  });
  out.push({ key: 'compliance', score: c.complianceReadiness, evidence: c.complianceReadiness === null ? '인증 서류 미확인' : `인증 준비도 ${(c.complianceReadiness * 100).toFixed(0)}%` });
  out.push({ key: 'logistics', score: c.logisticsScore, evidence: c.logisticsScore === null ? '물류 정보 없음' : `물류 점수 ${(c.logisticsScore * 100).toFixed(0)}` });
  out.push({ key: 'communication', score: c.communication, evidence: c.communication === null ? '소통 이력 없음' : `응답 품질 ${(c.communication * 100).toFixed(0)}` });
  out.push({
    key: 'past_orders',
    score: c.pastOrders === null ? null : clamp01(Math.log10(1 + c.pastOrders) / 2),
    evidence: c.pastOrders === null ? '거래 이력 없음' : `과거 거래 ${c.pastOrders}건`,
  });
  return out;
}

export function rankCandidates(candidates: CandidateInput[], req: MatchRequest, weights: MatchWeights = DEFAULT_MATCH_WEIGHTS, medianUnitPriceBase?: string | null): ScoredCandidate[] {
  const scored: ScoredCandidate[] = candidates.map((c) => {
    const comps = componentScores(c, req);
    let wsum = 0;
    let acc = 0;
    let totalWeight = 0;
    const components = comps.map((x) => {
      const w = weights[x.key] ?? 0;
      totalWeight += w;
      if (x.score !== null && w > 0) {
        wsum += w;
        acc += w * x.score;
      }
      return { key: x.key, label: MATCH_COMPONENT_LABEL_KO[x.key], score: x.score, weight: w, evidence: x.evidence };
    });
    const total = wsum > 0 ? (acc / wsum) * 100 : 0;
    const cautions: string[] = [];
    if (c.unitPriceBase && medianUnitPriceBase) {
      const a = detectPriceAnomaly(c.unitPriceBase, medianUnitPriceBase);
      if (a.anomalous && a.message) cautions.push(a.message);
    }
    const coverage = totalWeight ? wsum / totalWeight : 0;
    if (coverage < 0.5) cautions.push('비교 데이터가 부족해 점수 신뢰도가 낮습니다.');
    const reasons = components
      .filter((x) => x.score !== null && x.score >= 0.8 && x.weight > 0)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3)
      .map((x) => `${x.label}: ${x.evidence}`);
    return { id: c.id, total: Math.round(total * 10) / 10, coverage: Math.round(coverage * 100) / 100, components, tags: [], reasons, cautions, pinned: !!c.pinned };
  });

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const eligible = scored.filter((s) => s.coverage >= 0.3);
  const tag = (t: MatchTag, pick: ScoredCandidate | undefined) => {
    if (pick) pick.tags.push(t);
  };
  const best = [...eligible].sort((a, b) => b.total - a.total)[0];
  tag('BEST_MATCH', best);

  const imageOk = (s: ScoredCandidate) => {
    const im = s.components.find((c) => c.key === 'image_match')?.score;
    return im === null || im === undefined || im >= 0.6;
  };
  const priced = eligible.filter((s) => byId.get(s.id)?.unitPriceBase && imageOk(s) && !s.cautions.some((c) => c.includes('비정상적으로 낮은')));
  tag('LOWEST_COST', [...priced].sort((a, b) => new D(byId.get(a.id)!.unitPriceBase!).comparedTo(byId.get(b.id)!.unitPriceBase!))[0]);

  const qualityScore = (s: ScoredCandidate) => {
    const q = s.components.find((c) => c.key === 'quality_history')?.score;
    const r = s.components.find((c) => c.key === 'supplier_reliability')?.score;
    if (q === null && r === null) return null;
    return ((q ?? r ?? 0) + (r ?? q ?? 0)) / 2;
  };
  tag('BEST_QUALITY', [...eligible].filter((s) => qualityScore(s) !== null).sort((a, b) => qualityScore(b)! - qualityScore(a)!)[0]);
  if (req.wantsOem) tag('BEST_FOR_OEM', [...eligible].filter((s) => byId.get(s.id)?.oemSupported).sort((a, b) => b.total - a.total)[0]);
  tag('LOW_MOQ', [...eligible].filter((s) => byId.get(s.id)?.moq !== null).sort((a, b) => byId.get(a.id)!.moq! - byId.get(b.id)!.moq!)[0]);
  tag('FASTEST_DELIVERY', [...eligible].filter((s) => byId.get(s.id)?.leadTimeDays !== null).sort((a, b) => byId.get(a.id)!.leadTimeDays! - byId.get(b.id)!.leadTimeDays!)[0]);
  const privateTypes: SourceType[] = ['PRIVATE_NETWORK', 'DIRECT_FACTORY', 'INTERNAL_PRODUCT', 'LOCAL_PARTNER', 'MANUAL_PROPOSAL'];
  tag('PRIVATE_NETWORK_RECOMMENDED', [...eligible].filter((s) => privateTypes.includes(byId.get(s.id)!.sourceType)).sort((a, b) => b.total - a.total)[0]);

  return scored.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.total - a.total);
}
