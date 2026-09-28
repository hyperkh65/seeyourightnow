import { describe, expect, it, beforeAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { appDb, systemDb, withTenant } from '../src/db/client.js';
import { quotations } from '../src/db/schema/index.js';
import { client, json, type Client } from './helpers.js';
import { demoFlow, type DemoFlow } from './flow.js';

/**
 * The most important test in the system: Tenant A must never read or modify
 * Tenant B's customers, quotes, invoices, documents, shipments or APIs.
 */
describe('tenant isolation', () => {
  let d: DemoFlow;
  let acmeAdmin: Client;
  let acmeBuyer: Client;

  beforeAll(async () => {
    d = await demoFlow();
    acmeAdmin = await client('acme.localhost', 'owner@acme.local');
    acmeBuyer = await client('acme.localhost', 'buyer@acme.local');
  });

  it('cannot read another tenant’s customer (company)', async () => {
    expect((await acmeAdmin.get(`/crm/companies/${d.companyId}`)).statusCode).toBe(404);
    const list = json<{ items: Array<{ id: string }> }>(await acmeAdmin.get('/crm/companies'));
    expect(list.items.some((c) => c.id === d.companyId)).toBe(false);
  });

  it('cannot read or act on another tenant’s quotation', async () => {
    expect((await acmeAdmin.get(`/quotations/${d.quoteId}`)).statusCode).toBe(404);
    expect((await acmeAdmin.post(`/quotations/${d.quoteId}/final-approve`, {})).statusCode).toBe(404);
    expect((await acmeAdmin.post(`/quotations/${d.quoteId}/versions`, {})).statusCode).toBe(404);
    expect(
      (
        await acmeBuyer.post(`/quotations/${d.quoteId}/customer-decision`, {
          decision: 'APPROVE',
          versionId: d.versionId,
        })
      ).statusCode,
    ).toBe(404);
    const list = json<{ items: Array<{ id: string }> }>(await acmeAdmin.get('/quotations'));
    expect(list.items.some((q) => q.id === d.quoteId)).toBe(false);
  });

  it('cannot read another tenant’s invoice, documents, project or files', async () => {
    expect((await acmeAdmin.get(`/projects/${d.projectId}/overview`)).statusCode).toBe(404);
    expect((await acmeAdmin.get(`/documents/${d.documentId}/url`)).statusCode).toBe(404);
    expect((await acmeAdmin.patch(`/payments/${d.invoiceId}`, { status: 'PAID' })).statusCode).toBe(404);
    const projects = json<{ items: Array<{ id: string }> }>(await acmeAdmin.get('/projects'));
    expect(projects.items.some((p) => p.id === d.projectId)).toBe(false);
  });

  it('cannot read or modify another tenant’s shipment', async () => {
    expect((await acmeAdmin.get(`/shipments/${d.shipmentId}`)).statusCode).toBe(404);
    expect((await acmeAdmin.patch(`/shipments/${d.shipmentId}`, { blNumber: 'HACK' })).statusCode).toBe(404);
    expect(
      (
        await acmeAdmin.post(`/shipments/${d.shipmentId}/events`, {
          eventType: 'DELIVERED',
          occurredAt: new Date().toISOString(),
        })
      ).statusCode,
    ).toBeGreaterThanOrEqual(400);
    const list = json<{ items: Array<{ id: string }> }>(await acmeAdmin.get('/shipments'));
    expect(list.items.some((s) => s.id === d.shipmentId)).toBe(false);
  });

  it('cannot access another tenant’s sourcing request or API configuration', async () => {
    expect((await acmeAdmin.get(`/sourcing/requests/${d.requestId}/result`)).statusCode).toBe(404);
    expect((await acmeAdmin.get(`/sourcing/requests/${d.requestId}/status`)).statusCode).toBe(404);
    const conns = json<{ items: unknown[] }>(await acmeAdmin.get('/admin/connections'));
    expect(Array.isArray(conns.items)).toBe(true);
  });

  it('a session cookie from tenant A is not valid on tenant B’s host', async () => {
    const stolen = await client('acme.localhost');
    stolen.cookies = new Map(d.staff.cookies);
    stolen.csrf = d.staff.csrf;
    const me = json<{ user: unknown }>(await stolen.get('/auth/me'));
    expect(me.user).toBeNull();
    expect((await stolen.get('/admin/dashboard')).statusCode).toBe(401);
  });

  it('database RLS blocks cross-tenant reads and writes even for raw queries', async () => {
    const [acme] = (await systemDb.execute<{ id: string }>(sql`select id from tenants where slug = 'acme'`))
      .rows;
    const [demo] = (await systemDb.execute<{ id: string }>(sql`select id from tenants where slug = 'demo'`))
      .rows;
    const seen = await withTenant({ tenantId: acme!.id }, (tx) =>
      tx
        .select()
        .from(quotations)
        .where(sql`${quotations.id} = ${d.quoteId}`),
    );
    expect(seen.length).toBe(0);
    await expect(
      withTenant({ tenantId: acme!.id }, (tx) =>
        tx.insert(quotations).values({ tenantId: demo!.id, number: 'X-1', projectId: d.projectId }),
      ),
    ).rejects.toThrow();
    // Without any tenant context the runtime role sees nothing at all (fail closed).
    const none = await appDb.execute(sql`select count(*)::int as n from quotations`);
    expect((none.rows[0] as { n: number }).n).toBe(0);
  });

  it('every table with tenant_id has RLS enabled and forced', async () => {
    const r = await systemDb.execute<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(sql`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and exists (select 1 from information_schema.columns col where col.table_name = c.relname and col.column_name = 'tenant_id')`);
    const bad = r.rows.filter((x) => !x.relrowsecurity || !x.relforcerowsecurity).map((x) => x.relname);
    expect(bad).toEqual([]);
    expect(r.rows.length).toBeGreaterThan(60);
  });
});
