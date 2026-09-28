import { beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { D } from '@sos/core';
import { systemDb, withTenant } from '../src/db/client.js';
import { auditLogs, documents, emails, quotationVersions } from '../src/db/schema/index.js';
import { sha256Hex } from '../src/lib/crypto.js';
import { storage } from '../src/services/storage.js';
import { drainJobs } from '../src/services/jobs.js';
import { json } from './helpers.js';
import { demoFlow, type DemoFlow } from './flow.js';

describe('quotation → approval → contract → invoice → shipment', () => {
  let d: DemoFlow;
  let tenantId: string;
  beforeAll(async () => {
    d = await demoFlow();
    tenantId = (await systemDb.execute<{ id: string }>(sql`select id from tenants where slug='demo'`))
      .rows[0]!.id;
  });

  it('computes landed cost with decimals and keeps estimated values separate', async () => {
    const costs = json<{
      calculations: Array<{
        landedCostTotal: string;
        landedCostPerUnit: string;
        quantity: number;
        verification: string;
      }>;
      pricing: Array<{
        calculatedCustomerPrice: string;
        adminFinalPrice: string | null;
        estimatedLandedCost: string;
      }>;
    }>(await d.staff.get(`/candidates/${d.candidateId}/costs`));
    const calc = costs.calculations[0]!;
    expect(new D(calc.landedCostTotal).div(calc.quantity).toFixed(2)).toBe(
      new D(calc.landedCostPerUnit).toFixed(2),
    );
    const p = costs.pricing[0]!;
    expect(new D(p.calculatedCustomerPrice).gt(new D(p.estimatedLandedCost).div(600))).toBe(true);
    expect(p.adminFinalPrice).toBeNull();
  });

  it('customer quotation payload never contains internal cost or margin', async () => {
    const body = (await d.buyer.get(`/quotations/${d.quoteId}`)).body;
    for (const k of [
      'internalCost',
      'internalSummary',
      'expectedProfit',
      'marginPct',
      'markupPct',
      'itemsInternal',
      'estimatedLandedCost',
    ])
      expect(body).not.toContain(k);
    const staffBody = (await d.staff.get(`/quotations/${d.quoteId}`)).body;
    expect(staffBody).toContain('internalSummary');
    const result = (await d.buyer.get(`/sourcing/requests/${d.requestId}/result`)).body;
    for (const k of [
      'internalCost',
      'supplierListPrice',
      'priceTiers',
      'privateNote',
      'supplierVerifiedPrice',
      'costBreakdown',
    ])
      expect(result).not.toContain(k);
    const parsed = JSON.parse(result) as { candidates: Array<Record<string, unknown>> };
    for (const c of parsed.candidates) {
      expect(Object.keys(c)).not.toContain('listing');
      expect(Object.keys(c)).not.toContain('url');
      expect(Object.keys(c)).not.toContain('cost');
    }
  });

  it('issued PDF hash matches the stored bytes', async () => {
    const [doc] = await withTenant({ tenantId }, (tx) =>
      tx.select().from(documents).where(eq(documents.id, d.documentId)),
    );
    const { files } = await import('../src/db/schema/index.js');
    const [f] = await withTenant({ tenantId }, (tx) =>
      tx.select().from(files).where(eq(files.id, doc!.fileId)),
    );
    const bytes = await storage.get(f!.storageKey);
    expect(sha256Hex(bytes)).toBe(doc!.sha256);
    expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('issued quotation versions are immutable at the database level', async () => {
    await expect(
      withTenant({ tenantId }, (tx) =>
        tx.update(quotationVersions).set({ total: '1' }).where(eq(quotationVersions.id, d.versionId)),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant({ tenantId }, (tx) => tx.delete(documents).where(eq(documents.id, d.documentId))),
    ).rejects.toThrow();
  });

  it('editing creates v2 and keeps v1; issue is idempotent', async () => {
    const v2 = json<{ version: number }>(await d.staff.post(`/quotations/${d.quoteId}/versions`, {}));
    expect(v2.version).toBe(2);
    const r1 = await d.staff.post(
      `/quotations/${d.quoteId}/issue`,
      {},
      { 'idempotency-key': `issue-v2-${d.quoteId}` },
    );
    const r2 = await d.staff.post(
      `/quotations/${d.quoteId}/issue`,
      {},
      { 'idempotency-key': `issue-v2-${d.quoteId}` },
    );
    expect(r1.statusCode).toBe(200);
    expect(r2.headers['idempotent-replayed']).toBe('true');
    expect(json<{ documentId: string }>(r1).documentId).toBe(json<{ documentId: string }>(r2).documentId);
    const view = json<{ versions: Array<{ version: number }>; versionId: string }>(
      await d.buyer.get(`/quotations/${d.quoteId}`),
    );
    expect(view.versions.map((v) => v.version).sort()).toEqual([1, 2]);
    d.versionId = view.versionId;
  });

  it('customer approval stores evidence and admin approval locks; stale version is refused', async () => {
    const stale = await d.buyer.post(`/quotations/${d.quoteId}/customer-decision`, {
      decision: 'APPROVE',
      versionId: '00000000-0000-0000-0000-000000000000',
    });
    expect(stale.statusCode).toBe(409);
    const ok = await d.buyer.post(
      `/quotations/${d.quoteId}/customer-decision`,
      { decision: 'APPROVE', versionId: d.versionId },
      { 'idempotency-key': `cust-${d.quoteId}` },
    );
    expect(ok.statusCode).toBe(200);
    const again = await d.buyer.post(`/quotations/${d.quoteId}/customer-decision`, {
      decision: 'APPROVE',
      versionId: d.versionId,
    });
    expect(again.statusCode).toBe(409);
    const view = json<{ approvals: Array<{ action: string; documentHash: string | null; ip?: string }> }>(
      await d.staff.get(`/quotations/${d.quoteId}`),
    );
    const appr = view.approvals.find((a) => a.action === 'CUSTOMER_APPROVED')!;
    expect(appr.documentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(appr.ip).toBeDefined();
    expect((await d.staff.post(`/quotations/${d.quoteId}/final-approve`, {})).statusCode).toBe(200);
    expect(json<{ status: string }>(await d.staff.get(`/quotations/${d.quoteId}`)).status).toBe('LOCKED');
  });

  it('contract: send → customer approve → legal review → company approve = EFFECTIVE', async () => {
    const c = json<{ id: string }>(await d.staff.post(`/quotations/${d.quoteId}/contract`, {}));
    expect((await d.staff.post(`/contracts/${c.id}/send`)).statusCode).toBe(200);
    expect(
      (await d.buyer.post(`/contracts/${c.id}/customer-approve`, { agree: true, version: 1 })).statusCode,
    ).toBe(200);
    expect((await d.staff.post(`/contracts/${c.id}/company-approve`)).statusCode).toBe(409); // legal review pending
    expect((await d.staff.post(`/contracts/${c.id}/legal-review`)).statusCode).toBe(200);
    expect((await d.staff.post(`/contracts/${c.id}/company-approve`)).statusCode).toBe(200);
    const view = json<{ status: string; documents: unknown[] }>(await d.buyer.get(`/contracts/${c.id}`));
    expect(view.status).toBe('EFFECTIVE');
    expect(view.documents.length).toBeGreaterThanOrEqual(2);
  });

  it('shipment events drive the workflow and customer timeline', async () => {
    await d.staff.post(`/shipments/${d.shipmentId}/events`, {
      eventType: 'DEPARTED',
      occurredAt: new Date().toISOString(),
      locationCode: 'CNNGB',
    });
    await d.staff.post(`/shipments/${d.shipmentId}/events`, {
      eventType: 'ARRIVED',
      occurredAt: new Date().toISOString(),
      locationCode: 'KRPUS',
    });
    await d.staff.post(`/shipments/${d.shipmentId}/customs`, { status: 'CLEARED' });
    await d.staff.post(`/shipments/${d.shipmentId}/delivery`, { status: 'DELIVERED' });
    const ov = json<{ stage: string; workflow: { status: string } }>(
      await d.buyer.get(`/projects/${d.projectId}/overview`),
    );
    expect(ov.stage).toBe('COMPLETED');
    expect(ov.workflow.status).toBe('COMPLETED');
    const ship = json<{ map: { estimatedRoute: { kind: string }; currentPosition: unknown } }>(
      await d.buyer.get(`/shipments/${d.shipmentId}`),
    );
    expect(ship.map.estimatedRoute.kind).toBe('ESTIMATED');
    expect(ship.map.currentPosition).toBeNull(); // no AIS → no fake position
  });

  it('notifications, emails and audit logs are recorded', async () => {
    await drainJobs(50);
    const n = json<{ items: Array<{ kind: string }> }>(await d.buyer.get('/notifications'));
    expect(n.items.some((x) => x.kind === 'QUOTE_ISSUED')).toBe(true);
    const mails = await withTenant({ tenantId }, (tx) => tx.select().from(emails));
    expect(mails.length).toBeGreaterThan(0);
    // No SMTP in tests: emails are kept as NOT_CONFIGURED (never silently dropped).
    expect(mails.every((m) => ['NOT_CONFIGURED', 'QUEUED', 'SENT'].includes(m.status))).toBe(true);
    const audits = await withTenant({ tenantId }, (tx) =>
      tx.select({ action: auditLogs.action }).from(auditLogs),
    );
    const actions = new Set(audits.map((a) => a.action));
    for (const a of [
      'quote.issued',
      'quote.customer.approve',
      'quote.final_approved',
      'contract.effective',
      'invoice.issued',
      'shipment.created',
    ])
      expect(actions.has(a)).toBe(true);
  });
});
