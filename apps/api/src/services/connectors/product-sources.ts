import { and, eq, inArray, sql } from 'drizzle-orm';
import type { ProductAttributes, SourceType } from '@sos/core';
import { expiresAtFor } from '@sos/core';
import { config } from '../../config.js';
import type { Tx } from '../../db/client.js';
import { listingPriceHistory, sourceListings, suppliers } from '../../db/schema/index.js';
import { safeFetch } from '../../lib/http.js';
import { aopSignature } from '../connections/registry.js';
import type { LoadedConnection } from '../connections/index.js';
import { genericSearch } from './generic-http.js';

/**
 * ProductSourceConnector contract. Each marketplace / supply network is an
 * adapter; replacing one never touches the rest of the system.
 * Methods not supported by a source return null (never fabricated data).
 */
export interface SourceQuery {
  keywordsCn: string[];
  keywordsEn: string[];
  keywordsKo: string[];
  attributes: ProductAttributes;
  embedding: number[] | null;
  phash: string | null;
  url?: string | null;
  limit: number;
}

export interface NormalizedListing {
  connector: string;
  sourceType: SourceType;
  externalId: string;
  url: string;
  title: string;
  model?: string;
  currency: string;
  priceTiers: Array<{ minQty: number; unitPrice: string }>;
  moq: number | null;
  leadTimeDays?: number | null;
  imageUrls: string[];
  specs?: Record<string, string>;
  salesMetrics?: { sold30d?: number; reviews?: number; rating?: number };
  packaging?: Record<string, string | number>;
  shippingOrigin?: string;
  seller?: { name: string; externalId?: string; location?: string; yearsInBusiness?: number | null; verified?: boolean | null };
  isDevMock?: boolean;
  raw?: unknown;
}

export interface ConnectorSearchResult {
  connector: string;
  status: 'OK' | 'NOT_CONFIGURED' | 'ERROR' | 'SKIPPED';
  message?: string;
  listingIds: string[];
}

export interface ProductSourceConnector {
  name: string;
  search(tx: Tx, tenantId: string, q: SourceQuery): Promise<NormalizedListing[] | string[]>;
  getProduct?(externalIdOrUrl: string): Promise<NormalizedListing | null>;
}

// ───────────── Private network / internal DB ─────────────

const PRIVATE_TYPES: SourceType[] = ['PRIVATE_NETWORK', 'DIRECT_FACTORY', 'LOCAL_PARTNER', 'INTERNAL_PRODUCT', 'RFQ_RESULT', 'MANUAL_PROPOSAL'];

/** Searches the tenant's own supply network (and previously collected listings) by text trigram, image hash and embedding. */
export async function searchInternal(tx: Tx, tenantId: string, q: SourceQuery): Promise<string[]> {
  const terms = [...q.keywordsKo, ...q.keywordsCn, ...q.keywordsEn, q.attributes.product_name_ko, q.attributes.product_name_en, q.attributes.product_name_cn]
    .filter((t) => t && t !== 'UNKNOWN')
    .slice(0, 8);
  const ids = new Set<string>();
  if (terms.length) {
    const conds = terms.map((t) => sql`(similarity(${sourceListings.title}, ${t}) > 0.15 or similarity(${sourceListings.titleKo}, ${t}) > 0.15 or ${sourceListings.title} ilike ${'%' + t + '%'} or ${sourceListings.titleKo} ilike ${'%' + t + '%'})`);
    const rows = await tx
      .select({ id: sourceListings.id })
      .from(sourceListings)
      .where(and(eq(sourceListings.tenantId, tenantId), sql`(${sql.join(conds, sql` or `)})`, config.DEV_MODE ? sql`true` : eq(sourceListings.isDevMock, false)))
      .limit(q.limit * 2);
    rows.forEach((r) => ids.add(r.id));
  }
  if (q.embedding?.length) {
    const vec = `[${q.embedding.join(',')}]`;
    const rows = await tx.execute<{ owner_id: string; distance: number }>(sql`
      select owner_id, embedding <=> ${vec}::vector as distance from product_embeddings
      where tenant_id = ${tenantId} and owner_type = 'SOURCE_LISTING'
      order by embedding <=> ${vec}::vector limit ${q.limit}`);
    rows.rows.filter((r) => r.distance < 0.35).forEach((r) => ids.add(r.owner_id));
  }
  if (q.phash) {
    const rows = await tx.select({ id: sourceListings.id, phash: sourceListings.phash }).from(sourceListings).where(and(eq(sourceListings.tenantId, tenantId), sql`${sourceListings.phash} is not null`)).limit(5000);
    const { phashSimilarity } = await import('@sos/core');
    rows.filter((r) => (phashSimilarity(q.phash, r.phash) ?? 0) >= 0.85).forEach((r) => ids.add(r.id));
  }
  return [...ids];
}

