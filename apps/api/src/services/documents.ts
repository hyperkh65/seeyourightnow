import { and, desc, eq, sql } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { chromium, type Browser } from 'playwright-core';
import { config } from '../config.js';
import type { Tx } from '../db/client.js';
import { bankAccounts, documents, documentTemplates, documentTemplateVersions } from '../db/schema/index.js';
import { sha256Hex } from '../lib/crypto.js';
import { badRequest } from '../lib/errors.js';
import { safeFetch } from '../lib/http.js';
import { fileBuffer, storeFile } from './files.js';
import { getPublished } from './settings.js';
import { render } from './templates/render.js';

/**
 * Document Engine: versioned HTML templates → PDF (Gotenberg, or bundled Chromium fallback).
 * Every issued PDF is stored privately with SHA-256, size, creator and version; issued
 * documents are immutable (documents table is append-only for the runtime role).
 */

export async function publishedTemplate(tx: Tx, tenantId: string, kind: string) {
  const [tpl] = await tx.select().from(documentTemplates).where(and(eq(documentTemplates.tenantId, tenantId), eq(documentTemplates.kind, kind))).limit(1);
  if (!tpl?.publishedVersionId) throw badRequest(`${kind} 템플릿이 게시되지 않았습니다.`);
  const [ver] = await tx.select().from(documentTemplateVersions).where(eq(documentTemplateVersions.id, tpl.publishedVersionId)).limit(1);
  if (!ver) throw badRequest('템플릿 버전을 찾을 수 없습니다.');
  return { template: tpl, version: ver };
}

export async function documentContext(tx: Tx, tenantId: string) {
  const [brand, company] = await Promise.all([getPublished(tx, tenantId, 'brand'), getPublished(tx, tenantId, 'company')]);
  const banks = await tx.select().from(bankAccounts).where(and(eq(bankAccounts.tenantId, tenantId), eq(bankAccounts.active, true), eq(bankAccounts.showOnDocuments, true)));
  let logoDataUri: string | null = null;
  const logoId = brand.pdfLogoFileId ?? brand.logoFileId;
  if (logoId) {
    try {
      const f = await fileBuffer(tx, logoId);
      logoDataUri = `data:${f.mime};base64,${f.buffer.toString('base64')}`;
    } catch {
      logoDataUri = null;
    }
  }
  return {
    brand: { ...brand, logoDataUri },
    company,
    banks: banks.map((b) => ({ bankName: b.bankName, accountNumber: b.accountNumber, accountHolder: b.accountHolder, currency: b.currency, swift: b.swift, bankAddress: b.bankAddress })),
  };
}

export function wrapHtml(body: string, css: string, data: unknown): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>${render(css, data)}</style></head><body>${render(body, data)}</body></html>`;
}

let browserPromise: Promise<Browser> | null = null;
function chromiumPath(): string | undefined {
  if (config.CHROMIUM_PATH) return config.CHROMIUM_PATH;
  for (const p of ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) if (existsSync(p)) return p;
  return undefined;
}

async function renderWithChromium(html: string): Promise<Buffer> {
  browserPromise ??= chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const browser = await browserPromise;
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await ctx.newPage();
    // Block all network access: templates must be self-contained (images inlined as data URIs).
    await page.route('**/*', (route) => (route.request().url().startsWith('data:') ? route.continue() : route.abort()));
    await page.setContent(html, { waitUntil: 'load' });
    return Buffer.from(await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true }));
  } finally {
    await ctx.close();
  }
}

async function renderWithGotenberg(html: string): Promise<Buffer> {
  const form = new FormData();
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
  form.append('printBackground', 'true');
  form.append('preferCssPageSize', 'true');
  const res = await safeFetch(`${config.GOTENBERG_URL}/forms/chromium/convert/html`, { method: 'POST', body: form, trusted: true, timeoutMs: 60_000 });
  if (!res.ok) throw new Error(`Gotenberg HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function htmlToPdf(html: string): Promise<{ pdf: Buffer; renderer: 'GOTENBERG' | 'CHROMIUM' }> {
  if (config.GOTENBERG_URL) {
    try {
      return { pdf: await renderWithGotenberg(html), renderer: 'GOTENBERG' };
    } catch {
      /* fall back to local chromium */
    }
  }
  return { pdf: await renderWithChromium(html), renderer: 'CHROMIUM' };
}

export interface IssueDocumentInput {
  tenantId: string;
  kind: string;
  number: string;
  version?: number;
  projectId: string | null;
  entityType: string;
  entityId: string;
  data: Record<string, unknown>;
  userId: string | null;
  customerVisible?: boolean;
}

/** Renders and stores an immutable PDF; returns the document row. */
export async function issueDocument(tx: Tx, input: IssueDocumentInput) {
  const { version: tplVersion } = await publishedTemplate(tx, input.tenantId, input.kind);
  const ctx = await documentContext(tx, input.tenantId);
  const data = { ...ctx, ...input.data };
  const html = wrapHtml(tplVersion.html, tplVersion.css, data);
  const { pdf, renderer } = await htmlToPdf(html);
  const file = await storeFile(tx, { tenantId: input.tenantId, buffer: pdf, originalName: `${input.number}${input.version ? `-v${input.version}` : ''}.pdf`, purpose: 'GENERATED_PDF', uploadedBy: input.userId });
  const version = input.version ?? (await nextDocVersion(tx, input.tenantId, input.kind, input.number));
  const [doc] = await tx
    .insert(documents)
    .values({
      tenantId: input.tenantId,
      kind: input.kind,
      number: input.number,
      version,
      projectId: input.projectId,
      entityType: input.entityType,
      entityId: input.entityId,
      templateVersionId: tplVersion.id,
      fileId: file.id,
      sha256: sha256Hex(pdf),
      sizeBytes: pdf.length,
      renderer,
      customerVisible: input.customerVisible ?? true,
      createdBy: input.userId,
    })
    .returning();
  return { doc: doc!, templateVersionId: tplVersion.id, html };
}

async function nextDocVersion(tx: Tx, tenantId: string, kind: string, number: string): Promise<number> {
  const [r] = await tx.select({ v: sql<number>`coalesce(max(${documents.version}),0)::int` }).from(documents).where(and(eq(documents.tenantId, tenantId), eq(documents.kind, kind), eq(documents.number, number)));
  return (r?.v ?? 0) + 1;
}

/** HTML preview (no PDF, no storage) for template editing. */
export async function previewHtml(tx: Tx, tenantId: string, html: string, css: string, sample: Record<string, unknown>): Promise<string> {
  const ctx = await documentContext(tx, tenantId);
  return wrapHtml(html, css, { ...ctx, ...sample });
}

export async function latestDocuments(tx: Tx, projectId: string) {
  return tx.select().from(documents).where(eq(documents.projectId, projectId)).orderBy(desc(documents.createdAt));
}

export async function closePdfBrowser(): Promise<void> {
  if (browserPromise) await (await browserPromise).close().catch(() => undefined);
}
