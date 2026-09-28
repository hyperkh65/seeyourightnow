import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  clusterListings,
  cosine,
  D,
  DEFAULT_MATCH_WEIGHTS,
  median,
  phashSimilarity,
  rankCandidates,
  type CandidateInput,
  type MatchWeights,
  type ProductAttributes,
  type SourceType,
  expiresAtFor,
} from '@sos/core';
import { withTenant, type Tx } from '../../db/client.js';
import {
  files,
  marketListings,
  marketPriceHistory,
  modelPredictions,
  productClusters,
  productEmbeddings,
  productImages,
  products,
  requestCandidates,
  searchEvents,
  sourceListings,
  sourcingProjects,
  sourcingRequests,
  suppliers,
} from '../../db/schema/index.js';
import { hmacHex } from '../../lib/crypto.js';
import { safeFetch } from '../../lib/http.js';
import { logger } from '../../lib/logger.js';
import { connectionsWithCapability, recordConnectionResult } from '../connections/index.js';
import { searchMarket } from '../connectors/market.js';
import {
  devMockListings,
  parse1688OfferId,
  search1688,
  searchGeneric,
  searchInternal,
  upsertListings,
  type NormalizedListing,
  type SourceQuery,
} from '../connectors/product-sources.js';
import { evaluateProductCompliance, effectiveAttributes } from '../compliance.js';
import { fileBuffer } from '../files.js';
import { loadFxTable } from '../fx.js';
import { findHsCandidates, rerankWithAi, saveEstimatedHs } from '../hs.js';
import { enqueue, registerJob } from '../jobs.js';
import { notifyEvent } from '../notify.js';
import { estimateForCandidate } from '../pricing.js';
import { getPublished } from '../settings.js';
import { phash, imageMeta } from '../vision/phash.js';
import { understandProduct } from '../vision/understand.js';
import { fetchUrlMeta } from './url-meta.js';

type Step = 'analyze' | 'search' | 'market' | 'compliance' | 'hs' | 'cost';

export async function setProgress(
  tenantId: string,
  requestId: string,
  step: Step,
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'SKIPPED',
  message?: string,
): Promise<void> {
  await withTenant({ tenantId }, (tx) =>
    tx
      .update(sourcingRequests)
      .set({
        progress: sql`jsonb_set(coalesce(${sourcingRequests.progress}, '{}'::jsonb), ${`{${step}}`}::text[], ${JSON.stringify({ status, message: message ?? null, at: new Date().toISOString() })}::jsonb, true)`,
        updatedAt: new Date(),
      })
      .where(eq(sourcingRequests.id, requestId)),
  );
}

async function maybeFinish(tenantId: string, requestId: string): Promise<void> {
  await withTenant({ tenantId }, async (tx) => {
    const [r] = await tx.select().from(sourcingRequests).where(eq(sourcingRequests.id, requestId)).limit(1);
    if (!r || r.status === 'READY') return;
    const steps: Step[] = ['analyze', 'search', 'market', 'compliance', 'hs', 'cost'];
    const done = steps.every((s) => ['DONE', 'SKIPPED', 'FAILED'].includes(r.progress[s]?.status ?? ''));
    if (!done) return;
    await tx
      .update(sourcingRequests)
      .set({ status: 'READY', updatedAt: new Date() })
      .where(eq(sourcingRequests.id, requestId));
    if (r.projectId) {
      await tx
        .update(sourcingProjects)
        .set({ stage: 'QUOTE_PREPARING', updatedAt: new Date() })
        .where(and(eq(sourcingProjects.id, r.projectId), eq(sourcingProjects.stage, 'SEARCHING')));
      await notifyEvent(
        tx,
        tenantId,
        'ANALYSIS_COMPLETED',
        r.projectId,
        {},
        { dedupeKey: `analysis:${requestId}` },
      );
    }
  });
}

// ───────────────────────────── 1. Analyze ─────────────────────────────

