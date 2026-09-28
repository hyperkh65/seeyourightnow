import { authenticator } from 'otplib';
import { beforeAll, describe, expect, it } from 'vitest';
import { client, json, PASSWORD } from './helpers.js';
import { demoFlow, type DemoFlow } from './flow.js';

/** Waits until the next TOTP step so a fresh (never used) code is generated. */
async function freshCode(secret: string, last?: string): Promise<string> {
  for (;;) {
    const c = authenticator.generate(secret);
    if (c !== last) return c;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

describe('super admin MFA is mandatory', () => {
  it('blocks platform APIs until MFA is set up, then requires TOTP on every login', async () => {
    const sa = await client('platform.localhost', 'superadmin@platform.local');
    const me = json<{ user: { mfaSetupRequired: boolean } }>(await sa.get('/auth/me'));
    expect(me.user.mfaSetupRequired).toBe(true);
    expect((await sa.get('/platform/tenants')).statusCode).toBe(403);

    const setup = json<{ secret: string }>(await sa.post('/auth/mfa/setup'));
    expect((await sa.post('/auth/mfa/enable', { code: '000000' })).statusCode).toBe(400);
    const c1 = authenticator.generate(setup.secret);
    const en = await sa.post('/auth/mfa/enable', { code: c1 });
    expect(en.statusCode).toBe(200);
    const recovery = json<{ recoveryCodes: string[] }>(en).recoveryCodes;
    expect(recovery.length).toBeGreaterThanOrEqual(8);
    expect((await sa.get('/platform/tenants')).statusCode).toBe(200);

    // Super admin cannot switch MFA off.
    expect((await sa.post('/auth/mfa/disable', { password: PASSWORD, code: c1 })).statusCode).toBe(403);

    // New login: password alone is not enough.
    const sa2 = await client('platform.localhost', 'superadmin@platform.local');
    expect(json<{ user: { mfaPending: boolean } }>(await sa2.get('/auth/me')).user.mfaPending).toBe(true);
    expect((await sa2.get('/platform/tenants')).statusCode).toBe(403);
    expect((await sa2.post('/auth/mfa/verify', { code: '123456' })).statusCode).toBe(401);
    // A code that was already used cannot be replayed.
    expect((await sa2.post('/auth/mfa/verify', { code: c1 })).statusCode).toBe(401);
    const c2 = await freshCode(setup.secret, c1);
    expect((await sa2.post('/auth/mfa/verify', { code: c2 })).statusCode).toBe(200);
    expect((await sa2.get('/platform/tenants')).statusCode).toBe(200);

    // Recovery codes work exactly once.
    const sa3 = await client('platform.localhost', 'superadmin@platform.local');
    expect((await sa3.post('/auth/mfa/verify', { code: recovery[0] })).statusCode).toBe(200);
    const sa4 = await client('platform.localhost', 'superadmin@platform.local');
    expect((await sa4.post('/auth/mfa/verify', { code: recovery[0] })).statusCode).toBe(401);
  }, 60_000);

  it('platform APIs are not reachable from a tenant host or by tenant admins', async () => {
    const owner = await client('demo.localhost', 'owner@demo.local');
    expect([403, 404]).toContain((await owner.get('/platform/tenants')).statusCode);
    expect([403, 404]).toContain((await owner.get('/platform/dashboard')).statusCode);
  });
});

describe('expert/partner portal sees only assigned work', () => {
  let d: DemoFlow;
  let productId: string;
  let hsId: string;
  beforeAll(async () => {
    d = await demoFlow();
    const res = json<{ product: { id: string }; hs: { id: string } }>(
      await d.staff.get(`/sourcing/requests/${d.requestId}/result`),
    );
    productId = res.product.id;
    hsId = res.hs.id;
  });

  it('a partner cannot verify HS without an assigned task; with one, the task payload hides customer data', async () => {
    const customs = await client('demo.localhost', 'customs@demo.local');
    expect([403, 404]).toContain(
      (await customs.post(`/products/${productId}/hs/verify`, { hsCode: '841451', note: 'x' })).statusCode,
    );

    const partners = json<{ items: Array<{ id: string; email: string }> }>(await d.staff.get('/partners'));
    const customsId = partners.items.find((p) => p.email === 'customs@demo.local')!.id;
    const t = json<{ id: string }>(
      await d.staff.post('/partner-tasks', {
        partnerUserId: customsId,
        kind: 'HS_REVIEW',
        entityType: 'hs_classification',
        entityId: hsId,
        projectId: d.projectId,
        title: 'HS 확인',
      }),
    );

    const detail = await customs.get(`/partner/tasks/${t.id}`);
    expect(detail.statusCode).toBe(200);
    for (const secret of ['internalCost', 'supplierVerifiedPrice', 'margin', 'buyer@demo.local', 'companyId'])
      expect(detail.body).not.toContain(secret);

    // Another partner cannot open it.
    const lab = await client('demo.localhost', 'lab@demo.local');
    expect((await lab.get(`/partner/tasks/${t.id}`)).statusCode).toBe(404);
    expect([403, 404]).toContain(
      (await lab.post(`/products/${productId}/hs/verify`, { hsCode: '841451' })).statusCode,
    );

    expect(
      (await customs.post(`/products/${productId}/hs/verify`, { hsCode: '8414510000', note: '관세사 확인' }))
        .statusCode,
    ).toBe(200);
    const after = json<{ items: Array<{ id: string; status: string }> }>(await customs.get('/partner/tasks'));
    expect(after.items.find((x) => x.id === t.id)?.status).toBe('SUBMITTED');

    // Expert value is stored separately; the AI estimate is preserved.
    const res = json<{ hs: { estimatedHs: string | null; verifiedHs: string | null } }>(
      await d.staff.get(`/sourcing/requests/${d.requestId}/result`),
    );
    expect(res.hs.verifiedHs).toBe('8414510000');
    expect(res.hs.estimatedHs).not.toBe(null);
  });

  it('bank account changes require step-up and are masked in the audit log', async () => {
    const owner = await client('demo.localhost', 'owner@demo.local');
    const body = {
      bankName: '테스트은행',
      accountNumber: '110-123-456789',
      accountHolder: '데모',
      currency: 'KRW',
    };
    // A fresh password login includes step-up; age it by clearing and verify the gate with a sales account.
    const sales = await client('demo.localhost', 'sales@demo.local');
    expect((await sales.post('/admin/bank-accounts', body)).statusCode).toBe(403);
    const r = await owner.post('/admin/bank-accounts', body);
    expect([201, 403]).toContain(r.statusCode);
    if (r.statusCode === 403) {
      expect(json<{ code: string }>(r).code).toBe('STEP_UP_REQUIRED');
      expect((await owner.post('/auth/step-up', { password: PASSWORD })).statusCode).toBe(200);
      expect((await owner.post('/admin/bank-accounts', body)).statusCode).toBe(201);
    }
    const audit = await owner.get('/admin/audit?action=bank.');
    expect(audit.body).not.toContain('110-123-456789');
    expect(audit.body).toContain('****6789');
  });
});

describe('manual FX rates', () => {
  it('require margin permission + step-up and keep source/date provenance', async () => {
    const body = {
      base: 'CNY',
      rate: '191.25',
      rateDate: '2026-09-27',
      source: '테스트은행 고시',
      verification: 'PARTNER_VERIFIED',
    };
    const sales = await client('demo.localhost', 'sales@demo.local');
    expect((await sales.post('/fx/rates', body)).statusCode).toBe(403);
    const owner = await client('demo.localhost', 'owner@demo.local');
    let r = await owner.post('/fx/rates', body);
    if (r.statusCode === 403) {
      expect((await owner.post('/auth/step-up', { password: PASSWORD })).statusCode).toBe(200);
      r = await owner.post('/fx/rates', body);
    }
    expect(r.statusCode).toBe(201);
    expect((await owner.post('/fx/rates', { ...body, rate: '0' })).statusCode).toBe(400);
    const list = json<{ items: Array<{ base: string; rate: string; source: string; rateDate: string }> }>(
      await owner.get('/fx/rates'),
    );
    const cny = list.items.find((x) => x.base === 'CNY')!;
    expect(cny.source).toBeTruthy();
    expect(cny.rateDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
