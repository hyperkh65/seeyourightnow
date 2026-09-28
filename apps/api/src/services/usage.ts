import { sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { systemDb } from '../db/client.js';
import { usageCounters } from '../db/schema/index.js';
import { limitExceeded } from '../lib/errors.js';
import { effectiveFeatures } from './tenancy.js';

const period = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/**
 * Increments a usage metric and enforces plan limits. Hard limits reject,
 * soft limits allow but are reported to admins.
 */
export async function consume(
  tenantId: string,
  metric: string,
  amount = 1,
): Promise<{ count: number; limit: number | null; exceeded: boolean }> {
  const { limits } = await effectiveFeatures(tenantId);
  const limit = limits[metric];
  const [row] = await systemDb
    .insert(usageCounters)
    .values({ tenantId, metric, period: period(), count: amount })
    .onConflictDoUpdate({
      target: [usageCounters.tenantId, usageCounters.metric, usageCounters.period],
      set: { count: sql`${usageCounters.count} + ${amount}`, updatedAt: new Date() },
    })
    .returning({ count: usageCounters.count });
  const count = row?.count ?? amount;
  const exceeded = !!limit && limit.value >= 0 && count > limit.value;
  if (exceeded && limit?.hard) {
    await systemDb
      .update(usageCounters)
      .set({ count: sql`${usageCounters.count} - ${amount}` })
      .where(
        sql`${usageCounters.tenantId} = ${tenantId} and ${usageCounters.metric} = ${metric} and ${usageCounters.period} = ${period()}`,
      );
    throw limitExceeded(metric);
  }
  return { count, limit: limit?.value ?? null, exceeded };
}

export async function consumeFor(req: FastifyRequest, metric: string, amount = 1) {
  if (!req.ctx.tenant) return null;
  return consume(req.ctx.tenant.id, metric, amount);
}

export async function usageFor(tenantId: string) {
  return systemDb
    .select()
    .from(usageCounters)
    .where(sql`${usageCounters.tenantId} = ${tenantId} and ${usageCounters.period} = ${period()}`);
}