registerJob(
  'sourcing.analyze',
  async (payload, { tenantId }) => {
    const requestId = String(payload.requestId);
    await setProgress(tenantId, requestId, 'analyze', 'RUNNING', '제품을 분석하고 있습니다.');
    const { req, images } = await withTenant({ tenantId }, async (tx) => {
      const [req] = await tx
        .select()
        .from(sourcingRequests)
        .where(eq(sourcingRequests.id, requestId))
        .limit(1);
      if (!req) throw new Error('request not found');
      const images: Array<{ fileId: string; buffer: Buffer; mime: string; sha256: string }> = [];
      for (const fid of req.imageFileIds.slice(0, 5)) {
        const [f] = await tx.select().from(files).where(eq(files.id, fid)).limit(1);
        if (!f) continue;
        const b = await fileBuffer(tx, fid);
        images.push({ fileId: fid, buffer: b.buffer, mime: b.mime, sha256: f.sha256 });
      }
      return { req, images };
    });

    // URL input: link preview (robots-aware) + direct 1688 lookup when configured.
    let urlText = '';
    let urlNote: string | null = null;
    if (req.url) {
      const m = await fetchUrlMeta(req.url).catch(
        (e) =>
          ({ error: String(e) }) as {
            error: string;
            title?: null;
            description?: null;
            image?: null;
            price?: null;
            currency?: null;
          },
      );
      if ('title' in m && m.title)
        urlText = [m.title, m.description, m.price ? `가격 ${m.price} ${m.currency ?? ''}` : '']
          .filter(Boolean)
          .join(' / ');
      if (m.error) urlNote = m.error;
      if ('image' in m && m.image && images.length === 0) {
        try {
          const res = await safeFetch(m.image, { timeoutMs: 10_000 });
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.length < 8 * 1024 * 1024)
              images.push({
                fileId: '',
                buffer: buf,
                mime: res.headers.get('content-type') ?? 'image/jpeg',
                sha256: '',
              });
          }
        } catch {
          /* optional */
        }
      }
    }

    // Image fingerprints + exact-duplicate reuse (cache): an identical image analysed before is reused.
    const hashes: Array<{
      fileId: string;
      sha256: string;
      phash: string | null;
      width: number | null;
      height: number | null;
    }> = [];
    for (const img of images) {
      const ph = await phash(img.buffer).catch(() => null);
      const meta = await imageMeta(img.buffer).catch(() => ({ width: null, height: null }));
      hashes.push({ fileId: img.fileId, sha256: img.sha256, phash: ph, ...meta });
    }
    const reuse = await withTenant({ tenantId }, async (tx) => {
      const sha = hashes.find((h) => h.sha256)?.sha256;
      if (!sha || req.description || req.query) return null;
      const [prev] = await tx
        .select({ productId: productImages.productId })
        .from(productImages)
        .where(
          and(
            eq(productImages.tenantId, tenantId),
            eq(productImages.sha256, sha),
            ne(productImages.requestId, requestId),
          ),
        )
        .orderBy(desc(productImages.createdAt))
        .limit(1);
      if (!prev?.productId) return null;
      const [p] = await tx.select().from(products).where(eq(products.id, prev.productId)).limit(1);
      return p?.attributesEstimated && Date.now() - p.updatedAt.getTime() < 30 * 86_400_000 ? p : null;
    });

    const text = [req.query, req.description, urlText, req.options.notes].filter(Boolean).join('\n');
    const u = reuse
      ? {
          attributes: reuse.attributesEstimated!,
          conflicts: reuse.attributeConflicts,
          attributeSources: reuse.attributeSources,
          ocrText: null,
          caption: null,
          embedding: null,
          embeddingModel: null,
          subjectBox: null,
          steps: [
            {
              step: 'cache',
              status: 'DONE' as const,
              message: '동일한 이미지의 기존 분석 결과를 재사용했습니다.',
            },
          ],
        }
      : await understandProduct({
          tenantId,
          images: images.map((i) => ({ buffer: i.buffer, mime: i.mime })),
          text,
        });

    const productId = await withTenant({ tenantId }, async (tx) => {
      const a = u.attributes;
      const [p] = await tx
        .insert(products)
        .values({
          tenantId,
          projectId: req.projectId,
          requestId,
          nameKo: a.product_name_ko !== 'UNKNOWN' ? a.product_name_ko : req.query || '이름 미확인 제품',
          nameEn: a.product_name_en !== 'UNKNOWN' ? a.product_name_en : '',
          nameCn: a.product_name_cn !== 'UNKNOWN' ? a.product_name_cn : '',
          category: a.category,
          subcategory: a.subcategory,
          attributesEstimated: a,
          attributeSources: u.attributeSources,
          attributeConflicts: u.conflicts,
          confidence: a.confidence,
          passport: { pipeline: u.steps, urlNote },
        })
        .returning({ id: products.id });
      for (const h of hashes) {
        if (!h.fileId) continue;
        const [pi] = await tx
          .insert(productImages)
          .values({
            tenantId,
            productId: p!.id,
            requestId,
            fileId: h.fileId,
            sha256: h.sha256,
            phash: h.phash,
            width: h.width,
            height: h.height,
            ocrText: u.ocrText,
            subjectBox: u.subjectBox,
            analysis: { caption: u.caption },
          })
          .returning({ id: productImages.id });
        if (u.embedding && u.embedding.length === 768 && hashes[0] === h) {
          await tx
            .insert(productEmbeddings)
            .values({
              tenantId,
              ownerType: 'PRODUCT_IMAGE',
              ownerId: pi!.id,
              model: u.embeddingModel ?? 'unknown',
              dimensions: 768,
              embedding: u.embedding,
            })
            .onConflictDoNothing();
        }
      }
      await tx
        .update(sourcingRequests)
        .set({ productId: p!.id, status: 'ANALYZING', updatedAt: new Date() })
        .where(eq(sourcingRequests.id, requestId));
      if (req.projectId) {
        const title = a.product_name_ko !== 'UNKNOWN' ? a.product_name_ko : undefined;
        await tx
          .update(sourcingProjects)
          .set({ stage: 'SEARCHING', ...(title ? { title } : {}), updatedAt: new Date() })
          .where(and(eq(sourcingProjects.id, req.projectId), eq(sourcingProjects.stage, 'REQUESTED')));
      }
      await tx.insert(modelPredictions).values({
        tenantId,
        kind: 'ATTRIBUTE',
        entityType: 'product',
        entityId: p!.id,
        predicted: a,
        model: u.steps.find((s) => s.step === 'structure')?.provider ?? 'heuristic',
        confidence: a.confidence,
      });
      // De-identified demand signal (no user id / IP; salted buyer key only).
      await tx.insert(searchEvents).values({
        tenantId,
        normalizedQuery: (a.product_name_ko !== 'UNKNOWN' ? a.product_name_ko : req.query)
          .trim()
          .toLowerCase()
          .slice(0, 120),
        category: a.category,
        clusterKey: (a.search_keywords_ko[0] ?? a.product_name_ko).toLowerCase().slice(0, 80),
        inputType: req.inputType,
        quantity: req.quantity,
        targetPriceKrw: req.targetLandedPriceKrw,
        buyerKey: hmacHex(`${tenantId}:${req.createdByUserId ?? req.anonymousIpHash ?? requestId}`).slice(
          0,
          24,
        ),
      });
      for (const type of ['sourcing.search', 'market.collect', 'hs.classify'] as const) {
        await enqueue(
          tx,
          tenantId,
          type,
          { requestId, productId: p!.id },
          { priority: 50, dedupeKey: `${type}:${requestId}` },
        );
      }
      return p!.id;
    });
    const failed = u.steps
      .filter((s) => s.status === 'FAILED')
      .map((s) => s.message)
      .join(' / ');
    const skipped = u.steps.filter((s) => s.status === 'SKIPPED' && s.message).map((s) => s.message);
    await setProgress(
      tenantId,
      requestId,
      'analyze',
      'DONE',
      failed ? `일부 단계 실패: ${failed}` : skipped.length ? `분석 완료 (${skipped[0]})` : '제품 분석 완료',
    );
    return { productId, steps: u.steps };
  },
  { transactional: false },
);

