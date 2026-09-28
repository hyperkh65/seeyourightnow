import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { PROJECT_STAGES, productAttributesSchema, type ProductAttributes } from '@sos/core';
import type { Tx } from '../db/client.js';
import {
  complianceChecks,
  costCalculations,
  hsClassifications,
  marketListings,
  modelPredictions,
  overrides,
  pricingSnapshots,
  productClusters,
  products,
  regulations,
  requestCandidates,
  sourceListings,
  sourcingProjects,
  sourcingRequests,
  suppliers,
} from '../db/schema/index.js';
import { hmacHex, randomToken, safeEqual, sha256Hex } from '../lib/crypto.js';
import { AppError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { db, isStaff, requireFeature, requirePerm, tenantOf, userOf } from '../http/context.js';
import { readForm } from '../http/multipart.js';
import type { App } from '../http/types.js';
import { audit } from '../services/audit.js';
import { effectiveAttributes, effectiveStatus, evaluateProductCompliance } from '../services/compliance.js';
import { marketStats } from '../services/connectors/market.js';
import { storeFile } from '../services/files.js';
import { enqueue } from '../services/jobs.js';
import { notifyEvent } from '../services/notify.js';
import { estimateForCandidate } from '../services/pricing.js';
import { customerCandidate, customerCompliance, supplierDisplayName } from '../services/serializers.js';
import { getPublished, nextNumber } from '../services/settings.js';
import { rebuildCandidates, startAnalysis } from '../services/sourcing/pipeline.js';
import { signedDownloadUrl } from '../services/files.js';
import { consumeFor } from '../services/usage.js';
import { tariffOptions } from '../services/hs.js';

const requestFieldsSchema = z.object({
  query: z.string().max(300).default(''),
  url: z.string().max(2000).default(''),
  description: z.string().max(5000).default(''),
  quantity: z.coerce.number().int().positive().max(100_000_000).optional(),
  targetPurchasePrice: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .optional(),
  targetPurchaseCurrency: z.string().length(3).optional(),
  targetLandedPriceKrw: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .optional(),
  targetSellingPriceKrw: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .optional(),
  desiredLeadTimeDays: z.coerce.number().int().positive().max(720).optional(),
  options: z
    .object({
      oem: z.boolean().optional(),
      logoPrint: z.boolean().optional(),
      packageChange: z.boolean().optional(),
      certificationNeeded: z.enum(['YES', 'NO', 'UNSURE']).optional(),
      qualityLevel: z.string().max(40).optional(),
      colors: z.string().max(200).optional(),
      sizes: z.string().max(200).optional(),
      notes: z.string().max(2000).optional(),
    })
    .default({}),
  companyId: z.string().uuid().optional(),
});

const emptyToUndef = (o: Record<string, string>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== 'undefined' && v !== 'null'));

/** Access check for a request: staff, the owning customer/company, or the anonymous access token. */
async function assertRequestAccess(
  tx: Tx,
  req: Parameters<typeof isStaff>[0],
  r: typeof sourcingRequests.$inferSelect,
  token?: string,
) {
  if (isStaff(req)) return 'STAFF' as const;
  const u = req.ctx.user;
  if (u?.audience === 'CUSTOMER') {
    if (r.createdByUserId === u.id) return 'CUSTOMER' as const;
    if (r.projectId && u.companyId) {
      const [p] = await tx
        .select({ companyId: sourcingProjects.companyId })
        .from(sourcingProjects)
        .where(eq(sourcingProjects.id, r.projectId))
        .limit(1);
      if (p?.companyId === u.companyId) return 'CUSTOMER' as const;
    }
  }
  if (token && r.accessTokenHash && safeEqual(sha256Hex(token), r.accessTokenHash))
    return 'ANONYMOUS' as const;
  throw notFound('요청을 찾을 수 없습니다.');
}

export async function createProject(
  tx: Tx,
  tenantId: string,
  p: { title: string; companyId: string | null; customerUserId: string | null; ownerUserId?: string | null },
) {
  const code = await nextNumber(tx, tenantId, 'PROJECT');
  const [row] = await tx
    .insert(sourcingProjects)
    .values({
      tenantId,
      code,
      title: p.title || '새 소싱 요청',
      companyId: p.companyId,
      customerUserId: p.customerUserId,
      ownerUserId: p.ownerUserId ?? null,
      stage: 'REQUESTED',
      stageHistory: [{ stage: 'REQUESTED', at: new Date().toISOString(), by: p.customerUserId }],
    })
    .returning();
  return row!;
}

