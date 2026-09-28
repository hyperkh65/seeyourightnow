import { and, desc, eq, sql } from 'drizzle-orm';
import { SETTINGS_SECTIONS, defaultHomepage, defaultSettings, formatNumber, sequenceScope, DEFAULT_NUMBER_PATTERNS, type SettingsSection } from '@sos/core';
import type { z } from 'zod';
import type { Tx } from '../db/client.js';
import { configVersions, numberSequences } from '../db/schema/index.js';
import { randomToken } from '../lib/crypto.js';
import { badRequest } from '../lib/errors.js';

export type SectionData<S extends SettingsSection> = z.infer<(typeof SETTINGS_SECTIONS)[S]>;

/** Published settings for a section (falls back to neutral defaults). */
export async function getPublished<S extends SettingsSection>(tx: Tx, tenantId: string, section: S): Promise<SectionData<S>> {
  const [row] = await tx
    .select({ data: configVersions.data })
    .from(configVersions)
    .where(and(eq(configVersions.tenantId, tenantId), eq(configVersions.section, section), eq(configVersions.status, 'PUBLISHED')))
    .orderBy(desc(configVersions.version))
    .limit(1);
  const parsed = SETTINGS_SECTIONS[section].safeParse(row?.data ?? {});
  if (parsed.success) return parsed.data as SectionData<S>;
  return defaultSettings(section);
}

export async function getSectionState(tx: Tx, tenantId: string, section: SettingsSection) {
  const rows = await tx
    .select()
    .from(configVersions)
    .where(and(eq(configVersions.tenantId, tenantId), eq(configVersions.section, section)))
    .orderBy(desc(configVersions.version))
    .limit(20);
  const published = rows.find((r) => r.status === 'PUBLISHED') ?? null;
  const draft = rows.find((r) => r.status === 'DRAFT') ?? null;
  let publishedData = published ? SETTINGS_SECTIONS[section].safeParse(published.data) : null;
  const fallback = section === 'homepage' ? defaultHomepage('') : defaultSettings(section);
  return {
    section,
    published: publishedData?.success ? publishedData.data : fallback,
    publishedVersion: published?.version ?? 0,
    publishedAt: published?.publishedAt ?? null,
    draft: draft ? draft.data : null,
    draftVersion: draft?.version ?? null,
    previewToken: draft?.previewToken ?? null,
    history: rows.map((r) => ({ version: r.version, status: r.status, createdAt: r.createdAt, publishedAt: r.publishedAt })),
  };
}

/** Saves a draft (validated). Only one draft per section exists at a time. */
export async function saveDraft(tx: Tx, tenantId: string, section: SettingsSection, data: unknown, userId: string) {
  const parsed = SETTINGS_SECTIONS[section].safeParse(data);
  if (!parsed.success) throw badRequest('설정 값이 올바르지 않습니다.', parsed.error.flatten());
  const [draft] = await tx
    .select()
    .from(configVersions)
    .where(and(eq(configVersions.tenantId, tenantId), eq(configVersions.section, section), eq(configVersions.status, 'DRAFT')))
    .limit(1);
  if (draft) {
    await tx.update(configVersions).set({ data: parsed.data as Record<string, unknown>, createdBy: userId }).where(eq(configVersions.id, draft.id));
    return { version: draft.version, previewToken: draft.previewToken };
  }
  const [max] = await tx
    .select({ v: sql<number>`coalesce(max(${configVersions.version}),0)::int` })
    .from(configVersions)
    .where(and(eq(configVersions.tenantId, tenantId), eq(configVersions.section, section)));
  const previewToken = randomToken(18);
  const version = (max?.v ?? 0) + 1;
  await tx.insert(configVersions).values({ tenantId, section, version, status: 'DRAFT', data: parsed.data as Record<string, unknown>, previewToken, createdBy: userId });
  return { version, previewToken };
}

export async function publishDraft(tx: Tx, tenantId: string, section: SettingsSection, userId: string) {
  const [draft] = await tx
    .select()
    .from(configVersions)
    .where(and(eq(configVersions.tenantId, tenantId), eq(configVersions.section, section), eq(configVersions.status, 'DRAFT')))
    .limit(1);
  if (!draft) throw badRequest('게시할 초안이 없습니다.');
  const before = await getPublished(tx, tenantId, section);
  await tx
    .update(configVersions)
    .set({ status: 'ARCHIVED' })
    .where(and(eq(configVersions.tenantId, tenantId), eq(configVersions.section, section), eq(configVersions.status, 'PUBLISHED')));
  await tx.update(configVersions).set({ status: 'PUBLISHED', publishedAt: new Date(), publishedBy: userId, previewToken: null }).where(eq(configVersions.id, draft.id));
  return { before, after: draft.data, version: draft.version };
}

/** Direct publish (used by setup wizard and seed): draft + publish in one step. */
export async function publishSection(tx: Tx, tenantId: string, section: SettingsSection, data: unknown, userId: string) {
  await saveDraft(tx, tenantId, section, data, userId);
  return publishDraft(tx, tenantId, section, userId);
}

export async function discardDraft(tx: Tx, tenantId: string, section: SettingsSection) {
  await tx.delete(configVersions).where(and(eq(configVersions.tenantId, tenantId), eq(configVersions.section, section), eq(configVersions.status, 'DRAFT')));
}

export async function getDraftByPreviewToken(tx: Tx, tenantId: string, token: string) {
  const rows = await tx
    .select()
    .from(configVersions)
    .where(and(eq(configVersions.tenantId, tenantId), eq(configVersions.previewToken, token), eq(configVersions.status, 'DRAFT')));
  return rows;
}

/** Atomically allocates the next document number for a doc type (e.g. QUOTATION → QT-2026-0001). */
export async function nextNumber(tx: Tx, tenantId: string, docType: string, date = new Date()): Promise<string> {
  const numbering = await getPublished(tx, tenantId, 'numbering');
  const pattern = numbering.patterns[docType] ?? DEFAULT_NUMBER_PATTERNS[docType] ?? `${docType.slice(0, 3)}-{YYYY}-{SEQ:4}`;
  const scope = sequenceScope(pattern, date);
  const [row] = await tx
    .insert(numberSequences)
    .values({ tenantId, docType, scope, nextValue: 2 })
    .onConflictDoUpdate({ target: [numberSequences.tenantId, numberSequences.docType, numberSequences.scope], set: { nextValue: sql`${numberSequences.nextValue} + 1` } })
    .returning({ nextValue: numberSequences.nextValue });
  const seq = (row?.nextValue ?? 2) - 1;
  return formatNumber(pattern, seq, date);
}