export function isPrivateSource(t: string): boolean {
  return (PRIVATE_TYPES as string[]).includes(t);
}

// ───────────── Generic HTTP data provider ─────────────

export async function searchGeneric(conn: LoadedConnection, q: SourceQuery): Promise<NormalizedListing[]> {
  const query = q.keywordsCn[0] ?? q.keywordsEn[0] ?? q.keywordsKo[0];
  if (!query) return [];
  const items = await genericSearch(conn, query, q.limit);
  const market = String(conn.config.marketName ?? 'GENERIC');
  return items
    .filter((i) => i.externalId && i.title)
    .map((i) => ({
      connector: `GENERIC_HTTP:${market}`,
      sourceType: 'PUBLIC_MARKET' as const,
      externalId: i.externalId,
      url: i.url,
      title: i.title,
      currency: i.currency,
      priceTiers: i.price ? [{ minQty: i.moq ?? 1, unitPrice: i.price }] : [],
      moq: i.moq,
      imageUrls: i.image ? [i.image] : [],
      seller: i.seller ? { name: i.seller } : undefined,
      salesMetrics: { reviews: i.reviews ?? undefined, rating: i.rating ?? undefined },
      raw: i.raw,
    }));
}

// ───────────── 1688 Open Platform ─────────────

export function parse1688OfferId(url: string): string | null {
  const m = /1688\.com\/offer\/(\d{6,})\.html/.exec(url) ?? /offerId=(\d{6,})/.exec(url);
  return m?.[1] ?? null;
}

async function call1688(conn: LoadedConnection, apiPath: string, params: Record<string, string>): Promise<unknown> {
  const gateway = String(conn.config.gateway ?? 'https://gw.open.1688.com/openapi');
  const appKey = conn.secrets.appKey ?? '';
  const urlPath = `${apiPath.replace(/^\/+/, '')}/${appKey}`;
  const all: Record<string, string> = { ...params, ...(conn.secrets.accessToken ? { access_token: conn.secrets.accessToken } : {}), _aop_timestamp: String(Date.now()) };
  all._aop_signature = aopSignature(urlPath, all, conn.secrets.appSecret ?? '');
  const res = await safeFetch(`${gateway}/${urlPath}`, { method: 'POST', trusted: true, timeoutMs: 15_000, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(all).toString() });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !json) throw new Error(`1688 API HTTP ${res.status}`);
  if (json.error_code || json.errorCode) throw new Error(`1688 API ${String(json.error_code ?? json.errorCode)}: ${String(json.error_message ?? json.errorMessage ?? '')}`);
  return json;
}

