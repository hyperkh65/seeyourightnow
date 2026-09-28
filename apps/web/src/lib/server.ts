import 'server-only';
import { cookies, headers } from 'next/headers';
import type { SiteConfig } from './site';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

/** Server-side fetch to the API that preserves the tenant host (for SSR metadata/theming). */
export async function serverApi<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
  try {
    const res = await fetch(`${API}/api/v1${path}`, {
      ...init,
      headers: { 'x-forwarded-host': host, 'x-forwarded-proto': h.get('x-forwarded-proto') ?? 'http', accept: 'application/json', ...(init.headers ?? {}) },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Site config; an admin preview token (cookie set by /preview) shows unpublished drafts. */
export async function getSite(preview?: string): Promise<SiteConfig | null> {
  const token = preview ?? (await cookies()).get('sos_preview')?.value;
  return serverApi<SiteConfig>(`/public/site${token ? `?preview=${encodeURIComponent(token)}` : ''}`);
}
