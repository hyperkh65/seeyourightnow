import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  canTransition,
  CONTRACT_TRANSITIONS,
  D,
  INSPECTION_RESULTS,
  moneyString,
  PAYMENT_STATUSES,
  PRODUCTION_STATUSES,
  type ContractStatus,
} from '@sos/core';
import type { Tx } from '../db/client.js';
import {
  approvals,
  companies,
  contracts,
  contractVersions,
  documents,
  inspections,
  invoices,
  payments,
  productionOrders,
  purchaseOrders,
  quotationItems,
  quotations,
  quotationVersions,
  sourcingProjects,
  supplierEvents,
  suppliers,
  users,
} from '../db/schema/index.js';
import { AppError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { db, isStaff, requireFeature, requirePerm, tenantOf, userOf } from '../http/context.js';
import type { App } from '../http/types.js';
import { audit } from '../services/audit.js';
import { issueDocument, publishedTemplate } from '../services/documents.js';
import { idempotent } from '../services/idempotency.js';
import { notifyEvent } from '../services/notify.js';
import { getPublished, nextNumber } from '../services/settings.js';
import { render } from '../services/templates/render.js';
import { completeStep } from '../services/workflow.js';

async function projectOr404(tx: Tx, id: string) {
  const [p] = await tx.select().from(sourcingProjects).where(eq(sourcingProjects.id, id)).limit(1);
  if (!p) throw notFound('프로젝트를 찾을 수 없습니다.');
  return p;
}

async function assertCustomerProject(tx: Tx, req: Parameters<typeof userOf>[0], projectId: string) {
  if (isStaff(req)) return;
  const u = userOf(req);
  const p = await projectOr404(tx, projectId);
  if (u.audience !== 'CUSTOMER' || !u.companyId || p.companyId !== u.companyId) throw notFound();
}

const clauseSchema = z.object({
  key: z.string().max(40),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(5000),
});

async function renderContractPdf(
  tx: Tx,
  tenantId: string,
  c: typeof contracts.$inferSelect,
  v: typeof contractVersions.$inferSelect,
  userId: string | null,
  isDemo: boolean,
) {
  const snap = v.snapshot as {
    items?: unknown[];
    total?: string;
    currency?: string;
    customer?: Record<string, string>;
  };
  const appr = await tx
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.entityType, 'CONTRACT'),
        eq(approvals.entityId, c.id),
        eq(approvals.version, v.version),
      ),
    );
  const nameOf = async (id: string) =>
    (await tx.select({ name: users.name }).from(users).where(eq(users.id, id)).limit(1))[0]?.name ?? '';
  const cust = appr.find((a) => a.action === 'CUSTOMER_APPROVED');
  const comp = appr.find((a) => a.action === 'COMPANY_APPROVED');
  return issueDocument(tx, {
    tenantId,
    kind: 'CONTRACT',
    number: c.number,
    projectId: c.projectId,
    entityType: 'contract_version',
    entityId: v.id,
    userId,
    data: {
      title: '제품 공급 계약서',
      number: c.number,
      version: v.version,
      issueDate: new Date().toISOString().slice(0, 10),
      demo: isDemo,
      legalReviewPending: c.legalReviewRequired && !c.legalReviewedAt,
      customer: snap.customer ?? {},
      items: snap.items ?? [],
      total: snap.total,
      currency: snap.currency,
      clauses: v.clauses,
      customerApproval: cust
        ? {
            name: await nameOf(cust.actorId),
            at: cust.createdAt.toISOString().slice(0, 16).replace('T', ' '),
          }
        : null,
      companyApproval: comp
        ? {
            name: await nameOf(comp.actorId),
            at: comp.createdAt.toISOString().slice(0, 16).replace('T', ' '),
          }
        : null,
    },
  });
}

