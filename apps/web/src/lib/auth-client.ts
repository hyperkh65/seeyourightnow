'use client';

import type { useRouter } from 'next/navigation';
import type { useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { Me } from './site';

export function homeFor(audience?: string): string {
  return audience === 'STAFF'
    ? '/admin'
    : audience === 'PARTNER'
      ? '/partner'
      : audience === 'PLATFORM'
        ? '/platform'
        : '/portal';
}

/** Routes a freshly authenticated user: MFA → claimed search → role home. */
export async function afterLogin(
  router: ReturnType<typeof useRouter>,
  qc: ReturnType<typeof useQueryClient>,
  next: string | null,
  claim?: { id: string; token: string } | null,
) {
  await qc.invalidateQueries();
  const me = await api.get<Me>('/auth/me');
  if (me.user?.mfaSetupRequired) return router.push('/account/security?setup=1');
  if (me.user?.mfaPending) return router.push(`/login/mfa${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  if (claim && me.user?.audience === 'CUSTOMER') {
    try {
      const r = await api.post<{ projectId: string }>(`/sourcing/requests/${claim.id}/claim`, {
        token: claim.token,
      });
      return router.push(`/portal/projects/${r.projectId}`);
    } catch {
      /* fall through */
    }
  }
  router.push(safeNext(next) ?? homeFor(me.user?.audience));
  router.refresh();
}

/** Returns `next` only when it is a same-origin relative path (blocks `//host` and `/\\host` open redirects). */
export function safeNext(next: string | null | undefined): string | null {
  return next && /^\/(?![\\/])[^\s]*$/.test(next) ? next : null;
}
