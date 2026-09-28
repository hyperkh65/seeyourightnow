import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { withTenant, type Tx } from '../db/client.js';
import { shipmentEvents, shipments, sourcingProjects } from '../db/schema/index.js';
import { safeFetch } from '../lib/http.js';
import {
  connectionsWithCapability,
  recordConnectionResult,
  type LoadedConnection,
} from './connections/index.js';
import { registerJob } from './jobs.js';
import { notifyEvent } from './notify.js';
import { completeStep } from './workflow.js';

export type CustomsStatus = 'IN_PROGRESS' | 'HOLD' | 'CLEARED';
type Shipment = typeof shipments.$inferSelect;

/**
 * Applies a customs status to a shipment (manual entry or UNI-PASS): records a provenance-tagged
 * event, advances the workflow on clearance, flags holds on the project and notifies the customer.
 */
export async function applyCustomsStatus(
  tx: Tx,
  tenantId: string,
  s: Shipment,
  status: CustomsStatus,
  note: string,
  source: 'MANUAL' | 'CUSTOMS_API',
  by: string | null,
  occurredAt = new Date(),
): Promise<void> {
  await tx
    .update(shipments)
    .set({ customsStatus: status, updatedAt: new Date() })
    .where(eq(shipments.id, s.id));
  await tx.insert(shipmentEvents).values({
    tenantId,
    shipmentId: s.id,
    eventType: 'CUSTOMS',
    source,
    occurredAt,
    locationCode: s.destinationPort,
    note: `${status} ${note}`.trim(),
  });
  if (status === 'CLEARED') {
    await completeStep(tx, tenantId, s.projectId, 'CUSTOMS', by);
    await notifyEvent(tx, tenantId, 'CUSTOMS_COMPLETED', s.projectId, {}, { dedupeKey: `customs:${s.id}` });
  }
  if (status === 'HOLD') {
    const [p] = await tx.select().from(sourcingProjects).where(eq(sourcingProjects.id, s.projectId)).limit(1);
    await tx
      .update(sourcingProjects)
      .set({
        attention: [
          ...(p?.attention ?? []),
          { kind: 'CUSTOMS_HOLD', message: note || '통관 보류', since: new Date().toISOString() },
        ],
      })
      .where(eq(sourcingProjects.id, s.projectId));
  }
}

// ─── UNI-PASS 화물통관 진행정보 ───

const tag = (xml: string, name: string): string[] =>
  [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g'))].map((m) => m[1]!.trim());

/** Maps a UNI-PASS progress text (e.g. 수입신고수리, 반출신고, 검사대상) to our customs status. */
export function mapUnipassStatus(text: string): CustomsStatus | null {
  const t = text.replace(/\s/g, '');
  if (!t) return null;
  if (/보류|검사대상|검사지정|정정|취하/.test(t)) return 'HOLD';
  if (/신고수리|수리|반출/.test(t)) return 'CLEARED';
  if (/신고|입항|하선|반입|적하|심사/.test(t)) return 'IN_PROGRESS';
  return null;
}

export interface UnipassResult {
  found: boolean;
  status: CustomsStatus | null;
  statusText: string;
  steps: Array<{ name: string; at: Date | null }>;
  message: string | null;
}

/** Parses the XML response of the cargo customs progress API. */
export function parseUnipassCargo(xml: string): UnipassResult {
  const count = Number(tag(xml, 'tCnt')[0] ?? '0');
  const notice = tag(xml, 'ntceInfo')[0] ?? null;
  if (!count)
    return {
      found: false,
      status: null,
      statusText: '',
      steps: [],
      message: notice || '조회 결과가 없습니다.',
    };
  const statusText = tag(xml, 'csclPrgsStts')[0] || tag(xml, 'prgsStts')[0] || '';
  const blocks = tag(xml, 'cargCsclPrgsInfoDtlQryVo');
  const steps = blocks.map((b) => {
    const raw = tag(b, 'prcsDttm')[0] ?? '';
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/.exec(raw);
    // UNI-PASS times are Korea Standard Time (UTC+9).
    const at = m
      ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}+09:00`)
      : null;
    return { name: tag(b, 'cargTrcnRelaBsopTpcd')[0] ?? '', at };
  });
  return { found: true, status: mapUnipassStatus(statusText), statusText, steps, message: notice };
}

export async function fetchUnipassCargo(
  conn: LoadedConnection,
  blNumber: string,
  year: number,
): Promise<UnipassResult> {
  const base = String(conn.config.cargoProgressUrl ?? '');
  if (!base) throw new Error('UNI-PASS 화물통관 API 주소가 설정되지 않았습니다.');
  let last: UnipassResult | null = null;
  for (const key of ['hblNo', 'mblNo']) {
    const url = `${base}${base.includes('?') ? '&' : '?'}crkyCn=${encodeURIComponent(conn.secrets.cargoKey ?? '')}&${key}=${encodeURIComponent(blNumber)}&blYy=${year}`;
    const res = await safeFetch(url, { trusted: true, timeoutMs: 15_000 });
    if (!res.ok) throw new Error(`UNI-PASS HTTP ${res.status}`);
    last = parseUnipassCargo(await res.text());
    if (last.found) return last;
  }
  return last!;
}

registerJob('customs.unipass', async (payload, { tenantId }) => {
  const shipmentId = String(payload.shipmentId);
  const { s, conn } = await withTenant({ tenantId }, async (tx) => {
    const [s] = await tx.select().from(shipments).where(eq(shipments.id, shipmentId)).limit(1);
    const conns = await connectionsWithCapability(tx, tenantId, 'CUSTOMS_TRACKING');
    return { s, conn: conns.find((c) => c.provider === 'UNIPASS') };
  });
  if (!s || !conn) return { skipped: !s ? 'not found' : 'no UNI-PASS connection' };
  if (!s.blNumber || s.customsStatus === 'CLEARED') return { skipped: 'nothing to check' };
  const year = (s.atd ?? s.etd ?? s.createdAt).getUTCFullYear();
  try {
    const r = await fetchUnipassCargo(conn, s.blNumber, year);
    await recordConnectionResult(tenantId, conn.id, true);
    if (!r.found || !r.status || r.status === s.customsStatus) return { found: r.found, status: r.status };
    const last = [...r.steps].reverse().find((x) => x.at);
    await withTenant({ tenantId }, (tx) =>
      applyCustomsStatus(
        tx,
        tenantId,
        s,
        r.status!,
        `UNI-PASS: ${r.statusText}`,
        'CUSTOMS_API',
        null,
        last?.at ?? new Date(),
      ),
    );
    return { found: true, status: r.status };
  } catch (e) {
    await recordConnectionResult(tenantId, conn.id, false, e instanceof Error ? e.message : String(e));
    throw e;
  }
});

/** Shipments whose customs status should be polled. */
export async function shipmentsAwaitingCustoms(tx: Tx): Promise<Array<{ id: string }>> {
  return tx
    .select({ id: shipments.id })
    .from(shipments)
    .where(
      and(
        inArray(shipments.status, ['IN_TRANSIT', 'ARRIVED', 'RELEASED']),
        isNotNull(shipments.blNumber),
        ne(shipments.blNumber, ''),
        ne(shipments.customsStatus, 'CLEARED'),
      ),
    );
}
