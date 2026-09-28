import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  complianceChecks,
  freightQuotes,
  freightRfqs,
  hsClassifications,
  partnerTasks,
  productImages,
  products,
  regulations,
  regulationVersions,
  sourcingProjects,
} from '../db/schema/index.js';
import { forbidden, notFound } from '../lib/errors.js';
import { db, requirePerm, userOf } from '../http/context.js';
import type { App } from '../http/types.js';
import { audit } from '../services/audit.js';
import { effectiveAttributes } from '../services/compliance.js';
import { signedDownloadUrl } from '../services/files.js';

/**
 * Partner portal: customs brokers, labs, forwarders see only the tasks assigned
 * to them and only the data needed to do that task ("수정할 것만").
 * Customer identity, internal cost and margins are never included.
 */
export async function partnerRoutes(app: App) {
  app.get(
    '/partner/tasks',
    {
      schema: {
        querystring: z.object({
          status: z.enum(['OPEN', 'IN_PROGRESS', 'SUBMITTED', 'CANCELLED']).optional(),
        }),
      },
    },
    async (req) => {
      const u = userOf(req);
      requirePerm(req, 'partner.tasks');
      return db(req, async (tx) => {
        const rows = await tx
          .select()
          .from(partnerTasks)
          .where(
            and(
              eq(partnerTasks.partnerUserId, u.id),
              req.query.status ? eq(partnerTasks.status, req.query.status) : undefined,
            ),
          )
          .orderBy(desc(partnerTasks.createdAt))
          .limit(200);
        return {
          items: rows.map((t) => ({
            id: t.id,
            kind: t.kind,
            title: t.title,
            status: t.status,
            dueAt: t.dueAt,
            createdAt: t.createdAt,
            submittedAt: t.submittedAt,
          })),
        };
      });
    },
  );

  app.get('/partner/tasks/:id', { schema: { params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const u = userOf(req);
    requirePerm(req, 'partner.tasks');
    return db(req, async (tx) => {
      const [t] = await tx.select().from(partnerTasks).where(eq(partnerTasks.id, req.params.id)).limit(1);
      if (!t || t.partnerUserId !== u.id) throw notFound('배정된 작업이 아닙니다.');
      const [proj] = t.projectId
        ? await tx
            .select({ code: sourcingProjects.code })
            .from(sourcingProjects)
            .where(eq(sourcingProjects.id, t.projectId))
            .limit(1)
        : [];
      const base = {
        id: t.id,
        kind: t.kind,
        title: t.title,
        status: t.status,
        dueAt: t.dueAt,
        projectCode: proj?.code ?? null,
      };

      const productPayload = async (productId: string) => {
        const [p] = await tx.select().from(products).where(eq(products.id, productId)).limit(1);
        if (!p) return null;
        const imgs = await tx.select().from(productImages).where(eq(productImages.productId, p.id)).limit(5);
        return {
          id: p.id,
          nameKo: p.nameKo,
          nameEn: p.nameEn,
          category: p.category,
          attributes: effectiveAttributes(p),
          aiConfidence: p.confidence,
          images: await Promise.all(imgs.map((i) => signedDownloadUrl(tx, i.fileId, 1800).catch(() => null))),
          ocrText: imgs[0]?.ocrText ?? null,
        };
      };

      if (t.kind === 'COMPLIANCE_REVIEW') {
        const [c] = await tx
          .select()
          .from(complianceChecks)
          .where(eq(complianceChecks.id, t.entityId))
          .limit(1);
        if (!c) throw notFound();
        const [reg] = await tx.select().from(regulations).where(eq(regulations.id, c.regulationId)).limit(1);
        const [ver] = await tx
          .select()
          .from(regulationVersions)
          .where(eq(regulationVersions.id, c.regulationVersionId))
          .limit(1);
        const [hs] = await tx
          .select()
          .from(hsClassifications)
          .where(eq(hsClassifications.productId, c.productId))
          .limit(1);
        return {
          ...base,
          check: {
            id: c.id,
            aiStatus: c.estimatedStatus,
            aiConfidence: c.estimatedConfidence,
            reasons: c.reasons,
            missingAttributes: c.missingAttributes,
            verifiedStatus: c.verifiedStatus,
            expertNote: c.expertNote,
            verifiedCost: c.verifiedCost,
            certificateNumber: c.certificateNumber,
          },
          regulation: {
            code: reg?.code,
            name: reg?.name,
            authority: reg?.authority,
            summary: ver?.summary,
            documentsRequired: ver?.documentsRequired,
            testsRequired: ver?.testsRequired,
            officialSource: ver?.officialSource,
          },
          hsCandidates: hs?.candidates ?? [],
          product: await productPayload(c.productId),
        };
      }
      if (t.kind === 'HS_REVIEW') {
        const [hs] = await tx
          .select()
          .from(hsClassifications)
          .where(eq(hsClassifications.id, t.entityId))
          .limit(1);
        if (!hs) throw notFound();
        return {
          ...base,
          hs: {
            id: hs.id,
            candidates: hs.candidates,
            estimatedHs: hs.estimatedHs,
            estimatedConfidence: hs.estimatedConfidence,
            estimatedSource: hs.estimatedSource,
            verifiedHs: hs.verifiedHs,
            verificationNote: hs.verificationNote,
          },
          product: await productPayload(hs.productId),
        };
      }
      if (t.kind === 'FREIGHT_QUOTE') {
        const [rfq] = await tx.select().from(freightRfqs).where(eq(freightRfqs.id, t.entityId)).limit(1);
        if (!rfq) throw notFound();
        const mine = await tx
          .select()
          .from(freightQuotes)
          .where(and(eq(freightQuotes.rfqId, rfq.id), eq(freightQuotes.partnerUserId, u.id)))
          .orderBy(desc(freightQuotes.createdAt));
        return {
          ...base,
          rfq: {
            id: rfq.id,
            code: rfq.code,
            origin: rfq.origin,
            destination: rfq.destination,
            incoterm: rfq.incoterm,
            cartons: rfq.cartons,
            cbm: rfq.cbm,
            grossWeightKg: rfq.grossWeightKg,
            cargoType: rfq.cargoType,
            battery: rfq.battery,
            dangerousGoods: rfq.dangerousGoods,
            readyDate: rfq.readyDate,
            modes: rfq.modes,
            packing: rfq.packing,
            status: rfq.status,
          },
          myQuotes: mine,
        };
      }
      return base;
    });
  });

  app.post(
    '/partner/tasks/:id/start',
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      const u = userOf(req);
      requirePerm(req, 'partner.tasks');
      return db(req, async (tx) => {
        const [t] = await tx.select().from(partnerTasks).where(eq(partnerTasks.id, req.params.id)).limit(1);
        if (!t || t.partnerUserId !== u.id) throw forbidden();
        if (t.status === 'OPEN')
          await tx
            .update(partnerTasks)
            .set({ status: 'IN_PROGRESS', updatedAt: new Date() })
            .where(eq(partnerTasks.id, t.id));
        await audit(tx, req, { action: 'partner_task.started', entityType: 'partner_task', entityId: t.id });
        return { ok: true };
      });
    },
  );

  /** Staff: list partner users for assignment. */
  app.get('/partners', async (req) => {
    requirePerm(req, 'compliance.write');
    const { users, userRoles } = await import('../db/schema/index.js');
    return db(req, async (tx) => {
      const rows = await tx
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          expertTypes: users.expertTypes,
          role: userRoles.role,
        })
        .from(users)
        .innerJoin(userRoles, eq(userRoles.userId, users.id))
        .where(
          inArray(userRoles.role, [
            'CUSTOMS_PARTNER',
            'FORWARDER_PARTNER',
            'CERTIFICATION_PARTNER',
            'SUPPLIER_PARTNER',
          ]),
        );
      return { items: rows };
    });
  });

  app.get(
    '/partner-tasks',
    {
      schema: {
        querystring: z.object({
          entityId: z.string().uuid().optional(),
          projectId: z.string().uuid().optional(),
        }),
      },
    },
    async (req) => {
      requirePerm(req, 'compliance.read');
      return db(req, async (tx) => ({
        items: await tx
          .select()
          .from(partnerTasks)
          .where(
            and(
              req.query.entityId ? eq(partnerTasks.entityId, req.query.entityId) : undefined,
              req.query.projectId ? eq(partnerTasks.projectId, req.query.projectId) : undefined,
            ),
          )
          .orderBy(desc(partnerTasks.createdAt))
          .limit(200),
      }));
    },
  );
}
