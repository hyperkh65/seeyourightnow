import { and, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  COMPLIANCE_STATUSES,
  EXPERT_TYPES,
  FREIGHT_MODES,
  FREIGHT_SOURCES,
  TRI_ATTRIBUTE_KEYS,
  VERIFICATION_STATUSES,
  D,
  errorRatePct,
  packingMetrics,
  type TriAttributeKey,
} from '@sos/core';
import type { Tx } from '../db/client.js';
import {
  complianceChecks,
  complianceReviews,
  freightQuotes,
  freightRates,
  freightRfqs,
  fxRates,
  hsClassifications,
  hsCodes,
  listingPriceHistory,
  modelPredictions,
  partnerTasks,
  products,
  quotations,
  regulations,
  regulationVersions,
  sourceListings,
  sourcingProjects,
  supplierContacts,
  supplierEvents,
  suppliers,
  tariffRates,
  userRoles,
  users,
} from '../db/schema/index.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { can, db, requireFeature, requirePerm, tenantOf, userOf } from '../http/context.js';
import type { App } from '../http/types.js';
import { audit } from '../services/audit.js';
import { evaluateProductCompliance } from '../services/compliance.js';
import { loadFxTable } from '../services/fx.js';
import { idempotent } from '../services/idempotency.js';
import { enqueue } from '../services/jobs.js';
import { notifyUsers } from '../services/notify.js';
import { nextNumber } from '../services/settings.js';
import { supplierDisplayName } from '../services/serializers.js';

const money = z.string().regex(/^\d+(\.\d+)?$/);

/** Partner may act only on tasks assigned to them (ABAC). */
async function assertPartnerTask(tx: Tx, userId: string, entityId: string, kind: string) {
  const [t] = await tx
    .select()
    .from(partnerTasks)
    .where(
      and(
        eq(partnerTasks.partnerUserId, userId),
        eq(partnerTasks.entityId, entityId),
        eq(partnerTasks.kind, kind),
      ),
    )
    .limit(1);
  if (!t) throw notFound('배정된 작업이 아닙니다.');
  return t;
}

