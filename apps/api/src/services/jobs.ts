import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { hostname } from 'node:os';
import { systemDb, withTenant, type Tx } from '../db/client.js';
import { jobs } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';

/**
 * Durable job queue on Postgres (SELECT … FOR UPDATE SKIP LOCKED).
 * States: PENDING → RUNNING → SUCCESS | RETRYING → … → DEAD_LETTER.
 * Retries use exponential backoff; dead-lettered jobs can be re-queued from the admin UI.
 */

export type JobHandler = (
  payload: Record<string, unknown>,
  ctx: { tenantId: string; jobId: string; attempt: number; tx: Tx },
) => Promise<unknown>;

const handlers = new Map<string, { fn: JobHandler; transactional: boolean }>();

/**
 * Registers a job handler. `transactional: false` handlers run their own short transactions
 * (use for long external calls so we don't hold a DB transaction open).
 */
export function registerJob(type: string, fn: JobHandler, opts: { transactional?: boolean } = {}): void {
  handlers.set(type, { fn, transactional: opts.transactional ?? true });
}

export interface EnqueueOptions {
  runAt?: Date;
  priority?: number;
  maxAttempts?: number;
  dedupeKey?: string;
}

export async function enqueue(
  tx: Tx,
  tenantId: string,
  type: string,
  payload: Record<string, unknown>,
  opts: EnqueueOptions = {},
): Promise<string | null> {
  const [row] = await tx
    .insert(jobs)
    .values({
      tenantId,
      type,
      payload,
      runAt: opts.runAt ?? new Date(),
      priority: opts.priority ?? 100,
      maxAttempts: opts.maxAttempts ?? 5,
      dedupeKey: opts.dedupeKey ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: jobs.id });
  return row?.id ?? null;
}

export function backoffMs(attempt: number): number {
  return Math.min(5_000 * 2 ** (attempt - 1), 60 * 60_000);
}

const workerId = `${hostname()}:${process.pid}`;

async function claim(limit: number) {
  return systemDb.transaction(async (tx) => {
    const rows = await tx.execute<{ id: string }>(sql`
      select id from jobs
      where status in ('PENDING','RETRYING') and run_at <= now()
      order by priority asc, run_at asc
      limit ${limit}
      for update skip locked`);
    const ids = rows.rows.map((r) => r.id);
    if (!ids.length) return [];
    return tx
      .update(jobs)
      .set({
        status: 'RUNNING',
        lockedAt: new Date(),
        lockedBy: workerId,
        attempts: sql`${jobs.attempts} + 1`,
        updatedAt: new Date(),
      })
      .where(inArray(jobs.id, ids))
      .returning();
  });
}

export async function runJob(job: typeof jobs.$inferSelect): Promise<void> {
  const h = handlers.get(job.type);
  try {
    if (!h) throw new Error(`No handler registered for job type ${job.type}`);
    let result: unknown;
    if (h.transactional) {
      result = await withTenant({ tenantId: job.tenantId }, (tx) =>
        h.fn(job.payload, { tenantId: job.tenantId, jobId: job.id, attempt: job.attempts, tx }),
      );
    } else {
      // Non-transactional handlers manage their own short transactions via withTenant (no tx is held open
      // across slow external calls). Accessing ctx.tx there is a programming error.
      const noTx = new Proxy(
        {},
        {
          get: () => {
            throw new Error('non-transactional job must use withTenant()');
          },
        },
      ) as Tx;
      result = await h.fn(job.payload, {
        tenantId: job.tenantId,
        jobId: job.id,
        attempt: job.attempts,
        tx: noTx,
      });
    }
    await systemDb
      .update(jobs)
      .set({
        status: 'SUCCESS',
        result: (result ?? null) as never,
        finishedAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, job.id));
  } catch (e) {
    const message = e instanceof Error ? `${e.message}` : String(e);
    const dead = job.attempts >= job.maxAttempts;
    logger.warn(
      { jobId: job.id, type: job.type, attempt: job.attempts, err: message },
      dead ? 'job dead-lettered' : 'job failed, will retry',
    );
    await systemDb
      .update(jobs)
      .set({
        status: dead ? 'DEAD_LETTER' : 'RETRYING',
        lastError: message.slice(0, 4000),
        runAt: new Date(Date.now() + backoffMs(job.attempts)),
        lockedAt: null,
        lockedBy: null,
        finishedAt: dead ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, job.id));
  }
}

/** Recovers jobs whose worker died mid-run (lock older than 15 minutes). */
export async function recoverStuckJobs(): Promise<number> {
  const r = await systemDb
    .update(jobs)
    .set({
      status: 'RETRYING',
      lockedAt: null,
      lockedBy: null,
      lastError: 'worker lost (recovered)',
      updatedAt: new Date(),
    })
    .where(and(eq(jobs.status, 'RUNNING'), lte(jobs.lockedAt, new Date(Date.now() - 15 * 60_000))))
    .returning({ id: jobs.id });
  return r.length;
}

let running = false;

export function startWorker(concurrency = 4, pollMs = 1000): () => Promise<void> {
  running = true;
  let active = 0;
  const inflight = new Set<Promise<void>>();
  let lastRecover = 0;
  const loop = async () => {
    while (running) {
      try {
        if (Date.now() - lastRecover > 60_000) {
          lastRecover = Date.now();
          await recoverStuckJobs();
        }
        const free = concurrency - active;
        if (free > 0) {
          const claimed = await claim(free);
          for (const job of claimed) {
            active++;
            const p = runJob(job).finally(() => {
              active--;
              inflight.delete(p);
            });
            inflight.add(p);
          }
          if (claimed.length) continue;
        }
      } catch (e) {
        logger.error({ err: e instanceof Error ? e.message : e }, 'worker loop error');
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  };
  void loop();
  return async () => {
    running = false;
    await Promise.allSettled([...inflight]);
  };
}

/** Test helper: process everything currently due, synchronously. */
export async function drainJobs(maxRounds = 20): Promise<number> {
  let n = 0;
  for (let i = 0; i < maxRounds; i++) {
    const claimed = await claim(10);
    if (!claimed.length) break;
    for (const j of claimed) {
      await runJob(j);
      n++;
    }
  }
  return n;
}
