import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { PRODUCTION_STATUS_LABEL_KO, PROJECT_STAGE_LABEL_KO, type ProjectStage } from '@sos/core';
import type { Tx } from '../db/client.js';
import {
  auditLogs,
  companies,
  contracts,
  documents,
  emails,
  files,
  inspections,
  invoices,
  notificationPreferences,
  notifications,
  payments,
  productionOrders,
  purchaseOrders,
  quotations,
  quotationVersions,
  shipments,
  sourcingProjects,
  sourcingRequests,
} from '../db/schema/index.js';
import { verifyExpiring } from '../lib/crypto.js';
import { forbidden, notFound, unauthorized } from '../lib/errors.js';
import { db, isStaff, requirePerm, tenantOf, userOf } from '../http/context.js';
import { readForm } from '../http/multipart.js';
import type { App } from '../http/types.js';
import { withTenant } from '../db/client.js';
import { getFileRow, signedDownloadUrl, storeFile, type FilePurpose } from '../services/files.js';
import { storage } from '../services/storage.js';
import { unreadCount } from '../services/notify.js';
import { workflowView } from '../services/workflow.js';

const CUSTOMER_TIMELINE: ProjectStage[] = ['REQUESTED', 'SEARCHING', 'QUOTE_PREPARING', 'QUOTE_APPROVED', 'CONTRACT', 'PRODUCTION', 'INSPECTION', 'READY_TO_SHIP', 'SHIPPED', 'ARRIVED', 'CUSTOMS', 'DELIVERING', 'COMPLETED'];

async function projectFor(tx: Tx, req: Parameters<typeof userOf>[0], id: string) {
  const u = userOf(req);
  const [p] = await tx.select().from(sourcingProjects).where(eq(sourcingProjects.id, id)).limit(1);
  if (!p) throw notFound('프로젝트를 찾을 수 없습니다.');
  if (u.audience === 'CUSTOMER') {
    if (!u.companyId || p.companyId !== u.companyId) throw notFound('프로젝트를 찾을 수 없습니다.');
  } else if (u.audience === 'PARTNER') throw forbidden();
  else requirePerm(req, 'sourcing.read');
  return p;
}

/** Can the current user access this file? Tenant scoping is enforced by RLS; this adds audience rules. */
async function assertFileAccess(tx: Tx, req: Parameters<typeof userOf>[0], fileId: string) {
  const u = req.ctx.user;
  if (u && (u.audience === 'STAFF' || u.audience === 'PLATFORM')) return;
  const f = await getFileRow(tx, fileId);
  if (u && f.uploadedBy === u.id) return;
  if (u?.audience === 'CUSTOMER' && u.companyId) {
    const [d] = await tx.select({ projectId: documents.projectId, customerVisible: documents.customerVisible }).from(documents).where(eq(documents.fileId, fileId)).limit(1);
    if (d?.customerVisible && d.projectId) {
      const [p] = await tx.select({ companyId: sourcingProjects.companyId }).from(sourcingProjects).where(eq(sourcingProjects.id, d.projectId)).limit(1);
      if (p?.companyId === u.companyId) return;
    }
    const reqs = await tx.select({ imageFileIds: sourcingRequests.imageFileIds, projectId: sourcingRequests.projectId }).from(sourcingRequests).innerJoin(sourcingProjects, eq(sourcingProjects.id, sourcingRequests.projectId)).where(eq(sourcingProjects.companyId, u.companyId));
    if (reqs.some((r) => r.imageFileIds.includes(fileId))) return;
  }
  if (u?.audience === 'PARTNER') return; // partner access is limited to task payloads that embed signed URLs
  throw notFound('파일을 찾을 수 없습니다.');
}

