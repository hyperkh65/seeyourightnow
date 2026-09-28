/**
 * Platform reference data (tenant_id NULL, shared read-only).
 *
 * Regulations: Korean regulatory frameworks that commonly apply to imported
 * consumer goods. Trigger attributes only produce *candidates*; final
 * applicability is always decided by an expert (EXPERT_REVIEW / VERIFIED).
 *
 * HS codes: internationally harmonised 6-digit headings (descriptions are
 * summaries). Tariff RATES are intentionally NOT seeded — they must come from
 * the official Korea Customs tariff schedule import or the UNI-PASS connector.
 */

export interface RegulationSeed {
  code: string;
  name: string;
  authority: string;
  category: string;
  law: string;
  triggerAll: string[];
  triggerAny: string[];
  exceptions: string[];
  hsPrefixes: string[];
  mandatory: boolean;
  documentsRequired: string[];
  testsRequired: string[];
  expertType: string;
  officialSource: string;
  summary: string;
}

export const REGULATIONS: RegulationSeed[] = [
  {
    code: 'KC_ELECTRICAL',
    name: 'KC 전기용품 안전관리 (안전인증·안전확인·공급자적합성확인)',
    authority: '국가기술표준원 (KATS)',
    category: 'ELECTRICAL_SAFETY',
    law: '전기용품 및 생활용품 안전관리법',
    triggerAll: ['electrical'],
    triggerAny: ['ac_powered', 'adapter_included', 'dc_powered'],
    exceptions: [],
    hsPrefixes: [],
    mandatory: true,
    documentsRequired: ['회로도', '부품 목록(BOM)', '사용설명서', '명판/라벨 도안'],
    testsRequired: ['전기안전 시험 (품목별 KC 기준)'],
    expertType: 'ELECTRICAL_SAFETY_LAB',
    officialSource: 'https://www.safetykorea.kr',
    summary:
      '전원을 사용하는 전기용품은 품목에 따라 안전인증, 안전확인 또는 공급자적합성확인 대상입니다. 정확한 구분은 품목과 정격에 따라 시험기관이 판단합니다.',
  },
  {
    code: 'KC_EMC',
    name: '방송통신기자재 적합성평가 (전자파 적합성, EMC)',
    authority: '국립전파연구원 (RRA)',
    category: 'EMC',
    law: '전파법',
    triggerAll: ['electrical'],
    triggerAny: [],
    exceptions: [],
    hsPrefixes: [],
    mandatory: true,
    documentsRequired: ['제품 사양서', '회로도', '사용설명서'],
    testsRequired: ['EMC 시험 (전자파 장해/내성)'],
    expertType: 'RRA_EMC_LAB',
    officialSource: 'https://www.rra.go.kr',
    summary: '전자파를 발생하거나 영향을 받는 전기·전자제품은 적합성평가 대상이 될 수 있습니다.',
  },
  {
    code: 'KC_RF',
    name: '무선기기 적합성평가 (RF)',
    authority: '국립전파연구원 (RRA)',
    category: 'RADIO',
    law: '전파법',
    triggerAll: [],
    triggerAny: ['bluetooth', 'wifi', 'wireless'],
    exceptions: [],
    hsPrefixes: ['851762'],
    mandatory: true,
    documentsRequired: ['RF 시험성적서 (보유 시)', '안테나 사양', '무선 모듈 인증서 (보유 시)'],
    testsRequired: ['RF 시험', 'EMC 시험'],
    expertType: 'RRA_EMC_LAB',
    officialSource: 'https://www.rra.go.kr',
    summary:
      'Bluetooth, Wi-Fi 등 무선 기능이 있는 기기는 무선기기 적합성평가 대상입니다. 인증받은 모듈 사용 여부에 따라 절차가 달라질 수 있습니다.',
  },
  {
    code: 'KC_LITHIUM_BATTERY',
    name: '리튬이차전지 안전확인',
    authority: '국가기술표준원 (KATS)',
    category: 'BATTERY',
    law: '전기용품 및 생활용품 안전관리법',
    triggerAll: ['battery'],
    triggerAny: [],
    exceptions: [],
    hsPrefixes: ['850760'],
    mandatory: true,
    documentsRequired: ['배터리 사양서', 'UN38.3 시험요약서', 'MSDS', '셀/팩 제조사 정보'],
    testsRequired: ['리튬이차전지 안전 시험 (KC 62133 계열)'],
    expertType: 'ELECTRICAL_SAFETY_LAB',
    officialSource: 'https://www.safetykorea.kr',
    summary:
      '리튬이온 배터리 및 배터리 팩은 용량·용도에 따라 안전확인 대상입니다. 기기에 내장된 경우에도 확인이 필요합니다.',
  },
  {
    code: 'KC_CHILDREN',
    name: '어린이제품 안전관리 (안전인증·안전확인·공급자적합성확인)',
    authority: '국가기술표준원 (KATS)',
    category: 'CHILDREN',
    law: '어린이제품 안전 특별법',
    triggerAll: ['children_product'],
    triggerAny: [],
    exceptions: [],
    hsPrefixes: ['9503'],
    mandatory: true,
    documentsRequired: ['제품 사양서', '재질 정보', '사용연령 표시안'],
    testsRequired: ['유해물질 시험', '물리적·기계적 안전 시험 (품목별)'],
    expertType: 'CERTIFICATION_EXPERT',
    officialSource: 'https://www.safetykorea.kr',
    summary: '만 13세 이하 어린이가 사용하는 제품은 어린이제품 안전관리 대상입니다.',
  },
  {
    code: 'FOOD_CONTACT',
    name: '식품용 기구·용기·포장 수입신고',
    authority: '식품의약품안전처 (MFDS)',
    category: 'FOOD',
    law: '식품위생법 / 수입식품안전관리 특별법',
    triggerAll: ['food_contact'],
    triggerAny: [],
    exceptions: [],
    hsPrefixes: ['392410', '732393', '691110', '701337'],
    mandatory: true,
    documentsRequired: ['재질 정보', '제조공정도', '시험성적서 (정밀검사 대상 시)'],
    testsRequired: ['기구·용기·포장 기준 및 규격 시험'],
    expertType: 'MFDS_EXPERT',
    officialSource: 'https://impfood.mfds.go.kr',
    summary: '식품에 직접 닿는 기구·용기·포장은 수입 시 식품의약품안전처 수입신고 대상입니다.',
  },
  {
    code: 'COSMETICS',
    name: '화장품 수입 (책임판매업·표시 기준)',
    authority: '식품의약품안전처 (MFDS)',
    category: 'COSMETIC',
    law: '화장품법',
    triggerAll: ['cosmetic'],
    triggerAny: [],
    exceptions: [],
    hsPrefixes: ['3303', '3304', '3305', '3307'],
    mandatory: true,
    documentsRequired: ['전성분표', '제조판매증명서', '표시사항 도안'],
    testsRequired: ['품질검사 (책임판매업자)'],
    expertType: 'MFDS_EXPERT',
    officialSource: 'https://www.mfds.go.kr',
    summary: '화장품을 수입해 판매하려면 화장품책임판매업 등록 및 표시·품질 기준을 준수해야 합니다.',
  },
  {
    code: 'MEDICAL_DEVICE',
    name: '의료기기 수입 허가·인증·신고',
    authority: '식품의약품안전처 (MFDS)',
    category: 'MEDICAL',
    law: '의료기기법',
    triggerAll: ['medical_claim'],
    triggerAny: [],
    exceptions: [],
    hsPrefixes: ['9018', '9019', '9021'],
    mandatory: true,
    documentsRequired: ['제품 사양서', '사용 목적 설명', '기술문서'],
    testsRequired: ['등급별 시험 (의료기기 기준규격)'],
    expertType: 'MFDS_EXPERT',
    officialSource: 'https://emed.mfds.go.kr',
    summary:
      '질병 진단·치료·예방 등 의료 목적을 표방하면 의료기기에 해당할 수 있어 수입업 허가와 품목 허가·인증·신고가 필요합니다.',
  },
  {
    code: 'LIVING_CHEMICALS',
    name: '안전확인대상 생활화학제품',
    authority: '환경부',
    category: 'CHEMICAL',
    law: '생활화학제품 및 살생물제의 안전관리에 관한 법률',
    triggerAll: ['chemical_product'],
    triggerAny: [],
    exceptions: [],
    hsPrefixes: ['3402', '3405', '3808'],
    mandatory: true,
    documentsRequired: ['MSDS', '전성분 정보'],
    testsRequired: ['안전기준 적합확인 시험'],
    expertType: 'CHEMICAL_SAFETY_EXPERT',
    officialSource: 'https://ecolife.me.go.kr',
    summary: '세정제, 방향제, 코팅제 등 생활화학제품은 안전기준 적합확인 및 표시 대상입니다.',
  },
  {
    code: 'BIOCIDE',
    name: '살생물제품 승인',
    authority: '환경부',
    category: 'BIOCIDE',
    law: '생활화학제품 및 살생물제의 안전관리에 관한 법률',
    triggerAll: ['biocide_claim'],
    triggerAny: [],
    exceptions: [],
    hsPrefixes: ['3808'],
    mandatory: true,
    documentsRequired: ['살생물물질 정보', 'MSDS'],
    testsRequired: ['효능·위해성 자료'],
    expertType: 'CHEMICAL_SAFETY_EXPERT',
    officialSource: 'https://ecolife.me.go.kr',
    summary: '살균·항균·살충 등을 표방하는 제품은 살생물제품 또는 살생물처리제품으로 관리될 수 있습니다.',
  },
  {
    code: 'ENERGY_EFFICIENCY',
    name: '에너지소비효율등급·대기전력 표시',
    authority: '한국에너지공단',
    category: 'ENERGY',
    law: '에너지이용 합리화법',
    triggerAll: ['electrical', 'ac_powered'],
    triggerAny: [],
    exceptions: [],
    hsPrefixes: ['8418', '8450', '8415', '851671', '841451'],
    mandatory: false,
    documentsRequired: ['정격 소비전력 자료'],
    testsRequired: ['효율·대기전력 측정 (대상 품목에 한함)'],
    expertType: 'ELECTRICAL_SAFETY_LAB',
    officialSource: 'https://eep.energy.or.kr',
    summary:
      '지정된 품목만 대상입니다. 해당 품목이면 효율등급 또는 대기전력 기준을 충족하고 표시해야 합니다.',
  },
  {
    code: 'FIRE_EQUIPMENT',
    name: '소방용품 형식승인',
    authority: '소방청 / 한국소방산업기술원',
    category: 'FIRE',
    law: '소방시설 설치 및 관리에 관한 법률',
    triggerAll: [],
    triggerAny: [],
    exceptions: [],
    hsPrefixes: ['842410', '853110'],
    mandatory: true,
    documentsRequired: ['제품 도면', '사양서'],
    testsRequired: ['형식승인 시험'],
    expertType: 'FIRE_CERTIFICATION_EXPERT',
    officialSource: 'https://www.kfi.or.kr',
    summary: '소화기, 감지기 등 소방용품은 형식승인 대상입니다.',
  },
  {
    code: 'LASER_PRODUCT',
    name: '레이저 제품 안전 확인',
    authority: '국가기술표준원 (KATS)',
    category: 'LASER',
    law: '전기용품 및 생활용품 안전관리법',
    triggerAll: ['laser'],
    triggerAny: [],
    exceptions: [],
    hsPrefixes: [],
    mandatory: true,
    documentsRequired: ['레이저 등급 자료', '출력 사양'],
    testsRequired: ['레이저 출력·등급 시험'],
    expertType: 'ELECTRICAL_SAFETY_LAB',
    officialSource: 'https://www.safetykorea.kr',
    summary: '레이저 포인터 등 레이저를 사용하는 생활용품은 출력 등급에 따라 안전관리 대상입니다.',
  },
];

