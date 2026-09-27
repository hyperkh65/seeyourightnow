import type { ComplianceEvaluation } from './compliance.js';
import type { RiskDimension, RiskLevel } from './enums.js';
import type { ProductAttributes } from './product.js';

/**
 * Product Risk Engine. Each dimension gets a level *and* the reasons behind it.
 */

export interface RiskInput {
  attributes: ProductAttributes;
  compliance?: ComplianceEvaluation[];
  hsVerified?: boolean;
  hsCandidates?: number;
  supplier?: {
    yearsInBusiness?: number | null;
    verified?: boolean | null;
    claimCount?: number;
    lateDeliveryCount?: number;
    orderCount?: number;
    blacklisted?: boolean;
    responseHours?: number | null;
    priceAnomaly?: boolean;
    missingFactoryData?: boolean;
    frequentPriceChanges?: boolean;
  };
  freight?: { hasVerifiedRate: boolean; dangerousGoods?: boolean };
  fx?: { volatilityPct30d?: number | null };
  payment?: { overdue?: boolean; creditLevel?: string | null };
  market?: { competitorCount?: number | null; priceGapPct?: number | null };
  brandOrIpSignals?: boolean;
  stalePriceDays?: number | null;
}

export interface RiskItem {
  dimension: RiskDimension;
  level: RiskLevel;
  reasons: string[];
}

const LEVEL_ORDER: RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const maxLevel = (a: RiskLevel, b: RiskLevel) => (LEVEL_ORDER.indexOf(a) >= LEVEL_ORDER.indexOf(b) ? a : b);

