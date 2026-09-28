import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

export const sha256Hex = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export const hmacHex = (data: string, key = config.signingKey) => createHmac('sha256', key).update(data).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** AES-256-GCM with the master key. Output: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encrypt(plain: string, key: Buffer | null = config.masterKey): string {
  if (!key) throw new Error('Secret master key is not configured');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decrypt(payload: string, key: Buffer | null = config.masterKey): string {
  if (!key) throw new Error('Secret master key is not configured');
  const [v, iv, tag, ct] = payload.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unsupported ciphertext format');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

/** Signs a short-lived payload (e.g. file download). */
export function signExpiring(resource: string, ttlSeconds: number): { exp: number; sig: string } {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return { exp, sig: hmacHex(`${resource}:${exp}`) };
}

export function verifyExpiring(resource: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(hmacHex(`${resource}:${exp}`), sig);
}

export function last4(value: string): string {
  return value.length <= 4 ? '****' : value.slice(-4);
}