export async function tradeRoutes(app: App) {
  // ═════════════════════════ Suppliers ═════════════════════════
  const supplierBody = z.object({
    name: z.string().min(1).max(200),
    nameLocal: z.string().max(200).default(''),
    alias: z.string().max(120).default(''),
    visibility: z.enum(['HIDDEN', 'ALIAS', 'VISIBLE']).default('ALIAS'),
    sourceType: z
      .enum([
        'PUBLIC_MARKET',
        'PRIVATE_NETWORK',
        'DIRECT_FACTORY',
        'LOCAL_PARTNER',
        'INTERNAL_PRODUCT',
        'RFQ_RESULT',
        'MANUAL_PROPOSAL',
        'CUSTOMER_NOMINATED',
      ])
      .default('PRIVATE_NETWORK'),
    businessType: z.enum(['FACTORY', 'TRADING', 'UNKNOWN']).default('UNKNOWN'),
    country: z.string().length(2).default('CN'),
    province: z.string().max(60).default(''),
    city: z.string().max(60).default(''),
    address: z.string().max(300).default(''),
    nearestPort: z.string().max(5).default(''),
    yearsInBusiness: z.number().int().min(0).max(200).nullable().optional(),
    businessVerified: z.boolean().nullable().optional(),
    verificationNote: z.string().max(500).default(''),
    avgResponseHours: z.number().min(0).max(1000).nullable().optional(),
    typicalMoq: z.number().int().positive().nullable().optional(),
    oemSupported: z.boolean().nullable().optional(),
    certifications: z
      .array(z.object({ name: z.string(), number: z.string().optional(), validUntil: z.string().optional() }))
      .default([]),
    bankInfo: z.record(z.string(), z.string()).default({}),
    riskFlags: z.array(z.string().max(60)).default([]),
    blacklisted: z.boolean().default(false),
    blacklistReason: z.string().max(500).default(''),
    internalNotes: z.string().max(5000).default(''),
    metrics: z
      .object({
        qualityScore: z.number().min(0).max(1).optional(),
        communicationScore: z.number().min(0).max(1).optional(),
        reliabilityScore: z.number().min(0).max(1).optional(),
      })
      .partial()
      .default({}),
  });

  app.get(
    '/suppliers',
    {
      schema: {
        querystring: z.object({
          q: z.string().max(100).optional(),
          sourceType: z.string().optional(),
          blacklisted: z.coerce.boolean().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(100),
        }),
      },
    },
    async (req) => {
      requirePerm(req, 'supplier.read');
      const secret = can(req, 'supplier.secret');
      return db(req, async (tx) => {
        const conds = [];
        if (req.query.q)
          conds.push(
            or(
              ilike(suppliers.name, `%${req.query.q}%`),
              ilike(suppliers.alias, `%${req.query.q}%`),
              ilike(suppliers.city, `%${req.query.q}%`),
            ),
          );
        if (req.query.sourceType) conds.push(eq(suppliers.sourceType, req.query.sourceType));
        if (req.query.blacklisted !== undefined) conds.push(eq(suppliers.blacklisted, req.query.blacklisted));
        const rows = await tx
          .select()
          .from(suppliers)
          .where(conds.length ? and(...conds) : undefined)
          .orderBy(desc(suppliers.updatedAt))
          .limit(req.query.limit);
        return {
          items: rows.map((s) => ({
            id: s.id,
            name: secret || s.sourceType === 'PUBLIC_MARKET' ? s.name : supplierDisplayName(s, s.sourceType),
            alias: s.alias,
            visibility: s.visibility,
            sourceType: s.sourceType,
            businessType: s.businessType,
            city: s.city,
            province: s.province,
            yearsInBusiness: s.yearsInBusiness,
            businessVerified: s.businessVerified,
            blacklisted: s.blacklisted,
            riskFlags: s.riskFlags,
            metrics: s.metrics,
            updatedAt: s.updatedAt,
          })),
        };
      });
    },
  );

  app.get('/suppliers/:id', { schema: { params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    requirePerm(req, 'supplier.read');
    const secret = can(req, 'supplier.secret');
    return db(req, async (tx) => {
      const [s] = await tx.select().from(suppliers).where(eq(suppliers.id, req.params.id)).limit(1);
      if (!s) throw notFound();
      const contacts = secret
        ? await tx.select().from(supplierContacts).where(eq(supplierContacts.supplierId, s.id))
        : [];
      const events = await tx
        .select()
        .from(supplierEvents)
        .where(eq(supplierEvents.supplierId, s.id))
        .orderBy(desc(supplierEvents.occurredAt))
        .limit(100);
      const listings = await tx
        .select({
          id: sourceListings.id,
          title: sourceListings.title,
          currency: sourceListings.currency,
          supplierListPrice: sourceListings.supplierListPrice,
          supplierVerifiedPrice: sourceListings.supplierVerifiedPrice,
          moq: sourceListings.moq,
          lastCheckedAt: sourceListings.lastCheckedAt,
          sourceType: sourceListings.sourceType,
        })
        .from(sourceListings)
        .where(eq(sourceListings.supplierId, s.id))
        .limit(100);
      const history = listings.length
        ? await tx
            .select()
            .from(listingPriceHistory)
            .where(
              inArray(
                listingPriceHistory.listingId,
                listings.map((l) => l.id),
              ),
            )
            .orderBy(desc(listingPriceHistory.observedAt))
            .limit(300)
        : [];
      const counts = events.reduce<Record<string, number>>(
        (a, e) => ({ ...a, [e.kind]: (a[e.kind] ?? 0) + 1 }),
        {},
      );
      const base = { ...s, contacts, events, listings, priceHistory: history, counts };
      if (secret) return base;
      return {
        ...base,
        name: supplierDisplayName(s, s.sourceType),
        nameLocal: '',
        address: '',
        bankInfo: {},
        contacts: [],
      };
    });
  });

  app.post('/suppliers', { schema: { body: supplierBody } }, async (req, reply) => {
    const tenant = tenantOf(req);
    requirePerm(req, 'supplier.write');
    return db(req, async (tx) => {
      const [s] = await tx
        .insert(suppliers)
        .values({
          tenantId: tenant.id,
          ...req.body,
          yearsInBusiness: req.body.yearsInBusiness ?? null,
          businessVerified: req.body.businessVerified ?? null,
          avgResponseHours: req.body.avgResponseHours ?? null,
          typicalMoq: req.body.typicalMoq ?? null,
          oemSupported: req.body.oemSupported ?? null,
        })
        .returning();
      await audit(tx, req, {
        action: 'supplier.created',
        entityType: 'supplier',
        entityId: s!.id,
        after: { name: s!.name, sourceType: s!.sourceType },
      });
      reply.status(201);
      return s;
    });
  });

  app.patch(
    '/suppliers/:id',
    { schema: { params: z.object({ id: z.string().uuid() }), body: supplierBody.partial() } },
    async (req) => {
      requirePerm(req, 'supplier.write');
      return db(req, async (tx) => {
        const [s] = await tx.select().from(suppliers).where(eq(suppliers.id, req.params.id)).limit(1);
        if (!s) throw notFound();
        const metrics = req.body.metrics ? { ...s.metrics, ...req.body.metrics } : s.metrics;
        await tx
          .update(suppliers)
          .set({ ...req.body, metrics, updatedAt: new Date() })
          .where(eq(suppliers.id, s.id));
        await audit(tx, req, {
          action: req.body.blacklisted && !s.blacklisted ? 'supplier.blacklisted' : 'supplier.updated',
          entityType: 'supplier',
          entityId: s.id,
          before: { blacklisted: s.blacklisted, visibility: s.visibility, bankInfo: s.bankInfo },
          after: req.body,
        });
        return { ok: true };
      });
    },
  );

  app.post(
    '/suppliers/:id/contacts',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          name: z.string().min(1).max(80),
          role: z.string().max(60).default(''),
          phone: z.string().max(40).default(''),
          email: z.string().max(200).default(''),
          wechat: z.string().max(80).default(''),
          whatsapp: z.string().max(40).default(''),
          language: z.string().max(5).default('zh'),
        }),
      },
    },
    async (req, reply) => {
      const tenant = tenantOf(req);
      requirePerm(req, 'supplier.secret');
      return db(req, async (tx) => {
        const [c] = await tx
          .insert(supplierContacts)
          .values({ tenantId: tenant.id, supplierId: req.params.id, ...req.body })
          .returning();
        reply.status(201);
        return c;
      });
    },
  );

  app.post(
    '/suppliers/:id/events',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          kind: z.enum([
            'SAMPLE',
            'ORDER',
            'QUALITY_ISSUE',
            'LATE_DELIVERY',
            'CLAIM',
            'REFUND',
            'COMMUNICATION',
            'PRICE_CHANGE',
          ]),
          projectId: z.string().uuid().optional(),
          rating: z.number().min(0).max(5).optional(),
          amount: money.optional(),
          currency: z.string().length(3).optional(),
          note: z.string().max(2000).default(''),
          occurredAt: z.string().optional(),
        }),
      },
    },
    async (req, reply) => {
      const tenant = tenantOf(req);
      const user = requirePerm(req, 'supplier.write');
      return db(req, async (tx) => {
        const [e] = await tx
          .insert(supplierEvents)
          .values({
            tenantId: tenant.id,
            supplierId: req.params.id,
            ...req.body,
            occurredAt: req.body.occurredAt ? new Date(req.body.occurredAt) : new Date(),
            createdBy: user.id,
          })
          .returning();
        // Keep aggregate metrics in sync (used by Best Match & Risk engines).
        const all = await tx
          .select()
          .from(supplierEvents)
          .where(eq(supplierEvents.supplierId, req.params.id));
        const count = (k: string) => all.filter((x) => x.kind === k).length;
        const [s] = await tx.select().from(suppliers).where(eq(suppliers.id, req.params.id)).limit(1);
        const orders = count('ORDER');
        const issues = count('QUALITY_ISSUE') + count('CLAIM');
        const ratings = all.filter((x) => x.rating !== null).map((x) => x.rating!);
        await tx
          .update(suppliers)
          .set({
            metrics: {
              ...(s?.metrics ?? {}),
              orderCount: orders,
              sampleCount: count('SAMPLE'),
              claimCount: count('CLAIM'),
              refundCount: count('REFUND'),
              lateDeliveryCount: count('LATE_DELIVERY'),
              qualityScore: orders ? Math.max(0, 1 - issues / Math.max(orders, 1)) : s?.metrics.qualityScore,
              communicationScore: ratings.length
                ? ratings.reduce((a, b) => a + b, 0) / ratings.length / 5
                : s?.metrics.communicationScore,
            },
            updatedAt: new Date(),
          })
          .where(eq(suppliers.id, req.params.id));
        await audit(tx, req, {
          action: 'supplier.event',
          entityType: 'supplier',
          entityId: req.params.id,
          after: req.body,
        });
        reply.status(201);
        return e;
      });
    },
  );

  /** Manually add a private-network product listing (our own supply chain). */
  app.post(
    '/suppliers/:id/listings',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          title: z.string().min(1).max(300),
          titleKo: z.string().max(300).default(''),
          model: z.string().max(80).default(''),
          currency: z.string().length(3).default('CNY'),
          priceTiers: z.array(z.object({ minQty: z.number().int().positive(), unitPrice: money })).min(1),
          moq: z.number().int().positive().optional(),
          leadTimeDays: z.number().int().positive().optional(),
          oemSupported: z.boolean().optional(),
          specs: z.record(z.string(), z.string()).default({}),
          packaging: z
            .object({
              unitsPerCarton: z.number().int().positive(),
              cartonL: z.string(),
              cartonW: z.string(),
              cartonH: z.string(),
              cartonGw: z.string(),
              cartonNw: z.string().optional(),
            })
            .partial()
            .default({}),
          shippingOrigin: z.string().max(5).default(''),
          imageFileIds: z.array(z.string().uuid()).max(8).default([]),
        }),
      },
    },
    async (req, reply) => {
      const tenant = tenantOf(req);
      requirePerm(req, 'supplier.write');
      return db(req, async (tx) => {
        const [s] = await tx.select().from(suppliers).where(eq(suppliers.id, req.params.id)).limit(1);
        if (!s) throw notFound();
        const [l] = await tx
          .insert(sourceListings)
          .values({
            tenantId: tenant.id,
            supplierId: s.id,
            sourceType: s.sourceType,
            connector: 'MANUAL',
            ...req.body,
            packaging: req.body.packaging as Record<string, string>,
            supplierVerifiedPrice: req.body.priceTiers[0]!.unitPrice,
            moq: req.body.moq ?? null,
            leadTimeDays: req.body.leadTimeDays ?? null,
            oemSupported: req.body.oemSupported ?? null,
          })
          .returning();
        await tx.insert(listingPriceHistory).values({
          tenantId: tenant.id,
          listingId: l!.id,
          unitPrice: req.body.priceTiers[0]!.unitPrice,
          currency: req.body.currency,
          moq: req.body.moq ?? null,
        });
        await audit(tx, req, {
          action: 'listing.created',
          entityType: 'source_listing',
          entityId: l!.id,
          after: { title: l!.title, supplier: s.id },
        });
        reply.status(201);
        return l;
      });
    },
  );

  /** Update verified supplier price (price history kept; change detection affects active quotes). */
  app.patch(
    '/listings/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          supplierVerifiedPrice: money.optional(),
          actualPurchasePrice: money.optional(),
          moq: z.number().int().positive().optional(),
          leadTimeDays: z.number().int().positive().optional(),
          packaging: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
          titleKo: z.string().max(300).optional(),
        }),
      },
    },
    async (req) => {
      const tenant = tenantOf(req);
      requirePerm(req, 'supplier.write');
      return db(req, async (tx) => {
        const [l] = await tx
          .select()
          .from(sourceListings)
          .where(eq(sourceListings.id, req.params.id))
          .limit(1);
        if (!l) throw notFound();
        const { actualPurchasePrice: _a, ...rest } = req.body;
        await tx
          .update(sourceListings)
          .set({
            ...rest,
            packaging: (req.body.packaging ?? l.packaging) as Record<string, string>,
            lastCheckedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(sourceListings.id, l.id));
        if (req.body.supplierVerifiedPrice)
          await tx.insert(listingPriceHistory).values({
            tenantId: tenant.id,
            listingId: l.id,
            unitPrice: req.body.supplierVerifiedPrice,
            currency: l.currency,
            moq: req.body.moq ?? l.moq,
          });
        await audit(tx, req, {
          action: 'listing.updated',
          entityType: 'source_listing',
          entityId: l.id,
          before: { supplierVerifiedPrice: l.supplierVerifiedPrice, moq: l.moq },
          after: req.body,
        });
        if (req.body.supplierVerifiedPrice)
          await enqueue(
            tx,
            tenant.id,
            'change.detect',
            { listingId: l.id },
            { dedupeKey: `change:${l.id}:${Date.now()}` },
          );
        return { ok: true };
      });
    },
  );

  // ═════════════════════════ Compliance rules (versioned) ═════════════════════════
  const ruleVersionBody = z.object({
    hsPrefixes: z.array(z.string().regex(/^\d{2,10}$/)).default([]),
    triggerAll: z.array(z.enum(TRI_ATTRIBUTE_KEYS as [TriAttributeKey, ...TriAttributeKey[]])).default([]),
    triggerAny: z.array(z.enum(TRI_ATTRIBUTE_KEYS as [TriAttributeKey, ...TriAttributeKey[]])).default([]),
    exceptions: z.array(z.enum(TRI_ATTRIBUTE_KEYS as [TriAttributeKey, ...TriAttributeKey[]])).default([]),
    mandatory: z.boolean().default(true),
    documentsRequired: z.array(z.string().max(120)).default([]),
    testsRequired: z.array(z.string().max(120)).default([]),
    expertType: z.enum(EXPERT_TYPES).nullable().default(null),
    officialSource: z.string().max(500).default(''),
    summary: z.string().max(3000).default(''),
    effectiveFrom: z.string().optional(),
    effectiveTo: z.string().optional(),
    changeNote: z.string().max(1000).default(''),
  });

  app.get('/regulations', async (req) => {
    requirePerm(req, 'compliance.read');
    const tenant = tenantOf(req);
    return db(req, async (tx) => {
      const regs = await tx
        .select()
        .from(regulations)
        .where(or(isNull(regulations.tenantId), eq(regulations.tenantId, tenant.id)))
        .orderBy(regulations.category);
      const vers = regs.length
        ? await tx
            .select()
            .from(regulationVersions)
            .where(
              inArray(
                regulationVersions.regulationId,
                regs.map((r) => r.id),
              ),
            )
            .orderBy(desc(regulationVersions.version))
        : [];
      return {
        items: regs.map((r) => ({
          ...r,
          platformManaged: r.tenantId === null,
          current: vers.find((v) => v.id === r.currentVersionId) ?? null,
          versions: vers
            .filter((v) => v.regulationId === r.id)
            .map((v) => ({
              id: v.id,
              version: v.version,
              effectiveFrom: v.effectiveFrom,
              changeNote: v.changeNote,
              createdAt: v.createdAt,
            })),
        })),
      };
    });
  });

  app.post(
    '/regulations',
    {
      schema: {
        body: z.object({
          code: z.string().regex(/^[A-Z0-9_]{2,40}$/),
          name: z.string().min(1).max(200),
          authority: z.string().min(1).max(120),
          category: z.string().min(1).max(40),
          version: ruleVersionBody,
        }),
      },
    },
    async (req, reply) => {
      const tenant = tenantOf(req);
      const user = requirePerm(req, 'compliance.rules.manage');
      return db(req, async (tx) => {
        const [r] = await tx
          .insert(regulations)
          .values({
            tenantId: tenant.id,
            code: req.body.code,
            name: req.body.name,
            authority: req.body.authority,
            category: req.body.category,
          })
          .returning();
        const [v] = await tx
          .insert(regulationVersions)
          .values({
            tenantId: tenant.id,
            regulationId: r!.id,
            version: 1,
            ...req.body.version,
            createdBy: user.id,
          })
          .returning();
        await tx.update(regulations).set({ currentVersionId: v!.id }).where(eq(regulations.id, r!.id));
        await audit(tx, req, {
          action: 'regulation.created',
          entityType: 'regulation',
          entityId: r!.id,
          after: req.body,
        });
        reply.status(201);
        return { id: r!.id, versionId: v!.id };
      });
    },
  );

  /**
   * New regulation version (tenant rules only; platform rules are updated by the platform).
   * Triggers impact analysis: affected products, active quotations, open orders.
   */
  app.post(
    '/regulations/:id/versions',
    { schema: { params: z.object({ id: z.string().uuid() }), body: ruleVersionBody } },
    async (req, reply) => {
      const tenant = tenantOf(req);
      const user = requirePerm(req, 'compliance.rules.manage');
      return db(req, async (tx) => {
        const [r] = await tx.select().from(regulations).where(eq(regulations.id, req.params.id)).limit(1);
        if (!r) throw notFound();
        if (r.tenantId === null) throw forbidden('플랫폼 관리 규정은 플랫폼 관리자만 변경할 수 있습니다.');
        const [max] = await tx
          .select({ v: sql<number>`max(${regulationVersions.version})::int` })
          .from(regulationVersions)
          .where(eq(regulationVersions.regulationId, r.id));
        const [v] = await tx
          .insert(regulationVersions)
          .values({
            tenantId: tenant.id,
            regulationId: r.id,
            version: (max?.v ?? 0) + 1,
            ...req.body,
            createdBy: user.id,
          })
          .returning();
        await tx
          .update(regulations)
          .set({ currentVersionId: v!.id, updatedAt: new Date() })
          .where(eq(regulations.id, r.id));
        const impact = await regulationImpact(tx, r.id);
        await tx.update(complianceChecks).set({ stale: true }).where(eq(complianceChecks.regulationId, r.id));
        for (const pid of impact.productIds)
          await enqueue(
            tx,
            tenant.id,
            'compliance.evaluate',
            { productId: pid },
            { dedupeKey: `comp-reeval:${pid}:${v!.id}` },
          );
        await audit(tx, req, {
          action: 'regulation.version.created',
          entityType: 'regulation',
          entityId: r.id,
          after: { version: v!.version, changeNote: req.body.changeNote, impact: impact.summary },
        });
        reply.status(201);
        return { versionId: v!.id, version: v!.version, impact: impact.summary };
      });
    },
  );

  app.get(
    '/regulations/:id/impact',
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      requirePerm(req, 'compliance.read');
      return db(req, async (tx) => (await regulationImpact(tx, req.params.id)).summary);
    },
  );

  app.get(
    '/products/:id/compliance',
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      requirePerm(req, 'compliance.read');
      return db(req, async (tx) => {
        const checks = await tx
          .select()
          .from(complianceChecks)
          .where(eq(complianceChecks.productId, req.params.id));
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
        const reviews = checks.length
          ? await tx
              .select()
              .from(complianceReviews)
              .where(
                inArray(
                  complianceReviews.checkId,
                  checks.map((c) => c.id),
                ),
              )
              .orderBy(desc(complianceReviews.createdAt))
          : [];
        return {
          items: checks.map((c) => ({
            ...c,
            regulation: regs.find((r) => r.id === c.regulationId),
            reviews: reviews.filter((r) => r.checkId === c.id),
          })),
        };
      });
    },
  );

  /** Assign a compliance check (or HS classification) to an expert partner. */
  app.post(
    '/partner-tasks',
    {
      schema: {
        body: z.object({
          partnerUserId: z.string().uuid(),
          kind: z.enum(['HS_REVIEW', 'COMPLIANCE_REVIEW', 'FREIGHT_QUOTE', 'SUPPLIER_RFQ']),
          entityType: z.string().max(40),
          entityId: z.string().uuid(),
          projectId: z.string().uuid().optional(),
          title: z.string().min(1).max(200),
          dueAt: z.string().datetime({ offset: true }).optional(),
        }),
      },
    },
    async (req, reply) => {
      const tenant = tenantOf(req);
      requireFeature(req, 'EXPERT_PORTAL');
      const user = requirePerm(req, 'compliance.write');
      return db(req, async (tx) => {
        const [pu] = await tx
          .select()
          .from(userRoles)
          .where(
            and(
              eq(userRoles.userId, req.body.partnerUserId),
              inArray(userRoles.role, [
                'CUSTOMS_PARTNER',
                'FORWARDER_PARTNER',
                'CERTIFICATION_PARTNER',
                'SUPPLIER_PARTNER',
              ]),
            ),
          )
          .limit(1);
        if (!pu) throw badRequest('협력사 계정이 아닙니다.');
        const [t] = await tx
          .insert(partnerTasks)
          .values({
            tenantId: tenant.id,
            ...req.body,
            dueAt: req.body.dueAt ? new Date(req.body.dueAt) : null,
            createdBy: user.id,
          })
          .returning();
        if (req.body.kind === 'COMPLIANCE_REVIEW')
          await tx
            .update(complianceChecks)
            .set({ verifiedStatus: null })
            .where(and(eq(complianceChecks.id, req.body.entityId), isNull(complianceChecks.verifiedStatus)));
        await notifyUsers(tx, tenant.id, [req.body.partnerUserId], {
          kind: 'PARTNER_TASK',
          title: `새 확인 요청: ${req.body.title}`,
          link: `/partner/tasks/${t!.id}`,
          dedupeKey: `task:${t!.id}`,
        });
        await audit(tx, req, {
          action: 'partner_task.assigned',
          entityType: 'partner_task',
          entityId: t!.id,
          after: req.body,
        });
        reply.status(201);
        return t;
      });
    },
  );

  /** Expert decision on a compliance check (staff or assigned partner). Estimate is never overwritten. */
  app.post(
    '/compliance-checks/:id/review',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          status: z.enum(COMPLIANCE_STATUSES),
          note: z.string().max(3000).default(''),
          verifiedCost: money.optional(),
          certificateNumber: z.string().max(80).optional(),
          attachments: z.array(z.string().uuid()).max(10).default([]),
        }),
      },
    },
    async (req) => {
      const tenant = tenantOf(req);
      const user = userOf(req);
      return db(req, async (tx) => {
        const [c] = await tx
          .select()
          .from(complianceChecks)
          .where(eq(complianceChecks.id, req.params.id))
          .limit(1);
        if (!c) throw notFound();
        let task: typeof partnerTasks.$inferSelect | null = null;
        if (user.audience === 'PARTNER')
          task = await assertPartnerTask(tx, user.id, c.id, 'COMPLIANCE_REVIEW');
        else requirePerm(req, 'compliance.write');
        await tx.insert(complianceReviews).values({
          tenantId: tenant.id,
          checkId: c.id,
          reviewerId: user.id,
          fromStatus: c.verifiedStatus ?? c.estimatedStatus,
          toStatus: req.body.status,
          note: req.body.note,
          attachments: req.body.attachments,
        });
        await tx
          .update(complianceChecks)
          .set({
            verifiedStatus: req.body.status,
            verifiedBy: user.id,
            verifiedAt: new Date(),
            expertNote: req.body.note,
            ...(req.body.verifiedCost ? { verifiedCost: req.body.verifiedCost } : {}),
            ...(req.body.certificateNumber ? { certificateNumber: req.body.certificateNumber } : {}),
            updatedAt: new Date(),
          })
          .where(eq(complianceChecks.id, c.id));
        await tx.insert(modelPredictions).values({
          tenantId: tenant.id,
          kind: 'COMPLIANCE',
          entityType: 'compliance_check',
          entityId: c.id,
          predicted: { status: c.estimatedStatus, confidence: c.estimatedConfidence },
          humanValue: { status: req.body.status },
          humanBy: user.id,
          humanAt: new Date(),
          confidence: c.estimatedConfidence,
        });
        if (task)
          await tx
            .update(partnerTasks)
            .set({ status: 'SUBMITTED', submittedAt: new Date(), updatedAt: new Date() })
            .where(eq(partnerTasks.id, task.id));
        await audit(tx, req, {
          action: 'compliance.reviewed',
          entityType: 'compliance_check',
          entityId: c.id,
          before: { estimated: c.estimatedStatus, verified: c.verifiedStatus },
          after: req.body,
        });
        return { ok: true };
      });
    },
  );

  app.post(
    '/products/:id/compliance/evaluate',
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      const tenant = tenantOf(req);
      requirePerm(req, 'compliance.write');
      return db(req, async (tx) => ({
        items: await evaluateProductCompliance(tx, tenant.id, req.params.id),
      }));
    },
  );

  // ═════════════════════════ HS / tariff ═════════════════════════
  app.get(
    '/hs-codes',
    {
      schema: {
        querystring: z.object({
          q: z.string().max(100).default(''),
          limit: z.coerce.number().int().min(1).max(100).default(30),
        }),
      },
    },
    async (req) => {
      requirePerm(req, 'hs.read');
      const tenant = tenantOf(req);
      return db(req, async (tx) => {
        const q = req.query.q.trim();
        const rows = await tx
          .select()
          .from(hsCodes)
          .where(
            and(
              or(isNull(hsCodes.tenantId), eq(hsCodes.tenantId, tenant.id)),
              q
                ? or(
                    ilike(hsCodes.code, `${q.replace(/\D/g, '')}%`),
                    ilike(hsCodes.descriptionKo, `%${q}%`),
                    ilike(hsCodes.descriptionEn, `%${q}%`),
                  )
                : undefined,
            ),
          )
          .limit(req.query.limit);
        return { items: rows };
      });
    },
  );

  /** Customs broker verification: stored in verified_hs, estimate untouched. */
  app.post(
    '/products/:id/hs/verify',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          hsCode: z.string().regex(/^\d{6,10}$/),
          rateType: z.string().max(40).optional(),
          note: z.string().max(2000).default(''),
        }),
      },
    },
    async (req) => {
      const tenant = tenantOf(req);
      const user = userOf(req);
      return db(req, async (tx) => {
        const [hs] = await tx
          .select()
          .from(hsClassifications)
          .where(eq(hsClassifications.productId, req.params.id))
          .limit(1);
        if (user.audience === 'PARTNER')
          await assertPartnerTask(tx, user.id, hs?.id ?? req.params.id, 'HS_REVIEW');
        else requirePerm(req, 'hs.write');
        if (hs) {
          await tx
            .update(hsClassifications)
            .set({
              verifiedHs: req.body.hsCode,
              verifiedBy: user.id,
              verifiedAt: new Date(),
              verificationNote: req.body.note,
              selectedRateType: req.body.rateType ?? hs.selectedRateType,
              updatedAt: new Date(),
            })
            .where(eq(hsClassifications.id, hs.id));
        } else {
          await tx.insert(hsClassifications).values({
            tenantId: tenant.id,
            productId: req.params.id,
            verifiedHs: req.body.hsCode,
            verifiedBy: user.id,
            verifiedAt: new Date(),
            verificationNote: req.body.note,
            selectedRateType: req.body.rateType ?? null,
          });
        }
        await tx
          .update(products)
          .set({ hsCodeVerified: req.body.hsCode, updatedAt: new Date() })
          .where(eq(products.id, req.params.id));
        await tx
          .update(modelPredictions)
          .set({ humanValue: { code: req.body.hsCode }, humanBy: user.id, humanAt: new Date() })
          .where(and(eq(modelPredictions.entityId, req.params.id), eq(modelPredictions.kind, 'HS')));
        if (user.audience === 'PARTNER' && hs)
          await tx
            .update(partnerTasks)
            .set({ status: 'SUBMITTED', submittedAt: new Date() })
            .where(and(eq(partnerTasks.entityId, hs.id), eq(partnerTasks.partnerUserId, user.id)));
        await audit(tx, req, {
          action: 'hs.verified',
          entityType: 'product',
          entityId: req.params.id,
          before: { estimated: hs?.estimatedHs, verified: hs?.verifiedHs },
          after: req.body,
        });
        await evaluateProductCompliance(tx, tenant.id, req.params.id);
        return { ok: true };
      });
    },
  );

  app.post(
    '/products/:id/hs/actual',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          hsCode: z.string().regex(/^\d{6,10}$/),
          source: z.string().max(120).default('수입신고필증'),
        }),
      },
    },
    async (req) => {
      const user = requirePerm(req, 'hs.write');
      return db(req, async (tx) => {
        await tx
          .update(hsClassifications)
          .set({
            actualHs: req.body.hsCode,
            actualSource: req.body.source,
            actualAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(hsClassifications.productId, req.params.id));
        await tx
          .update(products)
          .set({ hsCodeActual: req.body.hsCode })
          .where(eq(products.id, req.params.id));
        await tx
          .update(modelPredictions)
          .set({ actualValue: { code: req.body.hsCode }, actualAt: new Date() })
          .where(and(eq(modelPredictions.entityId, req.params.id), eq(modelPredictions.kind, 'HS')));
        await audit(tx, req, {
          action: 'hs.actual_recorded',
          entityType: 'product',
          entityId: req.params.id,
          after: { ...req.body, by: user.id },
        });
        return { ok: true };
      });
    },
  );

  /** Tariff import (official schedule rows). Tenants import into their own scope. */
  app.post(
    '/tariff-rates/import',
    {
      schema: {
        body: z.object({
          source: z.string().min(2).max(120),
          sourceUrl: z.string().max(500).default(''),
          verification: z.enum(VERIFICATION_STATUSES).default('UNVERIFIED'),
          rows: z
            .array(
              z.object({
                hsCode: z.string().regex(/^\d{4,10}$/),
                rateType: z.string().min(2).max(40),
                ratePct: money.nullable(),
                originCountry: z.string().max(3).default('*'),
                requiresCertificateOfOrigin: z.boolean().default(false),
                validFrom: z.string().optional(),
                validTo: z.string().optional(),
              }),
            )
            .min(1)
            .max(20000),
        }),
      },
    },
    async (req) => {
      const tenant = tenantOf(req);
      requirePerm(req, 'hs.write');
      return db(req, async (tx) => {
        for (const r of req.body.rows)
          await tx.insert(tariffRates).values({
            tenantId: tenant.id,
            ...r,
            source: req.body.source,
            sourceUrl: req.body.sourceUrl,
            verification: req.body.verification,
          });
        await audit(tx, req, {
          action: 'tariff.imported',
          entityType: 'tariff_rates',
          entityId: '',
          after: { source: req.body.source, rows: req.body.rows.length },
        });
        return { imported: req.body.rows.length };
      });
    },
  );

  app.get(
    '/tariff-rates',
    { schema: { querystring: z.object({ hsCode: z.string().max(10).optional() }) } },
    async (req) => {
      requirePerm(req, 'hs.read');
      const tenant = tenantOf(req);
      return db(req, async (tx) => ({
        items: await tx
          .select()
          .from(tariffRates)
          .where(
            and(
              or(isNull(tariffRates.tenantId), eq(tariffRates.tenantId, tenant.id)),
              req.query.hsCode ? ilike(tariffRates.hsCode, `${req.query.hsCode}%`) : undefined,
            ),
          )
          .limit(500),
      }));
    },
  );

  // ═════════════════════════ FX rates ═════════════════════════
  /** Current rate per currency (tenant rows win over platform rows) with source and verification. */
  app.get('/fx/rates', async (req) => {
    requirePerm(req, 'cost.read');
    const tenant = tenantOf(req);
    return db(req, async (tx) => {
      const { rates } = await loadFxTable(tx, tenant.id);
      return { items: rates.sort((a, b) => a.base.localeCompare(b.base)) };
    });
  });

  /** Manual FX rate (e.g. bank notice) — used when no FX API is connected. Step-up required. */
  app.post(
    '/fx/rates',
    {
      schema: {
        body: z.object({
          base: z.string().regex(/^[A-Z]{3}$/),
          rate: z.string().regex(/^\d+(\.\d+)?$/),
          rateDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          source: z.string().min(2).max(120),
          verification: z
            .enum(['UNVERIFIED', 'PARTNER_VERIFIED', 'EXPERT_VERIFIED', 'ACTUAL'])
            .default('UNVERIFIED'),
        }),
      },
    },
    async (req, reply) => {
      const tenant = tenantOf(req);
      requirePerm(req, 'margin.manage');
      if (Number(req.body.rate) <= 0) throw badRequest('환율은 0보다 커야 합니다.');
      return db(req, async (tx) => {
        const [r] = await tx
          .insert(fxRates)
          .values({
            tenantId: tenant.id,
            base: req.body.base,
            quote: 'KRW',
            rate: req.body.rate,
            rateDate: req.body.rateDate,
            source: req.body.source,
            verification: req.body.verification,
          })
          .returning();
        await audit(tx, req, {
          action: 'fx.manual',
          entityType: 'fx_rate',
          entityId: r!.id,
          after: req.body,
        });
        reply.status(201);
        return r;
      });
    },
  );

  app.post('/fx/refresh', async (req) => {
    const tenant = tenantOf(req);
    requirePerm(req, 'cost.read');
    return db(req, async (tx) => {
      await enqueue(
        tx,
        tenant.id,
        'fx.daily',
        {},
        { priority: 20, dedupeKey: `fx.manual:${Math.floor(Date.now() / 60000)}` },
      );
      return { ok: true };
    });
  });

  // ═════════════════════════ Freight ═════════════════════════
  const rateBody = z.object({
    mode: z.enum(FREIGHT_MODES),
    origin: z.string().min(2).max(6),
    destination: z.string().min(2).max(6),
    source: z.enum(FREIGHT_SOURCES),
    verification: z.enum(VERIFICATION_STATUSES).default('UNVERIFIED'),
    providerName: z.string().max(120).default(''),
    currency: z.string().length(3),
    basis: z.enum(['PER_KG', 'PER_CBM', 'PER_RT', 'PER_CONTAINER', 'FLAT']),
    rate: money,
    minCharge: money.optional(),
    fixedCharges: z.array(z.object({ name: z.string().max(60), amount: money })).default([]),
    transitDaysMin: z.number().int().min(0).optional(),
    transitDaysMax: z.number().int().min(0).optional(),
    validFrom: z.string().optional(),
    validUntil: z.string().optional(),
    note: z.string().max(500).default(''),
  });

  app.get('/freight/rates', async (req) => {
    requirePerm(req, 'freight.read');
    return db(req, async (tx) => ({
      items: await tx.select().from(freightRates).orderBy(desc(freightRates.collectedAt)).limit(500),
    }));
  });

  app.post('/freight/rates', { schema: { body: rateBody } }, async (req, reply) => {
    const tenant = tenantOf(req);
    const user = requirePerm(req, 'freight.write');
    return db(req, async (tx) => {
      const [r] = await tx
        .insert(freightRates)
        .values({ tenantId: tenant.id, ...req.body, createdBy: user.id })
        .returning();
      await audit(tx, req, {
        action: 'freight.rate.created',
        entityType: 'freight_rate',
        entityId: r!.id,
        after: req.body,
      });
      reply.status(201);
      return r;
    });
  });

  app.delete(
    '/freight/rates/:id',
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      requirePerm(req, 'freight.write');
      return db(req, async (tx) => {
        const [r] = await tx.select().from(freightRates).where(eq(freightRates.id, req.params.id)).limit(1);
        if (!r) throw notFound();
        await tx.delete(freightRates).where(eq(freightRates.id, r.id));
        await audit(tx, req, {
          action: 'freight.rate.deleted',
          entityType: 'freight_rate',
          entityId: r.id,
          before: r,
        });
        return { ok: true };
      });
    },
  );

  /** RFQ to one or more forwarders; each gets a partner task in the Forwarder Portal. */
  app.post(
    '/projects/:id/freight-rfqs',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          origin: z.string().min(2).max(6),
          destination: z.string().min(2).max(6),
          incoterm: z.string().max(10).default('FOB'),
          packing: z.object({
            cartonCount: z.number().int().positive(),
            cartonLengthCm: money,
            cartonWidthCm: money,
            cartonHeightCm: money,
            cartonGrossWeightKg: money,
          }),
          cargoType: z.string().max(40).default('GENERAL'),
          battery: z.boolean().default(false),
          dangerousGoods: z.boolean().default(false),
          readyDate: z.string().optional(),
          modes: z.array(z.enum(FREIGHT_MODES)).min(1),
          forwarderUserIds: z.array(z.string().uuid()).min(1).max(20),
        }),
      },
    },
    async (req, reply) => {
      const tenant = tenantOf(req);
      requireFeature(req, 'FREIGHT');
      const user = requirePerm(req, 'freight.write');
      return idempotent(req, reply, `rfq.create:${req.params.id}`, () =>
        db(req, async (tx) => {
          const [p] = await tx
            .select()
            .from(sourcingProjects)
            .where(eq(sourcingProjects.id, req.params.id))
            .limit(1);
          if (!p) throw notFound();
          const m = packingMetrics(req.body.packing);
          const code = await nextNumber(tx, tenant.id, 'RFQ');
          const [rfq] = await tx
            .insert(freightRfqs)
            .values({
              tenantId: tenant.id,
              code,
              projectId: p.id,
              origin: req.body.origin,
              destination: req.body.destination,
              incoterm: req.body.incoterm,
              cartons: req.body.packing.cartonCount,
              cbm: m.cbm,
              grossWeightKg: m.grossWeightKg,
              cargoType: req.body.cargoType,
              battery: req.body.battery,
              dangerousGoods: req.body.dangerousGoods,
              readyDate: req.body.readyDate ?? null,
              modes: req.body.modes,
              packing: { ...req.body.packing, metrics: m },
              createdBy: user.id,
            })
            .returning();
          const fwds = await tx
            .select({ id: users.id })
            .from(users)
            .innerJoin(userRoles, eq(userRoles.userId, users.id))
            .where(
              and(inArray(users.id, req.body.forwarderUserIds), eq(userRoles.role, 'FORWARDER_PARTNER')),
            );
          for (const f of fwds) {
            const [t] = await tx
              .insert(partnerTasks)
              .values({
                tenantId: tenant.id,
                partnerUserId: f.id,
                kind: 'FREIGHT_QUOTE',
                entityType: 'freight_rfq',
                entityId: rfq!.id,
                projectId: p.id,
                title: `[${p.code}] 운임 견적 요청 ${req.body.origin}→${req.body.destination} · ${m.cbm}CBM`,
                createdBy: user.id,
              })
              .returning();
            await notifyUsers(tx, tenant.id, [f.id], {
              kind: 'PARTNER_TASK',
              title: `운임 견적 요청 ${code}`,
              link: `/partner/tasks/${t!.id}`,
              dedupeKey: `rfq:${rfq!.id}:${f.id}`,
            });
          }
          await audit(tx, req, {
            action: 'freight.rfq.created',
            entityType: 'freight_rfq',
            entityId: rfq!.id,
            after: { code, forwarders: fwds.length, cbm: m.cbm },
          });
          reply.status(201);
          return { id: rfq!.id, code, metrics: m, sentTo: fwds.length };
        }),
      );
    },
  );

  app.get(
    '/projects/:id/freight',
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      requirePerm(req, 'freight.read');
      return db(req, async (tx) => {
        const rfqs = await tx
          .select()
          .from(freightRfqs)
          .where(eq(freightRfqs.projectId, req.params.id))
          .orderBy(desc(freightRfqs.createdAt));
        const quotes = await tx
          .select()
          .from(freightQuotes)
          .where(eq(freightQuotes.projectId, req.params.id))
          .orderBy(desc(freightQuotes.createdAt));
        const est = quotes.find((q) => q.kind === 'ESTIMATED');
        const ver = quotes.find((q) => q.kind === 'PARTNER_VERIFIED');
        const act = quotes.find((q) => q.kind === 'ACTUAL');
        return {
          rfqs,
          quotes,
          comparison: {
            estimated: est?.totalBase ?? null,
            partnerVerified: ver?.totalBase ?? null,
            actual: act?.totalBase ?? null,
            errorEstimatedVsActualPct:
              est?.totalBase && act?.totalBase ? errorRatePct(est.totalBase, act.totalBase) : null,
            errorVerifiedVsActualPct:
              ver?.totalBase && act?.totalBase ? errorRatePct(ver.totalBase, act.totalBase) : null,
          },
        };
      });
    },
  );

  /** Forwarder (partner) submits a quote for an RFQ assigned to them. */
  const quoteBody = z.object({
    mode: z.enum(FREIGHT_MODES),
    currency: z.string().length(3),
    freight: money,
    originCharges: money.default('0'),
    destinationCharges: money.default('0'),
    customsCharges: money.default('0'),
    deliveryCharges: money.default('0'),
    transitDays: z.string().max(20).default(''),
    validUntil: z.string().optional(),
    note: z.string().max(2000).default(''),
  });

  app.post(
    '/freight-rfqs/:id/quotes',
    { schema: { params: z.object({ id: z.string().uuid() }), body: quoteBody } },
    async (req, reply) => {
      const tenant = tenantOf(req);
      const user = userOf(req);
      return idempotent(req, reply, `rfq.quote:${req.params.id}:${user.id}`, () =>
        db(req, async (tx) => {
          const [rfq] = await tx.select().from(freightRfqs).where(eq(freightRfqs.id, req.params.id)).limit(1);
          if (!rfq) throw notFound();
          let task: typeof partnerTasks.$inferSelect | null = null;
          if (user.audience === 'PARTNER')
            task = await assertPartnerTask(tx, user.id, rfq.id, 'FREIGHT_QUOTE');
          else requirePerm(req, 'freight.write');
          const b = req.body;
          const total = [
            b.freight,
            b.originCharges,
            b.destinationCharges,
            b.customsCharges,
            b.deliveryCharges,
          ]
            .reduce((a, v) => a.add(v), new D(0))
            .toFixed(2);
          const { table } = await loadFxTable(tx, tenant.id);
          let totalBase: string | null = null;
          try {
            totalBase = table.convert(total, b.currency, 'KRW').toFixed(0);
          } catch {
            totalBase = null;
          }
          const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, user.id)).limit(1);
          const [q] = await tx
            .insert(freightQuotes)
            .values({
              tenantId: tenant.id,
              rfqId: rfq.id,
              projectId: rfq.projectId,
              kind: 'PARTNER_VERIFIED',
              source: 'FORWARDER_VERIFIED',
              partnerUserId: user.audience === 'PARTNER' ? user.id : null,
              providerName: u?.name ?? '',
              ...b,
              total,
              totalBase,
              confirmedAt: new Date(),
            })
            .returning();
          await tx
            .update(freightRfqs)
            .set({ status: 'QUOTED', updatedAt: new Date() })
            .where(eq(freightRfqs.id, rfq.id));
          if (task)
            await tx
              .update(partnerTasks)
              .set({ status: 'SUBMITTED', submittedAt: new Date(), updatedAt: new Date() })
              .where(eq(partnerTasks.id, task.id));
          // Also store as a lane rate so future estimates use forwarder-verified data.
          const m = (rfq.packing as { metrics?: { cbm: string } }).metrics;
          if (m && Number(m.cbm) > 0 && ['LCL'].includes(b.mode)) {
            await tx.insert(freightRates).values({
              tenantId: tenant.id,
              mode: b.mode,
              origin: rfq.origin,
              destination: rfq.destination,
              source: 'FORWARDER_VERIFIED',
              verification: 'PARTNER_VERIFIED',
              providerName: u?.name ?? '',
              currency: b.currency,
              basis: 'PER_RT',
              rate: new D(b.freight).div(D.max(1, m.cbm)).toFixed(2),
              fixedCharges: [
                { name: 'origin', amount: b.originCharges },
                { name: 'destination', amount: b.destinationCharges },
              ],
              validUntil: b.validUntil ?? null,
              note: `RFQ ${rfq.code}`,
            });
          }
          await audit(tx, req, {
            action: 'freight.quote.submitted',
            entityType: 'freight_quote',
            entityId: q!.id,
            after: { rfq: rfq.code, total, currency: b.currency },
          });
          reply.status(201);
          return q;
        }),
      );
    },
  );

  /** Actual freight cost (after invoice). Stored separately; error rates computed vs estimate/verified. */
  app.post(
    '/projects/:id/freight-actuals',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: quoteBody.extend({ providerName: z.string().max(120).default('') }),
      },
    },
    async (req, reply) => {
      const tenant = tenantOf(req);
      requirePerm(req, 'freight.write');
      return db(req, async (tx) => {
        const b = req.body;
        const total = [b.freight, b.originCharges, b.destinationCharges, b.customsCharges, b.deliveryCharges]
          .reduce((a, v) => a.add(v), new D(0))
          .toFixed(2);
        const { table } = await loadFxTable(tx, tenant.id);
        let totalBase: string | null = null;
        try {
          totalBase = table.convert(total, b.currency, 'KRW').toFixed(0);
        } catch {
          totalBase = null;
        }
        const [q] = await tx
          .insert(freightQuotes)
          .values({
            tenantId: tenant.id,
            projectId: req.params.id,
            kind: 'ACTUAL',
            source: 'HISTORICAL_ACTUAL',
            ...b,
            total,
            totalBase,
            confirmedAt: new Date(),
          })
          .returning();
        const [est] = await tx
          .select()
          .from(freightQuotes)
          .where(
            and(
              eq(freightQuotes.projectId, req.params.id),
              inArray(freightQuotes.kind, ['ESTIMATED', 'PARTNER_VERIFIED']),
            ),
          )
          .orderBy(desc(freightQuotes.createdAt))
          .limit(1);
        if (est?.totalBase && totalBase)
          await tx.insert(modelPredictions).values({
            tenantId: tenant.id,
            kind: 'FREIGHT',
            entityType: 'project',
            entityId: req.params.id,
            predicted: { totalBase: est.totalBase, kind: est.kind },
            actualValue: { totalBase },
            actualAt: new Date(),
          });
        await audit(tx, req, {
          action: 'freight.actual.recorded',
          entityType: 'freight_quote',
          entityId: q!.id,
          after: { total, currency: b.currency },
        });
        reply.status(201);
        return q;
      });
    },
  );

  app.post(
    '/freight-rfqs/:id/award',
    {
      schema: { params: z.object({ id: z.string().uuid() }), body: z.object({ quoteId: z.string().uuid() }) },
    },
    async (req) => {
      requirePerm(req, 'freight.write');
      return db(req, async (tx) => {
        await tx
          .update(freightRfqs)
          .set({ status: 'AWARDED', awardedQuoteId: req.body.quoteId, updatedAt: new Date() })
          .where(eq(freightRfqs.id, req.params.id));
        await audit(tx, req, {
          action: 'freight.rfq.awarded',
          entityType: 'freight_rfq',
          entityId: req.params.id,
          after: req.body,
        });
        return { ok: true };
      });
    },
  );
}