export interface HsSeed {
  code: string;
  ko: string;
  en: string;
  keywords: string[];
}

export const HS_SAMPLES: HsSeed[] = [
  {
    code: '841451',
    ko: '선풍기 (탁상·바닥·벽걸이·천장형 등, 전동기 출력 125W 이하)',
    en: 'Table, floor, wall, window, ceiling or roof fans, with a self-contained electric motor of an output not exceeding 125 W',
    keywords: ['선풍기', '미니선풍기', '휴대용 선풍기', 'fan', 'mini fan', '风扇'],
  },
  {
    code: '851830',
    ko: '헤드폰·이어폰 (마이크 결합 여부 불문)',
    en: 'Headphones and earphones, whether or not combined with a microphone',
    keywords: ['이어폰', '헤드폰', 'earphone', 'headphone', 'earbuds', '耳机'],
  },
  {
    code: '851762',
    ko: '음성·영상·데이터 송수신·변환·재생 기기 (무선 통신기기 등)',
    en: 'Machines for the reception, conversion and transmission or regeneration of voice, images or other data',
    keywords: ['블루투스', '무선', 'bluetooth', 'wifi', 'router', '蓝牙'],
  },
  {
    code: '850760',
    ko: '리튬이온 축전지',
    en: 'Lithium-ion accumulators',
    keywords: ['리튬', '배터리', '보조배터리', 'battery', 'power bank', '电池'],
  },
  {
    code: '850440',
    ko: '정지형 변환기 (어댑터·충전기 등)',
    en: 'Static converters',
    keywords: ['어댑터', '충전기', 'adapter', 'charger', '充电器'],
  },
  {
    code: '940542',
    ko: 'LED 광원 전용 조명기구 (기타)',
    en: 'Other electric luminaires and lighting fittings designed for use solely with LED light sources',
    keywords: ['LED', '조명', '램프', '스탠드', 'lamp', 'light', '灯'],
  },
  {
    code: '851310',
    ko: '휴대용 전기램프',
    en: 'Portable electric lamps designed to function by their own source of energy',
    keywords: ['손전등', '랜턴', 'flashlight', 'torch', '手电筒'],
  },
  {
    code: '950300',
    ko: '완구 (세발자전거·인형 등)',
    en: 'Tricycles, scooters, dolls and other toys; puzzles',
    keywords: ['장난감', '완구', '인형', 'toy', 'doll', '玩具'],
  },
  {
    code: '392410',
    ko: '플라스틱제 식탁용품·주방용품',
    en: 'Tableware and kitchenware of plastics',
    keywords: ['플라스틱 컵', '밀폐용기', '도시락', 'plastic cup', 'lunch box', '塑料餐具'],
  },
  {
    code: '732393',
    ko: '스테인리스강제 식탁·주방용품',
    en: 'Table, kitchen or other household articles of stainless steel',
    keywords: ['텀블러', '스테인리스', 'tumbler', 'stainless', '不锈钢杯'],
  },
  {
    code: '851671',
    ko: '커피·차 메이커',
    en: 'Coffee or tea makers',
    keywords: ['커피메이커', '전기포트', 'coffee maker', '咖啡机'],
  },
  {
    code: '850980',
    ko: '기타 가정용 전기기기 (전동기 내장)',
    en: 'Other electro-mechanical domestic appliances with self-contained electric motor',
    keywords: ['가정용', '전동', '블렌더', 'appliance', '家电'],
  },
  {
    code: '420292',
    ko: '가방류 (외면이 플라스틱 시트 또는 방직용 섬유제)',
    en: 'Containers with outer surface of sheeting of plastics or of textile materials',
    keywords: ['가방', '파우치', 'bag', 'pouch', '包'],
  },
  {
    code: '330499',
    ko: '미용·메이크업·피부관리용 제품 (기타)',
    en: 'Beauty or make-up preparations and preparations for the care of the skin, other',
    keywords: ['화장품', '크림', 'cosmetic', 'cream', '化妆品'],
  },
  {
    code: '901890',
    ko: '의료용 기기 (기타)',
    en: 'Other instruments and appliances used in medical sciences',
    keywords: ['의료기기', 'medical device', '医疗器械'],
  },
  {
    code: '842410',
    ko: '소화기',
    en: 'Fire extinguishers, whether or not charged',
    keywords: ['소화기', 'fire extinguisher', '灭火器'],
  },
  {
    code: '630260',
    ko: '테리직물 등의 화장실·주방용 린넨',
    en: 'Toilet linen and kitchen linen, of terry towelling',
    keywords: ['수건', '타월', 'towel', '毛巾'],
  },
  {
    code: '961900',
    ko: '위생용품 (생리대·기저귀 등)',
    en: 'Sanitary towels, napkins and similar articles',
    keywords: ['기저귀', '생리대', 'diaper', '尿不湿'],
  },
];