// ───────────────────────────── 2. Supplier search ─────────────────────────────

async function listingImagePhash(url: string): Promise<string | null> {
  try {
    const res = await safeFetch(url, { timeoutMs: 8000 });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 6 * 1024 * 1024) return null;
    return await phash(buf);
  } catch {
    return null;
  }
}

registerJob(
  'sourcing.search',
  async (payload, { tenantId }) => {
    const requestId = String(payload.requestId);
    await setProgress(tenantId, requestId, 'search', 'RUNNING', '공급처를 찾고 있습니다.');
    const ctx = await withTenant({ tenantId }, async (tx) => {
      const [req] = await tx
        .select()
        .from(sourcingRequests)
        .where(eq(sourcingRequests.id, requestId))
        .limit(1);
      const [p] = req?.productId
        ? await tx.select().from(products).where(eq(products.id, req.productId)).limit(1)
        : [];
      const [img] = p
        ? await tx.select().from(productImages).where(eq(productImages.productId, p.id)).limit(1)
        : [];
      const [emb] = img
        ? await tx
            .select()
            .from(productEmbeddings)
            .where(
              and(eq(productEmbeddings.ownerType, 'PRODUCT_IMAGE'), eq(productEmbeddings.ownerId, img.id)),
            )
            .limit(1)
        : [];
      const sourceConns = await connectionsWithCapability(tx, tenantId, 'PRODUCT_SOURCE');
      return {
        req: req!,
        product: p ?? null,
        phashValue: img?.phash ?? null,
        embedding: emb?.embedding ?? null,
        sourceConns,
      };
    });
    if (!ctx.product) {
      await setProgress(tenantId, requestId, 'search', 'FAILED', '제품 정보가 없습니다.');
      return;
    }
    const attrs = effectiveAttributes(ctx.product);
    const q: SourceQuery = {
      keywordsCn: attrs.search_keywords_cn.length
        ? attrs.search_keywords_cn
        : attrs.product_name_cn !== 'UNKNOWN'
          ? [attrs.product_name_cn]
          : [],
      keywordsEn: attrs.search_keywords_en.length
        ? attrs.search_keywords_en
        : attrs.product_name_en !== 'UNKNOWN'
          ? [attrs.product_name_en]
          : [],
      keywordsKo: attrs.search_keywords_ko.length
        ? attrs.search_keywords_ko
        : [ctx.product.nameKo].filter(Boolean),
      attributes: attrs,
      embedding: ctx.embedding,
      phash: ctx.phashValue,
      url: ctx.req.url || null,
      limit: 20,
    };

    const statuses: string[] = [];
    const collected: NormalizedListing[] = [];
    // Connectors run independently: one failing source never removes the others' results.
    await Promise.all(
      ctx.sourceConns.map(async (c) => {
        try {
          const items =
            c.provider === 'ALIBABA_1688_OPEN'
              ? await search1688(c, q)
              : c.provider === 'GENERIC_HTTP_SOURCE'
                ? await searchGeneric(c, q)
                : [];
          collected.push(...items);
          statuses.push(`${c.label || c.provider}: ${items.length}건`);
          await recordConnectionResult(tenantId, c.id, true);
        } catch (e) {
          statuses.push(`${c.label || c.provider}: 오류`);
          await recordConnectionResult(tenantId, c.id, false, e instanceof Error ? e.message : String(e));
        }
      }),
    );
    if (
      ctx.req.url &&
      parse1688OfferId(ctx.req.url) &&
      !ctx.sourceConns.some((c) => c.provider === 'ALIBABA_1688_OPEN')
    )
      statuses.push('1688 커넥터 미설정');
    if (!ctx.sourceConns.length) statuses.push('외부 마켓 커넥터 미설정');
    const mocks = devMockListings(q);
    if (mocks.length) {
      collected.push(...mocks);
      statuses.push(`DEV MOCK ${mocks.length}건 (개발 모드)`);
    }

    const newIds = await withTenant({ tenantId }, (tx) => upsertListings(tx, tenantId, collected));
    // Image fingerprints for marketplace listings (for clustering & image match).
    await withTenant({ tenantId }, async (tx) => {
      const rows = await tx
        .select({ id: sourceListings.id, imageUrls: sourceListings.imageUrls, phash: sourceListings.phash })
        .from(sourceListings)
        .where(inArray(sourceListings.id, newIds.length ? newIds : ['00000000-0000-0000-0000-000000000000']));
      for (const r of rows.filter((x) => !x.phash && x.imageUrls[0]).slice(0, 12)) {
        const ph = await listingImagePhash(r.imageUrls[0]!);
        if (ph) await tx.update(sourceListings).set({ phash: ph }).where(eq(sourceListings.id, r.id));
      }
    });
    const internalIds = await withTenant({ tenantId }, (tx) => searchInternal(tx, tenantId, q));
    statuses.push(`자체 공급망·기존 DB: ${internalIds.length}건`);

    await withTenant({ tenantId }, (tx) =>
      rebuildCandidates(tx, tenantId, requestId, [...new Set([...newIds, ...internalIds])]),
    );
    await withTenant({ tenantId }, (tx) =>
      enqueue(
        tx,
        tenantId,
        'cost.estimate',
        { requestId },
        { priority: 60, dedupeKey: `cost.estimate:${requestId}:${Date.now()}` },
      ),
    );
    await setProgress(tenantId, requestId, 'search', 'DONE', statuses.join(' · '));
    return { statuses };
  },
  { transactional: false },
);

