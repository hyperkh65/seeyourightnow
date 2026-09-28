import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { config } from '../config.js';
import * as schema from './schema/index.js';

// NUMERIC → string (never JS float). pg already returns strings for numeric; keep it explicit.
pg.types.setTypeParser(1700, (v) => v);
// int8 → number (counts only; money never uses int8)
pg.types.setTypeParser(20, (v) => Number(v));

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Runtime pool: role sos_app, Row Level Security enforced. */
export const appPool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: config.DB_POOL_MAX,
  application_name: 'sos-api',
});
/** Trusted system pool: role sos_system (BYPASSRLS). Only for auth, job polling, tenant resolution and platform admin. */
export const systemPool = new pg.Pool({
  connectionString: config.DATABASE_SYSTEM_URL,
  max: Math.max(4, Math.floor(config.DB_POOL_MAX / 2)),
  application_name: 'sos-system',
});

export const appDb: Db = drizzle(appPool, { schema });
export const systemDb: Db = drizzle(systemPool, { schema });

export interface TenantContext {
  tenantId: string;
  userId?: string | null;
}

/**
 * Runs `fn` inside a transaction scoped to one tenant. `app.tenant_id` is set
 * transaction-locally so pooled connections can never leak tenant context.
 */
export async function withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!ctx.tenantId) throw new Error('withTenant requires tenantId');
  return appDb.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.tenant_id', ${ctx.tenantId}, true), set_config('app.user_id', ${ctx.userId ?? ''}, true)`,
    );
    return fn(tx);
  });
}

/** System-level transaction (bypasses RLS). Use sparingly and never with user-controlled tenant ids without validation. */
export async function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return systemDb.transaction(async (tx) => fn(tx));
}

export async function closeDb(): Promise<void> {
  await Promise.allSettled([appPool.end(), systemPool.end()]);
}