export function assessRisk(input: RiskInput): { items: RiskItem[]; overall: RiskLevel } {
  const a = input.attributes;
  const items: RiskItem[] = [];
  const push = (dimension: RiskDimension, level: RiskLevel, reasons: string[]) => {
    if (reasons.length) items.push({ dimension, level, reasons });
  };

  // Certification / compliance
  const likely = (input.compliance ?? []).filter((c) => ['RULE_MATCHED', 'AI_LIKELY', 'CONFIRMED'].includes(c.status));
  const certReasons: string[] = [];
  const traits: string[] = [];
  if (a.bluetooth === 'TRUE') traits.push('Bluetooth');
  if (a.wifi === 'TRUE') traits.push('Wi-Fi');
  if (a.battery === 'TRUE') traits.push('배터리');
  if (a.electrical === 'TRUE') traits.push('전기제품');
  if (a.children_product === 'TRUE') traits.push('어린이제품');
  if (a.food_contact === 'TRUE') traits.push('식품접촉');
  if (traits.length) certReasons.push(traits.join(' + '));
  if (likely.length) certReasons.push(`인증 후보 ${likely.length}건: ${likely.map((l) => l.name).slice(0, 3).join(', ')}`);
  const certLevel: RiskLevel = likely.length >= 3 || (traits.length >= 3 && likely.length > 0) ? 'HIGH' : likely.length > 0 ? 'MEDIUM' : 'LOW';
  push('CERTIFICATION', certLevel, certReasons);
  if (a.medical_claim === 'TRUE' || a.cosmetic === 'TRUE' || a.biocide_claim === 'TRUE') {
    push('COMPLIANCE', 'HIGH', ['의료·화장품·살생물 표방 제품은 사전 허가/신고 대상일 수 있습니다.']);
  }
  const unknownCount = (input.compliance ?? []).filter((c) => c.status === 'UNKNOWN' || c.status === 'AI_POSSIBLE').length;
  if (unknownCount > 0) push('COMPLIANCE', unknownCount > 3 ? 'MEDIUM' : 'LOW', [`확인되지 않은 규제 항목 ${unknownCount}건`]);

  // Battery / DG
  if (a.battery === 'TRUE') {
    push('BATTERY', 'MEDIUM', ['배터리 포함: 운송 시 UN38.3·MSDS 필요, 항공/특송 제한 가능']);
  }
  if (a.flammable === 'TRUE' || a.pressure_vessel === 'TRUE' || input.freight?.dangerousGoods) {
    push('DG', 'HIGH', ['위험물 가능성: 운송수단 제한 및 추가 서류 필요']);
  }
  if (a.liquid === 'TRUE' || a.magnet === 'TRUE') push('FREIGHT', 'MEDIUM', [a.liquid === 'TRUE' ? '액체 포함' : '자성 물질 포함'].concat(['운송사별 제한 확인 필요']));
  if (input.freight && !input.freight.hasVerifiedRate) push('FREIGHT', 'LOW', ['확정 운임 없음 (추정치 기반)']);

  // Customs
  if (input.hsVerified === false) {
    push('CUSTOMS', (input.hsCandidates ?? 0) > 1 ? 'MEDIUM' : 'LOW', ['HS 코드 미확정: 관세율 변동 가능']);
  }

  // Supplier
  const s = input.supplier;
  if (s) {
    const r: string[] = [];
    let lvl: RiskLevel = 'LOW';
    if (s.blacklisted) {
      r.push('블랙리스트 공급자');
      lvl = 'CRITICAL';
    }
    if (s.priceAnomaly) {
      r.push('동일 제품 대비 비정상 저가');
      lvl = maxLevel(lvl, 'HIGH');
    }
    if (s.yearsInBusiness !== undefined && s.yearsInBusiness !== null && s.yearsInBusiness < 2) {
      r.push(`업력 ${s.yearsInBusiness}년 (신규 판매자)`);
      lvl = maxLevel(lvl, 'MEDIUM');
    }
    if (s.verified === false) {
      r.push('사업자 검증 안 됨');
      lvl = maxLevel(lvl, 'MEDIUM');
    }
    if (s.missingFactoryData) {
      r.push('공장 정보 부족');
      lvl = maxLevel(lvl, 'MEDIUM');
    }
    if (s.responseHours !== undefined && s.responseHours !== null && s.responseHours > 48) {
      r.push(`평균 응답 ${s.responseHours}시간`);
      lvl = maxLevel(lvl, 'MEDIUM');
    }
    if (s.frequentPriceChanges) {
      r.push('가격 변동 잦음');
      lvl = maxLevel(lvl, 'MEDIUM');
    }
    push('SUPPLIER', lvl, r);
    if (s.claimCount && s.claimCount > 0) {
      push('QUALITY', s.claimCount >= 3 ? 'HIGH' : 'MEDIUM', [`품질 클레임 ${s.claimCount}건`]);
    }
    if (s.lateDeliveryCount && s.orderCount) {
      const rate = s.lateDeliveryCount / s.orderCount;
      if (rate > 0.1) push('DELIVERY', rate > 0.3 ? 'HIGH' : 'MEDIUM', [`납기 지연율 ${(rate * 100).toFixed(0)}%`]);
    }
  }

  if (input.brandOrIpSignals || (a.brand !== 'UNKNOWN' && a.brand.trim() !== '')) {
    push('IP', 'MEDIUM', [`브랜드/상표 표시 확인됨${a.brand !== 'UNKNOWN' ? ` (${a.brand})` : ''}: 지식재산권 침해 여부 확인 필요`]);
  }
  if (input.fx?.volatilityPct30d && input.fx.volatilityPct30d > 3) {
    push('FX', input.fx.volatilityPct30d > 6 ? 'HIGH' : 'MEDIUM', [`최근 30일 환율 변동 ${input.fx.volatilityPct30d.toFixed(1)}%`]);
  }
  if (input.payment?.overdue) push('PAYMENT', 'HIGH', ['미수금 연체']);
  if (input.market?.competitorCount && input.market.competitorCount > 200) push('MARKET', 'MEDIUM', [`국내 경쟁상품 ${input.market.competitorCount}개`]);
  if (input.stalePriceDays && input.stalePriceDays > 14) push('MARKET', 'LOW', [`가격 확인 후 ${input.stalePriceDays}일 경과`]);
  if (a.children_product === 'TRUE') push('PACKAGING', 'LOW', ['어린이제품 표시사항(KC·연령·경고문) 필요']);

  const overall = items.reduce<RiskLevel>((acc, i) => maxLevel(acc, i.level), 'LOW');
  return { items: items.sort((x, y) => LEVEL_ORDER.indexOf(y.level) - LEVEL_ORDER.indexOf(x.level)), overall };
}
