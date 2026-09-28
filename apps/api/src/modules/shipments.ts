import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { SHIPMENT_EVENT_TYPES } from '@sos/core';
import { shipmentContainers, shipmentEtas, shipmentEvents, shipments, shipmentVessels, sourcingProjects } from '../db/schema/index.js';
import { AppError, notFound } from '../lib/errors.js';
import { db, isStaff, requireFeature, requirePerm, tenantOf, userOf } from '../http/context.js';
import type { App } from '../http/types.js';
import { audit } from '../services/audit.js';
import { enqueue } from '../services/jobs.js';
import { notifyEvent } from '../services/notify.js';
import { nextNumber } from '../services/settings.js';
import { applyEventEffects, latestEtas, shipmentMap } from '../services/tracking.js';
import { completeStep } from '../services/workflow.js';

const locode = z.string().regex(/^[A-Z]{2}[A-Z0-9]{3}$/, 'UN/LOCODE 형식(예: KRPUS)');

export async function shipmentRoutes(app: App) {
  app.post(
    '/projects/:id/shipments',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          mode: z.enum(['COURIER', 'AIR', 'LCL', 'FCL_20', 'FCL_40', 'FCL_40HQ']),
          carrierCode: z.string().max(10).default(''),
          carrierName: z.string().max(80).default(''),
          bookingNumber: z.string().max(40).default(''),
          blNumber: z.string().max(40).default(''),
          originPort: locode,
          destinationPort: locode,
          transshipmentPorts: z.array(locode).max(5).default([]),
          incoterm: z.string().max(10).default('FOB'),
          etd: z.string().datetime({ offset: true }).optional(),
          eta: z.string().datetime({ offset: true }).optional(),
        }),
      },
    },
    async (req, reply) => {
      const tenant = tenantOf(req);
      requireFeature(req, 'SHIPMENT');
      const user = requirePerm(req, 'shipment.write');
      return db(req, async (tx) => {
        const [p] = await tx.select().from(sourcingProjects).where(eq(sourcingProjects.id, req.params.id)).limit(1);
        if (!p) throw notFound();
        const code = await nextNumber(tx, tenant.id, 'SHIPMENT');
        const b = req.body;
        const [s] = await tx
          .insert(shipments)
          .values({ tenantId: tenant.id, code, projectId: p.id, mode: b.mode, carrierCode: b.carrierCode.toUpperCase(), carrierName: b.carrierName, bookingNumber: b.bookingNumber, blNumber: b.blNumber, originPort: b.originPort, destinationPort: b.destinationPort, transshipmentPorts: b.transshipmentPorts, incoterm: b.incoterm, status: b.bookingNumber ? 'BOOKED' : 'PLANNED', etd: b.etd ? new Date(b.etd) : null, eta: b.eta ? new Date(b.eta) : null })
          .returning();
        if (b.bookingNumber) {
          await tx.insert(shipmentEvents).values({ tenantId: tenant.id, shipmentId: s!.id, eventType: 'BOOKED', source: 'MANUAL', occurredAt: new Date(), locationCode: b.originPort, note: `Booking ${b.bookingNumber}` });
          await notifyEvent(tx, tenant.id, 'SHIPMENT_BOOKED', p.id, { etd: b.etd?.slice(0, 10) ?? '-' }, { dedupeKey: `booked:${s!.id}` });
        }
        if (b.eta) await tx.insert(shipmentEtas).values({ tenantId: tenant.id, shipmentId: s!.id, source: 'FORWARDER', eta: new Date(b.eta), note: '예약 시 안내된 도착 예정일' });
        await completeStep(tx, tenant.id, p.id, 'FORWARDER', user.id, code);
        await audit(tx, req, { action: 'shipment.created', entityType: 'shipment', entityId: s!.id, after: b });
        reply.status(201);
        return s;
      });
    },
  );

  app.patch(
    '/shipments/:id',
    { schema: { params: z.object({ id: z.string().uuid() }), body: z.object({ carrierCode: z.string().max(10).optional(), carrierName: z.string().max(80).optional(), bookingNumber: z.string().max(40).optional(), blNumber: z.string().max(40).optional(), etd: z.string().datetime({ offset: true }).optional(), eta: z.string().datetime({ offset: true }).optional(), transshipmentPorts: z.array(locode).max(5).optional() }) } },
    async (req) => {
      const tenant = tenantOf(req);
      requirePerm(req, 'shipment.write');
      return db(req, async (tx) => {
        const [s] = await tx.select().from(shipments).where(eq(shipments.id, req.params.id)).limit(1);
        if (!s) throw notFound();
        const b = req.body;
        await tx.update(shipments).set({ ...b, carrierCode: b.carrierCode?.toUpperCase() ?? s.carrierCode, etd: b.etd ? new Date(b.etd) : s.etd, eta: b.eta ? new Date(b.eta) : s.eta, updatedAt: new Date() }).where(eq(shipments.id, s.id));
        if (b.eta && s.eta && Math.abs(new Date(b.eta).getTime() - s.eta.getTime()) > 12 * 3_600_000) {
          await tx.insert(shipmentEtas).values({ tenantId: tenant.id, shipmentId: s.id, source: 'FORWARDER', eta: new Date(b.eta), note: '담당자 수정' });
          await notifyEvent(tx, tenant.id, 'ETA_CHANGED', s.projectId, { previousEta: s.eta.toISOString().slice(0, 10), eta: b.eta.slice(0, 10), etaSource: '포워더' }, { dedupeKey: `eta:${s.id}:${b.eta.slice(0, 10)}` });
        }
        await audit(tx, req, { action: 'shipment.updated', entityType: 'shipment', entityId: s.id, before: { eta: s.eta, bl: s.blNumber }, after: b });
        return { ok: true };
      });
    },
  );

  app.post('/shipments/:id/containers', { schema: { params: z.object({ id: z.string().uuid() }), body: z.object({ containerNumber: z.string().regex(/^[A-Z]{4}\d{7}$/, '컨테이너 번호 형식(예: MSKU1234567)'), isoType: z.string().max(4).default(''), sealNumber: z.string().max(30).default(''), cartons: z.number().int().optional(), grossWeightKg: z.string().optional(), cbm: z.string().optional() }) } }, async (req, reply) => {
    const tenant = tenantOf(req);
    requirePerm(req, 'shipment.write');
    return db(req, async (tx) => {
      const [c] = await tx.insert(shipmentContainers).values({ tenantId: tenant.id, shipmentId: req.params.id, ...req.body }).returning();
      await audit(tx, req, { action: 'shipment.container.added', entityType: 'shipment', entityId: req.params.id, after: req.body });
      reply.status(201);
      return c;
    });
  });

  app.post('/shipments/:id/vessels', { schema: { params: z.object({ id: z.string().uuid() }), body: z.object({ vesselName: z.string().min(1).max(80), imo: z.string().regex(/^\d{7}$/).or(z.literal('')).default(''), mmsi: z.string().regex(/^\d{9}$/).or(z.literal('')).default(''), voyage: z.string().max(20).default(''), legSequence: z.number().int().min(1).default(1), loadPort: z.string().max(5).default(''), dischargePort: z.string().max(5).default('') }) } }, async (req, reply) => {
    const tenant = tenantOf(req);
    requirePerm(req, 'shipment.write');
    return db(req, async (tx) => {
      const [v] = await tx.insert(shipmentVessels).values({ tenantId: tenant.id, shipmentId: req.params.id, ...req.body }).returning();
      await audit(tx, req, { action: 'shipment.vessel.added', entityType: 'shipment', entityId: req.params.id, after: req.body });
      reply.status(201);
      return v;
    });
  });

  app.post(
    '/shipments/:id/events',
    { schema: { params: z.object({ id: z.string().uuid() }), body: z.object({ eventType: z.enum(SHIPMENT_EVENT_TYPES), occurredAt: z.string().datetime({ offset: true }), locationCode: z.string().max(5).default(''), note: z.string().max(500).default(''), source: z.enum(['MANUAL', 'FORWARDER_REPORTED']).default('MANUAL'), confirmAisEventId: z.string().uuid().optional() }) } },
    async (req, reply) => {
      const tenant = tenantOf(req);
      const user = requirePerm(req, 'shipment.write');
      return db(req, async (tx) => {
        const [s] = await tx.select().from(shipments).where(eq(shipments.id, req.params.id)).limit(1);
        if (!s) throw notFound();
        const b = req.body;
        const [e] = await tx.insert(shipmentEvents).values({ tenantId: tenant.id, shipmentId: s.id, eventType: b.eventType, source: b.source, locationCode: b.locationCode, occurredAt: new Date(b.occurredAt), note: b.note, confirmed: true }).returning();
        await applyEventEffects(tx, tenant.id, s, b.eventType, new Date(b.occurredAt), user.id);
        await audit(tx, req, { action: 'shipment.event.added', entityType: 'shipment', entityId: s.id, after: b });
        reply.status(201);
        return e;
      });
    },
  );

  app.post('/shipments/:id/customs', { schema: { params: z.object({ id: z.string().uuid() }), body: z.object({ status: z.enum(['IN_PROGRESS', 'HOLD', 'CLEARED']), note: z.string().max(500).default('') }) } }, async (req) => {
    const tenant = tenantOf(req);
    const user = requirePerm(req, 'shipment.write');
    return db(req, async (tx) => {
      const [s] = await tx.select().from(shipments).where(eq(shipments.id, req.params.id)).limit(1);
      if (!s) throw notFound();
      await tx.update(shipments).set({ customsStatus: req.body.status, updatedAt: new Date() }).where(eq(shipments.id, s.id));
      await tx.insert(shipmentEvents).values({ tenantId: tenant.id, shipmentId: s.id, eventType: 'CUSTOMS', source: 'MANUAL', occurredAt: new Date(), locationCode: s.destinationPort, note: `${req.body.status} ${req.body.note}`.trim() });
      if (req.body.status === 'CLEARED') {
        await completeStep(tx, tenant.id, s.projectId, 'CUSTOMS', user.id);
        await notifyEvent(tx, tenant.id, 'CUSTOMS_COMPLETED', s.projectId, {}, { dedupeKey: `customs:${s.id}` });
      }
      if (req.body.status === 'HOLD') {
        const [p] = await tx.select().from(sourcingProjects).where(eq(sourcingProjects.id, s.projectId)).limit(1);
        await tx.update(sourcingProjects).set({ attention: [...(p?.attention ?? []), { kind: 'CUSTOMS_HOLD', message: req.body.note || '통관 보류', since: new Date().toISOString() }] }).where(eq(sourcingProjects.id, s.projectId));
      }
      await audit(tx, req, { action: 'shipment.customs', entityType: 'shipment', entityId: s.id, after: req.body });
      return { ok: true };
    });
  });

  app.post('/shipments/:id/delivery', { schema: { params: z.object({ id: z.string().uuid() }), body: z.object({ status: z.enum(['STARTED', 'DELIVERED']), note: z.string().max(500).default('') }) } }, async (req) => {
    const tenant = tenantOf(req);
    const user = requirePerm(req, 'shipment.write');
    return db(req, async (tx) => {
      const [s] = await tx.select().from(shipments).where(eq(shipments.id, req.params.id)).limit(1);
      if (!s) throw notFound();
      if (req.body.status === 'STARTED') {
        await tx.update(shipments).set({ status: 'DELIVERING', updatedAt: new Date() }).where(eq(shipments.id, s.id));
        await notifyEvent(tx, tenant.id, 'DELIVERY_STARTED', s.projectId, {}, { dedupeKey: `delivery-start:${s.id}` });
      } else {
        await tx.insert(shipmentEvents).values({ tenantId: tenant.id, shipmentId: s.id, eventType: 'DELIVERED', source: 'MANUAL', occurredAt: new Date(), note: req.body.note });
        await applyEventEffects(tx, tenant.id, s, 'DELIVERED', new Date(), user.id);
      }
      await audit(tx, req, { action: `shipment.delivery.${req.body.status.toLowerCase()}`, entityType: 'shipment', entityId: s.id, after: req.body });
      return { ok: true };
    });
  });

  app.post('/shipments/:id/refresh', { schema: { params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const tenant = tenantOf(req);
    requirePerm(req, 'shipment.read');
    return db(req, async (tx) => {
      await enqueue(tx, tenant.id, 'tracking.carrier', { shipmentId: req.params.id }, { priority: 30, dedupeKey: `track:${req.params.id}:${Math.floor(Date.now() / 60000)}` });
      await enqueue(tx, tenant.id, 'ais.poll', {}, { priority: 40, dedupeKey: `ais:${Math.floor(Date.now() / 60000)}` });
      return { ok: true, message: '운송 정보를 새로 확인하고 있습니다.' };
    });
  });

  app.get('/shipments', { schema: { querystring: z.object({ projectId: z.string().uuid().optional() }) } }, async (req) => {
    const u = userOf(req);
    return db(req, async (tx) => {
      const conds = [];
      if (req.query.projectId) conds.push(eq(shipments.projectId, req.query.projectId));
      if (u.audience === 'CUSTOMER') {
        if (!u.companyId) return { items: [] };
        const projects = await tx.select({ id: sourcingProjects.id }).from(sourcingProjects).where(eq(sourcingProjects.companyId, u.companyId));
        if (!projects.length) return { items: [] };
        conds.push(inArray(shipments.projectId, projects.map((p) => p.id)));
      } else requirePerm(req, 'shipment.read');
      const rows = await tx.select().from(shipments).where(conds.length ? and(...conds) : undefined).orderBy(desc(shipments.updatedAt)).limit(200);
      return { items: rows.map((s) => ({ id: s.id, code: s.code, projectId: s.projectId, mode: s.mode, status: s.status, originPort: s.originPort, destinationPort: s.destinationPort, etd: s.etd, eta: s.eta, atd: s.atd, ata: s.ata, carrierName: s.carrierName, customsStatus: s.customsStatus, ...(isStaff(req) ? { trackingError: s.trackingError, lastTrackedAt: s.lastTrackedAt, blNumber: s.blNumber } : {}) })) };
    });
  });

  app.get('/shipments/:id', { schema: { params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const u = userOf(req);
    return db(req, async (tx) => {
      const [s] = await tx.select().from(shipments).where(eq(shipments.id, req.params.id)).limit(1);
      if (!s) throw notFound();
      if (u.audience === 'CUSTOMER') {
        const [p] = await tx.select({ companyId: sourcingProjects.companyId }).from(sourcingProjects).where(eq(sourcingProjects.id, s.projectId)).limit(1);
        if (!u.companyId || p?.companyId !== u.companyId) throw notFound();
      } else if (u.audience !== 'STAFF' && u.audience !== 'PLATFORM') throw new AppError(403, 'FORBIDDEN', '권한이 없습니다.');
      const events = await tx.select().from(shipmentEvents).where(eq(shipmentEvents.shipmentId, s.id)).orderBy(desc(shipmentEvents.occurredAt));
      const containers = await tx.select().from(shipmentContainers).where(eq(shipmentContainers.shipmentId, s.id));
      const vessels = await tx.select().from(shipmentVessels).where(eq(shipmentVessels.shipmentId, s.id));
      const staff = isStaff(req);
      return {
        ...s,
        trackingError: staff ? s.trackingError : null,
        events: events.filter((e) => staff || e.confirmed).map((e) => ({ id: e.id, eventType: e.eventType, source: e.source, classifier: e.classifier, confirmed: e.confirmed, locationCode: e.locationCode, locationName: e.locationName, occurredAt: e.occurredAt, note: e.note })),
        containers,
        vessels: vessels.map((v) => ({ id: v.id, vesselName: v.vesselName, imo: v.imo, mmsi: v.mmsi, voyage: v.voyage, legSequence: v.legSequence })),
        etas: await latestEtas(tx, s.id),
        map: await shipmentMap(tx, s),
      };
    });
  });
}