/** Clusters listings, scores them explainably and upserts request_candidates (keeps pinned & internal ones). */
export async function rebuildCandidates(
  tx: Tx,
  tenantId: string,
  requestId: string,
  extraListingIds: string[] = [],
): Promise<void> {
  const [req] = await tx.select().from(sourcingRequests).where(eq(sourcingRequests.id, requestId)).limit(1);
  if (!req) return;
  const existing = await tx
    .select()
    .from(requestCandidates)
    .where(eq(requestCandidates.requestId, requestId));
  const ids = [...new Set([...extraListingIds, ...existing.map((e) => e.listingId)])];
  if (!ids.length) return;
  const listings = await tx.select().from(sourceListings).where(inArray(sourceListings.id, ids));
  const supplierIds = [...new Set(listings.map((l) => l.supplierId).filter((x): x is string => !!x))];
  const sups = supplierIds.length
    ? await tx.select().from(suppliers).where(inArray(suppliers.id, supplierIds))
    : [];
  const supById = new Map(sups.map((s) => [s.id, s]));
  const { table: fx } = await loadFxTable(tx, tenantId);
  const pricing = await getPublished(tx, tenantId, 'pricing');
  const search = await getPublished(tx, tenantId, 'search');

  const [p] = req.productId
    ? await tx.select().from(products).where(eq(products.id, req.productId)).limit(1)
    : [];
  const [pimg] = p
    ? await tx.select().from(productImages).where(eq(productImages.productId, p.id)).limit(1)
    : [];
  const [pemb] = pimg
    ? await tx
        .select()
        .from(productEmbeddings)
        .where(and(eq(productEmbeddings.ownerType, 'PRODUCT_IMAGE'), eq(productEmbeddings.ownerId, pimg.id)))
        .limit(1)
    : [];
  const listingEmb = await tx
    .select()
    .from(productEmbeddings)
    .where(and(eq(productEmbeddings.ownerType, 'SOURCE_LISTING'), inArray(productEmbeddings.ownerId, ids)));
  const embById = new Map(listingEmb.map((e) => [e.ownerId, e.embedding]));
  const qty = req.quantity ?? null;
  const attrs = p ? effectiveAttributes(p) : null;

  const unitBase = (l: (typeof listings)[number]): string | null => {
    const tiers = l.priceTiers;
    const price = (() => {
      if (!tiers.length) return l.supplierVerifiedPrice ?? l.supplierListPrice;
      const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);
      let v = sorted[0]!.unitPrice;
      for (const t of sorted) if ((qty ?? 0) >= t.minQty) v = t.unitPrice;
      return l.supplierVerifiedPrice ?? v;
    })();
    if (!price) return null;
    try {
      return fx.convert(price, l.currency, pricing.baseCurrency).toFixed(2);
    } catch {
      return null;
    }
  };

  const clusters = clusterListings(
    listings.map((l) => ({
      id: l.id,
      title: l.title,
      phash: l.phash,
      embedding: embById.get(l.id) ?? null,
      model: l.model,
      specs: l.specs,
      unitPrice: unitBase(l),
      currency: pricing.baseCurrency,
      moq: l.moq,
      supplierId: l.supplierId,
      sellerQuality: l.sellerQuality,
    })),
  );
  const clusterIdByListing = new Map<string, string>();
  await tx.delete(productClusters).where(eq(productClusters.requestId, requestId));
  for (const c of clusters) {
    const [row] = await tx
      .insert(productClusters)
      .values({
        tenantId,
        requestId,
        label: listings.find((l) => l.id === c.memberIds[0])?.title.slice(0, 80) ?? '',
        supplierCount: c.supplierCount,
        currency: c.currency,
        lowestPrice: c.lowestPrice,
        medianPrice: c.medianPrice,
        highestPrice: c.highestPrice,
        moqDistribution: c.moqDistribution,
        avgSellerQuality: c.avgSellerQuality,
        reasons: c.reasons,
      })
      .returning({ id: productClusters.id });
    c.memberIds.forEach((m) => clusterIdByListing.set(m, row!.id));
  }
  const clusterMedian = new Map(clusters.map((c) => [c.memberIds, c.medianPrice] as const));
  const medianFor = (id: string) => [...clusterMedian.entries()].find(([m]) => m.includes(id))?.[1] ?? null;

  const targetUnit =
    req.targetLandedPriceKrw ??
    (req.targetPurchasePrice && req.targetPurchaseCurrency
      ? (() => {
          try {
            return fx
              .convert(req.targetPurchasePrice!, req.targetPurchaseCurrency!, pricing.baseCurrency)
              .toFixed(2);
          } catch {
            return null;
          }
        })()
      : null);

  const candidates: CandidateInput[] = listings.map((l) => {
    const s = l.supplierId ? supById.get(l.supplierId) : undefined;
    const m = s?.metrics ?? {};
    const imageSim = (() => {
      const e1 = pemb?.embedding;
      const e2 = embById.get(l.id);
      const c = cosine(e1, e2);
      if (c !== null) return Math.max(0, Math.min(1, c));
      return phashSimilarity(pimg?.phash, l.phash);
    })();
    const specMatch = (() => {
      if (!attrs) return null;
      const keys: Array<[keyof ProductAttributes, string]> = [
        ['material', '재질'],
        ['voltage', '전압'],
        ['dimensions', '크기'],
        ['battery_capacity', '배터리'],
      ];
      let agree = 0;
      let total = 0;
      for (const [k] of keys) {
        const v = attrs[k];
        if (typeof v !== 'string' || v === 'UNKNOWN') continue;
        const hay = `${l.title} ${Object.values(l.specs).join(' ')}`.toLowerCase();
        total++;
        if (hay.includes(v.toLowerCase())) agree++;
      }
      return total ? agree / total : null;
    })();
    const reliability = s
      ? (() => {
          let score = 0.5;
          if (s.businessVerified) score += 0.15;
          if (s.businessVerified === false) score -= 0.1;
          if ((s.yearsInBusiness ?? 0) >= 5) score += 0.15;
          else if (s.yearsInBusiness !== null && s.yearsInBusiness < 2) score -= 0.1;
          if (s.blacklisted) score = 0;
          if (m.reliabilityScore !== undefined) score = (score + m.reliabilityScore) / 2;
          return Math.max(0, Math.min(1, score));
        })()
      : null;
    return {
      id: l.id,
      sourceType: l.sourceType as SourceType,
      unitPriceBase: unitBase(l),
      moq: l.moq,
      leadTimeDays: l.leadTimeDays,
      imageSimilarity: imageSim,
      specMatch,
      supplierReliability: reliability,
      qualityHistory: m.qualityScore ?? null,
      oemSupported: l.oemSupported ?? s?.oemSupported ?? null,
      complianceReadiness: s && s.certifications.length ? Math.min(1, s.certifications.length / 3) : null,
      logisticsScore: l.packaging && Object.keys(l.packaging).length ? 0.8 : null,
      communication:
        m.communicationScore ??
        (s?.avgResponseHours !== null && s?.avgResponseHours !== undefined
          ? Math.max(0, 1 - s.avgResponseHours / 72)
          : null),
      pastOrders: m.orderCount ?? null,
      pinned: existing.find((e) => e.listingId === l.id)?.pinned ?? false,
    };
  });
  const weights = { ...DEFAULT_MATCH_WEIGHTS, ...(search.matchWeights as Partial<MatchWeights>) };
  const allMedian = median(candidates.map((c) => c.unitPriceBase).filter((x): x is string => !!x));
  // DEV_MODE mock listings never compete with real supply data: they are ranked separately and listed last.
  const isMock = (id: string) => !!listings.find((l) => l.id === id)?.isDevMock;
  const matchReq = {
    targetUnitPriceBase: targetUnit,
    quantity: qty,
    wantsOem: !!req.options.oem,
    desiredLeadTimeDays: req.desiredLeadTimeDays,
  };
  const realCands = candidates.filter((c) => !isMock(c.id));
  const mockCands = candidates.filter((c) => isMock(c.id));
  const ranked = realCands.length
    ? [
        ...rankCandidates(realCands, matchReq, weights, allMedian?.toString() ?? null),
        ...rankCandidates(mockCands, matchReq, weights, allMedian?.toString() ?? null).map((r) => ({
          ...r,
          tags: [],
        })),
      ]
    : rankCandidates(mockCands, matchReq, weights, allMedian?.toString() ?? null);
  for (const r of ranked) {
    const l = listings.find((x) => x.id === r.id)!;
    const cand = candidates.find((c) => c.id === r.id)!;
    const cm = medianFor(l.id);
    const cautions = [...r.cautions];
    if (l.isDevMock) cautions.unshift('개발용 모의 데이터입니다 (실제 공급처 아님).');
    if (
      cm &&
      cand.unitPriceBase &&
      new D(cand.unitPriceBase).lt(new D(cm).mul(search.priceAnomalyLowRatio)) &&
      !cautions.some((c) => c.includes('비정상'))
    ) {
      cautions.push(
        '동일 제품 그룹 중앙가 대비 비정상적으로 낮은 가격입니다. MOQ·옵션·미끼가격 여부를 확인하세요.',
      );
    }
    const staleDays = (Date.now() - l.lastCheckedAt.getTime()) / 86_400_000;
    if (staleDays > search.staleDaysWarning)
      cautions.push(`가격 확인 후 ${Math.floor(staleDays)}일 지났습니다 (STALE).`);
    await tx
      .insert(requestCandidates)
      .values({
        tenantId,
        requestId,
        listingId: l.id,
        clusterId: clusterIdByListing.get(l.id) ?? null,
        score: r.total,
        coverage: r.coverage,
        components: r.components,
        weightsSnapshot: weights,
        tags: r.tags,
        reasons: r.reasons,
        cautions,
        unitPriceBase: cand.unitPriceBase,
        imageSimilarity: cand.imageSimilarity,
      })
      .onConflictDoUpdate({
        target: [requestCandidates.requestId, requestCandidates.listingId],
        set: {
          clusterId: clusterIdByListing.get(l.id) ?? null,
          score: r.total,
          coverage: r.coverage,
          components: r.components,
          weightsSnapshot: weights,
          tags: r.tags,
          reasons: r.reasons,
          cautions,
          imageSimilarity: cand.imageSimilarity,
          updatedAt: new Date(),
        },
      });
  }
}

