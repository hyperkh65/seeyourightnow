import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { D } from '@sos/core';
import { withTenant } from '../db/client.js';
import {
  idempotencyKeys,
  listingPriceHistory,
  pricingSnapshots,
  quotationItems,
  quotations,
  quotationVersions,
  requestCandidates,
  sourceListings,
  sourcingProjects,
  sourcingRequests,
  users,
  watchedItems,
} from '../db/schema/index.js';
import { connectionsWithCapability, recordConnectionResult } from '../services/connections/index.js';
import { fetchKoreaEximRates, saveFxRates } from '../services/fx.js';
import { enqueue, registerJob } from '../services/jobs.js';
import { notifyEvent, notifyUsers, staffUserIds } from '../services/notify.js';
import { getPublished } from '../services/settings.js';

/** Marks SENT quotations past their validity as EXPIRED and sends reminders 2 days before. */
registerJob('quotes.expire', async (_p, { tx, tenantId }) => {
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const rows = await tx
    .select({ q: quotations, v: quotationVersions })
    .from(quotations)
    .innerJoin(quotationVersions, eq(quotationVersions.id, quotations.currentVersionId))
    .where(eq(quotations.status, 'SENT'));
  let expired = 0;
  for (const { q, v } of rows) {
    if (v.validUntil && v.validUntil < today) {
      await tx
        .update(quotations)
        .set({ status: 'EXPIRED', updatedAt: new Date() })
        .where(eq(quotations.id, q.id));
      await tx.update(quotationVersions).set({ status: 'EXPIRED' }).where(eq(quotationVersions.id, v.id));
      expired++;
    } else if (v.validUntil && v.validUntil <= soon) {
      await notifyEvent(
        tx,
        tenantId,
        'QUOTE_REMINDER',
        q.projectId,
        { quoteNumber: q.number, validUntil: v.validUntil },
        { dedupeKey: `reminder:${v.id}` },
      );
    }
  }
  return { expired };
});

/** Daily FX from Korea Eximbank when configured (rates stored with 기준일 and source). */
registerJob(
  'fx.daily',
  async (_p, { tenantId }) => {
    const conns = await withTenant({ tenantId }, (tx) => connectionsWithCapability(tx, tenantId, 'FX'));
    const conn = conns.find((c) => c.provider === 'KOREAEXIM_FX');
    if (!conn) return { skipped: 'FX connector not configured' };
    try {
      let rows = await fetchKoreaEximRates(conn);
      // Weekends/holidays return empty — fall back to the previous business days.
      for (let back = 1; rows.length === 0 && back <= 4; back++)
        rows = await fetchKoreaEximRates(conn, new Date(Date.now() - back * 86_400_000));
      await withTenant({ tenantId }, (tx) =>
        saveFxRates(tx, tenantId, rows, 'KOREAEXIM', 'SYSTEM_CALCULATED'),
      );
      await recordConnectionResult(tenantId, conn.id, true);
      return { saved: rows.length };
    } catch (e) {
      await recordConnectionResult(tenantId, conn.id, false, e instanceof Error ? e.message : String(e));
      throw e;
    }
  },
  { transactional: false },
);

/**
 * Change detection: when a supplier price changes, find active quotations that use it
 * and alert staff ("공급가 12% 상승, 활성 견적 4건 영향").
 */
