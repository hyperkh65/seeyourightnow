import { and, eq } from 'drizzle-orm';
import { FEATURE_MODULES, type FeatureModule } from '@sos/core';
import { config } from '../config.js';
import { systemDb } from '../db/client.js';
import { featureFlags, plans, subscriptions, tenantDomains, tenants } from '../db/schema/index.js';
import { cached, cacheDel } from '../lib/cache.js';
import type { TenantInfo } from '../http/context.js';

export type HostResolution = { kind: 'platform' } | { kind: 'tenant'; tenant: TenantInfo } | { kind: 'unknown' };

export function normalizeHost(raw: string): string {
  return raw.split(',')[0]!.trim().toLowerCase().replace(/:\d+$/, '');
}

/** Resolves the request host to a tenant: platform host → subdomain → verified custom domain → dev default. */
export async function resolveHost(rawHost: string): Promise<HostResolution> {
  const host = normalizeHost(rawHost);
  if (host === config.PLATFORM_ADMIN_HOST.toLowerCase()) return { kind: 'platform' };
  return cached(`host:${host}`, 60, async () => {
    const base = config.PLATFORM_BASE_DOMAIN.toLowerCase();
    let slug: string | null = null;
    if (host.endsWith(`.${base}`)) {
      const sub = host.slice(0, -(base.length + 1));
      if (sub && !sub.includes('.')) slug = sub;
    }
    if (slug) {
      const t = await tenantBySlug(slug);
      if (t) return { kind: 'tenant', tenant: t } as HostResolution;
    }
    const [d] = await systemDb
      .select({ tenantId: tenantDomains.tenantId })
      .from(tenantDomains)
      .where(and(eq(tenantDomains.hostname, host), eq(tenantDomains.active, true), eq(tenantDomains.dnsStatus, 'VERIFIED')))
      .limit(1);
    if (d) {
      const t = await tenantById(d.tenantId);
      if (t) return { kind: 'tenant', tenant: t } as HostResolution;
    }
    if (config.DEFAULT_TENANT_SLUG && (host === base || host === 'localhost' || host === '127.0.0.1')) {
      const t = await tenantBySlug(config.DEFAULT_TENANT_SLUG);
      if (t) return { kind: 'tenant', tenant: t } as HostResolution;
    }
    return { kind: 'unknown' } as HostResolution;
  });
}

export async function tenantBySlug(slug: string): Promise<TenantInfo | null> {
  const [t] = await systemDb.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
  return t ? { id: t.id, slug: t.slug, name: t.name, status: t.status, isDemo: t.isDemo } : null;
}

export async function tenantById(id: string): Promise<TenantInfo | null> {
  const [t] = await systemDb.select().from(tenants).where(eq(tenants.id, id)).limit(1);
  return t ? { id: t.id, slug: t.slug, name: t.name, status: t.status, isDemo: t.isDemo } : null;
}

export async function invalidateHostCache(hostname?: string): Promise<void> {
  if (hostname) await cacheDel(`host:${normalizeHost(hostname)}`);
}

export interface PlanLimits {
  [metric: string]: { value: number; hard: boolean };
}

/** Effective feature set = plan features ± subscription overrides ± tenant feature flags. */
export async function effectiveFeatures(tenantId: string): Promise<{ features: Set<FeatureModule>; limits: PlanLimits; planCode: string | null }> {
  return cached(`features:${tenantId}`, 30, async () => {
    const [sub] = await systemDb
      .select({ planFeatures: plans.features, planLimits: plans.limits, planCode: plans.code, featureOverrides: subscriptions.featureOverrides, limitOverrides: subscriptions.limitOverrides })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(subscriptions.tenantId, tenantId))
      .limit(1);
    const flags = await systemDb.select().from(featureFlags).where(eq(featureFlags.tenantId, tenantId));
    // Without a subscription every module is available (self-hosted single-company mode).
    const set = new Set<string>(sub ? sub.planFeatures : FEATURE_MODULES);
    for (const [k, v] of Object.entries(sub?.featureOverrides ?? {})) v ? set.add(k) : set.delete(k);
    for (const f of flags) f.enabled ? set.add(f.module) : set.delete(f.module);
    return { features: [...set], limits: { ...(sub?.planLimits ?? {}), ...(sub?.limitOverrides ?? {}) }, planCode: sub?.planCode ?? null };
  }).then((r) => ({ ...r, features: new Set(r.features as FeatureModule[]) }));
}

export async function invalidateFeatures(tenantId: string): Promise<void> {
  await cacheDel(`features:${tenantId}`);
}
