import type { FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors.js';

export interface UploadedPart {
  field: string;
  filename: string;
  buffer: Buffer;
}

/** Reads a multipart request fully (limits enforced by @fastify/multipart). JSON bodies pass through as fields. */
export async function readForm(
  req: FastifyRequest,
): Promise<{ fields: Record<string, string>; files: UploadedPart[] }> {
  if (!req.isMultipart()) {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) fields[k] = typeof v === 'string' ? v : JSON.stringify(v);
    return { fields, files: [] };
  }
  const fields: Record<string, string> = {};
  const files: UploadedPart[] = [];
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      const buffer = await part.toBuffer();
      if (part.file.truncated) throw new AppError(413, 'FILE_TOO_LARGE', '파일이 너무 큽니다.');
      files.push({ field: part.fieldname, filename: part.filename, buffer });
    } else {
      fields[part.fieldname] = String(part.value ?? '');
    }
  }
  return { fields, files };
}
