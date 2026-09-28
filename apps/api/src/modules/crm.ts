import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { companies, contacts, customerNotes, quotations, quotationVersions, sourcingProjects, userRoles, users } from '../db/schema/index.js';
import { notFound } from '../lib/errors.js';
import { can, db, requireFeature, requirePerm, tenantOf, userOf } from '../http/context.js';
import type { App } from '../http/types.js';
import { audit } from '../services/audit.js';

const companyBody = z.object({
  name: z.string().min(1).max(160),
  businessNumber: z.string().max(20).default(''),
  ceo: z.string().max(60).default(''),
  address: z.string().max(300).default(''),
  industry: z.string().max(60).default(''),
  categories: z.array(z.string().max(40)).max(20).default([]),
  taxInvoiceEmail: z.string().max(200).default(''),
  paymentTerms: z.string().max(300).default(''),
  preferences: z.object({ targetMarginPct: z.string().optional(), preferredFreight: z.string().optional(), categories: z.array(z.string()).optional() }).default({}),
  tier: z.string().max(20).default('STANDARD'),
  creditLevel: z.string().max(20).default('NORMAL'),
  warnings: z.array(z.string().max(200)).max(20).default([]),
});

export async function crmRoutes(app: App) {
  app.get('/crm/companies', { schema: { querystring: z.object({ q: z.string().max(100).optional() }) } }, async (req) => {
    requireFeature(req, 'CRM');
    requirePerm(req, 'crm.read');
    return db(req, async (tx) => {
      const rows = await tx
        .select()
        .from(companies)
        .where(req.query.q ? or(ilike(companies.name, `%${req.query.q}%`), ilike(companies.businessNumber, `%${req.query.q}%`)) : undefined)
        .orderBy(desc(companies.updatedAt))
        .limit(300);
      const counts = rows.length
        ? await tx.select({ companyId: sourcingProjects.companyId, n: sql<number>`count(*)::int` }).from(sourcingProjects).where(inArray(sourcingProjects.companyId, rows.map((r) => r.id))).groupBy(sourcingProjects.companyId)
        : [];
      return { items: rows.map((r) => ({ ...r, projectCount: counts.find((c) => c.companyId === r.id)?.n ?? 0 })) };
    });
  });

  app.get('/crm/companies/:id', { schema: { params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    requirePerm(req, 'crm.read');
    const internal = can(req, 'crm.internal_notes');
    return db(req, async (tx) => {
      const [c] = await tx.select().from(companies).where(eq(companies.id, req.params.id)).limit(1);
      if (!c) throw notFound();
      const cs = await tx.select().from(contacts).where(eq(contacts.companyId, c.id));
      const notes = internal ? await tx.select().from(customerNotes).where(eq(customerNotes.companyId, c.id)).orderBy(desc(customerNotes.pinned), desc(customerNotes.createdAt)) : [];
      const projects = await tx.select({ id: sourcingProjects.id, code: sourcingProjects.code, title: sourcingProjects.title, stage: sourcingProjects.stage, updatedAt: sourcingProjects.updatedAt }).from(sourcingProjects).where(eq(sourcingProjects.companyId, c.id)).orderBy(desc(sourcingProjects.updatedAt));
      const quotes = await tx.select({ id: quotations.id, number: quotations.number, status: quotations.status, total: quotationVersions.total, currency: quotationVersions.currency }).from(quotations).leftJoin(quotationVersions, eq(quotationVersions.id, quotations.currentVersionId)).where(eq(quotations.companyId, c.id));
      const portalUsers = await tx.select({ id: users.id, email: users.email, name: users.name, status: users.status, lastLoginAt: users.lastLoginAt }).from(users).where(eq(users.companyId, c.id));
      return { ...c, contacts: cs, notes, projects, quotations: quotes, portalUsers };
    });
  });

  app.post('/crm/companies', { schema: { body: companyBody } }, async (req, reply) => {
    const tenant = tenantOf(req);
    requirePerm(req, 'crm.write');
    return db(req, async (tx) => {
      const [c] = await tx.insert(companies).values({ tenantId: tenant.id, ...req.body }).returning();
      await audit(tx, req, { action: 'crm.company.created', entityType: 'company', entityId: c!.id, after: { name: c!.name } });
      reply.status(201);
      return c;
    });
  });

  app.patch('/crm/companies/:id', { schema: { params: z.object({ id: z.string().uuid() }), body: companyBody.partial() } }, async (req) => {
    requirePerm(req, 'crm.write');
    return db(req, async (tx) => {
      const [c] = await tx.select().from(companies).where(eq(companies.id, req.params.id)).limit(1);
      if (!c) throw notFound();
      await tx.update(companies).set({ ...req.body, updatedAt: new Date() }).where(eq(companies.id, c.id));
      await audit(tx, req, { action: 'crm.company.updated', entityType: 'company', entityId: c.id, before: { tier: c.tier, creditLevel: c.creditLevel, paymentTerms: c.paymentTerms }, after: req.body });
      return { ok: true };
    });
  });

  app.post('/crm/companies/:id/contacts', { schema: { params: z.object({ id: z.string().uuid() }), body: z.object({ name: z.string().min(1).max(60), department: z.string().max(60).default(''), title: z.string().max(60).default(''), phone: z.string().max(40).default(''), email: z.string().max(200).default(''), messenger: z.record(z.string(), z.string()).default({}), isPrimary: z.boolean().default(false) }) } }, async (req, reply) => {
    const tenant = tenantOf(req);
    requirePerm(req, 'crm.write');
    return db(req, async (tx) => {
      const [c] = await tx.insert(contacts).values({ tenantId: tenant.id, companyId: req.params.id, ...req.body }).returning();
      await audit(tx, req, { action: 'crm.contact.created', entityType: 'company', entityId: req.params.id, after: { name: req.body.name } });
      reply.status(201);
      return c;
    });
  });

  /** Internal notes: staff-only; never serialized to customer audiences. */
  app.post('/crm/companies/:id/notes', { schema: { params: z.object({ id: z.string().uuid() }), body: z.object({ body: z.string().min(1).max(5000), pinned: z.boolean().default(false) }) } }, async (req, reply) => {
    const tenant = tenantOf(req);
    const user = requirePerm(req, 'crm.internal_notes');
    return db(req, async (tx) => {
      const [n] = await tx.insert(customerNotes).values({ tenantId: tenant.id, companyId: req.params.id, authorId: user.id, ...req.body }).returning();
      await audit(tx, req, { action: 'crm.note.created', entityType: 'company', entityId: req.params.id });
      reply.status(201);
      return n;
    });
  });

  /** Customer self-service: own company profile (no internal fields). */
  app.get('/me/company', async (req) => {
    const u = userOf(req);
    if (!u.companyId) return null;
    return db(req, async (tx) => {
      const [c] = await tx.select().from(companies).where(eq(companies.id, u.companyId!)).limit(1);
      if (!c) return null;
      const members = await tx.select({ id: users.id, name: users.name, email: users.email }).from(users).innerJoin(userRoles, eq(userRoles.userId, users.id)).where(and(eq(users.companyId, c.id), eq(userRoles.role, 'CUSTOMER_USER')));
      return { id: c.id, name: c.name, businessNumber: c.businessNumber, ceo: c.ceo, address: c.address, taxInvoiceEmail: c.taxInvoiceEmail, members };
    });
  });

  app.patch('/me/company', { schema: { body: z.object({ name: z.string().min(1).max(160).optional(), businessNumber: z.string().max(20).optional(), ceo: z.string().max(60).optional(), address: z.string().max(300).optional(), taxInvoiceEmail: z.string().max(200).optional() }) } }, async (req) => {
    const u = userOf(req);
    if (!u.companyId || !u.roles.includes('CUSTOMER_ADMIN')) throw notFound();
    return db(req, async (tx) => {
      await tx.update(companies).set({ ...req.body, updatedAt: new Date() }).where(eq(companies.id, u.companyId!));
      await audit(tx, req, { action: 'customer.company.updated', entityType: 'company', entityId: u.companyId!, after: req.body });
      return { ok: true };
    });
  });
}
