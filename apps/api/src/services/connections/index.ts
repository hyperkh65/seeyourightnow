import { and, eq } from 'drizzle-orm';
import { withTenant, type Tx } from '../../db/client.js';
import { apiConnections } from '../../db/schema/index.js';
import { readSecret } from '../secrets.js';
import { providerDef, type ConnectionRuntime } from './registry.js';

export type ConnectionRow = typeof apiConnections.$inferSelect;

export interface LoadedConnection extends ConnectionRuntime {
  id: string;
  provider: string;
  label: string;
  row: ConnectionRow;
}

const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_OPEN_MS = 5 * 60_000;

export async function loadConnection(tx: Tx, row: ConnectionRow): Promise<LoadedConnection> {
  const secrets: Record<string, string> = {};
  for (const [k, ref] of Object.entries(row.secretRefs)) {
    const v = await readSecret(tx, ref);
    if (v !== null) secrets[k] = v;
  }
  return { id: row.id, provider: row.provider, label: row.label, row, config: row.config, secrets };
}

/** Enabled connections that provide a capability, excluding those with an open circuit breaker. */
export async function connectionsWithCapability(tx: Tx, tenantId: string, capability: string): Promise<LoadedConnection[]> {
  const rows = await tx.select().from(apiConnections).where(and(eq(apiConnections.tenantId, tenantId), eq(apiConnections.enabled, true)));
  const now = Date.now();
  const out: LoadedConnection[] = [];
  for (const r of rows) {
    const def = providerDef(r.provider);
    if (!def?.capabilities.includes(capability)) continue;
    if (r.circuitOpenUntil && r.circuitOpenUntil.getTime() > now) continue;
    out.push(await loadConnection(tx, r));
  }
  return out;
}

export async function connectionById(tx: Tx, id: string): Promise<LoadedConnection | null> {
  const [row] = await tx.select().from(apiConnections).where(eq(apiConnections.id, id)).limit(1);
  if (!row || !row.enabled) return null;
  if (row.circuitOpenUntil && row.circuitOpenUntil.getTime() > Date.now()) return null;
  return loadConnection(tx, row);
}

/** Records the outcome of a real call: updates status/last success/last error and the circuit breaker. */
export async function recordConnectionResult(tenantId: string, connectionId: string, ok: boolean, error?: string): Promise<void> {
  await withTenant({ tenantId }, async (tx) => {
    const [row] = await tx.select().from(apiConnections).where(eq(apiConnections.id, connectionId)).limit(1);
    if (!row) return;
    if (ok) {
      await tx.update(apiConnections).set({ status: 'CONNECTED', lastSuccessAt: new Date(), consecutiveFailures: 0, circuitOpenUntil: null, updatedAt: new Date() }).where(eq(apiConnections.id, connectionId));
    } else {
      const failures = row.consecutiveFailures + 1;
      await tx
        .update(apiConnections)
        .set({
          status: 'ERROR',
          lastError: (error ?? 'error').slice(0, 1000),
          consecutiveFailures: failures,
          circuitOpenUntil: failures >= CIRCUIT_THRESHOLD ? new Date(Date.now() + CIRCUIT_OPEN_MS) : row.circuitOpenUntil,
          updatedAt: new Date(),
        })
        .where(eq(apiConnections.id, connectionId));
    }
  });
}
