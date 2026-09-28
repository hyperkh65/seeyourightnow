import ExcelJS from 'exceljs';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Tx } from '../db/client.js';
import { companies, freightRates, hsClassifications, importJobs, marginRuleSets, products, sourceListings, suppliers } from '../db/schema/index.js';
import { badRequest } from '../lib/errors.js';
import { db, requirePerm, tenantOf } from '../http/context.js';
import { readForm } from '../http/multipart.js';
import type { App } from '../http/types.js';
import { audit } from '../services/audit.js';

/**
 * CSV / Excel import-export for admin data. Importers validate every row with
 * zod and report row-level errors instead of silently skipping. The importer
 * registry is the extension point for future PDF/XLSX quote importers.
 */

const ENTITIES = ['suppliers', 'products', 'customers', 'freight_rates', 'margin_rules', 'hs_history'] as const;
type Entity = (typeof ENTITIES)[number];

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

/** CSV cell escaping incl. formula-injection protection for spreadsheet apps. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function exportRows(tx: Tx, entity: Entity): Promise<Array<Record<string, unknown>>> {
  switch (entity) {
    case 'suppliers':
      return (await tx.select().from(suppliers)).map((s) => ({ id: s.id, name: s.name, alias: s.alias, visibility: s.visibility, sourceType: s.sourceType, businessType: s.businessType, country: s.country, province: s.province, city: s.city, yearsInBusiness: s.yearsInBusiness, businessVerified: s.businessVerified, typicalMoq: s.typicalMoq, oemSupported: s.oemSupported, blacklisted: s.blacklisted }));
    case 'products':
      return (await tx.select().from(sourceListings)).map((l) => ({ id: l.id, supplierId: l.supplierId, sourceType: l.sourceType, connector: l.connector, title: l.title, titleKo: l.titleKo, model: l.model, currency: l.currency, unitPrice: l.supplierVerifiedPrice ?? l.supplierListPrice, moq: l.moq, leadTimeDays: l.leadTimeDays, lastCheckedAt: l.lastCheckedAt?.toISOString() }));
    case 'customers':
      return (await tx.select().from(companies)).map((c) => ({ id: c.id, name: c.name, businessNumber: c.businessNumber, ceo: c.ceo, address: c.address, industry: c.industry, tier: c.tier, creditLevel: c.creditLevel, paymentTerms: c.paymentTerms, taxInvoiceEmail: c.taxInvoiceEmail }));
    case 'freight_rates':
      return (await tx.select().from(freightRates)).map((r) => ({ mode: r.mode, origin: r.origin, destination: r.destination, source: r.source, verification: r.verification, providerName: r.providerName, currency: r.currency, basis: r.basis, rate: r.rate, minCharge: r.minCharge, transitDaysMin: r.transitDaysMin, transitDaysMax: r.transitDaysMax, validFrom: r.validFrom, validUntil: r.validUntil }));
    case 'margin_rules': {
      const [set] = await tx.select().from(marginRuleSets).where(eq(marginRuleSets.status, 'PUBLISHED')).orderBy(desc(marginRuleSets.version)).limit(1);
      return ((set?.rules ?? []) as Array<Record<string, unknown>>).map((r) => ({ ...r, match: JSON.stringify(r.match) }));
    }
    case 'hs_history':
      return (await tx.select({ h: hsClassifications, name: products.nameKo }).from(hsClassifications).innerJoin(products, eq(products.id, hsClassifications.productId))).map(({ h, name }) => ({ product: name, estimatedHs: h.estimatedHs, verifiedHs: h.verifiedHs, actualHs: h.actualHs, verifiedAt: h.verifiedAt?.toISOString() ?? '' }));
  }
}

const bool = (v?: string) => (v === undefined || v === '' ? null : ['true', '1', 'y', 'yes', 'o'].includes(v.toLowerCase()));
const num = (v?: string) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

const importers: Partial<Record<Entity, (tx: Tx, tenantId: string, row: Record<string, string>) => Promise<void>>> = {
  suppliers: async (tx, tenantId, r) => {
    const v = z.object({ name: z.string().min(1), sourceType: z.string().default('PRIVATE_NETWORK') }).parse(r);
    await tx.insert(suppliers).values({ tenantId, name: v.name, alias: r.alias ?? '', visibility: (r.visibility as 'HIDDEN') || 'ALIAS', sourceType: v.sourceType, businessType: r.businessType || 'UNKNOWN', country: r.country || 'CN', province: r.province ?? '', city: r.city ?? '', yearsInBusiness: num(r.yearsInBusiness), businessVerified: bool(r.businessVerified), typicalMoq: num(r.typicalMoq), oemSupported: bool(r.oemSupported) });
  },
  customers: async (tx, tenantId, r) => {
    const v = z.object({ name: z.string().min(1) }).parse(r);
    await tx.insert(companies).values({ tenantId, name: v.name, businessNumber: r.businessNumber ?? '', ceo: r.ceo ?? '', address: r.address ?? '', industry: r.industry ?? '', tier: r.tier || 'STANDARD', paymentTerms: r.paymentTerms ?? '', taxInvoiceEmail: r.taxInvoiceEmail ?? '' });
  },
  freight_rates: async (tx, tenantId, r) => {
    const v = z
      .object({ mode: z.enum(['COURIER', 'AIR', 'LCL', 'FCL_20', 'FCL_40', 'FCL_40HQ']), origin: z.string().min(2), destination: z.string().min(2), source: z.enum(['REAL_TIME_API', 'FORWARDER_VERIFIED', 'CONTRACT_RATE', 'MARKET_RATE', 'GOVERNMENT_STATISTICS', 'HISTORICAL_ACTUAL', 'AI_ESTIMATE']), currency: z.string().length(3), basis: z.enum(['PER_KG', 'PER_CBM', 'PER_RT', 'PER_CONTAINER', 'FLAT']), rate: z.string().regex(/^\d+(\.\d+)?$/) })
      .parse(r);
    await tx.insert(freightRates).values({ tenantId, ...v, verification: r.verification || 'UNVERIFIED', providerName: r.providerName ?? '', minCharge: r.minCharge || null, transitDaysMin: num(r.transitDaysMin), transitDaysMax: num(r.transitDaysMax), validFrom: r.validFrom || null, validUntil: r.validUntil || null });
  },
  products: async (tx, tenantId, r) => {
    const v = z.object({ title: z.string().min(1), currency: z.string().length(3).default('CNY'), unitPrice: z.string().regex(/^\d+(\.\d+)?$/) }).parse(r);
    await tx.insert(sourceListings).values({ tenantId, supplierId: r.supplierId || null, sourceType: r.sourceType || 'PRIVATE_NETWORK', connector: 'CSV_IMPORT', title: v.title, titleKo: r.titleKo ?? '', model: r.model ?? '', currency: v.currency, priceTiers: [{ minQty: num(r.moq) ?? 1, unitPrice: v.unitPrice }], supplierVerifiedPrice: v.unitPrice, moq: num(r.moq), leadTimeDays: num(r.leadTimeDays) });
  },
};

export async function importExportRoutes(app: App) {
  app.get('/admin/export/:entity', { schema: { params: z.object({ entity: z.enum(ENTITIES) }), querystring: z.object({ format: z.enum(['csv', 'xlsx']).default('csv') }) } }, async (req, reply) => {
    requirePerm(req, 'import.export');
    const rows = await db(req, async (tx) => {
      const r = await exportRows(tx, req.params.entity);
      await audit(tx, req, { action: 'data.exported', entityType: req.params.entity, after: { rows: r.length, format: req.query.format } });
      return r;
    });
    const headers = rows[0] ? Object.keys(rows[0]) : [];
    const name = `${req.params.entity}-${new Date().toISOString().slice(0, 10)}`;
    if (req.query.format === 'xlsx') {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(req.params.entity);
      ws.columns = headers.map((h) => ({ header: h, key: h, width: 18 }));
      for (const r of rows) ws.addRow(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && /^[=+\-@]/.test(v) ? `'${v}` : v])));
      reply.header('Content-Disposition', `attachment; filename="${name}.xlsx"`);
      reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return reply.send(Buffer.from(await wb.xlsx.writeBuffer()));
    }
    const csv = '﻿' + [headers.join(','), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(','))].join('\r\n');
    reply.header('Content-Disposition', `attachment; filename="${name}.csv"`);
    reply.type('text/csv; charset=utf-8');
    return csv;
  });

  app.post('/admin/import/:entity', { schema: { params: z.object({ entity: z.enum(ENTITIES) }) } }, async (req) => {
    const tenant = tenantOf(req);
    const user = requirePerm(req, 'import.export');
    const importer = importers[req.params.entity];
    if (!importer) throw badRequest('이 항목은 가져오기를 지원하지 않습니다.');
    const { files } = await readForm(req);
    const f = files[0];
    if (!f) throw badRequest('파일을 첨부하세요.');
    let table: string[][];
    if (/\.xlsx$/i.test(f.filename)) {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(f.buffer as unknown as ArrayBuffer);
      const ws = wb.worksheets[0];
      table = [];
      ws?.eachRow((row) => table.push((row.values as unknown[]).slice(1).map((v) => (v === null || v === undefined ? '' : String(typeof v === 'object' && v && 'text' in v ? (v as { text: string }).text : v)))));
    } else table = parseCsv(f.buffer.toString('utf8'));
    if (table.length < 2) throw badRequest('데이터 행이 없습니다.');
    if (table.length > 20001) throw badRequest('한 번에 20,000행까지 가져올 수 있습니다.');
    const [header, ...data] = table;
    const errors: Array<{ row: number; message: string }> = [];
    let imported = 0;
    const job = await db(req, async (tx) => {
      const [j] = await tx.insert(importJobs).values({ tenantId: tenant.id, entity: req.params.entity, status: 'RUNNING', totalRows: data.length, createdBy: user.id }).returning();
      return j!;
    });
    for (let i = 0; i < data.length; i++) {
      const row = Object.fromEntries(header!.map((h, idx) => [h.trim(), (data[i]![idx] ?? '').trim()]));
      try {
        await db(req, (tx) => importer(tx, tenant.id, row));
        imported++;
      } catch (e) {
        errors.push({ row: i + 2, message: e instanceof z.ZodError ? e.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') : e instanceof Error ? e.message : String(e) });
      }
    }
    await db(req, async (tx) => {
      await tx.update(importJobs).set({ status: errors.length ? (imported ? 'PARTIAL' : 'FAILED') : 'SUCCESS', importedRows: imported, errors: errors.slice(0, 500), updatedAt: new Date() }).where(eq(importJobs.id, job.id));
      await audit(tx, req, { action: 'data.imported', entityType: req.params.entity, entityId: job.id, after: { imported, errors: errors.length } });
    });
    return { jobId: job.id, total: data.length, imported, errors: errors.slice(0, 100) };
  });

  app.get('/admin/import-jobs', async (req) => {
    requirePerm(req, 'import.export');
    return db(req, async (tx) => ({ items: await tx.select().from(importJobs).orderBy(desc(importJobs.createdAt)).limit(50) }));
  });
}
