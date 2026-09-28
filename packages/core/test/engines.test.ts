import { describe, expect, it } from 'vitest';
import {
  FxTable,
  calculateLandedCost,
  calculatePrice,
  compareFreightOptions,
  clusterListings,
  detectPriceAnomaly,
  evaluateCompliance,
  emptyAttributes,
  formatNumber,
  extractProjectRef,
  hasPermission,
  marginToMarkup,
  markupAndMargin,
  mergeAttributes,
  moneyString,
  packingMetrics,
  rankCandidates,
  redactInternal,
  resolveMarkup,
  roundMoney,
  simulateMarginChange,
  canTransition,
  QUOTATION_TRANSITIONS,
  assessRisk,
  freshness,
  mape,
  haversineKm,
  insideGeofence,
  DEFAULT_MARGIN_CONFIG,
  type MarginRule,
  type RegulationRule,
  type FreightRate,
} from '../src/index.js';

const fx = new FxTable([
  { base: 'CNY', quote: 'KRW', rate: '190.25', rateDate: '2026-09-25', source: 'TEST' },
  { base: 'USD', quote: 'KRW', rate: '1380.5', rateDate: '2026-09-25', source: 'TEST' },
]);

describe('money', () => {
  it('rounds per currency without float errors', () => {
    expect(moneyString('0.1', 'USD')).toBe('0.10');
    expect(roundMoney('0.1', 'USD').add('0.2').toString()).toBe('0.3');
    expect(moneyString('1234.5', 'KRW')).toBe('1235');
    expect(roundMoney('1231', 'KRW', { mode: 'UP', step: '10' }).toString()).toBe('1240');
    expect(roundMoney('1235', 'KRW', { mode: 'HALF_EVEN', step: '10' }).toString()).toBe('1240');
  });
  it('converts via inverse rate', () => {
    expect(fx.convert('1380.5', 'KRW', 'USD').toFixed(2)).toBe('1.00');
  });
  it('distinguishes markup and margin', () => {
    const r = markupAndMargin('100', '125');
    expect(r.markupPct!.toFixed(0)).toBe('25');
    expect(r.marginPct!.toFixed(0)).toBe('20');
    expect(marginToMarkup('20').toFixed(0)).toBe('25');
  });
});

describe('landed cost', () => {
  const base = {
    quantity: 1000,
    baseCurrency: 'KRW',
    vatPct: '10',
    vatRecoverable: true,
    fx,
    certificationAllocation: 'FULL_ON_ORDER' as const,
    items: [
      {
        key: 'product_cost' as const,
        amount: '10.00',
        currency: 'CNY',
        basis: 'PER_UNIT' as const,
        source: 'supplier',
        verification: 'PARTNER_VERIFIED' as const,
      },
      {
        key: 'international_freight' as const,
        amount: '500',
        currency: 'USD',
        basis: 'TOTAL' as const,
        source: 'forwarder',
        verification: 'PARTNER_VERIFIED' as const,
      },
      {
        key: 'certification' as const,
        amount: '2000000',
        currency: 'KRW',
        basis: 'TOTAL' as const,
        source: 'lab',
        verification: 'AI_ESTIMATE' as const,
      },
    ],
  };

  it('computes duty on CIF and VAT on CIF+duty', () => {
    const r = calculateLandedCost({
      ...base,
      duty: { ratePct: '8', source: 'tariff', verification: 'EXPERT_VERIFIED' },
    });
    // product 10*190.25*1000 = 1,902,500 ; freight 500*1380.5 = 690,250 ; CIF = 2,592,750
    expect(r.customsValueBase).toBe('2592750');
    expect(r.dutyBase).toBe('207420');
    expect(r.vatBase).toBe('280017');
    // ex VAT = 1,902,500 + 690,250 + 2,000,000 + 207,420
    expect(r.totalExVatBase).toBe('4800170');
    expect(r.landedCostBase).toBe('4800170');
    expect(r.perUnitLandedCostBase).toBe('4800.17');
    expect(r.complete).toBe(true);
    expect(r.verification).toBe('AI_ESTIMATE');
    expect(r.fxUsed.length).toBe(2);
  });

  it('flags unknown duty instead of assuming one', () => {
    const r = calculateLandedCost({
      ...base,
      duty: { ratePct: null, source: 'none', verification: 'UNVERIFIED' },
    });
    expect(r.complete).toBe(false);
    expect(r.dutyBase).toBeNull();
    expect(r.warnings.join()).toContain('관세율');
  });

  it('handles certification allocation modes', () => {
    const sep = calculateLandedCost({
      ...base,
      certificationAllocation: 'CUSTOMER_SEPARATE',
      duty: { ratePct: '0', source: 't', verification: 'EXPERT_VERIFIED' },
    });
    expect(sep.customerSeparateBase).toBe('2000000');
    expect(sep.totalExVatBase).toBe('2592750');
    const am = calculateLandedCost({
      ...base,
      certificationAllocation: 'AMORTIZE',
      amortizationUnits: 10000,
      duty: { ratePct: '0', source: 't', verification: 'EXPERT_VERIFIED' },
    });
    expect(am.totalExVatBase).toBe(String(2592750 + 200000));
    const co = calculateLandedCost({
      ...base,
      certificationAllocation: 'COMPANY_EXPENSE',
      duty: { ratePct: '0', source: 't', verification: 'EXPERT_VERIFIED' },
    });
    expect(co.totalExVatBase).toBe('2592750');
  });

  it('reports missing FX', () => {
    const r = calculateLandedCost({
      ...base,
      items: [
        {
          key: 'product_cost',
          amount: '1',
          currency: 'EUR',
          basis: 'PER_UNIT',
          source: 's',
          verification: 'AI_ESTIMATE',
        },
      ],
      duty: { ratePct: '8', source: 't', verification: 'AI_ESTIMATE' },
    });
    expect(r.complete).toBe(false);
    expect(r.warnings.some((w) => w.includes('EUR'))).toBe(true);
  });
});

