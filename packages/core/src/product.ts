import { z } from 'zod';
import type { Tri } from './enums.js';

/**
 * Structured product understanding. Every field is either a concrete value
 * or the literal 'UNKNOWN' — the system never invents values it could not observe.
 */
export const triSchema = z.enum(['TRUE', 'FALSE', 'UNKNOWN']);
const strOrUnknown = z.string().min(1).default('UNKNOWN');

export const productAttributesSchema = z.object({
  category: strOrUnknown,
  subcategory: strOrUnknown,
  product_name_ko: strOrUnknown,
  product_name_cn: strOrUnknown,
  product_name_en: strOrUnknown,
  brand: strOrUnknown,
  model: strOrUnknown,
  material: strOrUnknown,
  dimensions: strOrUnknown,
  weight: strOrUnknown,
  voltage: strOrUnknown,
  wattage: strOrUnknown,
  battery: triSchema.default('UNKNOWN'),
  battery_type: strOrUnknown,
  battery_capacity: strOrUnknown,
  electrical: triSchema.default('UNKNOWN'),
  ac_powered: triSchema.default('UNKNOWN'),
  dc_powered: triSchema.default('UNKNOWN'),
  adapter_included: triSchema.default('UNKNOWN'),
  wireless: triSchema.default('UNKNOWN'),
  bluetooth: triSchema.default('UNKNOWN'),
  wifi: triSchema.default('UNKNOWN'),
  food_contact: triSchema.default('UNKNOWN'),
  children_product: triSchema.default('UNKNOWN'),
  skin_contact: triSchema.default('UNKNOWN'),
  cosmetic: triSchema.default('UNKNOWN'),
  medical_claim: triSchema.default('UNKNOWN'),
  chemical_product: triSchema.default('UNKNOWN'),
  biocide_claim: triSchema.default('UNKNOWN'),
  laser: triSchema.default('UNKNOWN'),
  pressure_vessel: triSchema.default('UNKNOWN'),
  liquid: triSchema.default('UNKNOWN'),
  magnet: triSchema.default('UNKNOWN'),
  flammable: triSchema.default('UNKNOWN'),
  features: z.array(z.string()).default([]),
  visible_text: z.array(z.string()).default([]),
  search_keywords_cn: z.array(z.string()).default([]),
  search_keywords_en: z.array(z.string()).default([]),
  search_keywords_ko: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0),
});

export type ProductAttributes = z.infer<typeof productAttributesSchema>;

export type TriAttributeKey = {
  [K in keyof ProductAttributes]: ProductAttributes[K] extends Tri ? K : never;
}[keyof ProductAttributes];

export const TRI_ATTRIBUTE_KEYS: TriAttributeKey[] = [
  'battery',
  'electrical',
  'ac_powered',
  'dc_powered',
  'adapter_included',
  'wireless',
  'bluetooth',
  'wifi',
  'food_contact',
  'children_product',
  'skin_contact',
  'cosmetic',
  'medical_claim',
  'chemical_product',
  'biocide_claim',
  'laser',
  'pressure_vessel',
  'liquid',
  'magnet',
  'flammable',
];

export const TRI_ATTRIBUTE_LABEL_KO: Record<TriAttributeKey, string> = {
  battery: '배터리 포함',
  electrical: '전기제품',
  ac_powered: 'AC 전원',
  dc_powered: 'DC 전원',
  adapter_included: '어댑터 포함',
  wireless: '무선 기능',
  bluetooth: '블루투스',
  wifi: 'Wi-Fi',
  food_contact: '식품 접촉',
  children_product: '어린이 제품',
  skin_contact: '피부 접촉',
  cosmetic: '화장품',
  medical_claim: '의료 효능 표방',
  chemical_product: '생활화학제품',
  biocide_claim: '살균·항균 표방',
  laser: '레이저',
  pressure_vessel: '압력용기',
  liquid: '액체',
  magnet: '자석',
  flammable: '가연성',
};