/** Products, active quotations and open orders affected by a regulation. */
export async function regulationImpact(tx: Tx, regulationId: string) {
  const checks = await tx
    .select()
    .from(complianceChecks)
    .where(eq(complianceChecks.regulationId, regulationId));
  const productIds = [...new Set(checks.map((c) => c.productId))];
  const prods = productIds.length
    ? await tx
        .select({ id: products.id, projectId: products.projectId, nameKo: products.nameKo })
        .from(products)
        .where(inArray(products.id, productIds))
    : [];
  const projectIds = [...new Set(prods.map((p) => p.projectId).filter((x): x is string => !!x))];
  const activeQuotes = projectIds.length
    ? await tx
        .select({ id: quotations.id, number: quotations.number, status: quotations.status })
        .from(quotations)
        .where(
          and(
            inArray(quotations.projectId, projectIds),
            inArray(quotations.status, ['DRAFT', 'ADMIN_REVIEW', 'SENT', 'CUSTOMER_APPROVED']),
          ),
        )
    : [];
  const openOrders = projectIds.length
    ? await tx
        .select({ id: sourcingProjects.id, code: sourcingProjects.code, stage: sourcingProjects.stage })
        .from(sourcingProjects)
        .where(
          and(
            inArray(sourcingProjects.id, projectIds),
            inArray(sourcingProjects.stage, [
              'CONTRACT',
              'PRODUCTION',
              'INSPECTION',
              'READY_TO_SHIP',
              'SHIPPED',
              'ARRIVED',
              'CUSTOMS',
            ]),
          ),
        )
    : [];
  return {
    productIds,
    summary: {
      affectedProducts: prods.length,
      activeQuotations: activeQuotes.length,
      openOrders: openOrders.length,
      products: prods.slice(0, 50),
      quotations: activeQuotes.slice(0, 50),
      orders: openOrders.slice(0, 50),
    },
  };
}
