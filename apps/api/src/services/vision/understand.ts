import { emptyAttributes, keywordSignals, mergeAttributes, productAttributesSchema, type ProductAttributes } from '@sos/core';
import { aiChat, aiWorker, AiUnavailableError, parseJsonLoose } from '../ai/router.js';
import { visionThumbnail } from './phash.js';

/**
 * Product understanding. Combines, in order of trust:
 *   1. OCR text (AI worker / PaddleOCR) — literal text on the product/packaging
 *   2. Florence-2 caption + SigLIP embedding (AI worker)
 *   3. Vision LLM structured extraction (router: primary → fallback)
 *   4. Keyword heuristics (low confidence; used only when nothing else exists)
 * Anything not observed stays 'UNKNOWN'.
 */

export interface StepLog {
  step: string;
  status: 'DONE' | 'SKIPPED' | 'FAILED';
  provider?: string;
  message?: string;
}

export interface Understanding {
  attributes: ProductAttributes;
  conflicts: string[];
  attributeSources: Record<string, string>;
  ocrText: string | null;
  caption: string | null;
  embedding: number[] | null;
  embeddingModel: string | null;
  subjectBox: { x: number; y: number; w: number; h: number } | null;
  steps: StepLog[];
}

const SYSTEM_PROMPT = `You are a product sourcing analyst for Korean importers. Extract structured facts about the product.
Rules:
- Use ONLY what is visible in the image(s) or stated in the text. If a field is not observable, output "UNKNOWN".
- Tri-state fields must be exactly "TRUE", "FALSE" or "UNKNOWN". Use FALSE only when clearly not the case (e.g. a ceramic mug is not electrical).
- Never invent brand, model numbers, dimensions, weights, voltages or capacities.
- product_name_ko must be natural Korean (e.g. "휴대용 미니 선풍기"), product_name_cn simplified Chinese as used on 1688, product_name_en concise English.
- search keywords: 3-6 items each, as a buyer would type on 1688 (cn), Alibaba (en), Naver Shopping (ko).
- confidence: 0..1, your overall certainty.
Return one JSON object with keys: category, subcategory, product_name_ko, product_name_cn, product_name_en, brand, model, material, dimensions, weight, voltage, wattage, battery, battery_type, battery_capacity, electrical, ac_powered, dc_powered, adapter_included, wireless, bluetooth, wifi, food_contact, children_product, skin_contact, cosmetic, medical_claim, chemical_product, biocide_claim, laser, pressure_vessel, liquid, magnet, flammable, features, visible_text, search_keywords_cn, search_keywords_en, search_keywords_ko, confidence.`;

export interface UnderstandInput {
  tenantId: string;
  images: Array<{ buffer: Buffer; mime: string }>;
  text: string; // query + description + URL-derived text + requirement notes
}