registerJob('change.detect', async (payload, { tx, tenantId }) => {
  const listingId = String(payload.listingId);
  const hist = await tx
    .select()
    .from(listingPriceHistory)
    .where(eq(listingPriceHistory.listingId, listingId))
    .orderBy(desc(listingPriceHistory.observedAt))
    .limit(2);
  if (hist.length < 2) return { skipped: 'no previous price' };
  const [cur, prev] = hist as [(typeof hist)[number], (typeof hist)[number]];
  if (new D(prev.unitPrice).isZero()) return { skipped: 'zero' };
  const pct = new D(cur.unitPrice).sub(prev.unitPrice).div(prev.unitPrice).mul(100);
  if (pct.abs().lt(3)) return { changePct: pct.toFixed(1), significant: false };
  const cands = await tx
    .select({ id: requestCandidates.id })
    .from(requestCandidates)
    .where(eq(requestCandidates.listingId, listingId));
  const snaps = cands.length
    ? await tx
        .select({ id: pricingSnapshots.id })
        .from(pricingSnapshots)
        .where(
          inArray(
            pricingSnapshots.candidateId,
            cands.map((c) => c.id),
          ),
        )
    : [];
  const items = snaps.length
    ? await tx
        .select({ versionId: quotationItems.quotationVersionId })
        .from(quotationItems)
        .where(
          inArray(
            quotationItems.pricingSnapshotId,
            snaps.map((s) => s.id),
          ),
        )
    : [];
  const vers = items.length
    ? await tx
        .select({ quotationId: quotationVersions.quotationId })
        .from(quotationVersions)
        .where(
          inArray(
            quotationVersions.id,
            items.map((i) => i.versionId),
          ),
        )
    : [];
  const active = vers.length
    ? await tx
        .select({ id: quotations.id, number: quotations.number, projectId: quotations.projectId })
        .from(quotations)
        .where(
          and(
            inArray(
              quotations.id,
              vers.map((v) => v.quotationId),
            ),
            inArray(quotations.status, ['DRAFT', 'ADMIN_REVIEW', 'SENT', 'CUSTOMER_APPROVED']),
          ),
        )
    : [];
  const [l] = await tx
    .select({ title: sourceListings.title })
    .from(sourceListings)
    .where(eq(sourceListings.id, listingId))
    .limit(1);
  const msg = `공급가 ${pct.gt(0) ? '+' : ''}${pct.toFixed(0)}% ${pct.gt(0) ? '상승' : '하락'}, 활성 견적 ${active.length}건 영향`;
  await notifyUsers(tx, tenantId, await staffUserIds(tx, tenantId), {
    kind: 'PRICE_CHANGE',
    title: `${l?.title.slice(0, 40) ?? '상품'}: ${msg}`,
    link: active[0] ? `/admin/quotes/${active[0].id}` : '/admin/suppliers',
    severity: active.length ? 'WARNING' : 'INFO',
    dedupeKey: `price:${listingId}:${cur.id}`,
  });
  for (const q of active) {
    const [p] = await tx.select().from(sourcingProjects).where(eq(sourcingProjects.id, q.projectId)).limit(1);
    if (p)
      await tx
        .update(sourcingProjects)
        .set({
          attention: [
            ...p.attention.filter((a) => a.kind !== 'PRICE_CHANGE'),
            { kind: 'PRICE_CHANGE', message: `${q.number}: ${msg}`, since: new Date().toISOString() },
          ],
        })
        .where(eq(sourcingProjects.id, p.id));
  }
  return { changePct: pct.toFixed(1), affectedQuotes: active.length };
});

/** Periodic scan of watched listings (via their connector refresh) and stale price flags. */
registerJob('change.scan', async (_p, { tx, tenantId }) => {
  const search = await getPublished(tx, tenantId, 'search');
  const staleBefore = new Date(Date.now() - search.staleDaysWarning * 86_400_000);
  const watched = await tx.select().from(watchedItems);
  for (const w of watched)
    await enqueue(
      tx,
      tenantId,
      'change.detect',
      { listingId: w.listingId },
      { dedupeKey: `change:${w.listingId}:${new Date().toISOString().slice(0, 10)}` },
    );
  const [stale] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(sourceListings)
    .where(lt(sourceListings.lastCheckedAt, staleBefore));
  return { watched: watched.length, staleListings: stale?.n ?? 0 };
});

/** Retention & housekeeping: expired idempotency keys, anonymous request data, anonymisation of inactive customers. */
registerJob('maintenance.daily', async (_p, { tx, tenantId }) => {
  const privacy = await getPublished(tx, tenantId, 'privacy');
  await tx.delete(idempotencyKeys).where(lt(idempotencyKeys.expiresAt, new Date()));
  const anonCutoff = new Date(Date.now() - privacy.retentionDaysAnonymousSearch * 86_400_000);
  const anon = await tx
    .update(sourcingRequests)
    .set({ description: '', url: '', anonymousIpHash: null, accessTokenHash: null })
    .where(
      and(
        isNull(sourcingRequests.projectId),
        lt(sourcingRequests.createdAt, anonCutoff),
        sql`${sourcingRequests.accessTokenHash} is not null`,
      ),
    )
    .returning({ id: sourcingRequests.id });
  const inactiveCutoff = new Date(Date.now() - privacy.anonymizeInactiveCustomersDays * 86_400_000);
  const stale = await tx
    .update(users)
    .set({
      name: '탈퇴/비활성 고객',
      phone: '',
      email: sql`'anon+' || ${users.id} || '@invalid'`,
      status: 'DISABLED',
      anonymizedAt: new Date(),
      passwordHash: null,
    })
    .where(
      and(
        isNull(users.anonymizedAt),
        lt(sql`coalesce(${users.lastLoginAt}, ${users.createdAt})`, inactiveCutoff),
        sql`exists (select 1 from user_roles r where r.user_id = ${users.id} and r.role like 'CUSTOMER_%')`,
      ),
    )
    .returning({ id: users.id });
  return { anonymousRequestsScrubbed: anon.length, customersAnonymized: stale.length };
});