describe('margin engine', () => {
  const rules: MarginRule[] = [
    {
      id: 'g',
      name: '전체',
      scope: 'GLOBAL',
      component: 'PRODUCT',
      action: 'SET',
      markupPct: '12',
      priority: 0,
      active: true,
      match: {},
    },
    {
      id: 'c',
      name: 'LED',
      scope: 'CATEGORY',
      component: 'PRODUCT',
      action: 'SET',
      markupPct: '18',
      priority: 0,
      active: true,
      match: { category: 'LED' },
    },
    {
      id: 's',
      name: '평판등',
      scope: 'SUBCATEGORY',
      component: 'PRODUCT',
      action: 'SET',
      markupPct: '20',
      priority: 0,
      active: true,
      match: { subcategory: '평판등' },
    },
    {
      id: 'b',
      name: '배터리',
      scope: 'CUSTOM',
      component: 'PRODUCT',
      action: 'ADD',
      markupPct: '3',
      priority: 0,
      active: true,
      match: { attribute: { key: 'battery', equals: 'TRUE' } },
    },
    {
      id: 'q',
      name: '소량',
      scope: 'QUANTITY',
      component: 'ALL',
      action: 'ADD',
      markupPct: '5',
      priority: 0,
      active: true,
      match: { qtyMax: 100 },
    },
    {
      id: 'x',
      name: 'inactive',
      scope: 'SUPPLIER',
      component: 'PRODUCT',
      action: 'SET',
      markupPct: '99',
      priority: 0,
      active: false,
      match: { supplierId: 'sup' },
    },
  ];
  it('picks the most specific SET rule and sums ADD rules', () => {
    const e = resolveMarkup(
      'PRODUCT',
      rules,
      {
        category: 'LED',
        subcategory: '평판등',
        unitCostBase: '5000',
        quantity: 50,
        supplierId: 'sup',
        attributes: { battery: 'TRUE' },
      },
      DEFAULT_MARGIN_CONFIG,
    );
    expect(e.baseFrom.ruleId).toBe('s');
    expect(e.finalMarkupPct).toBe('28');
    expect(e.overriddenRules.map((r) => r.ruleId)).toEqual(['c', 'g']);
  });
  it('falls back to global and clamps', () => {
    const e = resolveMarkup(
      'PRODUCT',
      rules,
      { category: 'Other', unitCostBase: '100', quantity: 1000 },
      { ...DEFAULT_MARGIN_CONFIG, globalMaxMarkupPct: '10' },
    );
    expect(e.baseFrom.ruleId).toBe('g');
    expect(e.finalMarkupPct).toBe('10');
    expect(e.clampedFrom).toBe('12');
  });
  it('manual override wins', () => {
    const e = resolveMarkup(
      'PRODUCT',
      rules,
      { category: 'LED', unitCostBase: '100', quantity: 1000 },
      DEFAULT_MARGIN_CONFIG,
      { component: 'PRODUCT', markupPct: '7', reason: 'STRATEGIC_CUSTOMER' },
    );
    expect(e.finalMarkupPct).toBe('7');
  });
  it('cost range rules', () => {
    const cr: MarginRule[] = [
      {
        id: 'a',
        name: '<5000',
        scope: 'COST_RANGE',
        component: 'PRODUCT',
        action: 'SET',
        markupPct: '25',
        priority: 1,
        active: true,
        match: { costMax: '5000' },
      },
      {
        id: 'b',
        name: '<20000',
        scope: 'COST_RANGE',
        component: 'PRODUCT',
        action: 'SET',
        markupPct: '20',
        priority: 0,
        active: true,
        match: { costMax: '20000' },
      },
    ];
    expect(
      resolveMarkup('PRODUCT', cr, { unitCostBase: '4000', quantity: 10 }, DEFAULT_MARGIN_CONFIG)
        .finalMarkupPct,
    ).toBe('25');
    expect(
      resolveMarkup('PRODUCT', cr, { unitCostBase: '15000', quantity: 10 }, DEFAULT_MARGIN_CONFIG)
        .finalMarkupPct,
    ).toBe('20');
  });
  it('prices components with rounding and passes tax through', () => {
    const r = calculatePrice(
      [
        { component: 'PRODUCT', totalCostBase: '1000000' },
        { component: 'FREIGHT', totalCostBase: '200000' },
        { component: 'TAX', totalCostBase: '80000' },
      ],
      1000,
      'KRW',
      [],
      { unitCostBase: '1000', quantity: 1000 },
      DEFAULT_MARGIN_CONFIG,
    );
    // 1,000,000*1.12 + 200,000*1.05 + 80,000 = 1,410,000 → 1410/unit
    expect(r.calculatedTotalBase).toBe('1410000.00');
    expect(r.calculatedUnitPriceBase).toBe('1410');
    expect(r.profitBase).toBe('130000.00');
  });
  it('simulates rule changes', () => {
    const sim = simulateMarginChange(
      [
        {
          costs: [{ component: 'PRODUCT', totalCostBase: '100000' }],
          quantity: 10,
          ctx: { unitCostBase: '10000', quantity: 10 },
        },
      ],
      'KRW',
      { rules: [], config: DEFAULT_MARGIN_CONFIG },
      {
        rules: [],
        config: { ...DEFAULT_MARGIN_CONFIG, defaults: { ...DEFAULT_MARGIN_CONFIG.defaults, PRODUCT: '20' } },
      },
    );
    expect(sim.before.revenue).toBe('112000');
    expect(sim.after.revenue).toBe('120000');
    expect(sim.delta.profit).toBe('8000');
  });
});