export async function understandProduct(input: UnderstandInput): Promise<Understanding> {
  const steps: StepLog[] = [];
  let attrs = emptyAttributes();
  let conflicts: string[] = [];
  const sources: Record<string, string> = {};
  let ocrText: string | null = null;
  let caption: string | null = null;
  let embedding: number[] | null = null;
  let embeddingModel: string | null = null;
  let subjectBox: Understanding['subjectBox'] = null;

  const apply = (patch: Partial<ProductAttributes>, source: string) => {
    const before = { ...attrs } as Record<string, unknown>;
    const r = mergeAttributes(attrs, patch);
    attrs = r.merged;
    conflicts = [...new Set([...conflicts, ...r.conflicts])];
    for (const [k, v] of Object.entries(attrs)) {
      if (before[k] !== v && v !== 'UNKNOWN' && !Array.isArray(v) && k !== 'confidence') sources[k] = source;
    }
  };

  const first = input.images[0];
  const worker = await aiWorker(input.tenantId).catch(() => null);

  // 1–2. AI worker: segmentation, OCR, caption, embedding
  if (worker && first) {
    try {
      const b64 = first.buffer.toString('base64');
      const r = await worker.post<{
        ocr?: { text: string; lines: string[]; engine: string } | null;
        caption?: { text: string; model: string } | null;
        embedding?: { vector: number[]; model: string } | null;
        subject?: { box: { x: number; y: number; w: number; h: number } } | null;
        errors?: Record<string, string>;
      }>('/v1/analyze', { image_base64: b64, tasks: ['segment', 'ocr', 'caption', 'embed'] }, 90_000);
      if (r.subject?.box) subjectBox = r.subject.box;
      steps.push({ step: 'segment', status: r.subject ? 'DONE' : 'SKIPPED', provider: 'AI_WORKER', message: r.errors?.segment });
      if (r.ocr?.text) {
        ocrText = r.ocr.text;
        steps.push({ step: 'ocr', status: 'DONE', provider: r.ocr.engine });
      } else steps.push({ step: 'ocr', status: 'SKIPPED', provider: 'AI_WORKER', message: r.errors?.ocr ?? '인식된 텍스트 없음' });
      if (r.caption?.text) {
        caption = r.caption.text;
        steps.push({ step: 'caption', status: 'DONE', provider: r.caption.model });
      } else steps.push({ step: 'caption', status: 'SKIPPED', provider: 'AI_WORKER', message: r.errors?.caption });
      if (r.embedding?.vector?.length) {
        embedding = r.embedding.vector;
        embeddingModel = r.embedding.model;
        steps.push({ step: 'embedding', status: 'DONE', provider: r.embedding.model });
      } else steps.push({ step: 'embedding', status: 'SKIPPED', provider: 'AI_WORKER', message: r.errors?.embed });
    } catch (e) {
      steps.push({ step: 'ai_worker', status: 'FAILED', message: e instanceof Error ? e.message : String(e) });
    }
  } else {
    steps.push({ step: 'ai_worker', status: 'SKIPPED', message: 'AI 워커(OCR·임베딩)가 연결되지 않았습니다.' });
  }

  // 3. Vision / text LLM structuring
  const textBlock = [input.text && `사용자 입력: ${input.text}`, ocrText && `OCR: ${ocrText}`, caption && `Caption: ${caption}`].filter(Boolean).join('\n');
  try {
    const content: Array<{ type: 'text'; text: string } | { type: 'image'; mime: string; base64: string }> = [];
    for (const img of input.images.slice(0, 3)) {
      const thumb = await visionThumbnail(img.buffer);
      content.push({ type: 'image', mime: 'image/jpeg', base64: thumb.toString('base64') });
    }
    content.push({ type: 'text', text: textBlock || '제품 사진을 분석하세요.' });
    const r = await aiChat(input.tenantId, input.images.length ? 'VISION_UNDERSTAND' : 'TEXT_STRUCTURE', [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content }], {
      vision: input.images.length > 0,
      json: true,
      maxTokens: 1400,
    });
    const parsed = parseJsonLoose<Record<string, unknown>>(r.text);
    if (parsed) {
      const safe = productAttributesSchema.partial().safeParse(normalizeLlm(parsed));
      if (safe.success) {
        apply(safe.data, `${r.provider}:${r.model}`);
        steps.push({ step: 'structure', status: 'DONE', provider: `${r.provider}${r.fallbackUsed ? ' (fallback)' : ''}` });
      } else steps.push({ step: 'structure', status: 'FAILED', provider: r.provider, message: 'AI 응답 형식 오류' });
    } else steps.push({ step: 'structure', status: 'FAILED', provider: r.provider, message: 'AI 응답을 해석하지 못했습니다.' });
  } catch (e) {
    steps.push({ step: 'structure', status: e instanceof AiUnavailableError ? 'SKIPPED' : 'FAILED', message: e instanceof Error ? e.message : String(e) });
  }

  // 4. Keyword signals (only fill UNKNOWNs, low confidence)
  const signals = keywordSignals([input.text, ocrText, caption].filter(Boolean).join(' '));
  if (Object.keys(signals).length) {
    const fill: Partial<ProductAttributes> = {};
    for (const [k, v] of Object.entries(signals)) if (attrs[k as keyof ProductAttributes] === 'UNKNOWN') (fill as Record<string, unknown>)[k] = v;
    apply(fill, 'KEYWORD_HEURISTIC');
    steps.push({ step: 'keyword_signals', status: 'DONE', message: '키워드 기반 추정(낮은 신뢰도)' });
  }
  if (ocrText) apply({ visible_text: ocrText.split(/\n+/).map((s) => s.trim()).filter(Boolean).slice(0, 20) }, 'OCR');
  if (attrs.product_name_ko === 'UNKNOWN' && input.text.trim()) {
    apply({ product_name_ko: input.text.trim().split('\n')[0]!.slice(0, 80), search_keywords_ko: [input.text.trim().slice(0, 40)] }, 'USER_INPUT');
  }
  if (!sources.category && attrs.confidence === 0) attrs = { ...attrs, confidence: Object.keys(signals).length ? 0.2 : 0 };

  return { attributes: attrs, conflicts, attributeSources: sources, ocrText, caption, embedding, embeddingModel, subjectBox, steps };
}

/** LLMs sometimes return booleans/null instead of tri-state strings; normalise safely. */
function normalizeLlm(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === true) out[k] = 'TRUE';
    else if (v === false) out[k] = 'FALSE';
    else if (v === null || v === '' || v === 'unknown' || v === 'N/A') out[k] = 'UNKNOWN';
    else if (typeof v === 'string' && ['true', 'false'].includes(v.toLowerCase())) out[k] = v.toUpperCase();
    else if (k === 'confidence') out[k] = Math.max(0, Math.min(1, Number(v) || 0));
    else if (Array.isArray(v)) out[k] = v.map(String).slice(0, 20);
    else out[k] = typeof v === 'number' ? String(v) : v;
  }
  return out;
}
