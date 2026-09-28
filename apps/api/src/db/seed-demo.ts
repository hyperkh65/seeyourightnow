import { and, eq } from 'drizzle-orm';
import { systemDb } from './client.js';
import { companies, contacts, customerNotes, freightRates, fxRates, sourceListings, supplierEvents, suppliers, tariffRates, userRoles, users } from './schema/index.js';
import { hashPassword } from '../services/auth.js';

/**
 * DEMO data for the "demo" tenant only. Every row is labelled:
 *   - FX / freight / tariff rows use source "DEMO_DATA" and verification UNVERIFIED
 *   - supplier names start with "(DEMO)"
 * The UI shows a DEMO badge for this tenant. Nothing here is presented as official data.
 */
export async function seedDemoData(demoId: string, acmeId: string, password: string): Promise<void> {
  const customer = async (tenantId: string, companyName: string, email: string, name: string, extra: Partial<typeof companies.$inferInsert> = {}) => {
    const [existing] = await systemDb.select().from(users).where(and(eq(users.tenantId, tenantId), eq(users.email, email))).limit(1);
    if (existing) return existing;
    const [c] = await systemDb.insert(companies).values({ tenantId, name: companyName, industry: '온라인 유통', tier: 'STANDARD', ...extra }).returning();
    const [u] = await systemDb.insert(users).values({ tenantId, email, name, passwordHash: await hashPassword(password), companyId: c!.id, emailVerifiedAt: new Date() }).returning();
    await systemDb.insert(userRoles).values({ tenantId, userId: u!.id, role: 'CUSTOMER_ADMIN' });
    await systemDb.update(companies).set({ ownerUserId: u!.id }).where(eq(companies.id, c!.id));
    return u!;
  };
  const buyer = await customer(demoId, '(DEMO) 한빛리빙', 'buyer@demo.local', '홍구매', { businessNumber: '000-00-00000', ceo: '홍대표', address: '서울특별시 (데모 주소)', categories: ['생활가전', '주방용품'], paymentTerms: '계약금 30% / 선적 전 70%', taxInvoiceEmail: 'tax@demo.local' });
  await customer(acmeId, 'ACME 고객사', 'buyer@acme.local', 'ACME 구매담당');

  const [already] = await systemDb.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.tenantId, demoId)).limit(1);
  if (already) return;

  // CRM extras
  if (buyer.companyId) {
    await systemDb.insert(contacts).values({ tenantId: demoId, companyId: buyer.companyId, name: '홍구매', department: '구매팀', title: '팀장', phone: '010-0000-0000', email: 'buyer@demo.local', isPrimary: true });
    const [owner] = await systemDb.select({ id: users.id }).from(users).where(and(eq(users.tenantId, demoId), eq(users.email, 'owner@demo.local'))).limit(1);
    if (owner) await systemDb.insert(customerNotes).values({ tenantId: demoId, companyId: buyer.companyId, authorId: owner.id, body: '(DEMO 내부 메모) 가격 민감도 높음. 납기 준수 중요.', pinned: true });
  }

  // FX (demo reference values, clearly marked)
  const today = new Date().toISOString().slice(0, 10);
  for (const [base, rate] of [
    ['CNY', '190.50'],
    ['USD', '1385.00'],
    ['EUR', '1500.00'],
    ['JPY', '9.30'],
  ] as const) {
    await systemDb.insert(fxRates).values({ tenantId: demoId, base, quote: 'KRW', rate, rateDate: today, source: 'DEMO_DATA', verification: 'UNVERIFIED' });
  }

  // Freight lane rates (demo). Real deployments load forwarder/contract rates or receive RFQ quotes.
  const lanes = [
    { mode: 'LCL', origin: 'CN*', destination: 'KRPUS', basis: 'PER_RT', rate: '55', minCharge: '55', fixed: [{ name: 'CFS/THC(demo)', amount: '60' }], currency: 'USD', t: [4, 7] },
    { mode: 'LCL', origin: 'CN*', destination: 'KRINC', basis: 'PER_RT', rate: '60', minCharge: '60', fixed: [{ name: 'CFS/THC(demo)', amount: '65' }], currency: 'USD', t: [3, 6] },
    { mode: 'FCL_20', origin: 'CN*', destination: 'KRPUS', basis: 'PER_CONTAINER', rate: '650', fixed: [{ name: 'THC(demo)', amount: '180' }], currency: 'USD', t: [3, 6] },
    { mode: 'FCL_40HQ', origin: 'CN*', destination: 'KRPUS', basis: 'PER_CONTAINER', rate: '1100', fixed: [{ name: 'THC(demo)', amount: '260' }], currency: 'USD', t: [3, 6] },
    { mode: 'AIR', origin: 'CN*', destination: 'KRINC', basis: 'PER_KG', rate: '3.2', minCharge: '80', fixed: [], currency: 'USD', t: [1, 3] },
    { mode: 'COURIER', origin: 'CN*', destination: 'KR*', basis: 'PER_KG', rate: '6.5', minCharge: '25', fixed: [], currency: 'USD', t: [2, 4] },
  ];
  const validUntil = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
  for (const l of lanes) {
    await systemDb.insert(freightRates).values({ tenantId: demoId, mode: l.mode, origin: l.origin, destination: l.destination, source: 'MARKET_RATE', verification: 'UNVERIFIED', providerName: 'DEMO_DATA 시장운임 샘플', currency: l.currency, basis: l.basis, rate: l.rate, minCharge: l.minCharge ?? null, fixedCharges: l.fixed, transitDaysMin: l.t[0], transitDaysMax: l.t[1], validUntil, note: 'DEMO 데이터 — 실제 운임이 아닙니다.' });
  }

  // Tariff (demo values — NOT official; flagged DEMO_DATA so the UI labels them)
  for (const [hs, basic, fta] of [
    ['841451', '8', '0'],
    ['940542', '8', '0'],
    ['732393', '8', '0'],
    ['392410', '6.5', '0'],
    ['851830', '0', '0'],
    ['950300', '8', '0'],
  ] as const) {
    await systemDb.insert(tariffRates).values({ tenantId: demoId, hsCode: hs, rateType: 'BASIC', ratePct: basic, source: 'DEMO_DATA', verification: 'UNVERIFIED', validFrom: '2026-01-01' });
    await systemDb.insert(tariffRates).values({ tenantId: demoId, hsCode: hs, rateType: 'FTA_KR_CN', ratePct: fta, originCountry: 'CN', requiresCertificateOfOrigin: true, source: 'DEMO_DATA', verification: 'UNVERIFIED', validFrom: '2026-01-01' });
  }

  // Private sourcing network (demo)
  const sup = async (v: Partial<typeof suppliers.$inferInsert> & { name: string }) => (await systemDb.insert(suppliers).values({ tenantId: demoId, sourceType: 'PRIVATE_NETWORK', country: 'CN', ...v }).returning())[0]!;
  const s1 = await sup({ name: '(DEMO) 宁波星辰电器有限公司', nameLocal: '宁波星辰电器', alias: 'Verified Factory · Ningbo', visibility: 'ALIAS', businessType: 'FACTORY', province: '浙江', city: '宁波 Ningbo', nearestPort: 'CNNGB', yearsInBusiness: 9, businessVerified: true, avgResponseHours: 6, typicalMoq: 300, oemSupported: true, certifications: [{ name: 'CE (EMC/LVD)' }, { name: 'RoHS' }, { name: 'UN38.3 (battery)' }], metrics: { qualityScore: 0.92, communicationScore: 0.9, reliabilityScore: 0.9, orderCount: 14 } });
  const s2 = await sup({ name: '(DEMO) 义乌恒泰日用品', nameLocal: '义乌恒泰', alias: 'Verified Supplier · Yiwu', visibility: 'HIDDEN', businessType: 'TRADING', province: '浙江', city: '义乌 Yiwu', nearestPort: 'CNNGB', yearsInBusiness: 4, businessVerified: true, avgResponseHours: 12, typicalMoq: 100, oemSupported: false, metrics: { qualityScore: 0.8, communicationScore: 0.75, orderCount: 5 } });
  const s3 = await sup({ name: '(DEMO) 深圳光明照明科技', nameLocal: '深圳光明照明', alias: 'Verified Factory · Shenzhen', visibility: 'ALIAS', sourceType: 'DIRECT_FACTORY', businessType: 'FACTORY', province: '广东', city: '深圳 Shenzhen', nearestPort: 'CNYTN', yearsInBusiness: 12, businessVerified: true, avgResponseHours: 8, typicalMoq: 500, oemSupported: true, certifications: [{ name: 'CE' }, { name: 'CB report' }], metrics: { qualityScore: 0.95, communicationScore: 0.85, orderCount: 22 } });

  const listing = (supplierId: string, sourceType: string, v: Partial<typeof sourceListings.$inferInsert> & { title: string }) =>
    systemDb.insert(sourceListings).values({ tenantId: demoId, supplierId, sourceType, connector: 'MANUAL', currency: 'CNY', lastCheckedAt: new Date(), ...v });
  await listing(s1.id, 'PRIVATE_NETWORK', { title: '(DEMO) 手持USB充电小风扇 迷你便携', titleKo: '(DEMO) 휴대용 USB 충전식 미니 선풍기', model: 'XC-F18', priceTiers: [{ minQty: 300, unitPrice: '14.50' }, { minQty: 1000, unitPrice: '13.20' }], supplierVerifiedPrice: '14.50', moq: 300, leadTimeDays: 20, oemSupported: true, shippingOrigin: 'CNNGB', specs: { 배터리: '1200mAh', 전원: 'USB-C 5V', 재질: 'ABS' }, packaging: { unitsPerCarton: 60, cartonL: '52', cartonW: '38', cartonH: '40', cartonGw: '11.5' } });
  await listing(s2.id, 'PRIVATE_NETWORK', { title: '(DEMO) 迷你手持风扇 学生款', titleKo: '(DEMO) 미니 핸디 선풍기 (보급형)', model: 'HT-M2', priceTiers: [{ minQty: 100, unitPrice: '9.80' }], supplierVerifiedPrice: '9.80', moq: 100, leadTimeDays: 12, oemSupported: false, shippingOrigin: 'CNNGB', specs: { 배터리: '800mAh', 재질: 'ABS' }, packaging: { unitsPerCarton: 100, cartonL: '55', cartonW: '45', cartonH: '42', cartonGw: '13' } });
  await listing(s3.id, 'DIRECT_FACTORY', { title: '(DEMO) LED护眼台灯 可充电 触控调光', titleKo: '(DEMO) LED 스탠드 충전식 터치 디밍', model: 'GM-L220', priceTiers: [{ minQty: 500, unitPrice: '38.00' }, { minQty: 2000, unitPrice: '34.50' }], supplierVerifiedPrice: '38.00', moq: 500, leadTimeDays: 25, oemSupported: true, shippingOrigin: 'CNYTN', specs: { 전원: 'USB-C 5V', 밝기: '3단', 배터리: '2000mAh' }, packaging: { unitsPerCarton: 20, cartonL: '60', cartonW: '40', cartonH: '45', cartonGw: '14' } });
  await listing(s2.id, 'PRIVATE_NETWORK', { title: '(DEMO) 304不锈钢保温杯 500ml', titleKo: '(DEMO) 304 스테인리스 보온 텀블러 500ml', model: 'HT-T500', priceTiers: [{ minQty: 200, unitPrice: '16.00' }], supplierVerifiedPrice: '16.00', moq: 200, leadTimeDays: 18, oemSupported: true, shippingOrigin: 'CNNGB', specs: { 재질: '304 스테인리스', 용량: '500ml' }, packaging: { unitsPerCarton: 40, cartonL: '50', cartonW: '40', cartonH: '30', cartonGw: '15' } });

  await systemDb.insert(supplierEvents).values([
    { tenantId: demoId, supplierId: s1.id, kind: 'ORDER', note: '(DEMO) 2025 선풍기 3,000개', rating: 4.5 },
    { tenantId: demoId, supplierId: s1.id, kind: 'SAMPLE', note: '(DEMO) 샘플 2종 발송', rating: 5 },
    { tenantId: demoId, supplierId: s2.id, kind: 'LATE_DELIVERY', note: '(DEMO) 5일 지연' },
    { tenantId: demoId, supplierId: s3.id, kind: 'ORDER', note: '(DEMO) LED 스탠드 5,000개', rating: 4.8 },
  ]);
}
