import { sql } from 'drizzle-orm';
import { config } from '../config.js';
import { systemDb } from '../db/client.js';
import { pingRedis } from '../lib/cache.js';
import { storage } from '../services/storage.js';
import type { App } from '../http/types.js';

type Status = 'OK' | 'DEGRADED' | 'DOWN' | 'DISABLED' | 'NOT_CONFIGURED';

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T | null; ms: number; error?: string }> {
  const t = Date.now();
  try {
    return { value: await fn(), ms: Date.now() - t };
  } catch (e) {
    return { value: null, ms: Date.now() - t, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function systemHealth() {
  const [db, redis, store, ai, pdf, queue] = await Promise.all([
    timed(() => systemDb.execute(sql`select 1`)),
    timed(() => pingRedis()),
    timed(() => storage.health()),
    timed(async () => {
      if (!config.AI_WORKER_URL) return 'NOT_CONFIGURED' as Status;
      const r = await fetch(`${config.AI_WORKER_URL}/health`, { signal: AbortSignal.timeout(3000) });
      return (r.ok ? 'OK' : 'DOWN') as Status;
    }),
    timed(async () => {
      if (config.GOTENBERG_URL) {
        const r = await fetch(`${config.GOTENBERG_URL}/health`, { signal: AbortSignal.timeout(3000) });
        return (r.ok ? 'OK' : 'DOWN') as Status;
      }
      return 'OK' as Status; // falls back to bundled Chromium renderer
    }),
    timed(async () => {
      const r = await systemDb.execute<{ dead: number; pending: number; oldest: string | null }>(
        sql`select count(*) filter (where status='DEAD_LETTER')::int as dead, count(*) filter (where status in ('PENDING','RETRYING'))::int as pending, min(run_at) filter (where status in ('PENDING','RETRYING')) as oldest from jobs`,
      );
      return r.rows[0]!;
    }),
  ]);
  const queueRow = queue.value as { dead: number; pending: number; oldest: string | null } | null;
  const lagSec = queueRow?.oldest
    ? Math.max(0, (Date.now() - new Date(queueRow.oldest).getTime()) / 1000)
    : 0;
  const components = {
    database: { status: (db.error ? 'DOWN' : 'OK') as Status, latencyMs: db.ms, error: db.error ?? null },
    cache: {
      status: (redis.value === 'DISABLED' ? 'DISABLED' : redis.value === 'OK' ? 'OK' : 'DEGRADED') as Status,
      latencyMs: redis.ms,
      note: redis.value === 'OK' ? null : '메모리 캐시로 동작 중',
    },
    storage: { status: (store.value ?? 'DOWN') as Status, driver: storage.name, latencyMs: store.ms },
    aiWorker: { status: (ai.value ?? 'DOWN') as Status, latencyMs: ai.ms, error: ai.error ?? null },
    pdfRenderer: {
      status: (pdf.value ?? 'DOWN') as Status,
      renderer: config.GOTENBERG_URL ? 'GOTENBERG' : 'CHROMIUM',
    },
    queue: {
      status: (queue.error ? 'DOWN' : lagSec > 300 ? 'DEGRADED' : 'OK') as Status,
      pending: queueRow?.pending ?? null,
      deadLetter: queueRow?.dead ?? null,
      lagSeconds: Math.round(lagSec),
    },
    malwareScan: { status: (config.CLAMAV_HOST ? 'OK' : 'NOT_CONFIGURED') as Status },
    email: { status: (config.SMTP_HOST ? 'OK' : 'NOT_CONFIGURED') as Status },
  };
  const overall: Status =
    components.database.status !== 'OK'
      ? 'DOWN'
      : Object.values(components).some((c) => c.status === 'DOWN' || c.status === 'DEGRADED')
        ? 'DEGRADED'
        : 'OK';
  return { status: overall, time: new Date().toISOString(), components };
}

export async function healthRoutes(app: App) {
  /** Liveness: process is up. */
  app.get('/health/live', async () => ({ status: 'OK' }));
  /** Readiness + component status. Public output hides error details. */
  app.get('/health', async (_req, reply) => {
    const h = await systemHealth();
    reply.status(h.status === 'DOWN' ? 503 : 200);
    return {
      status: h.status,
      time: h.time,
      components: Object.fromEntries(Object.entries(h.components).map(([k, v]) => [k, v.status])),
    };
  });

  /**
   * Caddy on-demand TLS "ask" endpoint: a certificate is issued only for the platform host,
   * active tenant subdomains, and custom domains whose DNS ownership was verified and enabled.
   */
  app.get('/internal/tls-allowed', async (req, reply) => {
    const domain = String((req.query as { domain?: string }).domain ?? '')
      .toLowerCase()
      .replace(/\.$/, '');
    if (!/^(?=.{3,253}$)([a-z0-9-]+\.)+[a-z0-9-]{2,}$/.test(domain)) return reply.status(400).send();
    let ok = domain === config.PLATFORM_ADMIN_HOST;
    const base = `.${config.PLATFORM_BASE_DOMAIN}`;
    if (!ok && domain.endsWith(base)) {
      const slug = domain.slice(0, -base.length);
      const r = await systemDb.execute(
        sql`select 1 from tenants where slug = ${slug} and status = 'ACTIVE' limit 1`,
      );
      ok = r.rows.length > 0;
    }
    if (!ok) {
      const r = await systemDb.execute(
        sql`select 1 from tenant_domains d join tenants t on t.id = d.tenant_id
            where d.hostname = ${domain} and d.dns_status = 'VERIFIED' and d.active and t.status = 'ACTIVE' limit 1`,
      );
      ok = r.rows.length > 0;
    }
    return reply.status(ok ? 200 : 404).send();
  });
}