// ───────────────────────────── 3. Market intelligence ─────────────────────────────

registerJob(
  'market.collect',
  async (payload, { tenantId }) => {
    const requestId = String(payload.requestId);
    await setProgress(tenantId, requestId, 'market', 'RUNNING', '국내 시장가격을 확인하고 있습니다.');
    const { conns, query } = await withTenant({ tenantId }, async (tx) => {
      const [req] = await tx
        .select()
        .from(sourcingRequests)
        .where(eq(sourcingRequests.id, requestId))
        .limit(1);
      const [p] = req?.productId
        ? await tx.select().from(products).where(eq(products.id, req.productId)).limit(1)
        : [];
      const a = p ? effectiveAttributes(p) : null;
      const query =
        a?.search_keywords_ko[0] ??
        (a?.product_name_ko !== 'UNKNOWN' ? a?.product_name_ko : null) ??
        req?.query ??
        '';
      return { conns: await connectionsWithCapability(tx, tenantId, 'MARKET_SEARCH'), query };
    });
    if (!conns.length) {
      await setProgress(
        tenantId,
        requestId,
        'market',
        'SKIPPED',
        '국내 시장 데이터 커넥터가 설정되지 않았습니다.',
      );
      await maybeFinish(tenantId, requestId);
      return;
    }
    if (!query) {
      await setProgress(tenantId, requestId, 'market', 'SKIPPED', '검색어를 만들 수 없습니다.');
      await maybeFinish(tenantId, requestId);
      return;
    }
    const statuses: string[] = [];
    let total = 0;
    for (const c of conns) {
      try {
        const items = await searchMarket(c, query);
        await withTenant({ tenantId }, async (tx) => {
          for (const i of items) {
            await tx.insert(marketListings).values({
              tenantId,
              requestId,
              platform: i.platform,
              externalId: i.externalId,
              title: i.title,
              url: i.url,
              imageUrl: i.imageUrl,
              seller: i.seller,
              brand: i.brand,
              category: i.category,
              sellingPrice: i.sellingPrice,
              discountPrice: i.discountPrice,
              reviews: i.reviews,
              rating: i.rating,
              rank: i.rank,
              delivery: i.delivery,
              query,
              expiresAt: expiresAtFor('market_price'),
            });
            if (i.sellingPrice && i.externalId)
              await tx
                .insert(marketPriceHistory)
                .values({ tenantId, platform: i.platform, externalId: i.externalId, price: i.sellingPrice });
          }
        });
        total += items.length;
        statuses.push(`${c.label || c.provider}: ${items.length}건`);
        await recordConnectionResult(tenantId, c.id, true);
      } catch (e) {
        statuses.push(`${c.label || c.provider}: 오류`);
        await recordConnectionResult(tenantId, c.id, false, e instanceof Error ? e.message : String(e));
      }
    }
    await setProgress(tenantId, requestId, 'market', total ? 'DONE' : 'FAILED', statuses.join(' · '));
    await maybeFinish(tenantId, requestId);
  },
  { transactional: false },
);