describe('freight engine', () => {
  const packing = {
    cartonCount: 20,
    cartonLengthCm: '50',
    cartonWidthCm: '40',
    cartonHeightCm: '30',
    cartonGrossWeightKg: '12',
  };
  it('computes packing metrics', () => {
    const m = packingMetrics(packing);
    expect(m.cbm).toBe('1.2');
    expect(m.grossWeightKg).toBe('240');
    expect(m.volumetricWeightCourierKg).toBe('240');
    expect(m.chargeableAirKg).toBe('240');
    expect(m.revenueTonLcl).toBe('1.2');
  });
  it('never invents rates and prefers trusted sources', () => {
    const rates: FreightRate[] = [
      {
        id: 'm',
        mode: 'LCL',
        origin: 'CN*',
        destination: 'KRPUS',
        source: 'MARKET_RATE',
        verification: 'UNVERIFIED',
        currency: 'USD',
        basis: 'PER_RT',
        rate: '60',
        collectedAt: '2026-09-01',
      },
      {
        id: 'f',
        mode: 'LCL',
        origin: 'CNNGB',
        destination: 'KRPUS',
        source: 'FORWARDER_VERIFIED',
        verification: 'PARTNER_VERIFIED',
        currency: 'USD',
        basis: 'PER_RT',
        rate: '45',
        minCharge: '50',
        fixedCharges: [{ name: 'DOC', amount: '30' }],
        collectedAt: '2026-09-10',
      },
    ];
    const r = compareFreightOptions({
      packing,
      cargo: { battery: false, lithiumBattery: false, dangerousGoods: false, liquid: false, magnet: false },
      origin: 'CNNGB',
      destination: 'KRPUS',
      rates,
      baseCurrency: 'KRW',
      fx,
      asOf: new Date('2026-09-20'),
    });
    const lcl = r.options.find((o) => o.mode === 'LCL')!;
    expect(lcl.status).toBe('PRICED');
    expect(lcl.rate!.id).toBe('f');
    expect(lcl.costOriginal).toBe('84.00'); // max(1.2*45=54, 50) + 30
    const air = r.options.find((o) => o.mode === 'AIR')!;
    expect(air.status).toBe('NO_RATE');
    expect(r.recommended).toBe('LCL');
  });
  it('blocks DG courier', () => {
    const r = compareFreightOptions({
      packing,
      cargo: { battery: true, lithiumBattery: true, dangerousGoods: true, liquid: false, magnet: false },
      origin: 'CNNGB',
      destination: 'KRPUS',
      rates: [],
      baseCurrency: 'KRW',
      fx,
    });
    expect(r.options.find((o) => o.mode === 'COURIER')!.status).toBe('INFEASIBLE');
  });
  it('mape', () => {
    expect(
      mape([
        { predicted: '110', actual: '100' },
        { predicted: '90', actual: '100' },
      ]),
    ).toBe('10.00');
  });
});

