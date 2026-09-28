import type { ComplianceStatus, ExpertType } from './enums.js';
import { TRI_ATTRIBUTE_LABEL_KO, type ProductAttributes, type TriAttributeKey } from './product.js';

/**
 * Korea Compliance Engine — rule evaluation.
 *
 * AI never decides applicability on its own. The engine combines:
 *   1. structured attributes (tri-state, UNKNOWN when not observed)
 *   2. versioned regulation rules (trigger attributes, HS prefixes, exceptions)
 *   3. expert verification (stored separately, never overwriting estimates)
 */

export interface RegulationRule {
  regulationId: string;
  versionId: string;
  code: string;
  name: string;
  authority: string;
  category: string;
  /** Match if ALL of these attributes are TRUE. */
  triggerAll: TriAttributeKey[];
  /** …and at least one of these (when non-empty). */
  triggerAny: TriAttributeKey[];
  /** Rule does not apply if any of these attributes is TRUE. */
  exceptions: TriAttributeKey[];
  hsPrefixes: string[];
  mandatory: boolean;
  documentsRequired: string[];
  testsRequired: string[];
  expertType: ExpertType | null;
  officialSource: string | null;
}

export interface ComplianceEvaluation {
  regulationId: string;
  versionId: string;
  code: string;
  name: string;
  authority: string;
  status: ComplianceStatus;
  confidence: number;
  reasons: string[];
  missingAttributes: TriAttributeKey[];
  documentsRequired: string[];
  testsRequired: string[];
  expertType: ExpertType | null;
  mandatory: boolean;
}

function hsMatches(prefixes: string[], hs?: string | null): boolean | null {
  if (!prefixes.length) return null;
  if (!hs) return null;
  const clean = hs.replace(/\D/g, '');
  return prefixes.some((p) => clean.startsWith(p.replace(/\D/g, '')));
}

export function evaluateRegulation(rule: RegulationRule, attrs: ProductAttributes, hsCode?: string | null, aiConfidence = attrs.confidence): ComplianceEvaluation {
  const reasons: string[] = [];
  const missing: TriAttributeKey[] = [];
  const val = (k: TriAttributeKey) => attrs[k];

  for (const ex of rule.exceptions) {
    if (val(ex) === 'TRUE') {
      return base(rule, 'NOT_APPLICABLE', 0.7, [`예외 조건: ${TRI_ATTRIBUTE_LABEL_KO[ex]}`], []);
    }
  }

  // Rules without attribute triggers are purely HS-driven (e.g. fire equipment).
  if (rule.triggerAll.length === 0 && rule.triggerAny.length === 0) {
    const hsOnly = hsMatches(rule.hsPrefixes, hsCode);
    if (hsOnly === true) return base(rule, 'RULE_MATCHED', 0.8, [`HS ${hsCode} 해당 범위`], []);
    return base(rule, 'NOT_APPLICABLE', hsOnly === null ? 0.3 : 0.7, [hsOnly === null ? 'HS 코드 확정 후 다시 판단합니다.' : 'HS 코드 범위 밖'], []);
  }

  let allTrue = true;
  let anyFalse = false;
  for (const k of rule.triggerAll) {
    const v = val(k);
    if (v === 'TRUE') reasons.push(TRI_ATTRIBUTE_LABEL_KO[k]);
    else if (v === 'UNKNOWN') {
      allTrue = false;
      missing.push(k);
    } else {
      allTrue = false;
      anyFalse = true;
    }
  }

  let anySatisfied: boolean | null = rule.triggerAny.length ? false : true;
  let anyUnknown = false;
  for (const k of rule.triggerAny) {
    const v = val(k);
    if (v === 'TRUE') {
      anySatisfied = true;
      reasons.push(TRI_ATTRIBUTE_LABEL_KO[k]);
    } else if (v === 'UNKNOWN') {
      anyUnknown = true;
      missing.push(k);
    }
  }
  if (anySatisfied === false && anyUnknown) anySatisfied = null;

  const hs = hsMatches(rule.hsPrefixes, hsCode);
  if (hs === true) reasons.push(`HS ${hsCode} 해당 범위`);

  if (anyFalse || anySatisfied === false) {
    if (hs === true) {
      return base(rule, 'EXPERT_REVIEW_REQUIRED', 0.5, [...reasons, '제품 특성과 HS 분류가 서로 다른 결과를 보입니다.'], missing);
    }
    return base(rule, 'NOT_APPLICABLE', 0.6, ['제품 특성상 해당하지 않음'], []);
  }

  if (allTrue && anySatisfied === true) {
    // All triggers observed TRUE: a rule match. Confidence depends on how the attributes were obtained.
    const status: ComplianceStatus = aiConfidence >= 0.75 || hs === true ? 'RULE_MATCHED' : 'AI_LIKELY';
    return base(rule, status, Math.min(0.95, 0.6 + aiConfidence * 0.3 + (hs === true ? 0.1 : 0)), reasons, missing);
  }

  // Some triggers unknown.
  if (hs === true) return base(rule, 'AI_LIKELY', 0.55, [...reasons, '일부 특성 미확인'], missing);
  if (reasons.length > 0) return base(rule, 'AI_POSSIBLE', 0.4, [...reasons, '일부 특성 미확인'], missing);
  return base(rule, 'UNKNOWN', 0.2, ['판단에 필요한 제품 정보가 부족합니다.'], missing);
}

