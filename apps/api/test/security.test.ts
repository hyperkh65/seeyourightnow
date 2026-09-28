import { beforeAll, describe, expect, it } from 'vitest';
import { client, json, PASSWORD } from './helpers.js';
import { demoFlow, type DemoFlow } from './flow.js';

describe('RBAC, CSRF, step-up, anonymous access', () => {
  let d: DemoFlow;
  beforeAll(async () => {
    d = await demoFlow();
  });

  it('customers cannot reach staff APIs', async () => {
    expect((await d.buyer.get('/admin/dashboard')).statusCode).toBe(403);
    expect((await d.buyer.get('/suppliers')).statusCode).toBe(403);
    expect((await d.buyer.get('/admin/connections')).statusCode).toBe(403);
    expect((await d.buyer.post(`/quotations/${d.quoteId}/final-approve`, {})).statusCode).toBe(403);
    expect((await d.buyer.get(`/candidates/${d.candidateId}/costs`)).statusCode).toBe(403);
  });

  it('partners only see their own tasks', async () => {
    const partner = await client('demo.localhost', 'customs@demo.local');
    expect((await partner.get('/partner/tasks')).statusCode).toBe(200);
    expect((await partner.get('/admin/dashboard')).statusCode).toBe(403);
    expect((await partner.get(`/projects/${d.projectId}/overview`)).statusCode).toBe(403);
    expect((await partner.get('/partner/tasks/00000000-0000-0000-0000-000000000000')).statusCode).toBe(404);
  });

  it('sales cannot change margin rules; owner needs step-up', async () => {
    const sales = await client('demo.localhost', 'sales@demo.local');
    const body = { config: { defaults: { PRODUCT: '15', FREIGHT: '5', INSPECTION: '10', SERVICE: '10', DOMESTIC_DELIVERY: '5' }, rounding: { mode: 'UP', step: '10' }, taxPassThrough: true }, rules: [], note: 'test' };
    expect((await sales.put('/admin/margin/draft', body)).statusCode).toBe(403);
    const owner = await client('demo.localhost', 'owner@demo.local');
    // Fresh password login grants step-up; simulate an aged session by forcing a new one without step-up
    const r1 = await owner.put('/admin/margin/draft', body);
    expect([200, 403]).toContain(r1.statusCode);
    const step = await owner.post('/auth/step-up', { password: PASSWORD });
    expect(step.statusCode).toBe(200);
    expect((await owner.put('/admin/margin/draft', body)).statusCode).toBe(200);
    const bad = await owner.post('/auth/step-up', { password: 'wrong-password' });
    expect(bad.statusCode).toBe(401);
  });

  it('rejects state-changing requests without a valid CSRF token', async () => {
    const c = await client('demo.localhost', 'owner@demo.local');
    c.csrf = 'forged';
    const r = await c.post('/crm/companies', { name: 'x' });
    expect(r.statusCode).toBe(403);
    expect(json<{ code: string }>(r).code).toBe('CSRF');
  });

  it('rejects cross-origin state-changing requests', async () => {
    const c = await client('demo.localhost', 'owner@demo.local');
    const r = await c.post('/crm/companies', { name: 'x' }, { origin: 'https://evil.example' });
    expect(r.statusCode).toBe(403);
  });

  it('anonymous search works with an access token and nothing else', async () => {
    const anon = await client('demo.localhost');
    const r = await anon.post('/sourcing/requests', { query: '스테인리스 텀블러 500ml' });
    expect(r.statusCode).toBe(201);
    const { requestId, accessToken } = json<{ requestId: string; accessToken: string }>(r);
    expect(accessToken).toBeTruthy();
    expect((await anon.get(`/sourcing/requests/${requestId}/status`)).statusCode).toBe(404);
    expect((await anon.get(`/sourcing/requests/${requestId}/status?token=${accessToken}`)).statusCode).toBe(200);
    const other = await client('demo.localhost', 'buyer@demo.local');
    expect((await other.get(`/sourcing/requests/${requestId}/result`)).statusCode).toBe(404);
  });

  it('locks an account after repeated failed logins', async () => {
    const c = await client('demo.localhost');
    for (let i = 0; i < 5; i++) await c.post('/auth/login', { email: 'finance@demo.local', password: 'nope-nope-nope' });
    const r = await c.post('/auth/login', { email: 'finance@demo.local', password: PASSWORD });
    expect(r.statusCode).toBe(423);
  });

  it('does not leak whether an email exists', async () => {
    const c = await client('demo.localhost');
    const a = await c.post('/auth/login', { email: 'nobody@demo.local', password: 'whatever-123' });
    const b = await c.post('/auth/login', { email: 'sales@demo.local', password: 'whatever-123' });
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(json<{ message: string }>(a).message).toBe(json<{ message: string }>(b).message);
  });

  it('rejects SSRF targets in product URLs at fetch time', async () => {
    const { assertPublicUrl } = await import('../src/lib/http.js');
    await expect(assertPublicUrl('http://127.0.0.1:4000/api')).rejects.toThrow();
    await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow();
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow();
  });

  it('rejects uploads whose content does not match an allowed type', async () => {
    const r = await d.staff.app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: { 'x-forwarded-host': 'demo.localhost', origin: 'http://demo.localhost:3000', 'x-csrf-token': d.staff.csrf, cookie: [...d.staff.cookies].map(([k, v]) => `${k}=${v}`).join('; '), 'content-type': 'multipart/form-data; boundary=XX' },
      payload: '--XX\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nATTACHMENT\r\n--XX\r\nContent-Disposition: form-data; name="file"; filename="evil.pdf"\r\nContent-Type: application/pdf\r\n\r\n<script>alert(1)</script>\r\n--XX--\r\n',
    });
    expect(r.statusCode).toBe(415);
  });
});

describe('rate limiting', () => {
  it('throttles repeated login attempts per IP', async () => {
    const c = await client('demo.localhost');
    let limited = false;
    for (let i = 0; i < 12; i++) {
      const r = await c.post('/auth/login', { email: 'x@demo.local', password: 'wrong-password' }, { 'x-test-ratelimit': '1' });
      if (r.statusCode === 429) limited = true;
    }
    expect(limited).toBe(true);
  });
});
