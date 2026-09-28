import { safeFetch } from '../../lib/http.js';
import { coupangAuthorization } from '../connections/registry.js';
import type { LoadedConnection } from '../connections/index.js';
import { genericSearch } from './generic-http.js';

/**
 * MarketConnector adapters for Korean domestic price intelligence.
 * Only official / partner APIs are used. Channels without a public API
 * (G마켓, 무신사, 토스 등) connect through GENERIC_HTTP_MARKET with a contracted provider.
 */

export interface MarketItem {
  platform: string;
  externalId: string;
  title: string;
  url: string;
  imageUrl: string;
  seller: string;
  brand: string;
  category: string;
  sellingPrice: string | null;
  discountPrice: string | null;
  reviews: number | null;
  rating: number | null;
  rank: number | null;
  delivery: string;
}

const strip = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

export async function naverShopping(conn: LoadedConnection, query: string, display = 40): Promise<MarketItem[]> {
  const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(query)}&display=${Math.min(100, display)}&sort=sim`;
  const res = await safeFetch(url, { trusted: true, headers: { 'X-Naver-Client-Id': conn.secrets.clientId ?? '', 'X-Naver-Client-Secret': conn.secrets.clientSecret ?? '' } });
  if (!res.ok) throw new Error(`NAVER HTTP ${res.status}`);
  const json = (await res.json()) as { items?: Array<{ title: string; link: string; image: string; lprice: string; hprice: string; mallName: string; productId: string; brand: string; maker: string; category1: string; category2: string; category3: string }> };
  return (json.items ?? []).map((i, idx) => ({
    platform: 'NAVER_SHOPPING',
    externalId: i.productId,
    title: strip(i.title),
    url: i.link,
    imageUrl: i.image,
    seller: i.mallName,
    brand: i.brand || i.maker,
    category: [i.category1, i.category2, i.category3].filter(Boolean).join(' > '),
    sellingPrice: i.lprice || null,
    discountPrice: null,
    reviews: null,
    rating: null,
    rank: idx + 1,
    delivery: '',
  }));
}

export async function coupangPartners(conn: LoadedConnection, query: string, limit = 20): Promise<MarketItem[]> {
  const path = '/v2/providers/affiliate_open_api/apis/openapi/products/search';
  const q = `keyword=${encodeURIComponent(query)}&limit=${Math.min(10, limit)}`;
  const res = await safeFetch(`https://api-gateway.coupang.com${path}?${q}`, { trusted: true, headers: { Authorization: coupangAuthorization('GET', path, q, conn.secrets.accessKey ?? '', conn.secrets.secretKey ?? '') } });
  if (!res.ok) throw new Error(`COUPANG HTTP ${res.status}`);
  const json = (await res.json()) as { data?: { productData?: Array<{ productId: number; productName: string; productPrice: number; productImage: string; productUrl: string; rank: number; isRocket: boolean; categoryName: string }> } };
  return (json.data?.productData ?? []).map((p) => ({
    platform: 'COUPANG',
    externalId: String(p.productId),
    title: p.productName,
    url: p.productUrl,
    imageUrl: p.productImage,
    seller: '',
    brand: '',
    category: p.categoryName ?? '',
    sellingPrice: String(p.productPrice),
    discountPrice: null,
    reviews: null,
    rating: null,
    rank: p.rank ?? null,
    delivery: p.isRocket ? '로켓배송' : '',
  }));
}

export async function elevenst(conn: LoadedConnection, query: string, limit = 20): Promise<MarketItem[]> {
  const url = `http://openapi.11st.co.kr/openapi/OpenApiService.tmall?key=${encodeURIComponent(conn.secrets.apiKey ?? '')}&apiCode=ProductSearch&keyword=${encodeURIComponent(query)}&pageSize=${limit}`;
  const res = await safeFetch(url, { trusted: true });
  if (!res.ok) throw new Error(`11ST HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const xml = new TextDecoder('euc-kr').decode(buf);
  const tag = (block: string, name: string) => strip(new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`).exec(block)?.[1] ?? '');
  const items = xml.match(/<Product>[\s\S]*?<\/Product>/g) ?? [];
  return items.map((b, idx) => ({
    platform: 'ELEVENST',
    externalId: tag(b, 'ProductCode'),
    title: tag(b, 'ProductName'),
    url: tag(b, 'DetailPageUrl'),
    imageUrl: tag(b, 'ProductImage300') || tag(b, 'ProductImage'),
    seller: tag(b, 'SellerNick'),
    brand: '',
    category: '',
    sellingPrice: tag(b, 'ProductPrice') || null,
    discountPrice: tag(b, 'SalePrice') || null,
    reviews: Number(tag(b, 'ReviewCount')) || null,
    rating: Number(tag(b, 'BuySatisfy')) ? Number(tag(b, 'BuySatisfy')) / 20 : null,
    rank: idx + 1,
    delivery: tag(b, 'Delivery'),
  }));
}

export async function genericMarket(conn: LoadedConnection, query: string, limit = 20): Promise<MarketItem[]> {
  const items = await genericSearch(conn, query, limit);
  const platform = String(conn.config.marketName ?? 'GENERIC').toUpperCase();
  return items.map((i, idx) => ({
    platform,
    externalId: i.externalId,
    title: i.title,
    url: i.url,
    imageUrl: i.image,
    seller: i.seller,
    brand: '',
    category: '',
    sellingPrice: i.price,
    discountPrice: null,
    reviews: i.reviews,
    rating: i.rating,
    rank: idx + 1,
    delivery: '',
  }));
}

export async function searchMarket(conn: LoadedConnection, query: string): Promise<MarketItem[]> {
  switch (conn.provider) {
    case 'NAVER_SHOPPING':
      return naverShopping(conn, query);
    case 'COUPANG_PARTNERS':
      return coupangPartners(conn, query);
    case 'ELEVENST_OPENAPI':
      return elevenst(conn, query);
    case 'GENERIC_HTTP_MARKET':
      return genericMarket(conn, query);
    default:
      return [];
  }
}

/** Price distribution statistics for a set of market prices (KRW integers). */
export function marketStats(prices: number[]) {
  const p = prices.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!p.length) return null;
  const q = (f: number) => p[Math.min(p.length - 1, Math.floor((p.length - 1) * f))]!;
  const avg = Math.round(p.reduce((a, b) => a + b, 0) / p.length);
  const buckets = 6;
  const min = p[0]!;
  const max = p[p.length - 1]!;
  const width = Math.max(1, Math.ceil((max - min + 1) / buckets));
  const histogram = Array.from({ length: buckets }, (_, i) => ({ from: min + i * width, to: min + (i + 1) * width - 1, count: 0 }));
  for (const x of p) histogram[Math.min(buckets - 1, Math.floor((x - min) / width))]!.count++;
  return { count: p.length, min, p25: q(0.25), median: q(0.5), avg, p75: q(0.75), max, histogram };
}
