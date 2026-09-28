import { and, eq, sql } from 'drizzle-orm';
import { systemDb, withTenant } from '../db/client.js';
import { apiConnections, shipments, tenants } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';
import { enqueue } from '../services/jobs.js';

/**
 * Periodic schedules (run in the worker process). Each tick enqueues deduplicated
 * jobs per tenant, so running several workers never duplicates work.
 */

interface Schedule {
  name: string;
  everyMs: number;
  run: (tenantId: string, bucket: number) => Promise<void>;
}

const SCHEDULES: Schedule[] = [
  {
    name: 'quotes.expire',
    everyMs: 60 * 60_000,
    run: async (t, b) =>
      withTenant({ tenantId: t }, (tx) =>
        enqueue(tx, t, 'quotes.expire', {}, { dedupeKey: `quotes.expire:${b}` }),
      ).then(() => undefined),
  },
  {
    name: 'fx.daily',
    everyMs: 6 * 60 * 60_000,
    run: async (t, b) =>
      withTenant({ tenantId: t }, (tx) =>
        enqueue(tx, t, 'fx.daily', {}, { dedupeKey: `fx.daily:${b}` }),
      ).then(() => undefined),
  },
  {
    name: 'tracking.refresh',
    everyMs: 2 * 60 * 60_000,
    run: async (t, b) => {
      await withTenant({ tenantId: t }, async (tx) => {
        const active = await tx
          .select({ id: shipments.id })
          .from(shipments)
          .where(sql`${shipments.status} not in ('DELIVERED','CANCELLED','PLANNED')`);
        for (const s of active)
          await enqueue(tx, t, 'tracking.carrier', { shipmentId: s.id }, { dedupeKey: `track:${s.id}:${b}` });
      });
    },
  },
  {
    name: 'ais.poll',
    everyMs: 15 * 60_000,
    run: async (t, b) => {
      await withTenant({ tenantId: t }, async (tx) => {
        const [c] = await tx
          .select({ id: apiConnections.id })
          .from(apiConnections)
          .where(and(eq(apiConnections.provider, 'AISSTREAM'), eq(apiConnections.enabled, true)))
          .limit(1);
        if (c) await enqueue(tx, t, 'ais.poll', {}, { dedupeKey: `ais:${b}` });
      });
    },
  },
  {
    name: 'change.detect.all',
    everyMs: 6 * 60 * 60_000,
    run: async (t, b) =>
      withTenant({ tenantId: t }, (tx) =>
        enqueue(tx, t, 'change.scan', {}, { dedupeKey: `change.scan:${b}` }),
      ).then(() => undefined),
  },
  {
    name: 'maintenance',
    everyMs: 24 * 60 * 60_000,
    run: async (t, b) =>
      withTenant({ tenantId: t }, (tx) =>
        enqueue(tx, t, 'maintenance.daily', {}, { dedupeKey: `maint:${b}` }),
      ).then(() => undefined),
  },
];

export function startSchedulers(): () => void {
  const last = new Map<string, number>();
  const tick = async () => {
    try {
      const active = await systemDb
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.status, 'ACTIVE'));
      const now = Date.now();
      for (const s of SCHEDULES) {
        if (now - (last.get(s.name) ?? 0) < s.everyMs) continue;
        last.set(s.name, now);
        const bucket = Math.floor(now / s.everyMs);
        for (const t of active)
          await s
            .run(t.id, bucket)
            .catch((e) => logger.warn({ err: String(e), schedule: s.name, tenant: t.id }, 'schedule failed'));
      }
    } catch (e) {
      logger.error({ err: String(e) }, 'scheduler tick failed');
    }
  };
  void tick();
  const h = setInterval(() => void tick(), 60_000);
  return () => clearInterval(h);
}