// ───────────────────────────── 4. HS + 5. Compliance ─────────────────────────────

registerJob(
  'hs.classify',
  async (payload, { tenantId }) => {
    const requestId = String(payload.requestId);
    const productId = String(payload.productId);
    await setProgress(tenantId, requestId, 'hs', 'RUNNING', 'HS 코드 후보를 찾고 있습니다.');
    const { attrs, candidates } = await withTenant({ tenantId }, async (tx) => {
      const [p] = await tx.select().from(products).where(eq(products.id, productId)).limit(1);
      const attrs = effectiveAttributes(p!);
      return { attrs, candidates: await findHsCandidates(tx, tenantId, attrs) };
    });
    const reranked = await rerankWithAi(tenantId, attrs, candidates);
    await withTenant({ tenantId }, async (tx) => {
      await saveEstimatedHs(
        tx,
        tenantId,
        productId,
        reranked.ranked,
        reranked.used ? `HS_DB+AI_RERANK(${reranked.provider})` : 'HS_DB_MATCH',
      );
      if (reranked.ranked[0])
        await tx.insert(modelPredictions).values({
          tenantId,
          kind: 'HS',
          entityType: 'product',
          entityId: productId,
          predicted: {
            code: reranked.ranked[0].code,
            top3: reranked.ranked.slice(0, 3).map((c) => c.code),
          },
          model: reranked.used ? String(reranked.provider) : 'rules',
          confidence: reranked.ranked[0].score,
        });
      await enqueue(
        tx,
        tenantId,
        'compliance.evaluate',
        { requestId, productId },
        { priority: 55, dedupeKey: `compliance:${requestId}` },
      );
    });
    await setProgress(
      tenantId,
      requestId,
      'hs',
      'DONE',
      candidates.length
        ? `HS 후보 ${Math.min(3, candidates.length)}개 · 관세사 확인 필요`
        : 'HS 후보를 찾지 못했습니다. 관세사 확인이 필요합니다.',
    );
    await maybeFinish(tenantId, requestId);
  },
  { transactional: false },
);

