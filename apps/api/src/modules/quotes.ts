import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { canTransition, D, markupAndMargin, moneyString, QUOTATION_TRANSITIONS, type QuotationStatus } from '@sos/core';
import type { Tx } from '../db/client.js';
import {
  approvals,
  companies,
  documents,
  pricingSnapshots,
  productImages,
  quotationItems,
  quotations,
  quotationVersions,
  requestCandidates,
  sourceListings,
  sourcingProjects,
} from '../db/schema/index.js';
import { AppError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { db, isStaff, requireFeature, requirePerm, tenantOf, userOf } from '../http/context.js';
import type { App } from '../http/types.js';
import { audit } from '../services/audit.js';
import { documentContext, issueDocument } from '../services/documents.js';
import { fileBuffer } from '../services/files.js';
import { loadFxTable } from '../services/fx.js';
import { idempotent } from '../services/idempotency.js';
import { notifyEvent } from '../services/notify.js';
import { publishedMarginSet } from '../services/pricing.js';
import { getPublished, nextNumber } from '../services/settings.js';
import { completeStep, ensureWorkflow } from '../services/workflow.js';
import { consumeFor } from '../services/usage.js';

const itemSchema = z.object({
  candidateId: z.string().uuid().optional(),
  pricingSnapshotId: z.string().uuid().optional(),
  name: z.string().min(1).max(300),
  specification: z.string().max(2000).default(''),
  quantity: z.number().int().positive(),
  unit: z.string().max(10).default('EA'),
  unitPrice: z.string().regex(/^\d+(\.\d+)?$/).optional(),
});

const versionBodySchema = z.object({
  items: z.array(itemSchema).min(1).max(50),
  contactName: z.string().max(80).default(''),
  contactEmail: z.string().max(200).default(''),
  leadTime: z.string().max(200).default(''),
  paymentTerms: z.string().max(500).optional(),
  notes: z.string().max(3000).default(''),
  customerCaution: z.string().max(3000).default(''),
  terms: z.string().max(5000).optional(),
  shippingTotal: z.string().regex(/^\d+(\.\d+)?$/).default('0'),
  otherCharges: z.string().regex(/^\d+(\.\d+)?$/).default('0'),
});
type VersionBody = z.infer<typeof versionBodySchema>;

/** Resolves each item's unit price: explicit > admin final price > calculated price. Stores internal cost for the profit preview. */
async function buildItems(tx: Tx, tenantId: string, versionId: string, body: VersionBody) {
  const pricing = await getPublished(tx, tenantId, 'pricing');
  let subtotal = new D(0);
  let costTotal = new D(0);
  let costKnown = true;
  let pos = 0;
  for (const it of body.items) {
    let snap: typeof pricingSnapshots.$inferSelect | undefined;
    if (it.pricingSnapshotId) [snap] = await tx.select().from(pricingSnapshots).where(eq(pricingSnapshots.id, it.pricingSnapshotId)).limit(1);
    else if (it.candidateId) [snap] = await tx.select().from(pricingSnapshots).where(eq(pricingSnapshots.candidateId, it.candidateId)).orderBy(desc(pricingSnapshots.createdAt)).limit(1);
    const unitPrice = it.unitPrice ?? snap?.adminFinalPrice ?? snap?.calculatedCustomerPrice ?? null;
    if (!unitPrice) throw badRequest(`"${it.name}"의 단가가 없습니다. 원가 계산 후 가격을 정하거나 단가를 입력하세요.`);
    const amount = new D(unitPrice).mul(it.quantity);
    subtotal = subtotal.add(amount);
    const unitCost = snap?.estimatedLandedCost ? new D(snap.estimatedLandedCost).div(snap.quantity) : null;
    if (unitCost) costTotal = costTotal.add(unitCost.mul(it.quantity));
    else costKnown = false;
    let imageFileId: string | null = null;
    let productId: string | null = null;
    if (it.candidateId) {
      const [c] = await tx.select().from(requestCandidates).where(eq(requestCandidates.id, it.candidateId)).limit(1);
      const [l] = c ? await tx.select().from(sourceListings).where(eq(sourceListings.id, c.listingId)).limit(1) : [];
      imageFileId = l?.imageFileIds[0] ?? null;
      if (c) {
        const [pi] = await tx.select({ fileId: productImages.fileId, productId: productImages.productId }).from(productImages).where(eq(productImages.requestId, c.requestId)).limit(1);
        imageFileId ??= pi?.fileId ?? null;
        productId = pi?.productId ?? null;
      }
    }
    const pr = snap?.priceResult as { components?: Array<{ component: string; priceBase: string }> } | undefined;
    // A breakdown is only meaningful when the quoted price equals the calculated one;
    // for admin-set or manual prices it would not add up, so it is omitted.
    const priceIsCalculated = !!snap?.calculatedCustomerPrice && new D(unitPrice).eq(snap.calculatedCustomerPrice) && !it.unitPrice;
    const breakdown =
      pricing.mode === 'BREAKDOWN' && priceIsCalculated && pr?.components
        ? pr.components
            .map((c) => ({ key: c.component, label: ({ PRODUCT: '제품비', FREIGHT: '국제운송', DOMESTIC_DELIVERY: '국내운송', SERVICE: '서비스', INSPECTION: '서비스', TAX: '관세·세금', PASS_THROUGH: '기타' } as Record<string, string>)[c.component] ?? c.component, amount: new D(c.priceBase).div(snap!.quantity).toFixed(0) }))
            .filter((c) => pricing.visibleLines.includes(({ PRODUCT: 'PRODUCT', FREIGHT: 'INTERNATIONAL_FREIGHT', DOMESTIC_DELIVERY: 'DOMESTIC_DELIVERY', SERVICE: 'SERVICE', INSPECTION: 'SERVICE', TAX: 'DUTY_TAX' } as Record<string, string>)[c.key] as never))
            .map(({ label, amount }) => ({ label: `${label} (개당)`, amount }))
        : [];
    await tx.insert(quotationItems).values({
      tenantId,
      quotationVersionId: versionId,
      position: pos++,
      productId,
      candidateId: it.candidateId ?? null,
      pricingSnapshotId: snap?.id ?? null,
      imageFileId,
      name: it.name,
      specification: it.specification,
      quantity: it.quantity,
      unit: it.unit,
      unitPrice: moneyString(unitPrice, pricing.baseCurrency),
      amount: moneyString(amount, pricing.baseCurrency),
      visibleBreakdown: breakdown,
      priceBadge: snap?.adminFinalPrice ? 'FINAL' : 'ESTIMATED',
      internalCost: unitCost ? unitCost.toFixed(2) : null,
      internalMeta: { snapshotId: snap?.id ?? null, calculated: snap?.calculatedCustomerPrice ?? null, adminFinal: snap?.adminFinalPrice ?? null },
    });
  }
  const shipping = new D(body.shippingTotal);
  const other = new D(body.otherCharges);
  const supply = subtotal.add(shipping).add(other);
  const vat = supply.mul(new D(pricing.vatPct).div(100));
  const cur = pricing.baseCurrency;
  const total = supply.add(vat);
  const mm = costKnown ? markupAndMargin(costTotal, supply) : null;
  return {
    subtotal: moneyString(subtotal, cur),
    shippingTotal: moneyString(shipping, cur),
    otherCharges: moneyString(other, cur),
    vat: moneyString(vat, cur),
    total: moneyString(total, cur),
    internal: {
      customerTotalExVat: supply.toFixed(0),
      estimatedCost: costKnown ? costTotal.toFixed(0) : null,
      expectedProfit: mm ? mm.profit.toFixed(0) : null,
      markupPct: mm?.markupPct?.toFixed(2) ?? null,
      marginPct: mm?.marginPct?.toFixed(2) ?? null,
      costComplete: costKnown,
    },
  };
}

async function loadQuote(tx: Tx, id: string) {
  const [q] = await tx.select().from(quotations).where(eq(quotations.id, id)).limit(1);
  if (!q) throw notFound('견적을 찾을 수 없습니다.');
  return q;
}

async function customerCanSee(tx: Tx, req: Parameters<typeof userOf>[0], projectId: string) {
  const u = userOf(req);
  if (isStaff(req)) return true;
  if (u.audience !== 'CUSTOMER' || !u.companyId) throw forbidden();
  const [p] = await tx.select({ companyId: sourcingProjects.companyId }).from(sourcingProjects).where(eq(sourcingProjects.id, projectId)).limit(1);
  if (p?.companyId !== u.companyId) throw notFound();
  return true;
}

export function quoteView(q: typeof quotations.$inferSelect, v: typeof quotationVersions.$inferSelect, items: Array<typeof quotationItems.$inferSelect>, staff: boolean) {
  const base = {
    id: q.id,
    number: q.number,
    projectId: q.projectId,
    status: q.status,
    version: v.version,
    versionId: v.id,
    versionStatus: v.status,
    issueDate: v.issueDate,
    validUntil: v.validUntil,
    currency: v.currency,
    subtotal: v.subtotal,
    shippingTotal: v.shippingTotal,
    otherCharges: v.otherCharges,
    vat: v.vat,
    total: v.total,
    leadTime: v.leadTime,
    paymentTerms: v.paymentTerms,
    notes: v.notes,
    customerCaution: v.customerCaution,
    terms: v.terms,
    contactName: v.contactName,
    contactEmail: v.contactEmail,
    documentId: v.documentId,
    sentAt: v.sentAt,
    items: items.map((i) => ({ id: i.id, position: i.position, name: i.name, specification: i.specification, quantity: i.quantity, unit: i.unit, unitPrice: i.unitPrice, amount: i.amount, visibleBreakdown: i.visibleBreakdown, priceBadge: i.priceBadge, candidateId: staff ? i.candidateId : undefined })),
  };
  if (!staff) return base;
  return { ...base, internalSummary: v.internalSummary, itemsInternal: items.map((i) => ({ id: i.id, internalCost: i.internalCost, internalMeta: i.internalMeta, pricingSnapshotId: i.pricingSnapshotId })) };
}

export async function quoteRoutes(app: App) {
  app.post('/projects/:id/quotations', { schema: { params: z.object({ id: z.string().uuid() }), body: versionBodySchema } }, async (req, reply) => {
    const tenant = tenantOf(req);
    requireFeature(req, 'QUOTATION');
    const user = requirePerm(req, 'quote.write');
    await consumeFor(req, 'quotes');
    const out = await db(req, async (tx) => {
      const [p] = await tx.select().from(sourcingProjects).where(eq(sourcingProjects.id, req.params.id)).limit(1);
      if (!p) throw notFound();
      const pricing = await getPublished(tx, tenant.id, 'pricing');
      const number = await nextNumber(tx, tenant.id, 'QUOTATION');
      const [q] = await tx.insert(quotations).values({ tenantId: tenant.id, number, projectId: p.id, companyId: p.companyId, createdBy: user.id }).returning();
      const [v] = await tx
        .insert(quotationVersions)
        .values({ tenantId: tenant.id, quotationId: q!.id, version: 1, currency: pricing.baseCurrency, contactName: req.body.contactName, contactEmail: req.body.contactEmail, leadTime: req.body.leadTime, paymentTerms: req.body.paymentTerms ?? pricing.defaultPaymentTerms, notes: req.body.notes, customerCaution: req.body.customerCaution, terms: req.body.terms ?? '', createdBy: user.id })
        .returning();
      const totals = await buildItems(tx, tenant.id, v!.id, req.body);
      await tx.update(quotationVersions).set({ ...totals, internalSummary: totals.internal }).where(eq(quotationVersions.id, v!.id));
      await tx.update(quotations).set({ currentVersionId: v!.id }).where(eq(quotations.id, q!.id));
      await audit(tx, req, { action: 'quote.created', entityType: 'quotation', entityId: q!.id, after: { number, total: totals.total } });
      return { id: q!.id, number, versionId: v!.id };
    });
    reply.status(201);
    return out;
  });

  app.put('/quotations/:id/draft', { schema: { params: z.object({ id: z.string().uuid() }), body: versionBodySchema } }, async (req) => {
    const tenant = tenantOf(req);
    requirePerm(req, 'quote.write');
    return db(req, async (tx) => {
      const q = await loadQuote(tx, req.params.id);
      const [v] = await tx.select().from(quotationVersions).where(eq(quotationVersions.id, q.currentVersionId!)).limit(1);
      if (!v || v.sentAt || !['DRAFT', 'ADMIN_REVIEW'].includes(v.status)) throw new AppError(409, 'IMMUTABLE', '발행된 견적은 수정할 수 없습니다. 새 버전을 만드세요.');
      await tx.delete(quotationItems).where(eq(quotationItems.quotationVersionId, v.id));
      const totals = await buildItems(tx, tenant.id, v.id, req.body);
      await tx
        .update(quotationVersions)
        .set({ ...totals, internalSummary: totals.internal, contactName: req.body.contactName, contactEmail: req.body.contactEmail, leadTime: req.body.leadTime, paymentTerms: req.body.paymentTerms ?? v.paymentTerms, notes: req.body.notes, customerCaution: req.body.customerCaution, terms: req.body.terms ?? v.terms, updatedAt: new Date() })
        .where(eq(quotationVersions.id, v.id));
      await audit(tx, req, { action: 'quote.draft.updated', entityType: 'quotation', entityId: q.id, before: { total: v.total }, after: { total: totals.total } });
      return { ok: true };
    });
  });

  /** New version (v+1) copied from the current one; the previous version stays untouched. */
  app.post('/quotations/:id/versions', { schema: { params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const tenant = tenantOf(req);
    const user = requirePerm(req, 'quote.write');
    return db(req, async (tx) => {
      const q = await loadQuote(tx, req.params.id);
      if (['ADMIN_FINAL_APPROVED', 'LOCKED'].includes(q.status)) throw new AppError(409, 'LOCKED', '최종 승인된 견적은 새 버전을 만들 수 없습니다.');
      const [cur] = await tx.select().from(quotationVersions).where(eq(quotationVersions.id, q.currentVersionId!)).limit(1);
      const items = await tx.select().from(quotationItems).where(eq(quotationItems.quotationVersionId, cur!.id));
      const [v] = await tx
        .insert(quotationVersions)
        .values({ tenantId: tenant.id, quotationId: q.id, version: q.currentVersion + 1, currency: cur!.currency, contactName: cur!.contactName, contactEmail: cur!.contactEmail, leadTime: cur!.leadTime, paymentTerms: cur!.paymentTerms, notes: cur!.notes, customerCaution: cur!.customerCaution, terms: cur!.terms, subtotal: cur!.subtotal, shippingTotal: cur!.shippingTotal, otherCharges: cur!.otherCharges, vat: cur!.vat, total: cur!.total, internalSummary: cur!.internalSummary, createdBy: user.id })
        .returning();
      for (const i of items) {
        const { id: _id, quotationVersionId: _qv, ...rest } = i;
        await tx.insert(quotationItems).values({ ...rest, quotationVersionId: v!.id });
      }
      await tx.update(quotations).set({ currentVersionId: v!.id, currentVersion: v!.version, status: 'DRAFT', updatedAt: new Date() }).where(eq(quotations.id, q.id));
      await audit(tx, req, { action: 'quote.version.created', entityType: 'quotation', entityId: q.id, after: { version: v!.version } });
      return { versionId: v!.id, version: v!.version };
    });
  });

  app.post('/quotations/:id/review', { schema: { params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    requirePerm(req, 'quote.write');
    return db(req, async (tx) => {
      const q = await loadQuote(tx, req.params.id);
      if (!canTransition(QUOTATION_TRANSITIONS, q.status as QuotationStatus, 'ADMIN_REVIEW', 'STAFF')) throw new AppError(409, 'INVALID_TRANSITION', '검토 요청할 수 없는 상태입니다.');
      await tx.update(quotations).set({ status: 'ADMIN_REVIEW', updatedAt: new Date() }).where(eq(quotations.id, q.id));
      await tx.update(quotationVersions).set({ status: 'ADMIN_REVIEW' }).where(eq(quotationVersions.id, q.currentVersionId!));
      await audit(tx, req, { action: 'quote.review_requested', entityType: 'quotation', entityId: q.id });
      return { ok: true };
    });
  });

  /** Issue: snapshot everything, render the PDF, lock the version, notify the customer. Idempotent. */
  app.post('/quotations/:id/issue', { schema: { params: z.object({ id: z.string().uuid() }), body: z.object({ validDays: z.number().int().min(1).max(180).optional() }).default({}) } }, async (req, reply) => {
    const tenant = tenantOf(req);
    const user = requirePerm(req, 'quote.write');
    return idempotent(req, reply, `quote.issue:${req.params.id}`, () =>
      db(req, async (tx) => {
        const q = await loadQuote(tx, req.params.id);
        if (!canTransition(QUOTATION_TRANSITIONS, q.status as QuotationStatus, 'SENT', 'STAFF')) throw new AppError(409, 'INVALID_TRANSITION', '발행할 수 없는 상태입니다.');
        const [v] = await tx.select().from(quotationVersions).where(eq(quotationVersions.id, q.currentVersionId!)).limit(1);
        const items = await tx.select().from(quotationItems).where(eq(quotationItems.quotationVersionId, v!.id)).orderBy(quotationItems.position);
        const [project] = await tx.select().from(sourcingProjects).where(eq(sourcingProjects.id, q.projectId)).limit(1);
        const [company] = project?.companyId ? await tx.select().from(companies).where(eq(companies.id, project.companyId)).limit(1) : [];
        const pricing = await getPublished(tx, tenant.id, 'pricing');
        const ctx = await documentContext(tx, tenant.id);
        const { rates: fx } = await loadFxTable(tx, tenant.id);
        const margin = await publishedMarginSet(tx, tenant.id);
        const issueDate = new Date().toISOString().slice(0, 10);
        const validUntil = new Date(Date.now() + (req.body.validDays ?? pricing.quoteValidityDays) * 86_400_000).toISOString().slice(0, 10);
        const snaps = items.map((i) => i.pricingSnapshotId).filter((x): x is string => !!x);
        const pricingRows = snaps.length ? await tx.select().from(pricingSnapshots).where(inArray(pricingSnapshots.id, snaps)) : [];
        const itemData = await Promise.all(
          items.map(async (i) => {
            let imageDataUri: string | null = null;
            if (i.imageFileId) {
              try {
                const f = await fileBuffer(tx, i.imageFileId);
                if (f.buffer.length < 3_000_000) imageDataUri = `data:${f.mime};base64,${f.buffer.toString('base64')}`;
              } catch {
                imageDataUri = null;
              }
            }
            return { ...i, imageDataUri, badgeLabel: pricing.showEstimatedBadge ? (i.priceBadge === 'FINAL' ? null : '예상가 포함') : null, badgeWarn: true };
          }),
        );
        const snapshot = {
          issuedAt: new Date().toISOString(),
          customer: company ? { id: company.id, name: company.name, businessNumber: company.businessNumber, address: company.address } : null,
          items: items.map((i) => ({ name: i.name, specification: i.specification, quantity: i.quantity, unitPrice: i.unitPrice, amount: i.amount, priceBadge: i.priceBadge })),
          totals: { subtotal: v!.subtotal, shippingTotal: v!.shippingTotal, otherCharges: v!.otherCharges, vat: v!.vat, total: v!.total, currency: v!.currency },
          pricingSnapshots: pricingRows.map((p) => ({ id: p.id, calculated: p.calculatedCustomerPrice, adminFinal: p.adminFinalPrice, estimatedLandedCost: p.estimatedLandedCost, marginRuleSetId: p.marginRuleSetId })),
          fx,
          marginRuleSet: { id: margin.id, version: margin.version },
          pricingSettings: pricing,
          terms: { paymentTerms: v!.paymentTerms, terms: v!.terms, validUntil, leadTime: v!.leadTime },
          company: ctx.company,
          brand: { siteName: ctx.brand.siteName, primaryColor: ctx.brand.primaryColor },
          banks: ctx.banks,
        };
        const { doc, templateVersionId } = await issueDocument(tx, {
          tenantId: tenant.id,
          kind: 'QUOTATION',
          number: q.number,
          version: v!.version,
          projectId: q.projectId,
          entityType: 'quotation_version',
          entityId: v!.id,
          userId: user.id,
          data: {
            title: '견적서',
            number: q.number,
            version: v!.version,
            issueDate,
            validUntil,
            demo: tenant.isDemo,
            customer: { name: company?.name ?? '고객' },
            contactName: v!.contactName,
            contactEmail: v!.contactEmail,
            projectCode: project?.code,
            items: itemData,
            currency: v!.currency,
            subtotal: v!.subtotal,
            shippingTotal: v!.shippingTotal,
            otherCharges: v!.otherCharges,
            showShipping: new D(v!.shippingTotal).gt(0),
            showOther: new D(v!.otherCharges).gt(0),
            vat: v!.vat,
            total: v!.total,
            leadTime: v!.leadTime,
            paymentTerms: v!.paymentTerms,
            notes: v!.notes,
            customerCaution: v!.customerCaution,
            terms: v!.terms,
          },
        });
        await tx
          .update(quotationVersions)
          .set({ status: 'SENT', issueDate, validUntil, snapshot: { ...snapshot, templateVersionId }, documentId: doc.id, sentAt: new Date(), lockedAt: new Date(), updatedAt: new Date() })
          .where(eq(quotationVersions.id, v!.id));
        await tx.update(quotations).set({ status: 'SENT', updatedAt: new Date() }).where(eq(quotations.id, q.id));
        await ensureWorkflow(tx, tenant.id, q.projectId);
        await completeStep(tx, tenant.id, q.projectId, 'QUOTE_ISSUED', user.id, `${q.number} v${v!.version}`);
        await notifyEvent(tx, tenant.id, 'QUOTE_ISSUED', q.projectId, { quoteNumber: q.number, total: `${v!.total} ${v!.currency}`, validUntil }, { dedupeKey: `quote:${v!.id}`, attachments: [{ fileId: doc.fileId, name: `${q.number}-v${v!.version}.pdf` }] });
        await audit(tx, req, { action: 'quote.issued', entityType: 'quotation', entityId: q.id, after: { version: v!.version, total: v!.total, documentSha256: doc.sha256 } });
        return { ok: true, documentId: doc.id, sha256: doc.sha256, validUntil };
      }),
    );
  });

  /** Customer decision (approve / reject) with full evidence: user, time, IP, UA, document hash, version. */
  app.post('/quotations/:id/customer-decision', { schema: { params: z.object({ id: z.string().uuid() }), body: z.object({ decision: z.enum(['APPROVE', 'REJECT']), comment: z.string().max(1000).default(''), versionId: z.string().uuid() }) } }, async (req, reply) => {
    const tenant = tenantOf(req);
    const user = userOf(req);
    if (user.audience !== 'CUSTOMER') throw forbidden('고객만 승인할 수 있습니다.');
    return idempotent(req, reply, `quote.customer:${req.params.id}`, () =>
      db(req, async (tx) => {
        const q = await loadQuote(tx, req.params.id);
        await customerCanSee(tx, req, q.projectId);
        if (q.currentVersionId !== req.body.versionId) throw new AppError(409, 'STALE_VERSION', '견적이 새 버전으로 변경되었습니다. 최신 견적을 확인해 주세요.');
        const [v] = await tx.select().from(quotationVersions).where(eq(quotationVersions.id, q.currentVersionId!)).limit(1);
        if (v!.validUntil && v!.validUntil < new Date().toISOString().slice(0, 10)) throw new AppError(409, 'EXPIRED', '견적 유효기한이 지났습니다. 담당자에게 재견적을 요청해 주세요.');
        const to = req.body.decision === 'APPROVE' ? 'CUSTOMER_APPROVED' : 'REJECTED';
        if (!canTransition(QUOTATION_TRANSITIONS, q.status as QuotationStatus, to, 'CUSTOMER')) throw new AppError(409, 'INVALID_TRANSITION', '이미 처리된 견적입니다.');
        const [doc] = v!.documentId ? await tx.select().from(documents).where(eq(documents.id, v!.documentId)).limit(1) : [];
        await tx.insert(approvals).values({ tenantId: tenant.id, entityType: 'QUOTATION', entityId: q.id, version: v!.version, action: to, actorId: user.id, actorRole: user.roles.join(','), ip: req.ip, userAgent: req.ctx.userAgent, documentHash: doc?.sha256 ?? null, comment: req.body.comment });
        await tx.update(quotations).set({ status: to, updatedAt: new Date() }).where(eq(quotations.id, q.id));
        await tx.update(quotationVersions).set({ status: to }).where(eq(quotationVersions.id, v!.id));
        if (to === 'CUSTOMER_APPROVED') {
          await completeStep(tx, tenant.id, q.projectId, 'CUSTOMER_APPROVAL', user.id);
          await notifyEvent(tx, tenant.id, 'QUOTE_APPROVED', q.projectId, { quoteNumber: q.number }, { dedupeKey: `quote-approved:${v!.id}`, skipCustomer: true });
        }
        await audit(tx, req, { action: `quote.customer.${req.body.decision.toLowerCase()}`, entityType: 'quotation', entityId: q.id, after: { version: v!.version, documentHash: doc?.sha256 ?? null, comment: req.body.comment } });
        return { ok: true, status: to };
      }),
    );
  });

  app.post('/quotations/:id/final-approve', { schema: { params: z.object({ id: z.string().uuid() }), body: z.object({ comment: z.string().max(1000).default('') }).default({}) } }, async (req, reply) => {
    const tenant = tenantOf(req);
    const user = requirePerm(req, 'quote.approve_final');
    return idempotent(req, reply, `quote.final:${req.params.id}`, () =>
      db(req, async (tx) => {
        const q = await loadQuote(tx, req.params.id);
        if (!canTransition(QUOTATION_TRANSITIONS, q.status as QuotationStatus, 'ADMIN_FINAL_APPROVED', 'STAFF')) throw new AppError(409, 'INVALID_TRANSITION', '고객 승인 후에 최종 승인할 수 있습니다.');
        const [v] = await tx.select().from(quotationVersions).where(eq(quotationVersions.id, q.currentVersionId!)).limit(1);
        const [doc] = v!.documentId ? await tx.select().from(documents).where(eq(documents.id, v!.documentId)).limit(1) : [];
        await tx.insert(approvals).values({ tenantId: tenant.id, entityType: 'QUOTATION', entityId: q.id, version: v!.version, action: 'ADMIN_FINAL_APPROVED', actorId: user.id, actorRole: user.roles.join(','), ip: req.ip, userAgent: req.ctx.userAgent, documentHash: doc?.sha256 ?? null, comment: req.body.comment });
        await tx.update(quotations).set({ status: 'LOCKED', updatedAt: new Date() }).where(eq(quotations.id, q.id));
        await tx.update(quotationVersions).set({ status: 'LOCKED' }).where(eq(quotationVersions.id, v!.id));
        // Record the agreed customer price on each pricing snapshot (actual_customer_price).
        const items = await tx.select().from(quotationItems).where(eq(quotationItems.quotationVersionId, v!.id));
        for (const i of items) if (i.pricingSnapshotId) await tx.update(pricingSnapshots).set({ actualCustomerPrice: i.unitPrice, updatedAt: new Date() }).where(eq(pricingSnapshots.id, i.pricingSnapshotId));
        await completeStep(tx, tenant.id, q.projectId, 'ADMIN_APPROVAL', user.id);
        await audit(tx, req, { action: 'quote.final_approved', entityType: 'quotation', entityId: q.id, after: { version: v!.version, documentHash: doc?.sha256 ?? null } });
        return { ok: true, status: 'LOCKED' };
      }),
    );
  });

  app.post('/quotations/:id/reject', { schema: { params: z.object({ id: z.string().uuid() }), body: z.object({ comment: z.string().max(1000).default('') }) } }, async (req) => {
    const tenant = tenantOf(req);
    const user = requirePerm(req, 'quote.approve_final');
    return db(req, async (tx) => {
      const q = await loadQuote(tx, req.params.id);
      if (!canTransition(QUOTATION_TRANSITIONS, q.status as QuotationStatus, 'REJECTED', 'STAFF')) throw new AppError(409, 'INVALID_TRANSITION', '반려할 수 없는 상태입니다.');
      await tx.insert(approvals).values({ tenantId: tenant.id, entityType: 'QUOTATION', entityId: q.id, version: q.currentVersion, action: 'REJECTED', actorId: user.id, actorRole: user.roles.join(','), ip: req.ip, userAgent: req.ctx.userAgent, comment: req.body.comment });
      await tx.update(quotations).set({ status: 'REJECTED', updatedAt: new Date() }).where(eq(quotations.id, q.id));
      await audit(tx, req, { action: 'quote.rejected', entityType: 'quotation', entityId: q.id, after: req.body });
      return { ok: true };
    });
  });

  app.get('/quotations', { schema: { querystring: z.object({ projectId: z.string().uuid().optional(), status: z.string().optional() }) } }, async (req) => {
    const u = userOf(req);
    return db(req, async (tx) => {
      const conds = [];
      if (req.query.projectId) conds.push(eq(quotations.projectId, req.query.projectId));
      if (req.query.status) conds.push(eq(quotations.status, req.query.status));
      if (u.audience === 'CUSTOMER') {
        if (!u.companyId) return { items: [] };
        conds.push(eq(quotations.companyId, u.companyId));
        conds.push(sql`${quotations.status} not in ('DRAFT','ADMIN_REVIEW')`);
      } else requirePerm(req, 'quote.read');
      const rows = await tx.select().from(quotations).where(conds.length ? and(...conds) : undefined).orderBy(desc(quotations.updatedAt)).limit(200);
      const vers = rows.length ? await tx.select().from(quotationVersions).where(inArray(quotationVersions.id, rows.map((r) => r.currentVersionId!).filter(Boolean))) : [];
      const projs = rows.length ? await tx.select({ id: sourcingProjects.id, code: sourcingProjects.code, title: sourcingProjects.title }).from(sourcingProjects).where(inArray(sourcingProjects.id, rows.map((r) => r.projectId))) : [];
      return {
        items: rows.map((r) => {
          const v = vers.find((x) => x.id === r.currentVersionId);
          const p = projs.find((x) => x.id === r.projectId);
          return { id: r.id, number: r.number, status: r.status, version: r.currentVersion, projectId: r.projectId, projectCode: p?.code, projectTitle: p?.title, total: v?.total, currency: v?.currency, validUntil: v?.validUntil, sentAt: v?.sentAt, updatedAt: r.updatedAt, ...(u.audience !== 'CUSTOMER' ? { internalSummary: v?.internalSummary } : {}) };
        }),
      };
    });
  });

  app.get('/quotations/:id', { schema: { params: z.object({ id: z.string().uuid() }), querystring: z.object({ version: z.coerce.number().int().optional() }) } }, async (req) => {
    const staff = isStaff(req);
    userOf(req);
    return db(req, async (tx) => {
      const q = await loadQuote(tx, req.params.id);
      await customerCanSee(tx, req, q.projectId);
      if (!staff && ['DRAFT', 'ADMIN_REVIEW'].includes(q.status) && q.currentVersion === 1) throw notFound();
      if (staff) requirePerm(req, 'quote.read');
      const all = await tx.select().from(quotationVersions).where(eq(quotationVersions.quotationId, q.id)).orderBy(desc(quotationVersions.version));
      const visible = staff ? all : all.filter((v) => v.sentAt);
      const v = req.query.version ? visible.find((x) => x.version === req.query.version) : visible[0];
      if (!v) throw notFound();
      const items = await tx.select().from(quotationItems).where(eq(quotationItems.quotationVersionId, v.id)).orderBy(quotationItems.position);
      const approvalsRows = await tx.select().from(approvals).where(and(eq(approvals.entityType, 'QUOTATION'), eq(approvals.entityId, q.id))).orderBy(desc(approvals.createdAt));
      const [project] = await tx.select({ code: sourcingProjects.code, title: sourcingProjects.title }).from(sourcingProjects).where(eq(sourcingProjects.id, q.projectId)).limit(1);
      return {
        ...quoteView(q, v, items, staff),
        project,
        versions: visible.map((x) => ({ version: x.version, status: x.status, sentAt: x.sentAt, total: x.total })),
        approvals: approvalsRows.map((a) => ({ action: a.action, version: a.version, at: a.createdAt, documentHash: a.documentHash, comment: a.comment, ...(staff ? { ip: a.ip, userAgent: a.userAgent, actorId: a.actorId } : {}) })),
        canApprove: !staff && q.status === 'SENT' && q.currentVersionId === v.id,
      };
    });
  });
}
