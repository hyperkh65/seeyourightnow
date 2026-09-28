import { readFileSync } from 'node:fs';
import { and, eq, isNull } from 'drizzle-orm';
import type { Role } from '@sos/core';
import { closeCache } from '../lib/cache.js';
import { closeDb, systemDb } from './client.js';
import {
  hsCodes,
  plans,
  ports,
  regulations,
  regulationVersions,
  tenants,
  userRoles,
  users,
} from './schema/index.js';
import { HS_SAMPLES, PLANS, PORTS, REGULATIONS } from './reference-data.js';
import { hashPassword } from '../services/auth.js';
import { createTenant } from '../services/tenant-bootstrap.js';
import { seedDemoData } from './seed-demo.js';

/**
 * Idempotent seed.
 *   - reference data (plans, ports, regulations, HS headings)
 *   - platform super admin
 *   - "demo" tenant (clearly marked DEMO) and "acme" tenant (used for isolation tests)
 * Passwords come from SEED_PASSWORD (default for local development only).
 */

const PASSWORD = process.env.SEED_PASSWORD ?? 'Demo-Pass-2026!';

export async function seedReference(): Promise<void> {
  for (const p of PLANS) {
    await systemDb
      .insert(plans)
      .values(p)
      .onConflictDoUpdate({
        target: plans.code,
        set: { features: p.features, limits: p.limits, name: p.name, description: p.description },
      });
  }
  for (const p of PORTS) {
    await systemDb
      .insert(ports)
      .values({ ...p, geofenceKm: p.geofenceKm ?? 15, kind: p.kind ?? 'SEAPORT' })
      .onConflictDoNothing();
  }
  for (const r of REGULATIONS) {
    const [existing] = await systemDb
      .select()
      .from(regulations)
      .where(and(eq(regulations.code, r.code), isNull(regulations.tenantId)))
      .limit(1);
    if (existing) continue;
    const [reg] = await systemDb
      .insert(regulations)
      .values({ tenantId: null, code: r.code, name: r.name, authority: r.authority, category: r.category })
      .returning({ id: regulations.id });
    const [ver] = await systemDb
      .insert(regulationVersions)
      .values({
        tenantId: null,
        regulationId: reg!.id,
        version: 1,
        hsPrefixes: r.hsPrefixes,
        triggerAll: r.triggerAll,
        triggerAny: r.triggerAny,
        exceptions: r.exceptions,
        mandatory: r.mandatory,
        documentsRequired: r.documentsRequired,
        testsRequired: r.testsRequired,
        expertType: r.expertType,
        officialSource: r.officialSource,
        summary: `${r.summary} (근거: ${r.law})`,
        effectiveFrom: '2026-01-01',
        changeNote: '초기 등록',
      })
      .returning({ id: regulationVersions.id });
    await systemDb.update(regulations).set({ currentVersionId: ver!.id }).where(eq(regulations.id, reg!.id));
  }
  for (const h of HS_SAMPLES) {
    const [exists] = await systemDb
      .select({ id: hsCodes.id })
      .from(hsCodes)
      .where(and(eq(hsCodes.code, h.code), isNull(hsCodes.tenantId)))
      .limit(1);
    if (exists) continue;
    await systemDb.insert(hsCodes).values({
      tenantId: null,
      code: h.code,
      level: 6,
      descriptionKo: h.ko,
      descriptionEn: h.en,
      keywords: h.keywords,
      source: 'HS_NOMENCLATURE_SUMMARY',
      verification: 'UNVERIFIED',
    });
  }
}

async function ensureSuperAdmin(): Promise<void> {
  const email = (process.env.SEED_SUPERADMIN_EMAIL ?? 'superadmin@platform.local').toLowerCase();
  const [u] = await systemDb
    .select()
    .from(users)
    .where(and(isNull(users.tenantId), eq(users.email, email)))
    .limit(1);
  if (u) return;
  const [nu] = await systemDb
    .insert(users)
    .values({
      tenantId: null,
      email,
      name: 'Platform Admin',
      passwordHash: await hashPassword(process.env.SEED_SUPERADMIN_PASSWORD ?? PASSWORD),
      isSuperAdmin: true,
    })
    .returning({ id: users.id });
  await systemDb.insert(userRoles).values({ tenantId: null, userId: nu!.id, role: 'SUPER_ADMIN' });
}