export async function portalRoutes(app: App) {
  /** Project overview — the same endpoint serves staff (full) and customers (simplified, no internal data). */
  app.get('/projects/:id/overview', { schema: { params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const staff = isStaff(req);
    return db(req, async (tx) => {
      const p = await projectFor(tx, req, req.params.id);
      const [company] = p.companyId ? await tx.select().from(companies).where(eq(companies.id, p.companyId)).limit(1) : [];
      const reqs = await tx.select().from(sourcingRequests).where(eq(sourcingRequests.projectId, p.id)).orderBy(desc(sourcingRequests.createdAt));
      const qs = await tx.select().from(quotations).where(eq(quotations.projectId, p.id)).orderBy(desc(quotations.createdAt));
      const qv = qs.length ? await tx.select().from(quotationVersions).where(inArray(quotationVersions.id, qs.map((q) => q.currentVersionId!).filter(Boolean))) : [];
      const cs = await tx.select().from(contracts).where(eq(contracts.projectId, p.id)).orderBy(desc(contracts.createdAt));
      const invs = await tx.select().from(invoices).where(eq(invoices.projectId, p.id)).orderBy(desc(invoices.createdAt));
      const pays = await tx.select().from(payments).where(eq(payments.projectId, p.id)).orderBy(desc(payments.createdAt));
      const prods = await tx.select().from(productionOrders).where(eq(productionOrders.projectId, p.id));
      const insp = await tx.select().from(inspections).where(eq(inspections.projectId, p.id));
      const ships = await tx.select().from(shipments).where(eq(shipments.projectId, p.id));
      const docs = await tx.select().from(documents).where(and(eq(documents.projectId, p.id), staff ? undefined : eq(documents.customerVisible, true))).orderBy(desc(documents.createdAt));
      const wf = await workflowView(tx, p.id);
      const stageIdx = CUSTOMER_TIMELINE.indexOf(p.stage as ProjectStage);
      const timeline = CUSTOMER_TIMELINE.map((s, i) => ({ stage: s, label: PROJECT_STAGE_LABEL_KO[s], state: i < stageIdx || p.stage === 'COMPLETED' ? 'DONE' : i === stageIdx ? 'CURRENT' : 'PENDING', at: p.stageHistory.find((h) => h.stage === s)?.at ?? null }));
      const common = {
        id: p.id,
        code: p.code,
        title: p.title,
        stage: p.stage,
        stageLabel: PROJECT_STAGE_LABEL_KO[p.stage as ProjectStage],
        status: p.status,
        createdAt: p.createdAt,
        timeline,
        requests: reqs.map((r) => ({ id: r.id, status: r.status, createdAt: r.createdAt, query: r.query, quantity: r.quantity })),
        quotations: qs
          .filter((q) => staff || !['DRAFT', 'ADMIN_REVIEW'].includes(q.status) || q.currentVersion > 1)
          .map((q) => {
            const v = qv.find((x) => x.id === q.currentVersionId);
            return { id: q.id, number: q.number, status: q.status, version: q.currentVersion, total: v?.total, currency: v?.currency, validUntil: v?.validUntil, sentAt: v?.sentAt, ...(staff ? { internalSummary: v?.internalSummary } : {}) };
          }),
        contracts: cs.filter((c) => staff || c.status !== 'DRAFT').map((c) => ({ id: c.id, number: c.number, status: c.status, version: c.currentVersion, effectiveAt: c.effectiveAt, legalReviewRequired: staff ? c.legalReviewRequired && !c.legalReviewedAt : undefined })),
        invoices: invs.map((i) => ({ id: i.id, type: i.type, number: i.number, total: i.total, currency: i.currency, dueDate: i.dueDate, paymentStatus: i.paymentStatus, documentId: i.documentId, issuedAt: i.issuedAt })),
        payments: pays.filter((x) => staff || x.direction === 'INBOUND').map((x) => ({ id: x.id, direction: x.direction, kind: x.kind, amount: x.amount, currency: x.currency, dueDate: x.dueDate, status: x.status, paidAt: x.paidAt })),
        production: prods.map((x) => ({ id: x.id, status: x.status, statusLabel: PRODUCTION_STATUS_LABEL_KO[x.status as keyof typeof PRODUCTION_STATUS_LABEL_KO] ?? x.status, plannedStart: x.plannedStart, plannedEnd: x.plannedEnd, progressPct: x.progressPct, updates: x.updates.map((u) => ({ at: u.at, status: u.status, note: u.note })) })),
        inspections: insp.map((x) => ({ id: x.id, type: x.type, result: x.result, scheduledAt: x.scheduledAt, defectsCritical: x.defectsCritical, defectsMajor: x.defectsMajor, defectsMinor: x.defectsMinor, ...(staff ? { inspector: x.inspector, cost: x.cost, note: x.note } : {}) })),
        shipments: ships.map((s) => ({ id: s.id, code: s.code, mode: s.mode, status: s.status, originPort: s.originPort, destinationPort: s.destinationPort, etd: s.etd, eta: s.eta, atd: s.atd, ata: s.ata, customsStatus: s.customsStatus })),
        documents: docs.map((d) => ({ id: d.id, kind: d.kind, number: d.number, version: d.version, sha256: d.sha256, sizeBytes: d.sizeBytes, createdAt: d.createdAt })),
        workflow: wf,
      };
      if (!staff) return { ...common, audience: 'CUSTOMER' };
      const pos = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.projectId, p.id));
      const mails = await tx.select({ id: emails.id, trigger: emails.trigger, toAddress: emails.toAddress, subject: emails.subject, status: emails.status, error: emails.error, createdAt: emails.createdAt, sentAt: emails.sentAt }).from(emails).where(eq(emails.projectId, p.id)).orderBy(desc(emails.createdAt)).limit(50);
      const auditRows = await tx.select().from(auditLogs).where(or(eq(auditLogs.entityId, p.id), inArray(auditLogs.entityId, [...qs.map((q) => q.id), ...cs.map((c) => c.id), ...reqs.map((r) => r.id)]))).orderBy(desc(auditLogs.createdAt)).limit(100);
      return { ...common, audience: 'STAFF', company: company ?? null, attention: p.attention, purchaseOrders: pos, emails: mails, audit: auditRows };
    });
  });

  // ─────────────── Files ───────────────
  app.post('/files', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const tenant = tenantOf(req);
    const u = userOf(req);
    const { fields, files: parts } = await readForm(req);
    const purpose = (fields.purpose ?? 'ATTACHMENT') as FilePurpose;
    if (!['PRODUCT_IMAGE', 'DOCUMENT', 'BRAND_ASSET', 'ATTACHMENT', 'IMPORT'].includes(purpose)) throw forbidden('허용되지 않은 파일 용도입니다.');
    if (purpose === 'BRAND_ASSET') requirePerm(req, 'tenant.settings.write');
    if (u.audience === 'CUSTOMER' && purpose !== 'ATTACHMENT' && purpose !== 'DOCUMENT') throw forbidden();
    const f = parts[0];
    if (!f) throw notFound('파일이 없습니다.');
    const stored = await db(req, (tx) => storeFile(tx, { tenantId: tenant.id, buffer: f.buffer, originalName: f.filename, purpose, uploadedBy: u.id, isPublicAsset: purpose === 'BRAND_ASSET' }));
    reply.status(201);
    return stored;
  });

  app.get('/files/:id/url', { schema: { params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    tenantOf(req);
    if (!req.ctx.user) throw unauthorized();
    return db(req, async (tx) => {
      await assertFileAccess(tx, req, req.params.id);
      return { url: await signedDownloadUrl(tx, req.params.id, 300), expiresInSeconds: 300 };
    });
  });

  /** Local-storage signed download (HMAC, short-lived). S3 deployments use presigned URLs instead. */
  app.get('/files/:id/content', { schema: { params: z.object({ id: z.string().uuid() }), querystring: z.object({ exp: z.coerce.number(), sig: z.string(), inline: z.string().optional() }) } }, async (req, reply) => {
    const tenant = tenantOf(req);
    if (!verifyExpiring(`file:${req.params.id}`, req.query.exp, req.query.sig)) throw forbidden('다운로드 링크가 만료되었습니다.');
    const f = await withTenant({ tenantId: tenant.id }, async (tx) => (await tx.select().from(files).where(eq(files.id, req.params.id)).limit(1))[0]);
    if (!f) throw notFound();
    const buf = await storage.get(f.storageKey);
    reply.header('Cache-Control', 'private, max-age=60');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
    const inlineOk = f.mime.startsWith('image/') || f.mime === 'application/pdf';
    reply.header('Content-Disposition', `${inlineOk && req.query.inline ? 'inline' : inlineOk ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.originalName)}`);
    reply.type(f.mime);
    return reply.send(buf);
  });

  app.get('/documents/:id/url', { schema: { params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const u = userOf(req);
    return db(req, async (tx) => {
      const [d] = await tx.select().from(documents).where(eq(documents.id, req.params.id)).limit(1);
      if (!d) throw notFound();
      if (u.audience === 'CUSTOMER') {
        if (!d.customerVisible || !d.projectId) throw notFound();
        await projectFor(tx, req, d.projectId);
      } else if (u.audience === 'PARTNER') throw forbidden();
      else requirePerm(req, 'document.read');
      return { url: await signedDownloadUrl(tx, d.fileId, 300), sha256: d.sha256, number: d.number, version: d.version };
    });
  });

  // ─────────────── Notifications ───────────────
  app.get('/notifications', { schema: { querystring: z.object({ unread: z.coerce.boolean().optional() }) } }, async (req) => {
    const tenant = tenantOf(req);
    const u = userOf(req);
    return db(req, async (tx) => {
      const rows = await tx.select().from(notifications).where(and(eq(notifications.userId, u.id), req.query.unread ? isNull(notifications.readAt) : undefined)).orderBy(desc(notifications.createdAt)).limit(100);
      return { items: rows, unread: await unreadCount(tx, tenant.id, u.id) };
    });
  });
  app.post('/notifications/:id/read', { schema: { params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const u = userOf(req);
    return db(req, async (tx) => {
      await tx.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, req.params.id), eq(notifications.userId, u.id)));
      return { ok: true };
    });
  });
  app.post('/notifications/read-all', async (req) => {
    const u = userOf(req);
    return db(req, async (tx) => {
      await tx.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, u.id), isNull(notifications.readAt)));
      return { ok: true };
    });
  });
  app.get('/notifications/preferences', async (req) => {
    const u = userOf(req);
    return db(req, async (tx) => ({ items: await tx.select().from(notificationPreferences).where(eq(notificationPreferences.userId, u.id)) }));
  });
  app.put('/notifications/preferences', { schema: { body: z.object({ items: z.array(z.object({ kind: z.string().max(40), channels: z.array(z.enum(['WEB', 'EMAIL', 'SMS', 'KAKAO', 'PUSH'])) })).max(50) }) } }, async (req) => {
    const tenant = tenantOf(req);
    const u = userOf(req);
    return db(req, async (tx) => {
      for (const it of req.body.items) {
        await tx
          .insert(notificationPreferences)
          .values({ tenantId: tenant.id, userId: u.id, kind: it.kind, channels: it.channels })
          .onConflictDoUpdate({ target: [notificationPreferences.tenantId, notificationPreferences.userId, notificationPreferences.kind], set: { channels: it.channels, updatedAt: new Date() } });
      }
      return { ok: true };
    });
  });
}