/** Maps a 1688 product-detail response (productInfo) into the normalized listing. Unknown fields stay empty. */
export function map1688Product(offerId: string, json: unknown): NormalizedListing | null {
  const info = ((json as Record<string, unknown>).productInfo ?? (json as Record<string, unknown>).result ?? json) as Record<string, unknown>;
  const subject = String(info.subject ?? info.subjectTrans ?? '');
  if (!subject) return null;
  const sale = (info.saleInfo ?? {}) as Record<string, unknown>;
  const ranges = (sale.priceRanges ?? []) as Array<{ startQuantity?: number; price?: number | string }>;
  const images = ((info.image as Record<string, unknown> | undefined)?.images ?? []) as string[];
  const attrs = (info.attributes ?? []) as Array<{ attributeName?: string; value?: string }>;
  return {
    connector: 'ALIBABA_1688_OPEN',
    sourceType: 'PUBLIC_MARKET',
    externalId: offerId,
    url: `https://detail.1688.com/offer/${offerId}.html`,
    title: subject,
    currency: 'CNY',
    priceTiers: ranges.filter((r) => r.price !== undefined).map((r) => ({ minQty: Number(r.startQuantity ?? 1), unitPrice: String(r.price) })),
    moq: sale.minOrderQuantity !== undefined ? Number(sale.minOrderQuantity) : null,
    imageUrls: images.map((i) => (i.startsWith('http') ? i : `https://cbu01.alicdn.com/${i}`)),
    specs: Object.fromEntries(attrs.filter((a) => a.attributeName && a.value).map((a) => [a.attributeName!, a.value!])),
    raw: json,
  };
}

export async function get1688Product(conn: LoadedConnection, offerId: string): Promise<NormalizedListing | null> {
  const api = String(conn.config.productGetApi ?? '');
  if (!api) return null;
  const json = await call1688(conn, api, { productID: offerId, webSite: '1688' });
  return map1688Product(offerId, json);
}

export async function search1688(conn: LoadedConnection, q: SourceQuery): Promise<NormalizedListing[]> {
  const api = String(conn.config.searchApi ?? '');
  const out: NormalizedListing[] = [];
  if (q.url) {
    const id = parse1688OfferId(q.url);
    if (id) {
      const p = await get1688Product(conn, id);
      if (p) out.push(p);
    }
  }
  if (!api || !q.keywordsCn[0]) return out;
  const json = (await call1688(conn, api, { keywords: q.keywordsCn[0], pageSize: String(q.limit), beginPage: '1' })) as Record<string, unknown>;
  const list = (((json.result as Record<string, unknown> | undefined)?.data ?? (json.result as Record<string, unknown> | undefined)?.offerList ?? json.data ?? []) as Array<Record<string, unknown>>) ?? [];
  for (const it of list) {
    const id = String(it.offerId ?? it.id ?? '');
    const title = String(it.subject ?? it.subjectTrans ?? it.title ?? '');
    if (!id || !title) continue;
    const price = it.priceInfo && typeof it.priceInfo === 'object' ? (it.priceInfo as Record<string, unknown>).price : it.price;
    out.push({
      connector: 'ALIBABA_1688_OPEN',
      sourceType: 'PUBLIC_MARKET',
      externalId: id,
      url: `https://detail.1688.com/offer/${id}.html`,
      title,
      currency: 'CNY',
      priceTiers: price !== undefined ? [{ minQty: 1, unitPrice: String(price) }] : [],
      moq: it.minOrderQuantity !== undefined ? Number(it.minOrderQuantity) : null,
      imageUrls: it.imageUrl ? [String(it.imageUrl)] : [],
      raw: it,
    });
  }
  return out;
}

// ───────────── DEV_MODE mock (never in production) ─────────────

