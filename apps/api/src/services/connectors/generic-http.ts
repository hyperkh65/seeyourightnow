import { AppError } from '../../lib/errors.js';
import { safeFetch } from '../../lib/http.js';
import type { ConnectionRuntime } from '../connections/registry.js';

/**
 * Generic JSON connector: search URL template + response field mapping.
 * Used for contracted data providers where no first-party API exists.
 */

export function getPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    if (Array.isArray(acc) && /^\d+$/.test(key)) return acc[Number(key)];
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

export interface GenericItem {
  externalId: string;
  title: string;
  price: string | null;
  currency: string;
  moq: number | null;
  url: string;
  image: string;
  seller: string;
  reviews: number | null;
  rating: number | null;
  raw: unknown;
}

export async function genericSearch(rt: ConnectionRuntime, query: string, limit = 20): Promise<GenericItem[]> {
  const template = String(rt.config.searchUrl ?? '');
  if (!template.includes('{query}')) throw new AppError(400, 'CONFIG', '검색 URL에 {query} 자리표시자가 필요합니다.');
  let map: Record<string, string>;
  try {
    map = JSON.parse(String(rt.config.map ?? '{}')) as Record<string, string>;
  } catch {
    throw new AppError(400, 'CONFIG', '필드 매핑 JSON 형식이 올바르지 않습니다.');
  }
  const url = template.replace('{query}', encodeURIComponent(query));
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (rt.config.authHeader && rt.secrets.apiKey) headers[String(rt.config.authHeader)] = `${String(rt.config.authPrefix ?? '')}${rt.secrets.apiKey}`;
  const res = await safeFetch(url, { headers, timeoutMs: 15_000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as unknown;
  const items = getPath(json, String(rt.config.itemsPath ?? ''));
  if (!Array.isArray(items)) throw new Error('결과 배열 경로에서 배열을 찾지 못했습니다.');
  const num = (v: unknown) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
  const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
  const constOrPath = (item: unknown, spec: string | undefined, fallback: string) => {
    if (!spec) return fallback;
    const v = getPath(item, spec);
    return v === undefined ? (/^[A-Z]{3}$/.test(spec) ? spec : fallback) : s(v);
  };
  return items.slice(0, limit).map((it) => {
    const priceRaw = getPath(it, map.price ?? '');
    const price = priceRaw === undefined || priceRaw === null || priceRaw === '' ? null : String(priceRaw).replace(/[^0-9.]/g, '') || null;
    return {
      externalId: s(getPath(it, map.externalId ?? 'id')),
      title: s(getPath(it, map.title ?? 'title')),
      price,
      currency: constOrPath(it, map.currency, 'CNY'),
      moq: num(getPath(it, map.moq ?? '')),
      url: s(getPath(it, map.url ?? '')),
      image: s(getPath(it, map.image ?? '')),
      seller: s(getPath(it, map.seller ?? '')),
      reviews: num(getPath(it, map.reviews ?? '')),
      rating: num(getPath(it, map.rating ?? '')),
      raw: it,
    };
  });
}