describe('matching', () => {
  it('clusters by model number and phash, computes stats', () => {
    const clusters = clusterListings([
      {
        id: '1',
        title: 'mini fan usb handheld',
        model: 'F-100',
        unitPrice: '28',
        currency: 'CNY',
        moq: 100,
        supplierId: 'a',
      },
      {
        id: '2',
        title: 'handheld fan',
        model: 'F100',
        unitPrice: '30',
        currency: 'CNY',
        moq: 50,
        supplierId: 'b',
      },
      {
        id: '3',
        title: 'desk lamp',
        model: 'L-9',
        phash: 'ffffffffffffffff',
        unitPrice: '50',
        currency: 'CNY',
        supplierId: 'c',
      },
      {
        id: '4',
        title: 'lamp desk led',
        phash: 'fffffffffffffffe',
        unitPrice: '11',
        currency: 'CNY',
        supplierId: 'd',
      },
    ]);
    expect(clusters.length).toBe(2);
    const fan = clusters.find((c) => c.memberIds.includes('1'))!;
    expect(fan.memberIds.sort()).toEqual(['1', '2']);
    expect(fan.medianPrice).toBe('29');
    expect(fan.moqDistribution.min).toBe(50);
  });
  it('flags price anomalies', () => {
    const a = detectPriceAnomaly('11', '28');
    expect(a.anomalous).toBe(true);
    expect(a.message).toContain('비정상적으로 낮은 가격');
  });
  it('ranks explainably and assigns tags', () => {
    const ranked = rankCandidates(
      [
        {
          id: 'cheap',
          sourceType: 'PUBLIC_MARKET',
          unitPriceBase: '1000',
          moq: 500,
          leadTimeDays: 30,
          imageSimilarity: 0.9,
          specMatch: 0.8,
          supplierReliability: 0.4,
          qualityHistory: null,
          oemSupported: false,
          complianceReadiness: null,
          logisticsScore: null,
          communication: null,
          pastOrders: 0,
        },
        {
          id: 'good',
          sourceType: 'PRIVATE_NETWORK',
          unitPriceBase: '1300',
          moq: 100,
          leadTimeDays: 15,
          imageSimilarity: 0.95,
          specMatch: 0.9,
          supplierReliability: 0.9,
          qualityHistory: 0.9,
          oemSupported: true,
          complianceReadiness: 0.8,
          logisticsScore: 0.8,
          communication: 0.9,
          pastOrders: 12,
        },
      ],
      { targetUnitPriceBase: '1200', quantity: 300, wantsOem: true, desiredLeadTimeDays: 20 },
    );
    expect(ranked[0]!.id).toBe('good');
    expect(ranked[0]!.tags).toContain('BEST_MATCH');
    expect(ranked[0]!.tags).toContain('PRIVATE_NETWORK_RECOMMENDED');
    expect(ranked.find((r) => r.id === 'cheap')!.tags).toContain('LOWEST_COST');
    expect(ranked[0]!.reasons.length).toBeGreaterThan(0);
    expect(ranked[0]!.components.every((c) => typeof c.evidence === 'string')).toBe(true);
  });
});