function base(rule: RegulationRule, status: ComplianceStatus, confidence: number, reasons: string[], missing: TriAttributeKey[]): ComplianceEvaluation {
  return {
    regulationId: rule.regulationId,
    versionId: rule.versionId,
    code: rule.code,
    name: rule.name,
    authority: rule.authority,
    status,
    confidence: Math.round(confidence * 100) / 100,
    reasons,
    missingAttributes: missing,
    documentsRequired: rule.documentsRequired,
    testsRequired: rule.testsRequired,
    expertType: rule.expertType,
    mandatory: rule.mandatory,
  };
}

export function evaluateCompliance(rules: RegulationRule[], attrs: ProductAttributes, hsCode?: string | null): ComplianceEvaluation[] {
  const order: Record<ComplianceStatus, number> = {
    CONFIRMED: 0,
    RULE_MATCHED: 1,
    AI_LIKELY: 2,
    EXPERT_REVIEW_REQUIRED: 3,
    AI_POSSIBLE: 4,
    VERIFIED: 5,
    UNKNOWN: 6,
    REJECTED: 7,
    NOT_APPLICABLE: 8,
  };
  return rules.map((r) => evaluateRegulation(r, attrs, hsCode)).sort((a, b) => order[a.status] - order[b.status] || b.confidence - a.confidence);
}

/** Documents typically needed for the product passport, derived from attributes. */
export function suggestRequiredDocuments(attrs: ProductAttributes, evaluations: ComplianceEvaluation[]): string[] {
  const docs = new Set<string>(['제품 사양서 (Specification)', '포장 정보 (Packing info)', '공장 등록/인증서']);
  if (attrs.electrical !== 'FALSE') docs.add('회로도/도면 (Drawing)');
  if (attrs.electrical === 'TRUE') {
    docs.add('부품 목록 (BOM)');
    docs.add('CB 시험성적서 (보유 시)');
  }
  if (attrs.battery === 'TRUE') {
    docs.add('배터리 사양서');
    docs.add('UN38.3 시험요약서');
    docs.add('MSDS / SDS');
  }
  if (attrs.chemical_product === 'TRUE' || attrs.liquid === 'TRUE') docs.add('MSDS / SDS');
  if (attrs.wireless === 'TRUE') docs.add('RF 시험성적서 (보유 시)');
  docs.add('기존 KC 인증서 (보유 시)');
  docs.add('CE 시험성적서 (보유 시)');
  for (const e of evaluations) {
    if (['RULE_MATCHED', 'AI_LIKELY', 'CONFIRMED', 'EXPERT_REVIEW_REQUIRED'].includes(e.status)) e.documentsRequired.forEach((d) => docs.add(d));
  }
  return [...docs];
}
