import dns from 'node:dns';
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { Agent } from 'undici';
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

/**
 * Internal hosts that operator-configured connectors may reach (e.g. the self-hosted AI worker).
 * Tenant admins cannot widen this list: it comes from the environment only.
 */
const INTERNAL_ALLOW = new Set(
  (
    process.env.INTERNAL_HOST_ALLOWLIST ??
    (process.env.NODE_ENV === 'production' ? 'ai-worker' : 'ai-worker,localhost,127.0.0.1')
  )
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
);
const METADATA_V4 = ['169.254.169.254', '169.254.170.2', '100.100.100.200'];

type LookupCb = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

/** Resolves at connect time and refuses private targets, so DNS rebinding cannot bypass the pre-check. */
function guardedLookup(allowInternal: boolean) {
  return (hostname: string, options: dns.LookupOptions, cb: LookupCb) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return cb(err, [] as dns.LookupAddress[]);
      const list = addresses as dns.LookupAddress[];
      const internalOk = allowInternal && INTERNAL_ALLOW.has(hostname.toLowerCase());
      const blocked = list.some(
        (a) => METADATA_V4.includes(a.address) || (!internalOk && isPrivateAddress(a.address)),
      );
      if (blocked) {
        const e = new Error(`blocked address for ${hostname}`) as NodeJS.ErrnoException;
        e.code = 'EBLOCKED';
        return cb(e, [] as dns.LookupAddress[]);
      }
      if (options.all) return cb(null, list);
      const first = list[0]!;
      return cb(null, first.address, first.family);
    });
  };
}
const publicAgent = new Agent({ connect: { lookup: guardedLookup(false) } });
const operatorAgent = new Agent({ connect: { lookup: guardedLookup(true) } });

/** Pre-validates a URL; operator-trusted calls may reach allow-listed internal hosts only. */
async function assertAllowedUrl(raw: string, trusted: boolean): Promise<void> {
  if (!trusted) {
    await assertPublicUrl(raw);
    return;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError(400, 'INVALID_URL', '올바른 URL이 아닙니다.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new AppError(400, 'INVALID_URL', 'http(s) URL만 허용됩니다.');
  if (INTERNAL_ALLOW.has(url.hostname.toLowerCase())) return;
  await assertPublicUrl(raw);
}

export async function safeFetch(raw: string, opts: SafeFetchOptions = {}, depth = 0): Promise<Response> {
  const trusted = !!opts.trusted;
  await assertAllowedUrl(raw, trusted);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  try {
    const { trusted: _t, timeoutMs: _tm, maxBytes: _mb, ...init } = opts;
    const res = await fetch(raw, {
      ...init,
      redirect: 'manual',
      signal: controller.signal,
      // undici dispatcher: connect-time address check (not part of the DOM RequestInit type)
      ...({ dispatcher: trusted ? operatorAgent : publicAgent } as object),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return res;
      if (depth >= 5) throw new AppError(502, 'TOO_MANY_REDIRECTS', '리다이렉트가 너무 많습니다.');
      // Every hop is re-validated (a public URL must not redirect into the internal network).
      return safeFetch(new URL(loc, raw).toString(), opts, depth + 1);
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
