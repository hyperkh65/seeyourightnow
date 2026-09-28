export interface ScoreComponent {
  key: string;
  label: string;
  score: number | null;
  weight: number;
  evidence: string;
}

export interface StaffCandidate {
  id: string;
  score: number;
  coverage: number;
  components: ScoreComponent[];
  tags: string[];
  reasons: string[];
  cautions: string[];
  pinned: boolean;
  hiddenFromCustomer: boolean;
  selected: boolean;
  isInternalRecommendation: boolean;
  internalCost: string | null;
  customerPrice: string | null;
  privateNote: string;
  customerNote: string;
  unitPriceBase: string | null;
  imageSimilarity: number | null;
  listing: { id: string; title: string; titleKo: string; url: string; imageUrls: string[]; currency: string; priceTiers: Array<{ minQty: number; unitPrice: string }>; supplierListPrice: string | null; supplierVerifiedPrice: string | null; moq: number | null; leadTimeDays: number | null; sourceType: string; connector: string; isDevMock: boolean; lastCheckedAt: string; specs: Record<string, string> };
  supplier: null | { id: string; name: string; displayName: string; visibility: string; businessType: string; city: string; yearsInBusiness: number | null; businessVerified: boolean | null; blacklisted: boolean; riskFlags: string[] };
  cost: null | { id: string; landedCostPerUnit: string; landedCostTotal: string; complete: boolean; verification: string; warnings: string[]; createdAt: string };
  pricing: null | { id: string; calculatedCustomerPrice: string | null; adminFinalPrice: string | null; adminFinalReason: string | null; priceResult: Record<string, unknown> };
}

export interface StaffResult {
  audience: 'STAFF';
  id: string;
  status: string;
  progress: Record<string, { status: string; message?: string | null; at?: string }>;
  projectId: string | null;
  currency: string;
  input: { query: string; url: string; description: string; quantity: number | null; options: Record<string, unknown>; images: string[] };
  product: null | { id: string; nameKo: string; nameEn: string; category: string; attributes: Record<string, unknown> | null; confidence: number; conflicts: string[]; risk: { overall: string; items: Array<{ dimension: string; level: string; reasons: string[] }> } | null; requiredDocuments: string[] };
  candidates: StaffCandidate[];
  clusters: Array<{ id: string; label: string; supplierCount: number; currency: string | null; lowestPrice: string | null; medianPrice: string | null; highestPrice: string | null; reasons: string[] }>;
  compliance: Array<{ id: string; code: string; name: string; authority: string; status: string; estimatedStatus: string; verifiedStatus: string | null; confidence: number; reasons: string[]; missing: string[]; expertNote: string; estimatedCost: string | null; verifiedCost: string | null }>;
  hs: null | { id: string; candidates: Array<{ code: string; description: string; score: number; reasons: string[] }>; estimatedHs: string | null; estimatedConfidence: number | null; verifiedHs: string | null; actualHs: string | null; verificationNote: string };
  tariffs: Array<{ rateType: string; ratePct: string | null; source: string; verification: string; requiresCertificateOfOrigin: boolean; demo: boolean }>;
  market: { stats: null | { count: number; min: number; median: number; avg: number; max: number; p25: number; p75: number }; count: number; platforms: string[]; items: Array<{ platform: string; title: string; url: string; price: string | null; seller: string; isDevMock: boolean }> };
}

export interface CostLine {
  key: string;
  label: string;
  component: string;
  originalAmount: string | null;
  originalCurrency: string | null;
  basis: string;
  totalBase: string;
  perUnitBase: string;
  source: string;
  verification: string;
  includedInLandedCost: boolean;
  note?: string;
}
export interface EstimateRes {
  calculationId: string;
  landed: { baseCurrency: string; quantity: number; lines: CostLine[]; customsValueBase: string; dutyBase: string | null; vatBase: string | null; totalExVatBase: string; landedCostBase: string; perUnitLandedCostBase: string; customerSeparateBase: string; complete: boolean; warnings: string[]; verification: string; fxUsed: Array<{ from: string; to: string; rate: string; rateDate: string | null; source: string | null }> };
  price: null | { calculatedUnitPriceBase: string; roundedTotalBase: string; totalCostBase: string; profitBase: string; markupPct: string | null; marginPct: string | null; components: Array<{ component: string; costBase: string; markupPct: string; priceBase: string; explanation?: { baseFrom: { name: string; scope: string }; adjustments: Array<{ name: string; markupPct: string }>; clampedFrom?: string; override?: { reason: string } } }> };
  freight: null | { metrics: { cbm: string; grossWeightKg: string; chargeableAirKg: string }; options: Array<{ mode: string; status: string; costBase?: string; transitDays?: string; source?: string; verification?: string; actionRequired?: string; feasibility: { restrictions: string[] }; expired?: boolean }>; recommended: string | null };
  dutyNote: string;
  pricingSnapshotId: string | null;
}