export async function sourcingRoutes(app: App) {
  // ─────────────── Create request (anonymous allowed per tenant setting) ───────────────
  app.post(
    '/sourcing/requests',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const tenant = tenantOf(req);
      requireFeature(req, 'PRODUCT_SEARCH');
      const { fields, files } = await readForm(req);
      const parsed = requestFieldsSchema.safeParse({
        ...emptyToUndef(fields),
        options: fields.options ? JSON.parse(fields.options) : {},
      });
      if (!parsed.success) throw badRequest('입력값을 확인해 주세요.', parsed.error.flatten());
      const f = parsed.data;
      const images = files.filter((x) => x.field === 'images');
      const docs = files.filter((x) => x.field === 'documents');
      if (!f.query && !f.url && !f.description && images.length === 0 && docs.length === 0)
        throw badRequest('사진, 링크, 제품명 중 하나 이상을 입력해 주세요.');
      if (images.length > 5) throw badRequest('사진은 최대 5장까지 올릴 수 있습니다.');
      if (images.length) requireFeature(req, 'VISION_SEARCH');
      if (f.url) {
        try {
          const u = new URL(f.url);
          if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
        } catch {
          throw badRequest('올바른 상품 링크를 입력해 주세요.');
        }
      }
      const user = req.ctx.user;
      const staff = isStaff(req);
      const search = await db(req, (tx) => getPublished(tx, tenant.id, 'search'));
      const anonymous = !user;
      const ipHash = hmacHex(`ip:${req.ip}`).slice(0, 32);
      if (anonymous) {
        if (!search.anonymousSearchEnabled)
          throw new AppError(401, 'LOGIN_REQUIRED', '로그인 후 검색할 수 있습니다.');
        const [cnt] = await db(req, (tx) =>
          tx
            .select({ n: sql<number>`count(*)::int` })
            .from(sourcingRequests)
            .where(
              and(
                eq(sourcingRequests.anonymousIpHash, ipHash),
                gt(sourcingRequests.createdAt, new Date(Date.now() - 86_400_000)),
              ),
            ),
        );
        if ((cnt?.n ?? 0) >= search.anonymousDailyLimitPerIp)
          throw new AppError(
            429,
            'ANON_LIMIT',
            '오늘 무료 검색 횟수를 모두 사용했습니다. 가입하면 계속 검색할 수 있습니다.',
          );
      } else if (user && user.audience === 'PARTNER') throw forbidden();
      await consumeFor(req, 'monthly_searches');

      const accessToken = anonymous ? randomToken(24) : null;
      const result = await db(req, async (tx) => {
        const imageIds: string[] = [];
        for (const img of images)
          imageIds.push(
            (
              await storeFile(tx, {
                tenantId: tenant.id,
                buffer: img.buffer,
                originalName: img.filename,
                purpose: 'SEARCH_IMAGE',
                uploadedBy: user?.id ?? null,
              })
            ).id,
          );
        const docIds: string[] = [];
        for (const d of docs)
          docIds.push(
            (
              await storeFile(tx, {
                tenantId: tenant.id,
                buffer: d.buffer,
                originalName: d.filename,
                purpose: 'DOCUMENT',
                uploadedBy: user?.id ?? null,
              })
            ).id,
          );
        let projectId: string | null = null;
        if (user) {
          const companyId = staff ? (f.companyId ?? null) : user.companyId;
          const project = await createProject(tx, tenant.id, {
            title: f.query || f.description.slice(0, 60) || '사진 검색',
            companyId,
            customerUserId: staff ? null : user.id,
            ownerUserId: staff ? user.id : null,
          });
          projectId = project.id;
          await consumeFor(req, 'projects');
        }
        const inputType = [
          images.length && 'IMAGE',
          f.url && 'URL',
          (f.query || f.description) && 'TEXT',
          docs.length && 'DOCUMENT',
        ].filter(Boolean);
        const [r] = await tx
          .insert(sourcingRequests)
          .values({
            tenantId: tenant.id,
            projectId,
            accessTokenHash: accessToken ? sha256Hex(accessToken) : null,
            createdByUserId: user?.id ?? null,
            anonymousIpHash: anonymous ? ipHash : null,
            inputType: inputType.length > 1 ? 'MIXED' : String(inputType[0] ?? 'TEXT'),
            query: f.query,
            url: f.url,
            description: f.description,
            imageFileIds: imageIds,
            documentFileIds: docIds,
            quantity: f.quantity ?? null,
            targetPurchasePrice: f.targetPurchasePrice ?? null,
            targetPurchaseCurrency: f.targetPurchaseCurrency ?? null,
            targetLandedPriceKrw: f.targetLandedPriceKrw ?? null,
            targetSellingPriceKrw: f.targetSellingPriceKrw ?? null,
            desiredLeadTimeDays: f.desiredLeadTimeDays ?? null,
            options: f.options,
          })
          .returning({ id: sourcingRequests.id });
        await startAnalysis(tx, tenant.id, r!.id);
        await audit(tx, req, {
          action: 'sourcing.request.created',
          entityType: 'sourcing_request',
          entityId: r!.id,
          after: { inputType, projectId },
        });
        if (projectId)
          await notifyEvent(
            tx,
            tenant.id,
            'SOURCING_RECEIVED',
            projectId,
            { productName: f.query || '요청 제품' },
            { dedupeKey: `received:${r!.id}` },
          );
        return { requestId: r!.id, projectId };
      });
      reply.status(201);
      return { ...result, accessToken };
    },
  );

  // ─────────────── Progress (fast polling) ───────────────
  app.get(
    '/sourcing/requests/:id/status',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        querystring: z.object({ token: z.string().optional() }),
      },
    },
    async (req) => {
      tenantOf(req);
      return db(req, async (tx) => {
        const [r] = await tx
          .select()
          .from(sourcingRequests)
          .where(eq(sourcingRequests.id, req.params.id))
          .limit(1);
        if (!r) throw notFound('요청을 찾을 수 없습니다.');
        await assertRequestAccess(tx, req, r, req.query.token);
        return {
          id: r.id,
          status: r.status,
          progress: r.progress,
          productId: r.productId,
          projectId: r.projectId,
          updatedAt: r.updatedAt,
        };
      });
    },
  );

  // ─────────────── Result (audience-aware) ───────────────
  app.get(
    '/sourcing/requests/:id/result',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        querystring: z.object({ token: z.string().optional() }),
      },
    },
    async (req) => {
      const tenant = tenantOf(req);
      return db(req, async (tx) => {
        const [r] = await tx
          .select()
          .from(sourcingRequests)
          .where(eq(sourcingRequests.id, req.params.id))
          .limit(1);
        if (!r) throw notFound('요청을 찾을 수 없습니다.');
        const audience = await assertRequestAccess(tx, req, r, req.query.token);
        const pricing = await getPublished(tx, tenant.id, 'pricing');
        const [p] = r.productId
          ? await tx.select().from(products).where(eq(products.id, r.productId)).limit(1)
          : [];
        const attrs = p ? effectiveAttributes(p) : null;
        const imageUrls = await Promise.all(
          r.imageFileIds.slice(0, 5).map((id) => signedDownloadUrl(tx, id, 900).catch(() => null)),
        );

        const candsRaw = await tx
          .select()
          .from(requestCandidates)
          .where(eq(requestCandidates.requestId, r.id))
          .orderBy(desc(requestCandidates.pinned), desc(requestCandidates.score));
        const listings = candsRaw.length
          ? await tx
              .select()
              .from(sourceListings)
              .where(
                inArray(
                  sourceListings.id,
                  candsRaw.map((c) => c.listingId),
                ),
              )
          : [];
        const mockIds = new Set(listings.filter((l) => l.isDevMock).map((l) => l.id));
        const cands = [
          ...candsRaw.filter((c) => !mockIds.has(c.listingId)),
          ...candsRaw.filter((c) => mockIds.has(c.listingId)),
        ];
        const supIds = [...new Set(listings.map((l) => l.supplierId).filter((x): x is string => !!x))];
        const sups = supIds.length
          ? await tx.select().from(suppliers).where(inArray(suppliers.id, supIds))
          : [];
        const snaps = cands.length
          ? await tx
              .select()
              .from(pricingSnapshots)
              .where(
                inArray(
                  pricingSnapshots.candidateId,
                  cands.map((c) => c.id),
                ),
              )
              .orderBy(desc(pricingSnapshots.createdAt))
          : [];
        const calcs = cands.length
          ? await tx
              .select()
              .from(costCalculations)
              .where(
                inArray(
                  costCalculations.candidateId,
                  cands.map((c) => c.id),
                ),
              )
              .orderBy(desc(costCalculations.createdAt))
          : [];
        const latestSnap = (cid: string) => snaps.find((s) => s.candidateId === cid);
        const latestCalc = (cid: string) => calcs.find((s) => s.candidateId === cid);
        const clusters = await tx.select().from(productClusters).where(eq(productClusters.requestId, r.id));
        const market = await tx
          .select()
          .from(marketListings)
          .where(eq(marketListings.requestId, r.id))
          .orderBy(marketListings.rank)
          .limit(200);
        const stats = marketStats(market.map((m) => Number(m.discountPrice ?? m.sellingPrice ?? 0)));
        const checks = p
          ? await tx.select().from(complianceChecks).where(eq(complianceChecks.productId, p.id))
          : [];
        const regs = checks.length
          ? await tx
              .select()
              .from(regulations)
              .where(
                inArray(
                  regulations.id,
                  checks.map((c) => c.regulationId),
                ),
              )
          : [];
        const compRows = checks.map((c) => {
          const reg = regs.find((x) => x.id === c.regulationId)!;
          return {
            id: c.id,
            code: reg.code,
            name: reg.name,
            authority: reg.authority,
            status: effectiveStatus(c),
            estimatedStatus: c.estimatedStatus,
            verifiedStatus: c.verifiedStatus,
            confidence: c.estimatedConfidence,
            reasons: c.reasons,
            missing: c.missingAttributes,
            expertNote: c.expertNote,
            estimatedCost: c.estimatedCost,
            verifiedCost: c.verifiedCost,
          };
        });
        const [hs] = p
          ? await tx.select().from(hsClassifications).where(eq(hsClassifications.productId, p.id)).limit(1)
          : [];
        const hsCode = hs?.actualHs ?? hs?.verifiedHs ?? hs?.estimatedHs ?? null;
        const tariffs = await tariffOptions(tx, tenant.id, hsCode);

        const badgeFor = (cid: string): 'ESTIMATED' | 'VERIFIED' | 'FINAL' => {
          const s = latestSnap(cid);
          if (s?.adminFinalPrice) return 'FINAL';
          const c = latestCalc(cid);
          return c && ['PARTNER_VERIFIED', 'EXPERT_VERIFIED', 'ACTUAL'].includes(c.verification)
            ? 'VERIFIED'
            : 'ESTIMATED';
        };
        const common = {
          id: r.id,
          status: r.status,
          progress: r.progress,
          projectId: r.projectId,
          input: {
            query: r.query,
            url: r.url,
            description: r.description,
            quantity: r.quantity,
            options: r.options,
            images: imageUrls.filter(Boolean),
          },
          currency: pricing.baseCurrency,
          product: p
            ? {
                id: p.id,
                nameKo: p.nameKo,
                nameEn: p.nameEn,
                category: p.category,
                attributes: attrs,
                confidence: p.confidence,
                conflicts: p.attributeConflicts,
                risk: p.risk,
                requiredDocuments: (p.passport as { requiredDocuments?: string[] }).requiredDocuments ?? [],
              }
            : null,
          market: {
            stats,
            count: market.length,
            platforms: [...new Set(market.map((m) => m.platform))],
            items: market.slice(0, 30).map((m) => ({
              platform: m.platform,
              title: m.title,
              url: m.url,
              imageUrl: m.imageUrl,
              seller: m.seller,
              price: m.discountPrice ?? m.sellingPrice,
              reviews: m.reviews,
              rating: m.rating,
              collectedAt: m.collectedAt,
              isDevMock: m.isDevMock,
            })),
          },
          tariff: {
            hsCandidates: audience === 'STAFF' ? (hs?.candidates ?? []) : [],
            hsCode: audience === 'STAFF' ? hsCode : null,
            hsVerified: !!(hs?.verifiedHs || hs?.actualHs),
            dutyKnown: tariffs.some((t) => t.ratePct !== null),
          },
        };

        if (audience !== 'STAFF') {
          const visible = cands.filter((c) => !c.hiddenFromCustomer);
          const out = visible.map((c) => {
            const l = listings.find((x) => x.id === c.listingId)!;
            const s = sups.find((x) => x.id === l.supplierId);
            const snap = latestSnap(c.id);
            return customerCandidate(
              c,
              l,
              s,
              snap?.adminFinalPrice ?? snap?.calculatedCustomerPrice ?? null,
              badgeFor(c.id),
            );
          });
          const best = out.find((c) => c.tags.some((t) => t.key === 'BEST_MATCH')) ?? out[0] ?? null;
          return {
            audience,
            ...common,
            best,
            candidates: out.slice(0, 20),
            clusters: clusters.map((c) => ({
              id: c.id,
              supplierCount: c.supplierCount,
              moq: c.moqDistribution,
            })),
            compliance: customerCompliance(compRows),
            complianceUnknownCount: compRows.filter((r) => r.status === 'UNKNOWN').length,
            estimate: best?.estimatedUnitPrice
              ? {
                  unitPrice: best.estimatedUnitPrice,
                  badge: best.priceBadge,
                  note: '운임·관세·인증 비용은 협력사 확인 후 견적에서 확정됩니다.',
                }
              : null,
          };
        }

        return {
          audience,
          ...common,
          candidates: cands.map((c) => {
            const l = listings.find((x) => x.id === c.listingId)!;
            const s = sups.find((x) => x.id === l.supplierId);
            const calc = latestCalc(c.id);
            const snap = latestSnap(c.id);
            return {
              ...c,
              listing: {
                id: l.id,
                title: l.title,
                titleKo: l.titleKo,
                url: l.url,
                imageUrls: l.imageUrls,
                currency: l.currency,
                priceTiers: l.priceTiers,
                supplierListPrice: l.supplierListPrice,
                supplierVerifiedPrice: l.supplierVerifiedPrice,
                moq: l.moq,
                leadTimeDays: l.leadTimeDays,
                sourceType: l.sourceType,
                connector: l.connector,
                isDevMock: l.isDevMock,
                lastCheckedAt: l.lastCheckedAt,
                specs: l.specs,
              },
              supplier: s
                ? {
                    id: s.id,
                    name: s.name,
                    displayName: supplierDisplayName(s, l.sourceType),
                    visibility: s.visibility,
                    businessType: s.businessType,
                    city: s.city,
                    yearsInBusiness: s.yearsInBusiness,
                    businessVerified: s.businessVerified,
                    blacklisted: s.blacklisted,
                    riskFlags: s.riskFlags,
                  }
                : null,
              cost: calc
                ? {
                    id: calc.id,
                    landedCostPerUnit: calc.landedCostPerUnit,
                    landedCostTotal: calc.landedCostTotal,
                    complete: calc.complete,
                    verification: calc.verification,
                    warnings: (calc.result as { warnings?: string[] }).warnings ?? [],
                    createdAt: calc.createdAt,
                  }
                : null,
              pricing: snap
                ? {
                    id: snap.id,
                    calculatedCustomerPrice: snap.calculatedCustomerPrice,
                    adminFinalPrice: snap.adminFinalPrice,
                    adminFinalReason: snap.adminFinalReason,
                    priceResult: snap.priceResult,
                  }
                : null,
            };
          }),
          clusters,
          compliance: compRows,
          hs: hs ?? null,
          tariffs,
        };
      });
    },
  );

  // Anonymous → customer: claim a request after signing up
  app.post(
    '/sourcing/requests/:id/claim',
    {
      schema: { params: z.object({ id: z.string().uuid() }), body: z.object({ token: z.string().min(10) }) },
    },
    async (req) => {
      const tenant = tenantOf(req);
      const user = userOf(req);
      if (user.audience !== 'CUSTOMER') throw forbidden();
      return db(req, async (tx) => {
        const [r] = await tx
          .select()
          .from(sourcingRequests)
          .where(eq(sourcingRequests.id, req.params.id))
          .limit(1);
        if (!r || !r.accessTokenHash || !safeEqual(sha256Hex(req.body.token), r.accessTokenHash))
          throw notFound();
        if (r.projectId) return { projectId: r.projectId };
        const [p] = r.productId
          ? await tx.select().from(products).where(eq(products.id, r.productId)).limit(1)
          : [];
        const project = await createProject(tx, tenant.id, {
          title: p?.nameKo || r.query || '소싱 요청',
          companyId: user.companyId,
          customerUserId: user.id,
        });
        await tx
          .update(sourcingRequests)
          .set({
            projectId: project.id,
            createdByUserId: user.id,
            accessTokenHash: null,
            updatedAt: new Date(),
          })
          .where(eq(sourcingRequests.id, r.id));
        if (r.productId)
          await tx.update(products).set({ projectId: project.id }).where(eq(products.id, r.productId));
        await tx
          .update(sourcingProjects)
          .set({ stage: r.status === 'READY' ? 'QUOTE_PREPARING' : 'SEARCHING' })
          .where(eq(sourcingProjects.id, project.id));
        await audit(tx, req, {
          action: 'sourcing.request.claimed',
          entityType: 'sourcing_request',
          entityId: r.id,
          after: { projectId: project.id },
        });
        await notifyEvent(
          tx,
          tenant.id,
          'SOURCING_RECEIVED',
          project.id,
          { productName: project.title },
          { dedupeKey: `received:${r.id}` },
        );
        return { projectId: project.id };
      });
    },
  );

  // ─────────────── Staff: rerun a pipeline step ───────────────
  app.post(
    '/sourcing/requests/:id/rerun',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ step: z.enum(['analyze', 'search', 'market', 'hs', 'compliance', 'cost']) }),
      },
    },
    async (req) => {
      const tenant = tenantOf(req);
      requirePerm(req, 'sourcing.write');
      return db(req, async (tx) => {
        const [r] = await tx
          .select()
          .from(sourcingRequests)
          .where(eq(sourcingRequests.id, req.params.id))
          .limit(1);
        if (!r) throw notFound();
        const jobType = {
          analyze: 'sourcing.analyze',
          search: 'sourcing.search',
          market: 'market.collect',
          hs: 'hs.classify',
          compliance: 'compliance.evaluate',
          cost: 'cost.estimate',
        }[req.body.step];
        if (req.body.step !== 'analyze' && !r.productId) throw badRequest('먼저 제품 분석이 필요합니다.');
        await tx
          .update(sourcingRequests)
          .set({
            status: 'ANALYZING',
            progress: sql`jsonb_set(${sourcingRequests.progress}, ${`{${req.body.step}}`}::text[], '{"status":"PENDING"}'::jsonb, true)`,
          })
          .where(eq(sourcingRequests.id, r.id));
        await enqueue(tx, tenant.id, jobType, { requestId: r.id, productId: r.productId }, { priority: 20 });
        await audit(tx, req, {
          action: 'sourcing.step.rerun',
          entityType: 'sourcing_request',
          entityId: r.id,
          after: { step: req.body.step },
        });
        return { ok: true };
      });
    },
  );

  // ─────────────── Human override of AI attributes (original preserved) ───────────────
  app.patch(
    '/products/:id/attributes',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ changes: productAttributesSchema.partial(), reason: z.string().min(2).max(500) }),
      },
    },
    async (req) => {
      const tenant = tenantOf(req);
      const user = requirePerm(req, 'sourcing.write');
      return db(req, async (tx) => {
        const [p] = await tx.select().from(products).where(eq(products.id, req.params.id)).limit(1);
        if (!p) throw notFound();
        const before = effectiveAttributes(p);
        const verified = {
          ...(p.attributesVerified ?? {}),
          ...req.body.changes,
        } as Partial<ProductAttributes>;
        await tx
          .update(products)
          .set({
            attributesVerified: verified,
            ...(req.body.changes.product_name_ko ? { nameKo: req.body.changes.product_name_ko } : {}),
            ...(req.body.changes.category ? { category: req.body.changes.category } : {}),
            updatedAt: new Date(),
          })
          .where(eq(products.id, p.id));
        for (const [field, value] of Object.entries(req.body.changes)) {
          await tx.insert(overrides).values({
            tenantId: tenant.id,
            entityType: 'product',
            entityId: p.id,
            field,
            original: (before as Record<string, unknown>)[field] ?? null,
            changed: value as never,
            reason: req.body.reason,
            actorId: user.id,
          });
        }
        await tx
          .update(modelPredictions)
          .set({ humanValue: verified, humanBy: user.id, humanAt: new Date() })
          .where(and(eq(modelPredictions.entityId, p.id), eq(modelPredictions.kind, 'ATTRIBUTE')));
        await audit(tx, req, {
          action: 'product.attributes.override',
          entityType: 'product',
          entityId: p.id,
          before: Object.fromEntries(
            Object.keys(req.body.changes).map((k) => [k, (before as Record<string, unknown>)[k]]),
          ),
          after: req.body.changes,
        });
        await evaluateProductCompliance(tx, tenant.id, p.id);
        return { ok: true, attributes: { ...before, ...verified } };
      });
    },
  );

  // ─────────────── Candidate management (staff) ───────────────
  app.patch(
    '/candidates/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          pinned: z.boolean().optional(),
          hiddenFromCustomer: z.boolean().optional(),
          selected: z.boolean().optional(),
          customerNote: z.string().max(1000).optional(),
          privateNote: z.string().max(2000).optional(),
        }),
      },
    },
    async (req) => {
      requirePerm(req, 'sourcing.write');
      return db(req, async (tx) => {
        const [c] = await tx
          .select()
          .from(requestCandidates)
          .where(eq(requestCandidates.id, req.params.id))
          .limit(1);
        if (!c) throw notFound();
        await tx
          .update(requestCandidates)
          .set({ ...req.body, updatedAt: new Date() })
          .where(eq(requestCandidates.id, c.id));
        await audit(tx, req, {
          action: 'candidate.updated',
          entityType: 'request_candidate',
          entityId: c.id,
          before: { pinned: c.pinned, hiddenFromCustomer: c.hiddenFromCustomer, selected: c.selected },
          after: req.body,
        });
        return { ok: true };
      });
    },
  );

  /** Add Internal Recommendation: our own supply-network product, pinnable above marketplace results. */
  app.post(
    '/sourcing/requests/:id/internal-recommendations',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          supplierId: z.string().uuid().optional(),
          newSupplier: z
            .object({
              name: z.string().min(1).max(200),
              alias: z.string().max(120).default(''),
              visibility: z.enum(['HIDDEN', 'ALIAS', 'VISIBLE']).default('HIDDEN'),
              city: z.string().max(80).default(''),
              businessType: z.enum(['FACTORY', 'TRADING', 'UNKNOWN']).default('FACTORY'),
            })
            .optional(),
          sourceType: z
            .enum([
              'PRIVATE_NETWORK',
              'DIRECT_FACTORY',
              'LOCAL_PARTNER',
              'INTERNAL_PRODUCT',
              'MANUAL_PROPOSAL',
            ])
            .default('PRIVATE_NETWORK'),
          productTitle: z.string().min(1).max(300),
          internalCost: z.string().regex(/^\d+(\.\d+)?$/),
          costCurrency: z.string().length(3).default('CNY'),
          customerPrice: z
            .string()
            .regex(/^\d+(\.\d+)?$/)
            .optional(),
          moq: z.number().int().positive().optional(),
          leadTimeDays: z.number().int().positive().optional(),
          qualityLevel: z.string().max(40).optional(),
          reason: z.string().max(1000).default(''),
          privateNote: z.string().max(2000).default(''),
          customerNote: z.string().max(1000).default(''),
          pin: z.boolean().default(true),
          packaging: z
            .object({
              unitsPerCarton: z.number().int().positive(),
              cartonL: z.string(),
              cartonW: z.string(),
              cartonH: z.string(),
              cartonGw: z.string(),
            })
            .partial()
            .optional(),
          imageFileIds: z.array(z.string().uuid()).max(5).default([]),
        }),
      },
    },
    async (req, reply) => {
      const tenant = tenantOf(req);
      const user = requirePerm(req, 'supplier.write');
      const b = req.body;
      if (!b.supplierId && !b.newSupplier) throw badRequest('공급자를 선택하거나 새로 입력하세요.');
      const out = await db(req, async (tx) => {
        const [r] = await tx
          .select()
          .from(sourcingRequests)
          .where(eq(sourcingRequests.id, req.params.id))
          .limit(1);
        if (!r) throw notFound();
        let supplierId = b.supplierId ?? null;
        if (!supplierId && b.newSupplier) {
          const [s] = await tx
            .insert(suppliers)
            .values({ tenantId: tenant.id, ...b.newSupplier, sourceType: b.sourceType })
            .returning({ id: suppliers.id });
          supplierId = s!.id;
        }
        const imageUrls = await Promise.all(
          b.imageFileIds.map((id) => signedDownloadUrl(tx, id, 7 * 24 * 3600).catch(() => '')),
        );
        const [l] = await tx
          .insert(sourceListings)
          .values({
            tenantId: tenant.id,
            supplierId,
            sourceType: b.sourceType,
            connector: 'MANUAL',
            title: b.productTitle,
            titleKo: b.productTitle,
            currency: b.costCurrency,
            priceTiers: [{ minQty: b.moq ?? 1, unitPrice: b.internalCost }],
            supplierVerifiedPrice: b.internalCost,
            moq: b.moq ?? null,
            leadTimeDays: b.leadTimeDays ?? null,
            packaging: (b.packaging ?? {}) as Record<string, string>,
            imageFileIds: b.imageFileIds,
            imageUrls: imageUrls.filter(Boolean),
          })
          .returning({ id: sourceListings.id });
        const [c] = await tx
          .insert(requestCandidates)
          .values({
            tenantId: tenant.id,
            requestId: r.id,
            listingId: l!.id,
            pinned: b.pin,
            isInternalRecommendation: true,
            internalCost: b.internalCost,
            customerPrice: b.customerPrice ?? null,
            customerPriceCurrency: (await getPublished(tx, tenant.id, 'pricing')).baseCurrency,
            qualityLevel: b.qualityLevel ?? null,
            reason: b.reason,
            privateNote: b.privateNote,
            customerNote: b.customerNote,
            addedBy: user.id,
            tags: ['PRIVATE_NETWORK_RECOMMENDED'],
          })
          .returning({ id: requestCandidates.id });
        await rebuildCandidates(tx, tenant.id, r.id);
        await audit(tx, req, {
          action: 'candidate.internal_recommendation.added',
          entityType: 'request_candidate',
          entityId: c!.id,
          after: { productTitle: b.productTitle, supplierId, pin: b.pin },
        });
        return { candidateId: c!.id, listingId: l!.id, supplierId };
      });
      reply.status(201);
      return out;
    },
  );

  /** Recalculate landed cost / price for a candidate with optional manual inputs (stored as a new version). */
  app.post(
    '/candidates/:id/estimate',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          quantity: z.number().int().positive().optional(),
          freightMode: z.string().optional(),
          origin: z.string().max(10).optional(),
          destination: z.string().max(10).optional(),
          dutyRateType: z.string().max(40).optional(),
          packing: z
            .object({
              cartonCount: z.number().int().positive(),
              cartonLengthCm: z.string(),
              cartonWidthCm: z.string(),
              cartonHeightCm: z.string(),
              cartonGrossWeightKg: z.string(),
            })
            .optional(),
          items: z
            .array(
              z.object({
                key: z.enum([
                  'product_cost',
                  'china_inland',
                  'inspection',
                  'packing',
                  'labeling',
                  'sample',
                  'international_freight',
                  'insurance',
                  'customs_brokerage',
                  'port_charges',
                  'certification',
                  'testing',
                  'domestic_delivery',
                  'miscellaneous',
                ]),
                amount: z.string().regex(/^\d+(\.\d+)?$/),
                currency: z.string().length(3),
                basis: z.enum(['PER_UNIT', 'TOTAL']),
                source: z.string().max(120).default('MANUAL'),
                verification: z
                  .enum([
                    'UNVERIFIED',
                    'AI_ESTIMATE',
                    'SYSTEM_CALCULATED',
                    'PARTNER_VERIFIED',
                    'EXPERT_VERIFIED',
                    'ACTUAL',
                  ])
                  .default('UNVERIFIED'),
                note: z.string().max(300).optional(),
              }),
            )
            .default([]),
        }),
      },
    },
    async (req) => {
      const tenant = tenantOf(req);
      const user = requirePerm(req, 'cost.read');
      requirePerm(req, 'sourcing.write');
      return db(req, async (tx) => {
        const r = await estimateForCandidate(tx, tenant.id, req.params.id, user.id, {
          ...req.body,
          packing: req.body.packing ?? null,
        });
        await audit(tx, req, {
          action: 'cost.estimated',
          entityType: 'cost_calculation',
          entityId: r.calculationId,
          after: { candidateId: req.params.id, landed: r.landed.landedCostBase, complete: r.landed.complete },
        });
        return r;
      });
    },
  );

  app.get(
    '/candidates/:id/costs',
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      requirePerm(req, 'cost.read');
      return db(req, async (tx) => {
        const calcs = await tx
          .select()
          .from(costCalculations)
          .where(eq(costCalculations.candidateId, req.params.id))
          .orderBy(desc(costCalculations.version));
        const snaps = await tx
          .select()
          .from(pricingSnapshots)
          .where(eq(pricingSnapshots.candidateId, req.params.id))
          .orderBy(desc(pricingSnapshots.createdAt));
        return { calculations: calcs, pricing: snaps };
      });
    },
  );

  /** ADMIN_FINAL_PRICE — separate from the calculated price, with a mandatory reason. */
  app.post(
    '/pricing-snapshots/:id/final-price',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          unitPrice: z.string().regex(/^\d+(\.\d+)?$/),
          reason: z.enum([
            'STRATEGIC_CUSTOMER',
            'MARKET_PRICE',
            'DISCOUNT',
            'HIGH_RISK',
            'LOW_QUANTITY',
            'MANUAL',
            'OTHER',
          ]),
          note: z.string().max(500).default(''),
        }),
      },
    },
    async (req) => {
      const user = requirePerm(req, 'pricing.final');
      return db(req, async (tx) => {
        const [s] = await tx
          .select()
          .from(pricingSnapshots)
          .where(eq(pricingSnapshots.id, req.params.id))
          .limit(1);
        if (!s) throw notFound();
        await tx
          .update(pricingSnapshots)
          .set({
            adminFinalPrice: req.body.unitPrice,
            adminFinalReason: req.body.reason,
            adminFinalNote: req.body.note,
            adminFinalBy: user.id,
            adminFinalAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(pricingSnapshots.id, s.id));
        await audit(tx, req, {
          action: 'pricing.admin_final_price',
          entityType: 'pricing_snapshot',
          entityId: s.id,
          before: { adminFinalPrice: s.adminFinalPrice, calculated: s.calculatedCustomerPrice },
          after: req.body,
        });
        return { ok: true };
      });
    },
  );

  // ─────────────── Projects ───────────────
  app.get(
    '/projects',
    {
      schema: {
        querystring: z.object({
          stage: z.enum(PROJECT_STAGES).optional(),
          q: z.string().max(100).optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        }),
      },
    },
    async (req) => {
      const u = userOf(req);
      return db(req, async (tx) => {
        const conds = [];
        if (u.audience === 'CUSTOMER') {
          if (!u.companyId) return { items: [], total: 0 };
          conds.push(eq(sourcingProjects.companyId, u.companyId));
        } else requirePerm(req, 'sourcing.read');
        if (req.query.stage) conds.push(eq(sourcingProjects.stage, req.query.stage));
        if (req.query.q)
          conds.push(
            sql`(${sourcingProjects.title} ilike ${'%' + req.query.q + '%'} or ${sourcingProjects.code} ilike ${'%' + req.query.q + '%'})`,
          );
        const where = conds.length ? and(...conds) : undefined;
        const items = await tx
          .select()
          .from(sourcingProjects)
          .where(where)
          .orderBy(desc(sourcingProjects.updatedAt))
          .limit(req.query.limit)
          .offset(req.query.offset);
        const [cnt] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(sourcingProjects)
          .where(where);
        const reqs = items.length
          ? await tx
              .select({
                id: sourcingRequests.id,
                projectId: sourcingRequests.projectId,
                status: sourcingRequests.status,
                imageFileIds: sourcingRequests.imageFileIds,
              })
              .from(sourcingRequests)
              .where(
                inArray(
                  sourcingRequests.projectId,
                  items.map((i) => i.id),
                ),
              )
          : [];
        const thumbs = new Map<string, string | null>();
        for (const r of reqs)
          if (r.projectId && !thumbs.has(r.projectId) && r.imageFileIds[0])
            thumbs.set(r.projectId, await signedDownloadUrl(tx, r.imageFileIds[0], 900).catch(() => null));
        return {
          total: cnt?.n ?? 0,
          items: items.map((p) => ({
            id: p.id,
            code: p.code,
            title: p.title,
            stage: p.stage,
            status: p.status,
            updatedAt: p.updatedAt,
            createdAt: p.createdAt,
            companyId: p.companyId,
            attention: u.audience === 'CUSTOMER' ? [] : p.attention,
            thumbnail: thumbs.get(p.id) ?? null,
            requestId: reqs.find((r) => r.projectId === p.id)?.id ?? null,
            requestStatus: reqs.find((r) => r.projectId === p.id)?.status ?? null,
          })),
        };
      });
    },
  );

  app.patch(
    '/projects/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          stage: z.enum(PROJECT_STAGES).optional(),
          status: z.enum(['OPEN', 'ON_HOLD', 'CLOSED']).optional(),
          title: z.string().min(1).max(200).optional(),
          companyId: z.string().uuid().nullable().optional(),
          ownerUserId: z.string().uuid().nullable().optional(),
        }),
      },
    },
    async (req) => {
      const user = requirePerm(req, 'sourcing.write');
      return db(req, async (tx) => {
        const [p] = await tx
          .select()
          .from(sourcingProjects)
          .where(eq(sourcingProjects.id, req.params.id))
          .limit(1);
        if (!p) throw notFound();
        const history =
          req.body.stage && req.body.stage !== p.stage
            ? [...p.stageHistory, { stage: req.body.stage, at: new Date().toISOString(), by: user.id }]
            : p.stageHistory;
        await tx
          .update(sourcingProjects)
          .set({ ...req.body, stageHistory: history, updatedAt: new Date() })
          .where(eq(sourcingProjects.id, p.id));
        await audit(tx, req, {
          action: 'project.updated',
          entityType: 'project',
          entityId: p.id,
          before: { stage: p.stage, status: p.status, companyId: p.companyId },
          after: req.body,
        });
        return { ok: true };
      });
    },
  );
}
