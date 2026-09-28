import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { AppError } from './errors.js';

/**
 * Outbound HTTP with SSRF protection. User-influenced URLs (product URL
 * lookups, webhooks, generic connectors) must go through safeFetch, which
 * rejects non-http(s) schemes and private / loopback / link-local targets.
 */

const PRIVATE_V4 = [
  ['10.0.0.0', 8],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['100.64.0.0', 10],
  ['0.0.0.0', 8],
  ['224.0.0.0', 4],
] as const;

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
}

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const n = ipv4ToInt(ip);
    return PRIVATE_V4.some(([base, bits]) => {
      const mask = (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80')) return true;
  if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7));
  return false;
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError(400, 'INVALID_URL', '올바른 URL이 아닙니다.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new AppError(400, 'INVALID_URL', 'http(s) URL만 허용됩니다.');
  if (url.username || url.password)
    throw new AppError(400, 'INVALID_URL', '인증정보가 포함된 URL은 허용되지 않습니다.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addrs.length === 0) throw new AppError(400, 'INVALID_URL', '호스트를 찾을 수 없습니다.');
  if (addrs.some((a) => isPrivateAddress(a.address)))
    throw new AppError(400, 'BLOCKED_URL', '내부 네트워크 주소는 허용되지 않습니다.');
  return url;
}

export interface SafeFetchOptions extends RequestInit {
  timeoutMs?: number;
  maxBytes?: number;
  /** Skip SSRF checks for operator-configured, trusted endpoints (e.g. official APIs set by admins). */
  trusted?: boolean;
}

export async function safeFetch(raw: string, opts: SafeFetchOptions = {}): Promise<Response> {
  if (!opts.trusted) await assertPublicUrl(raw);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  try {
    const res = await fetch(raw, {
      ...opts,
      redirect: opts.trusted ? 'follow' : 'manual',
      signal: controller.signal,
    });
    if (!opts.trusted && res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return res;
      const next = new URL(loc, raw).toString();
      return safeFetch(next, { ...opts, timeoutMs: opts.timeoutMs });
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function readLimitedText(res: Response, maxBytes = 2_000_000): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