async function addUser(
  tenantId: string,
  email: string,
  name: string,
  roles: Role[],
  extra: Partial<typeof users.$inferInsert> = {},
): Promise<string> {
  const [existing] = await systemDb
    .select()
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.email, email)))
    .limit(1);
  if (existing) return existing.id;
  const [u] = await systemDb
    .insert(users)
    .values({
      tenantId,
      email,
      name,
      passwordHash: await hashPassword(PASSWORD),
      emailVerifiedAt: new Date(),
      ...extra,
    })
    .returning({ id: users.id });
  for (const role of roles) await systemDb.insert(userRoles).values({ tenantId, userId: u!.id, role });
  return u!.id;
}

export async function seedTenants(): Promise<{ demoId: string; acmeId: string }> {
  const ensure = async (
    slug: string,
    name: string,
    ownerEmail: string,
    isDemo: boolean,
    planCode: string,
  ) => {
    const [t] = await systemDb.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
    if (t) return t.id;
    const r = await createTenant({
      name,
      slug,
      isDemo,
      planCode,
      owner: { email: ownerEmail, name: '대표 관리자', password: PASSWORD },
    });
    return r.tenantId;
  };
  const demoId = await ensure('demo', 'Demo Sourcing', 'owner@demo.local', true, 'ENTERPRISE');
  const acmeId = await ensure('acme', 'ACME Trading (Test)', 'owner@acme.local', false, 'BUSINESS');

  await addUser(demoId, 'sales@demo.local', '김영업', ['SALES']);
  await addUser(demoId, 'sourcing@demo.local', '이소싱', ['SOURCING_MANAGER']);
  await addUser(demoId, 'finance@demo.local', '박재무', ['FINANCE']);
  await addUser(demoId, 'customs@demo.local', '최관세 (관세사)', ['CUSTOMS_PARTNER'], {
    expertTypes: ['CUSTOMS_BROKER'],
  });
  await addUser(demoId, 'forwarder@demo.local', '정포워더', ['FORWARDER_PARTNER'], {
    expertTypes: ['FORWARDER'],
  });
  await addUser(demoId, 'lab@demo.local', '한인증 (시험기관)', ['CERTIFICATION_PARTNER'], {
    expertTypes: ['ELECTRICAL_SAFETY_LAB', 'RRA_EMC_LAB', 'CERTIFICATION_EXPERT'],
  });
  return { demoId, acmeId };
}

export async function seedAll(opts: { demo?: boolean } = {}): Promise<{ demoId: string; acmeId: string }> {
  await seedReference();
  await ensureSuperAdmin();
  const ids = await seedTenants();
  if (opts.demo !== false) {
    await seedDemoData(ids.demoId, ids.acmeId, PASSWORD);
  }
  return ids;
}

/**
 * SEED_MODE:
 *  - "demo" (default outside production): reference data, super admin, demo + test tenants.
 *  - "base": reference data and the platform super admin only (production bootstrap).
 */
async function main(): Promise<void> {
  const prod = process.env.NODE_ENV === 'production';
  const pwFile = process.env.SEED_SUPERADMIN_PASSWORD_FILE;
  if (!process.env.SEED_SUPERADMIN_PASSWORD && pwFile) {
    process.env.SEED_SUPERADMIN_PASSWORD = readFileSync(pwFile, 'utf8').trim();
  }
  const mode = process.env.SEED_MODE ?? (prod ? 'base' : 'demo');
  if (mode === 'base') {
    if (prod && !process.env.SEED_SUPERADMIN_PASSWORD) {
      throw new Error('SEED_SUPERADMIN_PASSWORD is required for the production bootstrap.');
    }
    await seedReference();
    await ensureSuperAdmin();
    console.warn('Base seed complete (reference data + platform admin). MFA is enforced on first login.');
    return;
  }
  if (prod && process.env.ALLOW_DEMO_SEED !== 'true') {
    throw new Error('Refusing to seed demo tenants in production (set ALLOW_DEMO_SEED=true to override).');
  }
  await seedAll();
  console.warn(`Seed complete.
  Platform admin : http://platform.localhost:3000  superadmin@platform.local
  Demo tenant    : http://demo.localhost:3000      owner@demo.local (admin) · buyer@demo.local (customer)
  Second tenant  : http://acme.localhost:3000      owner@acme.local
  Password       : ${process.env.SEED_PASSWORD ? '(SEED_PASSWORD)' : PASSWORD}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then(async () => {
      await closeDb();
      await closeCache();
      process.exit(0);
    })
    .catch(async (e) => {
      console.error(e);
      await closeDb();
      await closeCache();
      process.exit(1);
    });
}