/** UN/LOCODE subset for main China/Korea/Hong Kong/Vietnam trade ports. Coordinates are approximate port positions. */
export const PORTS: Array<{
  unlocode: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
  geofenceKm?: number;
  kind?: string;
}> = [
  { unlocode: 'CNSHA', name: 'Shanghai', country: 'CN', lat: 31.36, lon: 121.62, geofenceKm: 40 },
  { unlocode: 'CNNGB', name: 'Ningbo', country: 'CN', lat: 29.93, lon: 121.85, geofenceKm: 25 },
  { unlocode: 'CNYTN', name: 'Yantian (Shenzhen)', country: 'CN', lat: 22.57, lon: 114.27, geofenceKm: 15 },
  { unlocode: 'CNSZX', name: 'Shenzhen', country: 'CN', lat: 22.49, lon: 113.88, geofenceKm: 20 },
  { unlocode: 'CNNSA', name: 'Nansha (Guangzhou)', country: 'CN', lat: 22.75, lon: 113.6, geofenceKm: 20 },
  { unlocode: 'CNTAO', name: 'Qingdao', country: 'CN', lat: 36.07, lon: 120.32, geofenceKm: 25 },
  { unlocode: 'CNXMN', name: 'Xiamen', country: 'CN', lat: 24.45, lon: 118.07, geofenceKm: 20 },
  { unlocode: 'CNTXG', name: 'Tianjin Xingang', country: 'CN', lat: 38.98, lon: 117.78, geofenceKm: 25 },
  { unlocode: 'CNDLC', name: 'Dalian', country: 'CN', lat: 38.93, lon: 121.65, geofenceKm: 20 },
  { unlocode: 'CNWEI', name: 'Weihai', country: 'CN', lat: 37.5, lon: 122.13, geofenceKm: 15 },
  { unlocode: 'CNYIW', name: 'Yiwu', country: 'CN', lat: 29.31, lon: 120.08, geofenceKm: 10, kind: 'INLAND' },
  { unlocode: 'HKHKG', name: 'Hong Kong', country: 'HK', lat: 22.3, lon: 114.17, geofenceKm: 20 },
  { unlocode: 'KRPUS', name: 'Busan', country: 'KR', lat: 35.1, lon: 129.04, geofenceKm: 20 },
  { unlocode: 'KRINC', name: 'Incheon', country: 'KR', lat: 37.45, lon: 126.6, geofenceKm: 20 },
  { unlocode: 'KRPTK', name: 'Pyeongtaek-Dangjin', country: 'KR', lat: 36.97, lon: 126.83, geofenceKm: 15 },
  { unlocode: 'KRKAN', name: 'Gwangyang', country: 'KR', lat: 34.9, lon: 127.7, geofenceKm: 15 },
  { unlocode: 'KRUSN', name: 'Ulsan', country: 'KR', lat: 35.5, lon: 129.38, geofenceKm: 15 },
  { unlocode: 'VNSGN', name: 'Ho Chi Minh City', country: 'VN', lat: 10.77, lon: 106.72, geofenceKm: 25 },
  { unlocode: 'VNHPH', name: 'Haiphong', country: 'VN', lat: 20.86, lon: 106.68, geofenceKm: 20 },
];

