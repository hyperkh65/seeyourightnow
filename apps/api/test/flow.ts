import { drainJobs } from '../src/services/jobs.js';
import { client, json, type Client } from './helpers.js';

export interface DemoFlow {
  staff: Client;
  buyer: Client;
  requestId: string;
  projectId: string;
  candidateId: string;
  quoteId: string;
  versionId: string;
  documentId: string;
  invoiceId: string;
  shipmentId: string;
  companyId: string;
  imageFileId: string | null;
}

let cached: Promise<DemoFlow> | null = null;

/** Builds one realistic project in the demo tenant through the public API (shared across test files). */
export function demoFlow(): Promise<DemoFlow> {
  cached ??= (async () => {
    const staff = await client('demo.localhost', 'owner@demo.local');
    const buyer = await client('demo.localhost', 'buyer@demo.local');
    const r = await buyer.post('/sourcing/requests', { query: '휴대용 미니 선풍기 USB 충전식', quantity: 600, targetLandedPriceKrw: '6000', options: { oem: true } });
    if (r.statusCode !== 201) throw new Error(r.body);
    const { requestId, projectId } = json<{ requestId: string; projectId: string }>(r);
    await drainJobs(50);
    const result = json<{ candidates: Array<{ id: string; listing: { isDevMock: boolean }; supplier: { id: string } | null }> }>(await staff.get(`/sourcing/requests/${requestId}/result`));
    const cand = result.candidates.find((c) => !c.listing.isDevMock)!;
    await staff.post(`/candidates/${cand.id}/estimate`, { quantity: 600 });
    const q = json<{ id: string; versionId: string }>(await staff.post(`/projects/${projectId}/quotations`, { items: [{ candidateId: cand.id, name: '휴대용 USB 미니 선풍기', specification: '1200mAh', quantity: 600 }], leadTime: '20일' }));
    const issued = json<{ documentId: string }>(await staff.post(`/quotations/${q.id}/issue`, {}));
    const inv = json<{ id: string }>(await staff.post(`/projects/${projectId}/invoices`, { type: 'PROFORMA_INVOICE', lines: [{ name: 'Fan', quantity: 600, unitPrice: '3500' }], dueDate: '2030-01-01' }));
    const sh = json<{ id: string }>(await staff.post(`/projects/${projectId}/shipments`, { mode: 'LCL', carrierCode: 'MAEU', originPort: 'CNNGB', destinationPort: 'KRPUS', bookingNumber: 'BK1' }));
    const me = json<{ user: { companyId: string } }>(await buyer.get('/auth/me'));
    const status = json<{ id: string }>(await buyer.get(`/sourcing/requests/${requestId}/status`));
    void status;
    await drainJobs(50);
    return { staff, buyer, requestId, projectId, candidateId: cand.id, quoteId: q.id, versionId: q.versionId, documentId: issued.documentId, invoiceId: inv.id, shipmentId: sh.id, companyId: me.user.companyId, imageFileId: null };
  })();
  return cached;
}
