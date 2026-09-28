import { GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { config } from '../config.js';
import { signExpiring } from '../lib/crypto.js';

/**
 * Object storage. Buckets are private; downloads use short-lived signed URLs.
 * `local` driver stores under STORAGE_LOCAL_DIR and serves through the API with HMAC-signed URLs.
 */
export interface StorageDriver {
  name: 'local' | 's3';
  bucket: string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  signedUrl(fileId: string, key: string, filename: string, ttlSeconds: number): Promise<string>;
  health(): Promise<'OK' | 'DOWN'>;
}

const localRoot = path.resolve(config.STORAGE_LOCAL_DIR);

const local: StorageDriver = {
  name: 'local',
  bucket: 'local',
  async put(key, body) {
    const p = safeJoin(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, body, { mode: 0o600 });
  },
  async get(key) {
    return readFile(safeJoin(key));
  },
  async signedUrl(fileId, _key, _filename, ttl) {
    const { exp, sig } = signExpiring(`file:${fileId}`, ttl);
    return `/api/v1/files/${fileId}/content?exp=${exp}&sig=${sig}`;
  },
  async health() {
    try {
      await mkdir(localRoot, { recursive: true });
      await stat(localRoot);
      return 'OK';
    } catch {
      return 'DOWN';
    }
  },
};

function safeJoin(key: string): string {
  const p = path.resolve(localRoot, key);
  if (!p.startsWith(localRoot + path.sep)) throw new Error('invalid storage key');
  return p;
}

let s3Client: S3Client | null = null;
function s3(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: config.S3_ACCESS_KEY ? { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY ?? '' } : undefined,
    });
  }
  return s3Client;
}

const s3Driver: StorageDriver = {
  name: 's3',
  bucket: config.S3_BUCKET,
  async put(key, body, contentType) {
    await s3().send(new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: config.S3_ENDPOINT ? undefined : 'AES256' }));
  },
  async get(key) {
    const r = await s3().send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  },
  async signedUrl(_fileId, key, filename, ttl) {
    return getSignedUrl(
      s3(),
      new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key, ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(filename)}` }),
      { expiresIn: ttl },
    );
  },
  async health() {
    try {
      await s3().send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }));
      return 'OK';
    } catch {
      return 'DOWN';
    }
  },
};

export const storage: StorageDriver = config.STORAGE_DRIVER === 's3' ? s3Driver : local;

// ─────────────── Malware scanning (ClamAV clamd INSTREAM) ───────────────

export type ScanResult = { status: 'CLEAN' | 'INFECTED' | 'NOT_SCANNED' | 'ERROR'; detail: string };

export async function scanBuffer(buf: Buffer): Promise<ScanResult> {
  if (!config.CLAMAV_HOST) return { status: 'NOT_SCANNED', detail: 'ClamAV not configured' };
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: config.CLAMAV_HOST, port: config.CLAMAV_PORT });
    let out = '';
    sock.setTimeout(30_000, () => {
      sock.destroy();
      resolve({ status: 'ERROR', detail: 'ClamAV timeout' });
    });
    sock.on('error', (e) => resolve({ status: 'ERROR', detail: e.message }));
    sock.on('data', (d) => (out += d.toString()));
    sock.on('end', () => {
      if (/OK\0?$/.test(out.trim())) resolve({ status: 'CLEAN', detail: '' });
      else if (/FOUND/.test(out)) resolve({ status: 'INFECTED', detail: out.trim() });
      else resolve({ status: 'ERROR', detail: out.trim() });
    });
    sock.on('connect', () => {
      sock.write('zINSTREAM\0');
      const chunk = 64 * 1024;
      for (let i = 0; i < buf.length; i += chunk) {
        const part = buf.subarray(i, i + chunk);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(part.length);
        sock.write(len);
        sock.write(part);
      }
      sock.write(Buffer.alloc(4));
    });
  });
}
