import type { FastifyRequest } from 'fastify';
import { systemDb, type Tx } from '../db/client.js';
import { auditLogs } from '../db/schema/index.js';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

const SENSITIVE_KEYS = /password|secret|token|apiKey|api_key|mfa|ciphertext|accountNumber/i;

/** Removes secret material from audit payloads while keeping the fact that it changed. */
export function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.test(k)) out[k] = v === null || v === undefined || v === '' ? v : '[REDACTED]';
      else out[k] = scrub(v);
    }
    return out;
  }
  return value;
}

/** Writes an audit row inside the caller's tenant transaction (atomic with the change). */
export async function audit(tx: Tx, req: FastifyRequest | null, e: AuditEntry, tenantIdOverride?: string | null): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: tenantIdOverride !== undefined ? tenantIdOverride : (req?.ctx.tenant?.id ?? null),
    actorId: req?.ctx.user?.id ?? null,
    actorRole: req?.ctx.user?.roles.join(',') ?? 'SYSTEM',
    impersonatorId: req?.ctx.session?.impersonatorId ?? null,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? '',
    before: e.before === undefined ? null : scrub(e.before),
    after: e.after === undefined ? null : scrub(e.after),
    ip: req?.ctx.ip ?? '',
    userAgent: req?.ctx.userAgent ?? '',
    requestId: req?.ctx.requestId ?? '',
  });
}

/** Platform-level audit (super admin actions, cross-tenant operations). */
export async function auditSystem(req: FastifyRequest | null, e: AuditEntry & { tenantId?: string | null }): Promise<void> {
  await systemDb.insert(auditLogs).values({
    tenantId: e.tenantId ?? null,
    actorId: req?.ctx.user?.id ?? null,
    actorRole: req?.ctx.user?.roles.join(',') ?? 'SYSTEM',
    impersonatorId: req?.ctx.session?.impersonatorId ?? null,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? '',
    before: e.before === undefined ? null : scrub(e.before),
    after: e.after === undefined ? null : scrub(e.after),
    ip: req?.ctx.ip ?? '',
    userAgent: req?.ctx.userAgent ?? '',
    requestId: req?.ctx.requestId ?? '',
  });
}
