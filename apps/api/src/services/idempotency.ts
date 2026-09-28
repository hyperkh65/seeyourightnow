import { and, eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { withTenant } from '../db/client.js';
import { idempotencyKeys } from '../db/schema/index.js';
import { AppError } from '../lib/errors.js';
import { sha256Hex } from '../lib/crypto.js';
import { tenantOf } from '../http/context.js';

/**
 * Idempotent execution for critical mutations (approvals, issuing documents,
 * orders, payments, emails, RFQs). The client sends an `Idempotency-Key`
 * header; a double click or network retry returns the first result instead of
 * executing twice. Keys are scoped per tenant + route and expire after 24h.
 */
export async function idempotent<T>(req: FastifyRequest, reply: FastifyReply, routeKey: string, fn: () => Promise<T>): Promise<T> {
  const key = (req.headers['idempotency-key'] as string | undefined)?.trim();
  if (!key) return fn();
  if (key.length > 128) throw new AppError(400, 'BAD_IDEMPOTENCY_KEY', 'Idempotency-Key가 너무 깁니다.');
  const tenant = tenantOf(req);
  const requestHash = sha256Hex(JSON.stringify({ body: req.body ?? null, params: req.params ?? null }));
  const ctx = { tenantId: tenant.id, userId: req.ctx.user?.id ?? null };

  const inserted = await withTenant(ctx, (tx) =>
    tx
      .insert(idempotencyKeys)
      .values({ tenantId: tenant.id, userId: ctx.userId, key, route: routeKey, requestHash, expiresAt: new Date(Date.now() + 24 * 3_600_000) })
      .onConflictDoNothing()
      .returning({ id: idempotencyKeys.id }),
  );

  if (!inserted.length) {
    const [existing] = await withTenant(ctx, (tx) =>
      tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.tenantId, tenant.id), eq(idempotencyKeys.key, key), eq(idempotencyKeys.route, routeKey))).limit(1),
    );
    if (!existing) throw new AppError(409, 'IDEMPOTENCY_RACE', '요청을 처리 중입니다. 잠시 후 다시 시도해 주세요.');
    if (existing.requestHash !== requestHash) throw new AppError(422, 'IDEMPOTENCY_MISMATCH', '같은 Idempotency-Key로 다른 요청을 보낼 수 없습니다.');
    if (existing.status !== 'COMPLETED') throw new AppError(409, 'IN_PROGRESS', '이미 처리 중인 요청입니다.');
    reply.header('Idempotent-Replayed', 'true');
    if (existing.responseStatus) reply.status(existing.responseStatus);
    return existing.responseBody as T;
  }

  try {
    const result = await fn();
    await withTenant(ctx, (tx) =>
      tx
        .update(idempotencyKeys)
        .set({ status: 'COMPLETED', responseStatus: reply.statusCode || 200, responseBody: (result ?? null) as never })
        .where(and(eq(idempotencyKeys.tenantId, tenant.id), eq(idempotencyKeys.key, key), eq(idempotencyKeys.route, routeKey))),
    );
    return result;
  } catch (e) {
    // Failed attempts release the key so the client can retry.
    await withTenant(ctx, (tx) => tx.delete(idempotencyKeys).where(and(eq(idempotencyKeys.tenantId, tenant.id), eq(idempotencyKeys.key, key), eq(idempotencyKeys.route, routeKey))));
    throw e;
  }
}