export function devMockListings(q: SourceQuery): NormalizedListing[] {
  if (!config.DEV_MODE) return [];
  const base = q.attributes.product_name_cn !== 'UNKNOWN' ? q.attributes.product_name_cn : (q.keywordsCn[0] ?? q.keywordsKo[0] ?? 'product');
  const seed = [...base].reduce((a, c) => a + c.charCodeAt(0), 0);
  const rnd = (i: number) => ((seed * 9301 + i * 49297) % 233280) / 233280;
  return Array.from({ length: 6 }, (_, i) => {
    const price = (8 + rnd(i) * 30).toFixed(2);
    return {
      connector: 'DEV_MOCK',
      sourceType: 'PUBLIC_MARKET' as const,
      externalId: `devmock-${seed}-${i}`,
      url: '',
      title: `[DEV MOCK] ${base} 样品 ${i + 1}`,
      model: i < 3 ? `DM-${seed % 1000}` : `DM-${seed % 1000}-${i}`,
      currency: 'CNY',
      priceTiers: [
        { minQty: 1, unitPrice: price },
        { minQty: 500, unitPrice: (Number(price) * 0.9).toFixed(2) },
      ],
      moq: [50, 100, 200, 500, 1000, 100][i]!,
      leadTimeDays: [15, 20, 25, 30, 12, 18][i]!,
      imageUrls: [],
      specs: {},
      seller: { name: `[DEV MOCK] 供应商 ${i + 1}`, yearsInBusiness: [1, 3, 5, 8, 2, 10][i]!, verified: i % 2 === 0 },
      isDevMock: true,
    };
  });
}

// ───────────── persistence ─────────────

/** Upserts normalized listings (and their public-market suppliers) and records price history. */
export async function upsertListings(tx: Tx, tenantId: string, items: NormalizedListing[]): Promise<string[]> {
  const ids: string[] = [];
  for (const it of items) {
    let supplierId: string | null = null;
    if (it.seller?.name) {
      const [s] = await tx.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.name, it.seller.name))).limit(1);
      supplierId =
        s?.id ??
        (
          await tx
            .insert(suppliers)
            .values({ tenantId, name: it.seller.name, sourceType: it.sourceType, visibility: 'ALIAS', alias: 'Marketplace Supplier', yearsInBusiness: it.seller.yearsInBusiness ?? null, businessVerified: it.seller.verified ?? null, city: it.seller.location ?? '', externalRefs: it.seller.externalId ? { [it.connector]: it.seller.externalId } : {} })
            .returning({ id: suppliers.id })
        )[0]!.id;
    }
    const firstPrice = it.priceTiers[0]?.unitPrice ?? null;
    const values = {
      tenantId,
      supplierId,
      sourceType: it.sourceType,
      connector: it.connector,
      externalId: it.externalId,
      url: it.url,
      title: it.title,
      model: it.model ?? '',
      currency: it.currency,
      priceTiers: it.priceTiers,
      supplierListPrice: firstPrice,
      moq: it.moq,
      leadTimeDays: it.leadTimeDays ?? null,
      imageUrls: it.imageUrls,
      specs: it.specs ?? {},
      salesMetrics: it.salesMetrics ?? {},
      packaging: (it.packaging ?? {}) as Record<string, string>,
      shippingOrigin: it.shippingOrigin ?? '',
      isDevMock: !!it.isDevMock,
      lastCheckedAt: new Date(),
      expiresAt: expiresAtFor('supplier_price'),
      raw: (it.raw ?? null) as never,
      updatedAt: new Date(),
    };
    const [row] = await tx
      .insert(sourceListings)
      .values(values)
      .onConflictDoUpdate({ target: [sourceListings.tenantId, sourceListings.connector, sourceListings.externalId], targetWhere: sql`${sourceListings.externalId} <> ''`, set: { ...values, collectedAt: undefined } as never })
      .returning({ id: sourceListings.id });
    ids.push(row!.id);
    if (firstPrice) await tx.insert(listingPriceHistory).values({ tenantId, listingId: row!.id, unitPrice: firstPrice, currency: it.currency, moq: it.moq, sellerName: it.seller?.name ?? null });
  }
  return ids;
}

export async function listingsByIds(tx: Tx, ids: string[]) {
  if (!ids.length) return [];
  return tx.select().from(sourceListings).where(inArray(sourceListings.id, ids));
}