registerJob('compliance.evaluate', async (payload, { tenantId, tx }) => {
  const requestId = payload.requestId ? String(payload.requestId) : null;
  const productId = String(payload.productId);
  const evals = await evaluateProductCompliance(tx, tenantId, productId);
  const likely = evals.filter((e) => ['RULE_MATCHED', 'AI_LIKELY'].includes(e.status)).length;
  if (requestId) {
    await tx
      .update(sourcingRequests)
      .set({
        progress: sql`jsonb_set(coalesce(${sourcingRequests.progress}, '{}'::jsonb), '{compliance}', ${JSON.stringify({ status: 'DONE', message: `인증 후보 ${likely}건 · 전문가 확인 필요`, at: new Date().toISOString() })}::jsonb, true)`,
      })
      .where(eq(sourcingRequests.id, requestId));
    await enqueue(
      tx,
      tenantId,
      'sourcing.finish-check',
      { requestId },
      { dedupeKey: `finish:${requestId}:compliance` },
    );
  }
  return { count: evals.length };
});

// ───────────────────────────── 6. Cost estimate ─────────────────────────────

registerJob(
  'cost.estimate',
  async (payload, { tenantId }) => {
    const requestId = String(payload.requestId);
    await setProgress(tenantId, requestId, 'cost', 'RUNNING', '예상 도착가격을 계산하고 있습니다.');
    const top = await withTenant({ tenantId }, (tx) =>
      tx
        .select()
        .from(requestCandidates)
        .where(eq(requestCandidates.requestId, requestId))
        .orderBy(desc(requestCandidates.pinned), desc(requestCandidates.score))
        .limit(5),
    );
    let complete = 0;
    let errors = 0;
    for (const c of top) {
      try {
        const r = await withTenant({ tenantId }, (tx) => estimateForCandidate(tx, tenantId, c.id, null));
        if (r.landed.complete) complete++;
      } catch (e) {
        errors++;
        logger.warn({ err: e instanceof Error ? e.message : e, candidateId: c.id }, 'cost estimate failed');
      }
    }
    await setProgress(
      tenantId,
      requestId,
      'cost',
      top.length ? 'DONE' : 'SKIPPED',
      top.length
        ? `${top.length}개 후보 계산${complete < top.length ? ` · ${top.length - complete}개는 운임·관세 정보 부족으로 일부 추정` : ''}${errors ? ` · 오류 ${errors}` : ''}`
        : '계산할 공급 후보가 없습니다.',
    );
    await maybeFinish(tenantId, requestId);
  },
  { transactional: false },
);

// compliance finishes inside a transaction; check completion afterwards.
registerJob(
  'sourcing.finish-check',
  async (payload, { tenantId }) => {
    await maybeFinish(tenantId, String(payload.requestId));
    return { ok: true };
  },
  { transactional: false },
);

export async function startAnalysis(tx: Tx, tenantId: string, requestId: string): Promise<void> {
  await tx
    .update(sourcingRequests)
    .set({
      progress: {
        analyze: { status: 'PENDING' },
        search: { status: 'PENDING' },
        market: { status: 'PENDING' },
        compliance: { status: 'PENDING' },
        hs: { status: 'PENDING' },
        cost: { status: 'PENDING' },
      },
    })
    .where(eq(sourcingRequests.id, requestId));
  await enqueue(
    tx,
    tenantId,
    'sourcing.analyze',
    { requestId },
    { priority: 10, dedupeKey: `analyze:${requestId}` },
  );
}