/** Returns a fully-populated attribute object where every missing value is UNKNOWN. */
export function emptyAttributes(): ProductAttributes {
  return productAttributesSchema.parse({});
}

/**
 * Merge attribute observations. A concrete observation beats UNKNOWN; when two
 * sources disagree on a tri-state value the result becomes UNKNOWN (conflict
 * must be resolved by a human rather than silently picking one).
 */
export function mergeAttributes(
  base: ProductAttributes,
  patch: Partial<ProductAttributes>,
): { merged: ProductAttributes; conflicts: string[] } {
  const merged: ProductAttributes = { ...base };
  const conflicts: string[] = [];
  const record = merged as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null) continue;
    const current = record[key];
    if (Array.isArray(value)) {
      const cur = Array.isArray(current) ? (current as string[]) : [];
      record[key] = [...new Set([...cur, ...(value as string[])])];
      continue;
    }
    if (key === 'confidence') {
      record[key] = Math.max(Number(current ?? 0), Number(value));
      continue;
    }
    if (value === 'UNKNOWN' || value === '') continue;
    if (current === undefined || current === 'UNKNOWN') {
      record[key] = value;
    } else if (current !== value) {
      if ((TRI_ATTRIBUTE_KEYS as string[]).includes(key)) {
        record[key] = 'UNKNOWN';
        conflicts.push(key);
      } else {
        conflicts.push(key);
      }
    }
  }
  return { merged, conflicts };
}

/** Very small keyword heuristics used only as a *signal* when no AI provider is configured. Results are marked low confidence. */
const KEYWORD_SIGNALS: Array<{ attr: TriAttributeKey; words: string[] }> = [
  {
    attr: 'battery',
    words: ['battery', 'rechargeable', 'mah', 'li-ion', 'lithium', '배터리', '충전식', '电池', '充电'],
  },
  {
    attr: 'electrical',
    words: ['usb', 'electric', 'volt', 'watt', ' led', '전기', '전동', '충전', '电动', '电源', 'led '],
  },
  { attr: 'bluetooth', words: ['bluetooth', '블루투스', '蓝牙'] },
  { attr: 'wifi', words: ['wifi', 'wi-fi', '와이파이', '无线网'] },
  { attr: 'wireless', words: ['wireless', 'bluetooth', 'wifi', '무선', '无线', 'rf '] },
  {
    attr: 'food_contact',
    words: [
      'cup',
      'bottle',
      'tumbler',
      'kitchen',
      'food',
      '컵',
      '텀블러',
      '식품',
      '주방',
      '水杯',
      '餐具',
      'lunch box',
    ],
  },
  {
    attr: 'children_product',
    words: ['kids', 'child', 'baby', 'toy', '아동', '유아', '어린이', '장난감', '儿童', '玩具', '婴儿'],
  },
  { attr: 'cosmetic', words: ['cosmetic', 'cream', 'lotion', '화장품', '크림', '化妆品'] },
  { attr: 'medical_claim', words: ['medical', 'therapy', '의료', '치료', '医疗'] },
  { attr: 'laser', words: ['laser', '레이저', '激光'] },
  { attr: 'liquid', words: ['liquid', 'oil', 'spray', '액체', '스프레이', '液体'] },
  { attr: 'magnet', words: ['magnet', 'magnetic', '자석', '磁'] },
];

export function keywordSignals(text: string): Partial<Record<TriAttributeKey, Tri>> {
  const t = ` ${text.toLowerCase()} `;
  const out: Partial<Record<TriAttributeKey, Tri>> = {};
  for (const s of KEYWORD_SIGNALS) {
    if (s.words.some((w) => t.includes(w))) out[s.attr] = 'TRUE';
  }
  if (out.bluetooth === 'TRUE' || out.wifi === 'TRUE') out.wireless = 'TRUE';
  if (out.battery === 'TRUE' || out.wireless === 'TRUE') out.electrical = 'TRUE';
  return out;
}