export async function fulfillmentRoutes(app: App) {
  // ═════════════════════════ Contracts ═════════════════════════
  app.post(
    '/quotations/:id/contract',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z
          .object({
            incoterm: z.string().max(20).default('FOB'),
            acceptableDefectRate: z.string().max(40).default('AQL 2.5 기준'),
            claimDays: z.number().int().min(1).max(365).default(14),
            fxThresholdPct: z.number().min(0).max(50).default(5),
          })
          .default({}),
      },
    },
    async (req, reply) => {
      const tenant = tenantOf(req);
      requireFeature(req, 'CONTRACT');
      const user = requirePerm(req, 'contract.write');
      return idempotent(req, reply, `contract.create:${req.params.id}`, () =>
        db(req, async (tx) => {
          const [q] = await tx.select().from(quotations).where(eq(quotations.id, req.params.id)).limit(1);
          if (!q) throw notFound();
          if (!['LOCKED', 'ADMIN_FINAL_APPROVED'].includes(q.status))
            throw new AppError(409, 'NOT_APPROVED', '최종 승인된 견적으로만 계약서를 만들 수 있습니다.');
          const [existing] = await tx
            .select()
            .from(contracts)
            .where(and(eq(contracts.quotationId, q.id), eq(contracts.tenantId, tenant.id)))
            .limit(1);
          if (existing && existing.status !== 'CANCELLED')
            return { id: existing.id, number: existing.number };
          const [v] = await tx
            .select()
            .from(quotationVersions)
            .where(eq(quotationVersions.id, q.currentVersionId!))
            .limit(1);
          const items = await tx
            .select()
            .from(quotationItems)
            .where(eq(quotationItems.quotationVersionId, v!.id))
            .orderBy(quotationItems.position);
          const project = await projectOr404(tx, q.projectId);
          const [company] = project.companyId
            ? await tx.select().from(companies).where(eq(companies.id, project.companyId)).limit(1)
            : [];
          const { version: tpl } = await publishedTemplate(tx, tenant.id, 'CONTRACT');
          const vars = {
            paymentTerms: v!.paymentTerms,
            leadTime: v!.leadTime || '협의된 기간',
            incoterm: req.body.incoterm,
            acceptableDefectRate: req.body.acceptableDefectRate,
            claimDays: req.body.claimDays,
            fxThresholdPct: req.body.fxThresholdPct,
          };
          const clauses = tpl.defaultClauses.map((c) => ({ ...c, body: render(c.body, vars) }));
          const number = await nextNumber(tx, tenant.id, 'CONTRACT');
          const [c] = await tx
            .insert(contracts)
            .values({
              tenantId: tenant.id,
              number,
              projectId: q.projectId,
              quotationId: q.id,
              quotationVersionId: v!.id,
              companyId: project.companyId,
              legalReviewRequired: tpl.requiresLegalReview,
              createdBy: user.id,
            })
            .returning();
          const [cv] = await tx
            .insert(contractVersions)
            .values({
              tenantId: tenant.id,
              contractId: c!.id,
              version: 1,
              templateVersionId: tpl.id,
              clauses,
              snapshot: {
                quotation: { id: q.id, number: q.number, version: v!.version },
                items: items.map((i) => ({
                  name: i.name,
                  specification: i.specification,
                  quantity: i.quantity,
                  unitPrice: i.unitPrice,
                  amount: i.amount,
                })),
                total: v!.total,
                currency: v!.currency,
                customer: company
                  ? { name: company.name, address: company.address, businessNumber: company.businessNumber }
                  : { name: '고객' },
                vars,
              },
              createdBy: user.id,
            })
            .returning();
          await tx.update(contracts).set({ currentVersionId: cv!.id }).where(eq(contracts.id, c!.id));
          await audit(tx, req, {
            action: 'contract.created',
            entityType: 'contract',
            entityId: c!.id,
            after: { number, quotation: q.number },
          });
          reply.status(201);
          return { id: c!.id, number };
        }),
      );
    },
  );

  /** Edits create a new immutable contract version (DRAFT only). */
  app.put(
    '/contracts/:id/clauses',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ clauses: z.array(clauseSchema).min(1).max(60) }),
      },
    },
    async (req) => {
      const tenant = tenantOf(req);
      const user = requirePerm(req, 'contract.write');
      return db(req, async (tx) => {
        const [c] = await tx.select().from(contracts).where(eq(contracts.id, req.params.id)).limit(1);
        if (!c) throw notFound();
        if (c.status !== 'DRAFT')
          throw new AppError(409, 'IMMUTABLE', '초안 상태에서만 조항을 수정할 수 있습니다.');
        const [cur] = await tx
          .select()
          .from(contractVersions)
          .where(eq(contractVersions.id, c.currentVersionId!))
          .limit(1);
        const [nv] = await tx
          .insert(contractVersions)
          .values({
            tenantId: tenant.id,
            contractId: c.id,
            version: c.currentVersion + 1,
            templateVersionId: cur!.templateVersionId,
            clauses: req.body.clauses,
            snapshot: cur!.snapshot,
            createdBy: user.id,
          })
          .returning();
        await tx
          .update(contracts)
          .set({ currentVersion: nv!.version, currentVersionId: nv!.id, updatedAt: new Date() })
          .where(eq(contracts.id, c.id));
        await audit(tx, req, {
          action: 'contract.clauses.updated',
          entityType: 'contract',
          entityId: c.id,
          after: { version: nv!.version },
        });
        return { version: nv!.version };
      });
    },
  );

  app.post(
    '/contracts/:id/legal-review',
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      const user = requirePerm(req, 'contract.approve_company');
      return db(req, async (tx) => {
        await tx
          .update(contracts)
          .set({ legalReviewedAt: new Date(), legalReviewedBy: user.id })
          .where(eq(contracts.id, req.params.id));
        await audit(tx, req, {
          action: 'contract.legal_reviewed',
          entityType: 'contract',
          entityId: req.params.id,
        });
        return { ok: true };
      });
    },
  );

  app.post(
    '/contracts/:id/send',
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req, reply) => {
      const tenant = tenantOf(req);
      const user = requirePerm(req, 'contract.write');
      return idempotent(req, reply, `contract.send:${req.params.id}`, () =>
        db(req, async (tx) => {
          const [c] = await tx.select().from(contracts).where(eq(contracts.id, req.params.id)).limit(1);
          if (!c) throw notFound();
          if (!canTransition(CONTRACT_TRANSITIONS, c.status as ContractStatus, 'CUSTOMER_REVIEW', 'STAFF'))
            throw new AppError(409, 'INVALID_TRANSITION', '보낼 수 없는 상태입니다.');
          const [v] = await tx
            .select()
            .from(contractVersions)
            .where(eq(contractVersions.id, c.currentVersionId!))
            .limit(1);
          const { doc } = await renderContractPdf(tx, tenant.id, c, v!, user.id, tenant.isDemo);
          await tx
            .update(contracts)
            .set({ status: 'CUSTOMER_REVIEW', updatedAt: new Date() })
            .where(eq(contracts.id, c.id));
          await notifyEvent(
            tx,
            tenant.id,
            'CONTRACT_READY',
            c.projectId,
            { contractNumber: c.number },
            {
              dedupeKey: `contract-ready:${c.id}:${v!.version}`,
              attachments: [{ fileId: doc.fileId, name: `${c.number}.pdf` }],
            },
          );
          await audit(tx, req, {
            action: 'contract.sent',
            entityType: 'contract',
            entityId: c.id,
            after: { version: v!.version, sha256: doc.sha256 },
          });
          return { ok: true, documentId: doc.id };
        }),
      );
    },
  );

  app.post(
    '/contracts/:id/customer-approve',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ agree: z.literal(true), version: z.number().int() }),
      },
    },
    async (req, reply) => {
      const tenant = tenantOf(req);
      const user = userOf(req);
      if (user.audience !== 'CUSTOMER') throw forbidden();
      return idempotent(req, reply, `contract.customer:${req.params.id}`, () =>
        db(req, async (tx) => {
          const [c] = await tx.select().from(contracts).where(eq(contracts.id, req.params.id)).limit(1);
          if (!c) throw notFound();
          await assertCustomerProject(tx, req, c.projectId);
          if (c.currentVersion !== req.body.version)
            throw new AppError(409, 'STALE_VERSION', '계약서가 변경되었습니다. 최신 내용을 확인해 주세요.');
          if (
            !canTransition(CONTRACT_TRANSITIONS, c.status as ContractStatus, 'CUSTOMER_APPROVED', 'CUSTOMER')
          )
            throw new AppError(409, 'INVALID_TRANSITION', '이미 처리된 계약입니다.');
          const [doc] = await tx
            .select()
            .from(documents)
            .where(and(eq(documents.kind, 'CONTRACT'), eq(documents.number, c.number)))
            .orderBy(desc(documents.version))
            .limit(1);
          await tx.insert(approvals).values({
            tenantId: tenant.id,
            entityType: 'CONTRACT',
            entityId: c.id,
            version: c.currentVersion,
            action: 'CUSTOMER_APPROVED',
            actorId: user.id,
            actorRole: user.roles.join(','),
            ip: req.ip,
            userAgent: req.ctx.userAgent,
            documentHash: doc?.sha256 ?? null,
          });
          await tx
            .update(contracts)
            .set({ status: 'CUSTOMER_APPROVED', updatedAt: new Date() })
            .where(eq(contracts.id, c.id));
          await audit(tx, req, {
            action: 'contract.customer_approved',
            entityType: 'contract',
            entityId: c.id,
            after: { version: c.currentVersion, documentHash: doc?.sha256 ?? null },
          });
          return { ok: true };
        }),
      );
    },
  );

  app.post(
    '/contracts/:id/company-approve',
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req, reply) => {
      const tenant = tenantOf(req);
      const user = requirePerm(req, 'contract.approve_company');
      return idempotent(req, reply, `contract.company:${req.params.id}`, () =>
        db(req, async (tx) => {
          const [c] = await tx.select().from(contracts).where(eq(contracts.id, req.params.id)).limit(1);
          if (!c) throw notFound();
          if (!canTransition(CONTRACT_TRANSITIONS, c.status as ContractStatus, 'COMPANY_APPROVED', 'STAFF'))
            throw new AppError(409, 'INVALID_TRANSITION', '고객 승인 후 회사 승인할 수 있습니다.');
          if (c.legalReviewRequired && !c.legalReviewedAt)
            throw new AppError(409, 'LEGAL_REVIEW_REQUIRED', '법률 검토 완료 표시 후 승인할 수 있습니다.');
          const [prevDoc] = await tx
            .select()
            .from(documents)
            .where(and(eq(documents.kind, 'CONTRACT'), eq(documents.number, c.number)))
            .orderBy(desc(documents.version))
            .limit(1);
          await tx.insert(approvals).values({
            tenantId: tenant.id,
            entityType: 'CONTRACT',
            entityId: c.id,
            version: c.currentVersion,
            action: 'COMPANY_APPROVED',
            actorId: user.id,
            actorRole: user.roles.join(','),
            ip: req.ip,
            userAgent: req.ctx.userAgent,
            documentHash: prevDoc?.sha256 ?? null,
          });
          const [v] = await tx
            .select()
            .from(contractVersions)
            .where(eq(contractVersions.id, c.currentVersionId!))
            .limit(1);
          // Final executed copy with both electronic approvals printed.
          const { doc } = await renderContractPdf(tx, tenant.id, c, v!, user.id, tenant.isDemo);
          await tx
            .update(contracts)
            .set({ status: 'EFFECTIVE', effectiveAt: new Date(), updatedAt: new Date() })
            .where(eq(contracts.id, c.id));
          await completeStep(tx, tenant.id, c.projectId, 'CONTRACT', user.id, c.number);
          await notifyEvent(
            tx,
            tenant.id,
            'CONTRACT_COMPLETED',
            c.projectId,
            { contractNumber: c.number },
            {
              dedupeKey: `contract-done:${c.id}`,
              attachments: [{ fileId: doc.fileId, name: `${c.number}-signed.pdf` }],
            },
          );
          await audit(tx, req, {
            action: 'contract.effective',
            entityType: 'contract',
            entityId: c.id,
            after: { sha256: doc.sha256 },
          });
          return { ok: true, status: 'EFFECTIVE', documentId: doc.id };
        }),
      );
    },
  );

  app.post(
    '/contracts/:id/cancel',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ reason: z.string().min(2).max(500) }),
      },
    },
    async (req) => {
      requirePerm(req, 'contract.approve_company');
      return db(req, async (tx) => {
        const [c] = await tx.select().from(contracts).where(eq(contracts.id, req.params.id)).limit(1);
        if (!c) throw notFound();
        if (!canTransition(CONTRACT_TRANSITIONS, c.status as ContractStatus, 'CANCELLED', 'STAFF'))
          throw new AppError(409, 'INVALID_TRANSITION', '취소할 수 없는 상태입니다.');
        await tx
          .update(contracts)
          .set({ status: 'CANCELLED', updatedAt: new Date() })
          .where(eq(contracts.id, c.id));
        await audit(tx, req, {
          action: 'contract.cancelled',
          entityType: 'contract',
          entityId: c.id,
          before: { status: c.status },
          after: req.body,
        });
        return { ok: true };
      });
    },
  );

  app.get('/contracts/:id', { schema: { params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    userOf(req);
    return db(req, async (tx) => {
      const [c] = await tx.select().from(contracts).where(eq(contracts.id, req.params.id)).limit(1);
      if (!c) throw notFound();
      await assertCustomerProject(tx, req, c.projectId);
      if (!isStaff(req) && c.status === 'DRAFT') throw notFound();
      const [v] = await tx
        .select()
        .from(contractVersions)
        .where(eq(contractVersions.id, c.currentVersionId!))
        .limit(1);
      const appr = await tx
        .select()
        .from(approvals)
        .where(and(eq(approvals.entityType, 'CONTRACT'), eq(approvals.entityId, c.id)));
      const docs = await tx
        .select()
        .from(documents)
        .where(and(eq(documents.kind, 'CONTRACT'), eq(documents.number, c.number)))
        .orderBy(desc(documents.version));
      return {
        ...c,
        clauses: v?.clauses ?? [],
        snapshot: v?.snapshot ?? {},
        approvals: appr.map((a) => ({
          action: a.action,
          version: a.version,
          at: a.createdAt,
          documentHash: a.documentHash,
        })),
        documents: docs.map((d) => ({
          id: d.id,
          version: d.version,
          sha256: d.sha256,
          createdAt: d.createdAt,
        })),
        canApprove: !isStaff(req) && c.status === 'CUSTOMER_REVIEW',
      };
    });
  });

  // ═════════════════════════ Invoices & payments ═════════════════════════
  const lineSchema = z.object({
    name: z.string().min(1).max(300),
    spec: z.string().max(1000).optional(),
    quantity: z.number().int().positive(),
    unit: z.string().max(10).optional(),
    unitPrice: z.string().regex(/^\d+(\.\d+)?$/),
    cartons: z.number().int().optional(),
    grossWeightKg: z.string().optional(),
    cbm: z.string().optional(),
  });

  app.post(
    '/projects/:id/invoices',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          type: z.enum([
            'PROFORMA_INVOICE',
            'COMMERCIAL_INVOICE',
            'PACKING_LIST',
            'SALES_INVOICE',
            'RECEIPT',
            'SHIPPING_NOTICE',
            'DELIVERY_NOTE',
          ]),
          lines: z.array(lineSchema).max(100).optional(),
          depositPct: z.number().min(0).max(100).optional(),
          dueDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          notes: z.string().max(3000).default(''),
          incoterm: z.string().max(20).optional(),
          includeVat: z.boolean().default(true),
        }),
      },
    },
    async (req, reply) => {
      const tenant = tenantOf(req);
      requireFeature(req, 'INVOICE');
      const user = requirePerm(req, 'invoice.write');
      return idempotent(req, reply, `invoice.create:${req.params.id}:${req.body.type}`, () =>
        db(req, async (tx) => {
          const project = await projectOr404(tx, req.params.id);
          const pricing = await getPublished(tx, tenant.id, 'pricing');
          const [contract] = await tx
            .select()
            .from(contracts)
            .where(and(eq(contracts.projectId, project.id), eq(contracts.status, 'EFFECTIVE')))
            .orderBy(desc(contracts.createdAt))
            .limit(1);
          let lines = req.body.lines;
          if (!lines) {
            const [q] = await tx
              .select()
              .from(quotations)
              .where(
                and(
                  eq(quotations.projectId, project.id),
                  inArray(quotations.status, ['LOCKED', 'ADMIN_FINAL_APPROVED']),
                ),
              )
              .orderBy(desc(quotations.updatedAt))
              .limit(1);
            if (!q) throw badRequest('확정된 견적이 없어 품목을 직접 입력해야 합니다.');
            const items = await tx
              .select()
              .from(quotationItems)
              .where(eq(quotationItems.quotationVersionId, q.currentVersionId!))
              .orderBy(quotationItems.position);
            lines = items.map((i) => ({
              name: i.name,
              spec: i.specification,
              quantity: i.quantity,
              unit: i.unit,
              unitPrice: i.unitPrice,
            }));
          }
          const factor = req.body.depositPct !== undefined ? new D(req.body.depositPct).div(100) : new D(1);
          const computed = lines.map((l) => ({
            ...l,
            amount: moneyString(new D(l.unitPrice).mul(l.quantity).mul(factor), pricing.baseCurrency),
          }));
          const subtotal = computed.reduce((a, l) => a.add(l.amount), new D(0));
          const vat =
            req.body.includeVat && ['PROFORMA_INVOICE', 'SALES_INVOICE', 'RECEIPT'].includes(req.body.type)
              ? subtotal.mul(new D(pricing.vatPct).div(100))
              : new D(0);
          const total = subtotal.add(vat);
          const number = await nextNumber(tx, tenant.id, req.body.type);
          const [company] = project.companyId
            ? await tx.select().from(companies).where(eq(companies.id, project.companyId)).limit(1)
            : [];
          const titleMap: Record<string, string> = {
            PROFORMA_INVOICE: 'Proforma Invoice',
            COMMERCIAL_INVOICE: 'Commercial Invoice',
            PACKING_LIST: 'Packing List',
            SALES_INVOICE: '거래명세서',
            RECEIPT: '영수증',
            SHIPPING_NOTICE: '선적 통지',
            DELIVERY_NOTE: '납품서',
          };
          const [inv] = await tx
            .insert(invoices)
            .values({
              tenantId: tenant.id,
              type: req.body.type,
              number,
              projectId: project.id,
              contractId: contract?.id ?? null,
              companyId: project.companyId,
              currency: pricing.baseCurrency,
              subtotal: moneyString(subtotal, pricing.baseCurrency),
              vat: moneyString(vat, pricing.baseCurrency),
              total: moneyString(total, pricing.baseCurrency),
              dueDate: req.body.dueDate ?? null,
              lines: computed,
              snapshot: { depositPct: req.body.depositPct ?? null, notes: req.body.notes },
              issuedAt: new Date(),
              createdBy: user.id,
            })
            .returning();
          const { doc } = await issueDocument(tx, {
            tenantId: tenant.id,
            kind: req.body.type,
            number,
            projectId: project.id,
            entityType: 'invoice',
            entityId: inv!.id,
            userId: user.id,
            data: {
              title: titleMap[req.body.type],
              number,
              issueDate: new Date().toISOString().slice(0, 10),
              demo: tenant.isDemo,
              party: { name: company?.name ?? '고객', address: company?.address ?? '' },
              projectCode: project.code,
              contractNumber: contract?.number,
              dueDate: req.body.dueDate,
              incoterm: req.body.incoterm,
              lines: computed,
              currency: pricing.baseCurrency,
              subtotal: inv!.subtotal,
              vat: new D(inv!.vat).gt(0) ? inv!.vat : null,
              total: inv!.total,
              notes:
                req.body.depositPct !== undefined
                  ? `계약금 ${req.body.depositPct}% 청구${req.body.notes ? `\n${req.body.notes}` : ''}`
                  : req.body.notes,
              packing: req.body.type === 'PACKING_LIST' || req.body.type === 'COMMERCIAL_INVOICE',
              packingOnly: req.body.type === 'PACKING_LIST',
            },
          });
          await tx.update(invoices).set({ documentId: doc.id }).where(eq(invoices.id, inv!.id));
          if (['PROFORMA_INVOICE', 'SALES_INVOICE'].includes(req.body.type)) {
            await tx.insert(payments).values({
              tenantId: tenant.id,
              projectId: project.id,
              invoiceId: inv!.id,
              direction: 'INBOUND',
              kind: req.body.depositPct !== undefined && req.body.depositPct < 100 ? 'DEPOSIT' : 'FULL',
              amount: inv!.total,
              currency: inv!.currency,
              dueDate: req.body.dueDate ?? null,
              createdBy: user.id,
            });
          }
          if (req.body.type === 'PROFORMA_INVOICE')
            await notifyEvent(
              tx,
              tenant.id,
              'PI_ISSUED',
              project.id,
              {
                invoiceNumber: number,
                total: `${inv!.total} ${inv!.currency}`,
                dueDate: req.body.dueDate ?? '-',
              },
              { dedupeKey: `pi:${inv!.id}`, attachments: [{ fileId: doc.fileId, name: `${number}.pdf` }] },
            );
          await audit(tx, req, {
            action: 'invoice.issued',
            entityType: 'invoice',
            entityId: inv!.id,
            after: { type: req.body.type, number, total: inv!.total, sha256: doc.sha256 },
          });
          reply.status(201);
          return { id: inv!.id, number, documentId: doc.id, total: inv!.total };
        }),
      );
    },
  );

  app.post(
    '/projects/:id/payments',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          direction: z.enum(['INBOUND', 'OUTBOUND']),
          kind: z.enum(['DEPOSIT', 'BALANCE', 'FULL', 'FREIGHT', 'DUTY', 'OTHER']),
          amount: z.string().regex(/^\d+(\.\d+)?$/),
          currency: z.string().length(3),
          dueDate: z.string().optional(),
          invoiceId: z.string().uuid().optional(),
          note: z.string().max(500).default(''),
        }),
      },
    },
    async (req, reply) => {
      const tenant = tenantOf(req);
      const user = requirePerm(req, 'payment.write');
      return db(req, async (tx) => {
        await projectOr404(tx, req.params.id);
        const [p] = await tx
          .insert(payments)
          .values({ tenantId: tenant.id, projectId: req.params.id, ...req.body, createdBy: user.id })
          .returning();
        await audit(tx, req, {
          action: 'payment.created',
          entityType: 'payment',
          entityId: p!.id,
          after: req.body,
        });
        reply.status(201);
        return p;
      });
    },
  );

  app.patch(
    '/payments/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          status: z.enum(PAYMENT_STATUSES),
          paidAt: z.string().optional(),
          reference: z.string().max(120).optional(),
          note: z.string().max(500).optional(),
        }),
      },
    },
    async (req, reply) => {
      const tenant = tenantOf(req);
      const user = requirePerm(req, 'payment.write');
      return idempotent(req, reply, `payment.update:${req.params.id}:${req.body.status}`, () =>
        db(req, async (tx) => {
          const [p] = await tx.select().from(payments).where(eq(payments.id, req.params.id)).limit(1);
          if (!p) throw notFound();
          await tx
            .update(payments)
            .set({
              status: req.body.status,
              paidAt: req.body.status === 'PAID' ? new Date(req.body.paidAt ?? Date.now()) : p.paidAt,
              reference: req.body.reference ?? p.reference,
              note: req.body.note ?? p.note,
              updatedAt: new Date(),
            })
            .where(eq(payments.id, p.id));
          if (p.invoiceId)
            await tx
              .update(invoices)
              .set({ paymentStatus: req.body.status, updatedAt: new Date() })
              .where(eq(invoices.id, p.invoiceId));
          if (req.body.status === 'PAID' && p.status !== 'PAID' && p.direction === 'INBOUND') {
            await notifyEvent(
              tx,
              tenant.id,
              'PAYMENT_RECEIVED',
              p.projectId,
              { amount: `${p.amount} ${p.currency}` },
              { dedupeKey: `paid:${p.id}` },
            );
            if (p.kind === 'DEPOSIT' || p.kind === 'FULL')
              await completeStep(tx, tenant.id, p.projectId, 'DEPOSIT', user.id);
          }
          await audit(tx, req, {
            action: 'payment.updated',
            entityType: 'payment',
            entityId: p.id,
            before: { status: p.status },
            after: req.body,
          });
          return { ok: true };
        }),
      );
    },
  );

  // ═════════════════════════ Purchase order / production / inspection ═════════════════════════
  app.post(
    '/projects/:id/purchase-orders',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          supplierId: z.string().uuid(),
          currency: z.string().length(3),
          lines: z
            .array(
              z.object({
                name: z.string().min(1),
                quantity: z.number().int().positive(),
                unitPrice: z.string().regex(/^\d+(\.\d+)?$/),
              }),
            )
            .min(1),
          notes: z.string().max(2000).default(''),
        }),
      },
    },
    async (req, reply) => {
      const tenant = tenantOf(req);
      const user = requirePerm(req, 'order.write');
      return idempotent(req, reply, `po.create:${req.params.id}`, () =>
        db(req, async (tx) => {
          const project = await projectOr404(tx, req.params.id);
          const [s] = await tx.select().from(suppliers).where(eq(suppliers.id, req.body.supplierId)).limit(1);
          if (!s) throw notFound('공급자를 찾을 수 없습니다.');
          const lines = req.body.lines.map((l) => ({
            ...l,
            amount: new D(l.unitPrice).mul(l.quantity).toFixed(2),
          }));
          const total = lines.reduce((a, l) => a.add(l.amount), new D(0)).toFixed(2);
          const number = await nextNumber(tx, tenant.id, 'PURCHASE_ORDER');
          const [po] = await tx
            .insert(purchaseOrders)
            .values({
              tenantId: tenant.id,
              number,
              projectId: project.id,
              supplierId: s.id,
              currency: req.body.currency,
              total,
              lines,
              createdBy: user.id,
            })
            .returning();
          const { doc } = await issueDocument(tx, {
            tenantId: tenant.id,
            kind: 'PURCHASE_ORDER',
            number,
            projectId: project.id,
            entityType: 'purchase_order',
            entityId: po!.id,
            userId: user.id,
            customerVisible: false,
            data: {
              title: 'Purchase Order',
              number,
              issueDate: new Date().toISOString().slice(0, 10),
              demo: tenant.isDemo,
              isPurchaseOrder: true,
              party: { name: s.nameLocal || s.name, address: s.address },
              projectCode: project.code,
              lines,
              currency: req.body.currency,
              subtotal: total,
              total,
              notes: req.body.notes,
            },
          });
          await tx.update(purchaseOrders).set({ documentId: doc.id }).where(eq(purchaseOrders.id, po!.id));
          await tx.insert(productionOrders).values({
            tenantId: tenant.id,
            projectId: project.id,
            purchaseOrderId: po!.id,
            status: 'NOT_STARTED',
          });
          await tx.insert(supplierEvents).values({
            tenantId: tenant.id,
            supplierId: s.id,
            kind: 'ORDER',
            projectId: project.id,
            amount: total,
            currency: req.body.currency,
            note: number,
            createdBy: user.id,
          });
          await completeStep(tx, tenant.id, project.id, 'PURCHASE_ORDER', user.id, number);
          await audit(tx, req, {
            action: 'po.issued',
            entityType: 'purchase_order',
            entityId: po!.id,
            after: { number, total, supplier: s.id },
          });
          reply.status(201);
          return { id: po!.id, number, documentId: doc.id };
        }),
      );
    },
  );

  app.patch(
    '/production-orders/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          status: z.enum(PRODUCTION_STATUSES).optional(),
          plannedStart: z.string().optional(),
          plannedEnd: z.string().optional(),
          progressPct: z.number().int().min(0).max(100).optional(),
          delayReason: z.string().max(500).optional(),
          note: z.string().max(1000).default(''),
          photoFileIds: z.array(z.string().uuid()).max(10).default([]),
        }),
      },
    },
    async (req) => {
      const tenant = tenantOf(req);
      const user = requirePerm(req, 'order.write');
      return db(req, async (tx) => {
        const [po] = await tx
          .select()
          .from(productionOrders)
          .where(eq(productionOrders.id, req.params.id))
          .limit(1);
        if (!po) throw notFound();
        const b = req.body;
        const status = b.status ?? po.status;
        const updates = [
          ...po.updates,
          {
            at: new Date().toISOString(),
            status,
            note: b.note || b.delayReason || '',
            by: user.id,
            photoFileIds: b.photoFileIds,
          },
        ];
        await tx
          .update(productionOrders)
          .set({
            status,
            plannedStart: b.plannedStart ?? po.plannedStart,
            plannedEnd: b.plannedEnd ?? po.plannedEnd,
            progressPct: b.progressPct ?? (status === 'COMPLETED' ? 100 : po.progressPct),
            delayReason: b.delayReason ?? po.delayReason,
            actualStart:
              status === 'IN_PRODUCTION' && !po.actualStart
                ? new Date().toISOString().slice(0, 10)
                : po.actualStart,
            actualEnd: status === 'COMPLETED' ? new Date().toISOString().slice(0, 10) : po.actualEnd,
            updates,
            updatedAt: new Date(),
          })
          .where(eq(productionOrders.id, po.id));
        const project = await projectOr404(tx, po.projectId);
        if (status === 'IN_PRODUCTION' && po.status !== 'IN_PRODUCTION')
          await notifyEvent(
            tx,
            tenant.id,
            'PRODUCTION_STARTED',
            project.id,
            { plannedEnd: b.plannedEnd ?? po.plannedEnd ?? '-' },
            { dedupeKey: `prod-start:${po.id}` },
          );
        if (status === 'DELAYED' || (b.plannedEnd && po.plannedEnd && b.plannedEnd > po.plannedEnd)) {
          await notifyEvent(
            tx,
            tenant.id,
            'PRODUCTION_DELAY',
            project.id,
            { reason: b.delayReason ?? '일정 조정', plannedEnd: b.plannedEnd ?? po.plannedEnd ?? '-' },
            { dedupeKey: `prod-delay:${po.id}:${b.plannedEnd ?? Date.now()}` },
          );
          await tx
            .update(sourcingProjects)
            .set({
              attention: [
                ...project.attention.filter((a) => a.kind !== 'PRODUCTION_DELAY'),
                {
                  kind: 'PRODUCTION_DELAY',
                  message: b.delayReason ?? '생산 지연',
                  since: new Date().toISOString(),
                },
              ],
            })
            .where(eq(sourcingProjects.id, project.id));
        }
        if (status === 'COMPLETED') {
          await completeStep(tx, tenant.id, project.id, 'PRODUCTION', user.id);
          await tx
            .update(sourcingProjects)
            .set({ attention: project.attention.filter((a) => a.kind !== 'PRODUCTION_DELAY') })
            .where(eq(sourcingProjects.id, project.id));
        }
        await audit(tx, req, {
          action: 'production.updated',
          entityType: 'production_order',
          entityId: po.id,
          before: { status: po.status, plannedEnd: po.plannedEnd },
          after: b,
        });
        return { ok: true };
      });
    },
  );

  app.post(
    '/projects/:id/inspections',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          type: z
            .enum(['PRE_PRODUCTION', 'DURING_PRODUCTION', 'PRE_SHIPMENT', 'LOADING'])
            .default('PRE_SHIPMENT'),
          inspector: z.string().max(120).default(''),
          scheduledAt: z.string().optional(),
          aqlLevel: z.string().max(40).default(''),
          cost: z
            .string()
            .regex(/^\d+(\.\d+)?$/)
            .optional(),
          costCurrency: z.string().length(3).optional(),
        }),
      },
    },
    async (req, reply) => {
      const tenant = tenantOf(req);
      requirePerm(req, 'order.write');
      return db(req, async (tx) => {
        await projectOr404(tx, req.params.id);
        const [i] = await tx
          .insert(inspections)
          .values({ tenantId: tenant.id, projectId: req.params.id, ...req.body })
          .returning();
        await audit(tx, req, {
          action: 'inspection.created',
          entityType: 'inspection',
          entityId: i!.id,
          after: req.body,
        });
        reply.status(201);
        return i;
      });
    },
  );

  app.patch(
    '/inspections/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          result: z.enum(INSPECTION_RESULTS),
          sampleSize: z.number().int().optional(),
          defectsCritical: z.number().int().min(0).default(0),
          defectsMajor: z.number().int().min(0).default(0),
          defectsMinor: z.number().int().min(0).default(0),
          reportFileId: z.string().uuid().optional(),
          photoFileIds: z.array(z.string().uuid()).default([]),
          note: z.string().max(2000).default(''),
        }),
      },
    },
    async (req) => {
      const tenant = tenantOf(req);
      const user = requirePerm(req, 'order.write');
      return db(req, async (tx) => {
        const [i] = await tx.select().from(inspections).where(eq(inspections.id, req.params.id)).limit(1);
        if (!i) throw notFound();
        await tx
          .update(inspections)
          .set({ ...req.body, updatedAt: new Date() })
          .where(eq(inspections.id, i.id));
        if (req.body.result !== 'PENDING') {
          const label = {
            PASSED: '합격',
            PASSED_WITH_REMARKS: '조건부 합격',
            FAILED: '불합격',
            WAIVED: '면제',
            PENDING: '대기',
          }[req.body.result];
          await notifyEvent(
            tx,
            tenant.id,
            'INSPECTION_COMPLETED',
            i.projectId,
            { result: label },
            { dedupeKey: `inspection:${i.id}:${req.body.result}` },
          );
          if (['PASSED', 'PASSED_WITH_REMARKS', 'WAIVED'].includes(req.body.result))
            await completeStep(tx, tenant.id, i.projectId, 'INSPECTION', user.id, label);
          if (req.body.result === 'FAILED') {
            const [po] = await tx
              .select()
              .from(purchaseOrders)
              .where(eq(purchaseOrders.projectId, i.projectId))
              .limit(1);
            if (po?.supplierId)
              await tx.insert(supplierEvents).values({
                tenantId: tenant.id,
                supplierId: po.supplierId,
                kind: 'QUALITY_ISSUE',
                projectId: i.projectId,
                note: `검품 불합격: ${req.body.note}`,
                createdBy: user.id,
              });
          }
        }
        await audit(tx, req, {
          action: 'inspection.result',
          entityType: 'inspection',
          entityId: i.id,
          before: { result: i.result },
          after: req.body,
        });
        return { ok: true };
      });
    },
  );
}
