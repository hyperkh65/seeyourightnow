import { desc, eq, isNull, or, sql } from 'drizzle-orm';
import { D, FxTable, type FxRate } from '@sos/core';
import type { Tx } from '../db/client.js';
import { fxRates } from '../db/schema/index.js';
import { safeFetch } from '../lib/http.js';
import type { LoadedConnection } from './connections/index.js';

/** Latest known rate per currency pair (tenant-specific rows win over platform rows). */
export async function loadFxTable(
  tx: Tx,
  tenantId: string,
): Promise<{
  table: FxTable;
  rates: Array<FxRate & { verification: string; collectedAt: Date; tenantScoped: boolean }>;
}> {
  const rows = await tx
    .select()
    .from(fxRates)
    .where(or(eq(fxRates.tenantId, tenantId), isNull(fxRates.tenantId)))
    .orderBy(desc(fxRates.rateDate), desc(fxRates.collectedAt))
    .limit(500);
  const seen = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const k = `${r.base}/${r.quote}`;
    const cur = seen.get(k);
    if (!cur || (r.tenantId && !cur.tenantId && r.rateDate >= cur.rateDate)) seen.set(k, r);
  }
  const rates = [...seen.values()].map((r) => ({
    base: r.base,
    quote: r.quote,
    rate: r.rate,
    rateDate: r.rateDate,
    source: r.source,
    verification: r.verification,
    collectedAt: r.collectedAt,
    tenantScoped: !!r.tenantId,
  }));
  return { table: new FxTable(rates), rates };
}

/** Korea Eximbank daily rates (매매기준율, KRW per unit). */
export async function fetchKoreaEximRates(
  conn: LoadedConnection,
  date = new Date(),
): Promise<Array<{ base: string; rate: string; rateDate: string }>> {
  const ymd = date.toISOString().slice(0, 10).replace(/-/g, '');
  const url = `https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON?authkey=${encodeURIComponent(conn.secrets.authKey ?? '')}&searchdate=${ymd}&data=AP01`;
  const res = await safeFetch(url, { trusted: true, timeoutMs: 15_000 });
  if (!res.ok) throw new Error(`KOREAEXIM HTTP ${res.status}`);
  const rows = (await res.json()) as Array<{ result: number; cur_unit: string; deal_bas_r: string }>;
  const out: Array<{ base: string; rate: string; rateDate: string }> = [];
  for (const r of rows ?? []) {
    if (r.result !== 1) continue;
    const rawText = String(r.deal_bas_r).replace(/,/g, '');
    if (!/^\d+(\.\d+)?$/.test(rawText) || new D(rawText).lte(0)) continue;
    let base = r.cur_unit;
    let rate = new D(rawText);
    const per = /\((\d+)\)/.exec(base);
    if (per) {
      rate = rate.div(per[1]!);
      base = base.replace(/\(\d+\)/, '');
    }
    if (base === 'CNH') base = 'CNY';
    out.push({ base, rate: rate.toFixed(), rateDate: date.toISOString().slice(0, 10) });
  }
  return out;
}

export async function saveFxRates(
  tx: Tx,
  tenantId: string | null,
  rows: Array<{ base: string; rate: string; rateDate: string }>,
  source: string,
  verification = 'SYSTEM_CALCULATED',
): Promise<number> {
  for (const r of rows) {
    await tx.insert(fxRates).values({
      tenantId,
      base: r.base,
      quote: 'KRW',
      rate: r.rate,
      rateDate: r.rateDate,
      source,
      verification,
    });
  }
  return rows.length;
}

/** 30-day volatility (max/min − 1) for FX risk. */
export async function fxVolatilityPct(tx: Tx, tenantId: string, base: string): Promise<number | null> {
  const r = await tx.execute<{ v: number | null }>(sql`
    select (max(rate::numeric) / nullif(min(rate::numeric),0) - 1) * 100 as v from fx_rates
    where base = ${base} and quote = 'KRW' and (tenant_id = ${tenantId} or tenant_id is null) and rate_date >= to_char(now() - interval '30 days', 'YYYY-MM-DD')`);
  const v = r.rows[0]?.v;
  return v === null || v === undefined ? null : Number(v);
}
