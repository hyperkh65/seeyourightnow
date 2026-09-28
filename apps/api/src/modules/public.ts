import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { SETTINGS_SECTIONS } from '@sos/core';
import { withTenant } from '../db/client.js';
import { apiConnections, files, policies } from '../db/schema/index.js';
import { notFound } from '../lib/errors.js';
import { tenantOf } from '../http/context.js';
import type { App } from '../http/types.js';
import { getDraftByPreviewToken, getPublished } from '../services/settings.js';
import { storage } from '../services/storage.js';

/**
 * Public (unauthenticated) site configuration for white-label rendering.
 * Only fields safe for the public are returned — never bank data, internal
 * settings, or connection secrets.
 */
export async function publicRoutes(app: App) {
  app.get('/public/site', { schema: { querystring: z.object({ preview: z.string().max(64).optional() }) } }, async (req, reply) => {
    if (req.ctx.platform) return { platform: true };
    const tenant = tenantOf(req);
    const data = await withTenant({ tenantId: tenant.id }, async (tx) => {
      const [brand, company, social, footer, homepage, locale, search, pricing] = await Promise.all([
        getPublished(tx, tenant.id, 'brand'),
        getPublished(tx, tenant.id, 'company'),
        getPublished(tx, tenant.id, 'social'),
        getPublished(tx, tenant.id, 'footer'),
        getPublished(tx, tenant.id, 'homepage'),
        getPublished(tx, tenant.id, 'locale'),
        getPublished(tx, tenant.id, 'search'),
        getPublished(tx, tenant.id, 'pricing'),
      ]);
      const overrides: Record<string, unknown> = {};
      let previewing = false;
      if (req.query.preview) {
        const drafts = await getDraftByPreviewToken(tx, tenant.id, req.query.preview);
        for (const d of drafts) {
          const schema = SETTINGS_SECTIONS[d.section as keyof typeof SETTINGS_SECTIONS];
          const parsed = schema?.safeParse(d.data);
          if (parsed?.success) {
            overrides[d.section] = parsed.data;
            previewing = true;
          }
        }
      }
      const pols = await tx.select({ type: policies.type, title: policies.title, version: policies.version }).from(policies).where(eq(policies.status, 'PUBLISHED'));
      const [ga] = await tx.select({ config: apiConnections.config }).from(apiConnections).where(and(eq(apiConnections.provider, 'GA4'), eq(apiConnections.enabled, true))).limit(1);
      return {
        tenant: { slug: tenant.slug, name: tenant.name, isDemo: tenant.isDemo },
        previewing,
        brand: overrides.brand ?? brand,
        company: {
          legalName: company.legalName,
          legalNameEn: company.legalNameEn,
          representative: company.representative,
          businessRegistrationNo: company.businessRegistrationNo,
          ecommerceRegistrationNo: company.ecommerceRegistrationNo,
          address: company.address,
          phone: company.phone,
          fax: company.fax,
          email: company.email,
          website: company.website,
          csContact: company.csContact,
          csHours: company.csHours,
        },
        social: overrides.social ?? social,
        footer: overrides.footer ?? footer,
        homepage: overrides.homepage ?? homepage,
        locale,
        search: { anonymousSearchEnabled: search.anonymousSearchEnabled },
        pricing: { showEstimatedBadge: pricing.showEstimatedBadge, baseCurrency: pricing.baseCurrency },
        policies: pols,
        analytics: ga ? { ga4: String(ga.config.measurementId ?? '') } : null,
        features: req.ctx.features ? [...req.ctx.features] : [],
      };
    });
    reply.header('Cache-Control', req.query.preview ? 'no-store' : 'public, max-age=30');
    return data;
  });

  /** Public brand assets (logo, favicon, OG image) — only files explicitly marked as public brand assets. */
  app.get('/public/assets/:id', { schema: { params: z.object({ id: z.string().uuid() }) } }, async (req, reply) => {
    const tenant = tenantOf(req);
    const f = await withTenant({ tenantId: tenant.id }, async (tx) => {
      const [row] = await tx.select().from(files).where(and(eq(files.id, req.params.id), eq(files.isPublicAsset, true))).limit(1);
      return row;
    });
    if (!f) throw notFound();
    const buf = await storage.get(f.storageKey);
    reply.header('Cache-Control', 'public, max-age=86400');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.type(f.mime);
    return reply.send(buf);
  });

  app.get('/public/policies/:type', { schema: { params: z.object({ type: z.string().max(40) }) } }, async (req) => {
    const tenant = tenantOf(req);
    return withTenant({ tenantId: tenant.id }, async (tx) => {
      const [p] = await tx.select().from(policies).where(and(eq(policies.type, req.params.type), eq(policies.status, 'PUBLISHED'))).orderBy(desc(policies.version)).limit(1);
      if (!p) throw notFound();
      return { type: p.type, title: p.title, body: p.body, version: p.version, publishedAt: p.publishedAt };
    });
  });
}