export const PLANS = [
  {
    code: 'STARTER',
    name: 'Starter',
    description: '작은 규모의 소싱 사업자용',
    features: [
      'PRODUCT_SEARCH',
      'VISION_SEARCH',
      'DOMESTIC_MARKET',
      'COMPLIANCE',
      'FREIGHT',
      'CUSTOMS',
      'QUOTATION',
      'CRM',
      'SHIPMENT',
    ],
    limits: {
      users: { value: 5, hard: true },
      monthly_searches: { value: 500, hard: false },
      ai_requests: { value: 2000, hard: false },
      storage_mb: { value: 5000, hard: true },
      quotes: { value: 200, hard: false },
      projects: { value: 200, hard: false },
      api_calls: { value: 0, hard: true },
      custom_domains: { value: 0, hard: true },
    },
    priceMonthly: '99000',
  },
  {
    code: 'BUSINESS',
    name: 'Business',
    description: '자체 브랜드로 운영하는 소싱·무역 회사용',
    features: [
      'PRODUCT_SEARCH',
      'VISION_SEARCH',
      'DOMESTIC_MARKET',
      'COMPLIANCE',
      'FREIGHT',
      'CUSTOMS',
      'QUOTATION',
      'CONTRACT',
      'INVOICE',
      'SHIPMENT',
      'AIS',
      'CRM',
      'ANALYTICS',
      'WHITE_LABEL',
      'CUSTOM_DOMAIN',
      'EXPERT_PORTAL',
      'WEBHOOKS',
    ],
    limits: {
      users: { value: 25, hard: true },
      monthly_searches: { value: 5000, hard: false },
      ai_requests: { value: 20000, hard: false },
      storage_mb: { value: 50000, hard: true },
      quotes: { value: 2000, hard: false },
      projects: { value: 2000, hard: false },
      api_calls: { value: 100000, hard: false },
      custom_domains: { value: 2, hard: true },
    },
    priceMonthly: '490000',
  },
  {
    code: 'ENTERPRISE',
    name: 'Enterprise',
    description: '전 기능과 무제한에 가까운 한도',
    features: [
      'PRODUCT_SEARCH',
      'VISION_SEARCH',
      'DOMESTIC_MARKET',
      'COMPLIANCE',
      'FREIGHT',
      'CUSTOMS',
      'QUOTATION',
      'CONTRACT',
      'INVOICE',
      'SHIPMENT',
      'AIS',
      'CRM',
      'ANALYTICS',
      'API',
      'WHITE_LABEL',
      'CUSTOM_DOMAIN',
      'JOINT_SOURCING',
      'PRODUCT_DISCOVERY',
      'EXPERT_PORTAL',
      'WEBHOOKS',
    ],
    limits: {
      users: { value: -1, hard: false },
      monthly_searches: { value: -1, hard: false },
      ai_requests: { value: -1, hard: false },
      storage_mb: { value: -1, hard: false },
      quotes: { value: -1, hard: false },
      projects: { value: -1, hard: false },
      api_calls: { value: -1, hard: false },
      custom_domains: { value: 20, hard: true },
    },
    priceMonthly: null,
  },
];
