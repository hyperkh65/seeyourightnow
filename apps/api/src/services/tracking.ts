import { and, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { aisEta, greatCirclePoints, insideGeofence, isAisStale, type ShipmentEventType } from '@sos/core';
import { withTenant, type Tx } from '../db/client.js';
import {
  ports,
  shipmentContainers,
  shipmentEtas,
  shipmentEvents,
  shipments,
  shipmentVessels,
  vesselPositions,
} from '../db/schema/index.js';
import { safeFetch } from '../lib/http.js';
import {
  connectionsWithCapability,
  recordConnectionResult,
  type LoadedConnection,
} from './connections/index.js';
import { collectPositions } from './connectors/ais.js';
import { registerJob } from './jobs.js';
import { notifyEvent } from './notify.js';
import { completeStep } from './workflow.js';

/**
 * Shipment tracking. Container/BL events (carrier, DCSA) and vessel positions (AIS)
 * are stored separately with provenance. AIS-derived events are candidates
 * (AIS_INFERRED, unconfirmed) and never overwrite carrier-confirmed events.
 */

const DCSA_MAP: Record<string, ShipmentEventType> = {
  'TRANSPORT:DEPA': 'DEPARTED',
  'TRANSPORT:ARRI': 'ARRIVED',
  'EQUIPMENT:LOAD': 'LOADED',
  'EQUIPMENT:DISC': 'DISCHARGED',
  'EQUIPMENT:GTIN': 'GATE_IN',
  'EQUIPMENT:GTOT': 'GATE_OUT',
  'EQUIPMENT:PICK': 'EMPTY_RELEASED',
  'SHIPMENT:CONF': 'BOOKED',
  'SHIPMENT:ISSU': 'BOOKED',
};

interface DcsaEvent {
  eventID?: string;
  eventType?: string;
  eventClassifierCode?: string;
  eventDateTime?: string;
  transportEventTypeCode?: string;
  equipmentEventTypeCode?: string;
  shipmentEventTypeCode?: string;
  equipmentReference?: string;
  eventLocation?: { UNLocationCode?: string; locationName?: string };
  transportCall?: { UNLocationCode?: string; location?: { UNLocationCode?: string; locationName?: string } };
}

export function mapDcsaEvent(
  e: DcsaEvent,
): { type: ShipmentEventType; classifier: string; location: string; locationName: string; at: Date } | null {
  const kind = e.eventType ?? '';
  const code = e.transportEventTypeCode ?? e.equipmentEventTypeCode ?? e.shipmentEventTypeCode ?? '';
  const type = DCSA_MAP[`${kind}:${code}`];
  if (!type || !e.eventDateTime) return null;
  const loc =
    e.eventLocation?.UNLocationCode ??
    e.transportCall?.UNLocationCode ??
    e.transportCall?.location?.UNLocationCode ??
    '';
  const name = e.eventLocation?.locationName ?? e.transportCall?.location?.locationName ?? '';
  return {
    type,
    classifier: e.eventClassifierCode ?? 'ACT',
    location: loc,
    locationName: name,
    at: new Date(e.eventDateTime),
  };
}

async function fetchDcsaEvents(conn: LoadedConnection, params: Record<string, string>): Promise<DcsaEvent[]> {
  const url = new URL(`${String(conn.config.baseUrl)}${String(conn.config.eventsPath ?? '/events')}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await safeFetch(url.toString(), {
    trusted: true,
    timeoutMs: 20_000,
    headers: {
      Accept: 'application/json',
      [String(conn.config.apiKeyHeader ?? 'Consumer-Key')]: conn.secrets.apiKey ?? '',
    },
  });
  if (!res.ok) throw new Error(`DCSA HTTP ${res.status}`);
  const json = (await res.json()) as DcsaEvent[] | { events?: DcsaEvent[] };
  return Array.isArray(json) ? json : (json.events ?? []);
}

/** Applies business effects of a (confirmed) event: status, workflow and customer notification. */
export async function applyEventEffects(
  tx: Tx,
  tenantId: string,
  s: typeof shipments.$inferSelect,
  type: ShipmentEventType,
  at: Date,
  by: string | null,
) {
  const patch: Partial<typeof shipments.$inferInsert> = { updatedAt: new Date() };
  if (type === 'DEPARTED' && !s.atd) {
    patch.atd = at;
    patch.status = 'IN_TRANSIT';
    await completeStep(tx, tenantId, s.projectId, 'SHIPPED', by);
    await notifyEvent(
      tx,
      tenantId,
      'VESSEL_DEPARTED',
      s.projectId,
      { originPort: s.originPort, eta: s.eta?.toISOString().slice(0, 10) ?? '-' },
      { dedupeKey: `departed:${s.id}` },
    );
  }
  if ((type === 'ARRIVED' || type === 'DISCHARGED') && !s.ata) {
    patch.ata = at;
    patch.status = 'ARRIVED';
    await completeStep(tx, tenantId, s.projectId, 'ARRIVED', by);
    await notifyEvent(
      tx,
      tenantId,
      'ARRIVED',
      s.projectId,
      { destinationPort: s.destinationPort },
      { dedupeKey: `arrived:${s.id}` },
    );
  }
  if (type === 'CUSTOMS') patch.customsStatus = 'IN_PROGRESS';
  if (type === 'GATE_OUT' && s.status === 'ARRIVED') patch.status = 'RELEASED';
  if (type === 'DELIVERED') {
    patch.status = 'DELIVERED';
    await completeStep(tx, tenantId, s.projectId, 'DELIVERY', by);
    await completeStep(tx, tenantId, s.projectId, 'COMPLETED', by);
    await notifyEvent(tx, tenantId, 'DELIVERED', s.projectId, {}, { dedupeKey: `delivered:${s.id}` });
  }
  await tx.update(shipments).set(patch).where(eq(shipments.id, s.id));
}

registerJob(
  'tracking.carrier',
  async (payload, { tenantId }) => {
    const shipmentId = String(payload.shipmentId);
    const { s, containers, conns } = await withTenant({ tenantId }, async (tx) => {
      const [s] = await tx.select().from(shipments).where(eq(shipments.id, shipmentId)).limit(1);
      const containers = s
        ? await tx.select().from(shipmentContainers).where(eq(shipmentContainers.shipmentId, s.id))
        : [];
      return { s, containers, conns: await connectionsWithCapability(tx, tenantId, 'CONTAINER_TRACKING') };
    });
    if (!s) return { skipped: 'not found' };
    const conn = conns.find(
      (c) => String(c.config.carrierCode ?? '').toUpperCase() === s.carrierCode.toUpperCase(),
    );
    if (!conn) {
      await withTenant({ tenantId }, (tx) =>
        tx
          .update(shipments)
          .set({ trackingError: `선사(${s.carrierCode || '미지정'}) 추적 API가 연결되지 않았습니다.` })
          .where(eq(shipments.id, s.id)),
      );
      return { skipped: 'no carrier connection' };
    }
    const queries: Array<Record<string, string>> = [];
    if (s.blNumber) queries.push({ transportDocumentReference: s.blNumber });
    if (s.bookingNumber) queries.push({ carrierBookingReference: s.bookingNumber });
    for (const c of containers) queries.push({ equipmentReference: c.containerNumber });
    let added = 0;
    try {
      for (const q of queries) {
        const events = await fetchDcsaEvents(conn, q);
        await withTenant({ tenantId }, async (tx) => {
          for (const raw of events) {
            const m = mapDcsaEvent(raw);
            if (!m) continue;
            const externalId =
              raw.eventID ?? `${m.type}:${m.at.toISOString()}:${raw.equipmentReference ?? ''}`;
            const [dup] = await tx
              .select({ id: shipmentEvents.id })
              .from(shipmentEvents)
              .where(and(eq(shipmentEvents.shipmentId, s.id), eq(shipmentEvents.externalId, externalId)))
              .limit(1);
            if (dup) continue;
            const containerId =
              containers.find((c) => c.containerNumber === raw.equipmentReference)?.id ?? null;
            await tx.insert(shipmentEvents).values({
              tenantId,
              shipmentId: s.id,
              containerId,
              eventType: m.type,
              classifier: m.classifier,
              source: 'CARRIER_CONFIRMED',
              locationCode: m.location,
              locationName: m.locationName,
              occurredAt: m.at,
              externalId,
              confirmed: m.classifier === 'ACT',
              raw,
            });
            added++;
            if (m.classifier === 'EST' && m.type === 'ARRIVED' && m.location === s.destinationPort) {
              await tx.insert(shipmentEtas).values({
                tenantId,
                shipmentId: s.id,
                source: 'CARRIER',
                eta: m.at,
                confidence: 0.8,
                note: 'Carrier estimated arrival',
              });
            }
            if (m.classifier === 'ACT') {
              const [fresh] = await tx.select().from(shipments).where(eq(shipments.id, s.id)).limit(1);
              await applyEventEffects(tx, tenantId, fresh!, m.type, m.at, null);
            }
          }
          await tx
            .update(shipments)
            .set({ lastTrackedAt: new Date(), trackingError: null })
            .where(eq(shipments.id, s.id));
        });
      }
      await recordConnectionResult(tenantId, conn.id, true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await recordConnectionResult(tenantId, conn.id, false, msg);
      await withTenant({ tenantId }, (tx) =>
        tx
          .update(shipments)
          .set({ trackingError: `선사 추적 오류: ${msg}` })
          .where(eq(shipments.id, s.id)),
      );
      throw e;
    }
    return { added };
  },
  { transactional: false },
);

registerJob(
  'ais.poll',
  async (_payload, { tenantId }) => {
    const { conns, vessels, portRows } = await withTenant({ tenantId }, async (tx) => {
      const vessels = await tx
        .select({ v: shipmentVessels, s: shipments })
        .from(shipmentVessels)
        .innerJoin(shipments, eq(shipments.id, shipmentVessels.shipmentId))
        .where(
          and(ne(shipmentVessels.mmsi, ''), inArray(shipments.status, ['BOOKED', 'IN_TRANSIT', 'PLANNED'])),
        );
      const codes = [...new Set(vessels.flatMap((x) => [x.s.destinationPort, ...x.s.transshipmentPorts]))];
      const portRows = codes.length
        ? await tx.select().from(ports).where(inArray(ports.unlocode, codes))
        : [];
      return { conns: await connectionsWithCapability(tx, tenantId, 'AIS'), vessels, portRows };
    });
    const conn = conns.find((c) => c.provider === 'AISSTREAM');
    if (!conn || !vessels.length) return { skipped: !conn ? 'AIS not configured' : 'no active vessels' };
    let positions;
    try {
      positions = await collectPositions(conn.secrets.apiKey ?? '', [
        ...new Set(vessels.map((x) => x.v.mmsi)),
      ]);
      await recordConnectionResult(tenantId, conn.id, true);
    } catch (e) {
      await recordConnectionResult(tenantId, conn.id, false, e instanceof Error ? e.message : String(e));
      throw e;
    }
    await withTenant({ tenantId }, async (tx) => {
      for (const { v, s } of vessels) {
        const pos = positions.find((p) => p.mmsi === v.mmsi);
        if (!pos) continue;
        await tx.insert(vesselPositions).values({
          tenantId,
          shipmentVesselId: v.id,
          mmsi: v.mmsi,
          lat: pos.lat,
          lon: pos.lon,
          speedKnots: pos.sog,
          courseDeg: pos.cog,
          headingDeg: pos.heading,
          navStatus: pos.navStatus,
          source: 'AISSTREAM',
          observedAt: pos.observedAt,
        });
        const dest = portRows.find((p) => p.unlocode === s.destinationPort);
        if (dest) {
          const eta = aisEta(
            { lat: pos.lat, lon: pos.lon },
            pos.sog,
            { lat: dest.lat, lon: dest.lon },
            pos.observedAt,
          );
          if (eta)
            await tx.insert(shipmentEtas).values({
              tenantId,
              shipmentId: s.id,
              source: 'AIS',
              eta,
              confidence: 0.5,
              note: `SOG ${pos.sog ?? '-'} kn`,
            });
          // Geofence entry → AIS_INFERRED arrival candidate (not confirmed, not applied to status).
          if (
            insideGeofence({ lat: pos.lat, lon: pos.lon }, { lat: dest.lat, lon: dest.lon }, dest.geofenceKm)
          ) {
            const [exists] = await tx
              .select({ id: shipmentEvents.id })
              .from(shipmentEvents)
              .where(
                and(
                  eq(shipmentEvents.shipmentId, s.id),
                  eq(shipmentEvents.eventType, 'ARRIVED'),
                  eq(shipmentEvents.source, 'AIS_INFERRED'),
                ),
              )
              .limit(1);
            if (!exists) {
              await tx.insert(shipmentEvents).values({
                tenantId,
                shipmentId: s.id,
                eventType: 'ARRIVED',
                classifier: 'EST',
                source: 'AIS_INFERRED',
                locationCode: dest.unlocode,
                locationName: dest.name,
                occurredAt: pos.observedAt,
                confirmed: false,
                note: '선박이 목적항 반경에 진입했습니다 (AIS 기반 추정, 선사 확인 전).',
              });
            }
          }
        }
      }
    });
    return { positions: positions.length };
  },
  { transactional: false },
);

/** Map payload: ports, estimated route (clearly labelled), actual AIS track, current position with staleness. */
export async function shipmentMap(tx: Tx, s: typeof shipments.$inferSelect) {
  const codes = [s.originPort, ...s.transshipmentPorts, s.destinationPort];
  const portRows = await tx.select().from(ports).where(inArray(ports.unlocode, codes));
  const ordered = codes
    .map((c) => portRows.find((p) => p.unlocode === c))
    .filter((p): p is (typeof portRows)[number] => !!p);
  const estimatedRoute: Array<[number, number]> = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const seg = greatCirclePoints(
      { lat: ordered[i]!.lat, lon: ordered[i]!.lon },
      { lat: ordered[i + 1]!.lat, lon: ordered[i + 1]!.lon },
      24,
    );
    estimatedRoute.push(...seg.map((p) => [p.lon, p.lat] as [number, number]));
  }
  const vessels = await tx.select().from(shipmentVessels).where(eq(shipmentVessels.shipmentId, s.id));
  const track = vessels.length
    ? await tx
        .select()
        .from(vesselPositions)
        .where(
          and(
            inArray(
              vesselPositions.shipmentVesselId,
              vessels.map((v) => v.id),
            ),
            isNotNull(vesselPositions.lat),
          ),
        )
        .orderBy(vesselPositions.observedAt)
        .limit(2000)
    : [];
  const last = track.at(-1) ?? null;
  return {
    ports: ordered.map((p, i) => ({
      unlocode: p.unlocode,
      name: p.name,
      lat: p.lat,
      lon: p.lon,
      role: i === 0 ? 'ORIGIN' : i === ordered.length - 1 ? 'DESTINATION' : 'TRANSSHIPMENT',
    })),
    estimatedRoute: {
      coordinates: estimatedRoute,
      kind: 'ESTIMATED',
      note: '항로는 항구 간 추정 경로이며 실제 선박 위치가 아닙니다.',
    },
    actualTrack: { coordinates: track.map((t) => [t.lon, t.lat] as [number, number]), source: 'AIS' },
    currentPosition: last
      ? {
          lat: last.lat,
          lon: last.lon,
          speedKnots: last.speedKnots,
          headingDeg: last.headingDeg,
          observedAt: last.observedAt,
          stale: isAisStale(last.observedAt),
          mmsi: last.mmsi,
        }
      : null,
  };
}

export async function latestEtas(tx: Tx, shipmentId: string) {
  const rows = await tx
    .select()
    .from(shipmentEtas)
    .where(eq(shipmentEtas.shipmentId, shipmentId))
    .orderBy(desc(shipmentEtas.computedAt))
    .limit(50);
  const bySource = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!bySource.has(r.source)) bySource.set(r.source, r);
  return [...bySource.values()].map((r) => ({
    source: r.source,
    eta: r.eta,
    confidence: r.confidence,
    computedAt: r.computedAt,
    note: r.note,
  }));
}

export async function activeShipmentIds(tx: Tx) {
  const rows = await tx
    .select({ id: shipments.id })
    .from(shipments)
    .where(sql`${shipments.status} not in ('DELIVERED','CANCELLED')`);
  return rows.map((r) => r.id);
}
