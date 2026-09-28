import { and, eq } from 'drizzle-orm';
import { config } from '../config.js';
import type { Tx } from '../db/client.js';
import { secrets } from '../db/schema/index.js';
import { decrypt, encrypt, last4 } from '../lib/crypto.js';

/**
 * Secret store abstraction. The database only keeps a reference (and, for the
 * BUILTIN backend, AES-256-GCM ciphertext). Plain values are never returned to
 * clients: the UI only ever sees `********ABCD`.
 */

interface SecretBackend {
  name: 'BUILTIN' | 'VAULT' | 'INFISICAL';
  put(
    tenantId: string,
    name: string,
    value: string,
  ): Promise<{ ciphertext: string | null; externalRef: string }>;
  get(row: typeof secrets.$inferSelect): Promise<string>;
}

const builtin: SecretBackend = {
  name: 'BUILTIN',
  async put(_t, _n, value) {
    return { ciphertext: encrypt(value), externalRef: '' };
  },
  async get(row) {
    if (!row.ciphertext) throw new Error('secret has no ciphertext');
    return decrypt(row.ciphertext);
  },
};

/** HashiCorp Vault KV v2. */
const vault: SecretBackend = {
  name: 'VAULT',
  async put(tenantId, name, value) {
    const path = `sourcing-os/${tenantId}/${name}`;
    const res = await fetch(`${config.VAULT_ADDR}/v1/${config.VAULT_MOUNT}/data/${path}`, {
      method: 'POST',
      headers: { 'X-Vault-Token': config.VAULT_TOKEN ?? '', 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { value } }),
    });
    if (!res.ok) throw new Error(`Vault write failed: ${res.status}`);
    return { ciphertext: null, externalRef: path };
  },
  async get(row) {
    const res = await fetch(`${config.VAULT_ADDR}/v1/${config.VAULT_MOUNT}/data/${row.externalRef}`, {
      headers: { 'X-Vault-Token': config.VAULT_TOKEN ?? '' },
    });
    if (!res.ok) throw new Error(`Vault read failed: ${res.status}`);
    const j = (await res.json()) as { data?: { data?: { value?: string } } };
    const v = j.data?.data?.value;
    if (typeof v !== 'string') throw new Error('Vault secret missing');
    return v;
  },
};

/** Infisical (v3 raw secrets API). */
const infisical: SecretBackend = {
  name: 'INFISICAL',
  async put(tenantId, name, value) {
    const key = `SOS_${tenantId.replace(/-/g, '')}_${name}`.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const res = await fetch(`${config.INFISICAL_API_URL}/api/v3/secrets/raw/${key}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.INFISICAL_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: config.INFISICAL_PROJECT_ID,
        environment: config.INFISICAL_ENVIRONMENT,
        secretValue: value,
        type: 'shared',
      }),
    });
    if (!res.ok && res.status !== 400) throw new Error(`Infisical write failed: ${res.status}`);
    if (res.status === 400) {
      const upd = await fetch(`${config.INFISICAL_API_URL}/api/v3/secrets/raw/${key}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${config.INFISICAL_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: config.INFISICAL_PROJECT_ID,
          environment: config.INFISICAL_ENVIRONMENT,
          secretValue: value,
          type: 'shared',
        }),
      });
      if (!upd.ok) throw new Error(`Infisical update failed: ${upd.status}`);
    }
    return { ciphertext: null, externalRef: key };
  },
  async get(row) {
    const url = new URL(`${config.INFISICAL_API_URL}/api/v3/secrets/raw/${row.externalRef}`);
    url.searchParams.set('workspaceId', config.INFISICAL_PROJECT_ID ?? '');
    url.searchParams.set('environment', config.INFISICAL_ENVIRONMENT);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${config.INFISICAL_TOKEN}` } });
    if (!res.ok) throw new Error(`Infisical read failed: ${res.status}`);
    const j = (await res.json()) as { secret?: { secretValue?: string } };
    if (typeof j.secret?.secretValue !== 'string') throw new Error('Infisical secret missing');
    return j.secret.secretValue;
  },
};

function backendFor(name: string): SecretBackend {
  return name === 'VAULT' ? vault : name === 'INFISICAL' ? infisical : builtin;
}

/** Creates or rotates a secret; returns its id (the reference stored elsewhere). */
export async function putSecret(
  tx: Tx,
  tenantId: string,
  name: string,
  value: string,
  userId?: string | null,
): Promise<string> {
  const backend = backendFor(config.SECRETS_BACKEND);
  const stored = await backend.put(tenantId, name, value);
  const [existing] = await tx
    .select()
    .from(secrets)
    .where(and(eq(secrets.tenantId, tenantId), eq(secrets.name, name)))
    .limit(1);
  if (existing) {
    await tx
      .update(secrets)
      .set({
        backend: backend.name,
        ciphertext: stored.ciphertext,
        externalRef: stored.externalRef,
        last4: last4(value),
        version: existing.version + 1,
        rotatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(secrets.id, existing.id));
    return existing.id;
  }
  const [row] = await tx
    .insert(secrets)
    .values({
      tenantId,
      name,
      backend: backend.name,
      ciphertext: stored.ciphertext,
      externalRef: stored.externalRef,
      last4: last4(value),
      createdBy: userId ?? null,
    })
    .returning({ id: secrets.id });
  return row!.id;
}

export async function readSecret(tx: Tx, secretId: string): Promise<string | null> {
  const [row] = await tx.select().from(secrets).where(eq(secrets.id, secretId)).limit(1);
  if (!row) return null;
  return backendFor(row.backend).get(row);
}

export async function secretMask(tx: Tx, secretId: string): Promise<string | null> {
  const [row] = await tx
    .select({ last4: secrets.last4 })
    .from(secrets)
    .where(eq(secrets.id, secretId))
    .limit(1);
  return row ? `********${row.last4}` : null;
}

export async function deleteSecret(tx: Tx, secretId: string): Promise<void> {
  await tx.delete(secrets).where(eq(secrets.id, secretId));
}
