import { eq } from 'drizzle-orm';
import { fileTypeFromBuffer } from 'file-type';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import type { Tx } from '../db/client.js';
import { files } from '../db/schema/index.js';
import { AppError, notFound } from '../lib/errors.js';
import { sha256Hex } from '../lib/crypto.js';
import { scanBuffer, storage } from './storage.js';

export type FilePurpose =
  | 'SEARCH_IMAGE'
  | 'PRODUCT_IMAGE'
  | 'DOCUMENT'
  | 'BRAND_ASSET'
  | 'ATTACHMENT'
  | 'EXPORT'
  | 'IMPORT'
  | 'GENERATED_PDF';

const IMAGE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
const DOCS = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip',
];
const BRAND = [...IMAGE, 'image/x-icon', 'image/vnd.microsoft.icon'];

const ALLOWED: Record<FilePurpose, string[]> = {
  SEARCH_IMAGE: IMAGE,
  PRODUCT_IMAGE: IMAGE,
  DOCUMENT: [...DOCS, ...IMAGE],
  BRAND_ASSET: BRAND,
  ATTACHMENT: [...DOCS, ...IMAGE],
  EXPORT: [...DOCS, 'text/csv'],
  IMPORT: [...DOCS, 'text/csv'],
  GENERATED_PDF: ['application/pdf'],
};

/** Text formats have no magic bytes; accept them only for explicit purposes and only if they look like UTF-8 text. */
function sniffText(buf: Buffer, name: string): string | null {
  if (!/\.(csv|txt)$/i.test(name)) return null;
  const sample = buf.subarray(0, 4096).toString('utf8');
  if (sample.includes('\u0000') || /<script|<html|<svg/i.test(sample)) return null;
  return 'text/csv';
}

export interface StoredFile {
  id: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  scanStatus: string;
  originalName: string;
}

/**
 * Validates (size, magic bytes vs allowlist, dangerous types), scans, stores privately and records metadata.
 * The client-declared MIME type is ignored: only detected content counts.
 */
export async function storeFile(
  tx: Tx,
  p: {
    tenantId: string;
    buffer: Buffer;
    originalName: string;
    purpose: FilePurpose;
    uploadedBy?: string | null;
    isPublicAsset?: boolean;
  },
): Promise<StoredFile> {
  const max = config.UPLOAD_MAX_MB * 1024 * 1024;
  if (p.buffer.length === 0) throw new AppError(400, 'EMPTY_FILE', '빈 파일입니다.');
  if (p.buffer.length > max)
    throw new AppError(413, 'FILE_TOO_LARGE', `파일은 ${config.UPLOAD_MAX_MB}MB 이하만 올릴 수 있습니다.`);
  const detected = await fileTypeFromBuffer(p.buffer);
  const mime = detected?.mime ?? sniffText(p.buffer, p.originalName);
  if (!mime || !ALLOWED[p.purpose].includes(mime)) {
    throw new AppError(415, 'UNSUPPORTED_FILE', '지원하지 않는 파일 형식입니다.', {
      detected: detected?.mime ?? null,
    });
  }
  const scan = await scanBuffer(p.buffer);
  if (scan.status === 'INFECTED')
    throw new AppError(422, 'MALWARE_DETECTED', '악성코드가 발견되어 업로드할 수 없습니다.');
  const sha256 = sha256Hex(p.buffer);
  const now = new Date();
  const ext = detected?.ext ?? 'csv';
  const key = `${p.tenantId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${ext}`;
  await storage.put(key, p.buffer, mime);
  const safeName = p.originalName.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 200) || `file.${ext}`;
  const [row] = await tx
    .insert(files)
    .values({
      tenantId: p.tenantId,
      storageKey: key,
      bucket: storage.bucket,
      originalName: safeName,
      mime,
      sizeBytes: p.buffer.length,
      sha256,
      purpose: p.purpose,
      scanStatus: scan.status,
      scanDetail: scan.detail.slice(0, 500),
      isPublicAsset: p.isPublicAsset ?? false,
      uploadedBy: p.uploadedBy ?? null,
    })
    .returning();
  return {
    id: row!.id,
    mime,
    sizeBytes: row!.sizeBytes,
    sha256,
    scanStatus: scan.status,
    originalName: safeName,
  };
}

export async function getFileRow(tx: Tx, id: string) {
  const [f] = await tx.select().from(files).where(eq(files.id, id)).limit(1);
  if (!f) throw notFound('파일을 찾을 수 없습니다.');
  return f;
}

export async function fileBuffer(
  tx: Tx,
  id: string,
): Promise<{ buffer: Buffer; mime: string; name: string }> {
  const f = await getFileRow(tx, id);
  return { buffer: await storage.get(f.storageKey), mime: f.mime, name: f.originalName };
}

/** Short-lived signed download URL (default 5 minutes). */
export async function signedDownloadUrl(tx: Tx, id: string, ttlSeconds = 300): Promise<string> {
  const f = await getFileRow(tx, id);
  return storage.signedUrl(f.id, f.storageKey, f.originalName, ttlSeconds);
}