describe('compliance', () => {
  const rules: RegulationRule[] = [
    {
      regulationId: 'r1',
      versionId: 'v1',
      code: 'RRA',
      name: '방송통신기자재 적합성평가',
      authority: '국립전파연구원',
      category: 'RADIO',
      triggerAll: [],
      triggerAny: ['bluetooth', 'wifi', 'wireless'],
      exceptions: [],
      hsPrefixes: [],
      mandatory: true,
      documentsRequired: ['RF 시험성적서'],
      testsRequired: ['RF'],
      expertType: 'RRA_EMC_LAB',
      officialSource: null,
    },
    {
      regulationId: 'r2',
      versionId: 'v1',
      code: 'FOOD',
      name: '식품용 기구·용기·포장',
      authority: '식품의약품안전처',
      category: 'FOOD',
      triggerAll: ['food_contact'],
      triggerAny: [],
      exceptions: [],
      hsPrefixes: [],
      mandatory: true,
      documentsRequired: [],
      testsRequired: [],
      expertType: 'MFDS_EXPERT',
      officialSource: null,
    },
  ];
  it('matches rules, keeps unknowns unknown', () => {
    const attrs = { ...emptyAttributes(), bluetooth: 'TRUE' as const, confidence: 0.9 };
    const res = evaluateCompliance(rules, attrs);
    expect(res.find((r) => r.code === 'RRA')!.status).toBe('RULE_MATCHED');
    expect(res.find((r) => r.code === 'FOOD')!.status).toBe('UNKNOWN');
    const no = evaluateCompliance(rules, { ...attrs, food_contact: 'FALSE' });
    expect(no.find((r) => r.code === 'FOOD')!.status).toBe('NOT_APPLICABLE');
  });
  it('merges attributes and marks conflicts unknown', () => {
    const { merged, conflicts } = mergeAttributes(
      { ...emptyAttributes(), battery: 'TRUE' },
      { battery: 'FALSE', bluetooth: 'TRUE' },
    );
    expect(merged.battery).toBe('UNKNOWN');
    expect(merged.bluetooth).toBe('TRUE');
    expect(conflicts).toContain('battery');
  });
  it('risk engine explains certification risk', () => {
    const attrs = {
      ...emptyAttributes(),
      bluetooth: 'TRUE' as const,
      battery: 'TRUE' as const,
      electrical: 'TRUE' as const,
      confidence: 0.9,
    };
    const r = assessRisk({ attributes: attrs, compliance: evaluateCompliance(rules, attrs) });
    const cert = r.items.find((i) => i.dimension === 'CERTIFICATION')!;
    expect(cert.reasons[0]).toContain('Bluetooth + 배터리 + 전기제품');
    expect(r.items.some((i) => i.dimension === 'BATTERY')).toBe(true);
  });
});

describe('misc', () => {
  it('numbering', () => {
    expect(formatNumber('QT-{YYYY}-{SEQ:4}', 1, new Date('2026-03-01'))).toBe('QT-2026-0001');
    expect(formatNumber('SRC-{YYYY}-{SEQ:6}', 184, new Date('2026-03-01'))).toBe('SRC-2026-000184');
    expect(extractProjectRef('Re: 견적 회신 [SRC-2026-000184] 건')).toBe('SRC-2026-000184');
  });
  it('permissions & redaction', () => {
    expect(hasPermission(['CUSTOMER_USER'], 'cost.read')).toBe(false);
    expect(hasPermission(['SALES'], 'cost.read')).toBe(true);
    const red = redactInternal({ name: 'x', internalCost: '1', items: [{ profit: '5', qty: 1 }] });
    expect(red).toEqual({ name: 'x', items: [{ qty: 1 }] });
  });
  it('quotation transitions', () => {
    expect(canTransition(QUOTATION_TRANSITIONS, 'SENT', 'CUSTOMER_APPROVED', 'CUSTOMER')).toBe(true);
    expect(canTransition(QUOTATION_TRANSITIONS, 'DRAFT', 'CUSTOMER_APPROVED', 'CUSTOMER')).toBe(false);
    expect(canTransition(QUOTATION_TRANSITIONS, 'SENT', 'ADMIN_FINAL_APPROVED', 'STAFF')).toBe(false);
  });
  it('freshness', () => {
    const now = new Date('2026-09-27T00:00:00Z');
    expect(freshness('supplier_price', new Date('2026-09-09T00:00:00Z'), now).status).toBe('STALE');
    expect(freshness('supplier_price', new Date('2026-09-26T00:00:00Z'), now).status).toBe('FRESH');
  });
  it('geo', () => {
    const busan = { lat: 35.1, lon: 129.04 };
    const ningbo = { lat: 29.87, lon: 121.55 };
    expect(Math.round(haversineKm(busan, ningbo))).toBeGreaterThan(850);
    expect(insideGeofence({ lat: 35.08, lon: 129.05 }, busan, 15)).toBe(true);
  });
});
