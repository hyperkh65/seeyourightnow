import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { loadAuthUser, validateSession } from '../services/auth.js';
import { effectiveFeatures, resolveHost, tenantBySlug } from '../services/tenancy.js';
import { safeEqual } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';

export const SESSION_COOKIE = 'sos_session';
export const CSRF_COOKIE = 'sos_csrf';

export function setSessionCookies(reply: FastifyReply, token: string, csrf: string): void {
  const base = {
    path: '/',
    secure: config.cookieSecure,
    sameSite: 'lax' as const,
    maxAge: config.SESSION_TTL_HOURS * 3600,
  };
  reply.setCookie(SESSION_COOKIE, token, { ...base, httpOnly: true });
  reply.setCookie(CSRF_COOKIE, csrf, { ...base, httpOnly: false });
}

export function clearSessionCookies(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
  reply.clearCookie(CSRF_COOKIE, { path: '/' });
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Routes that may be called cross-site without CSRF token (signed webhooks, health). */
const CSRF_EXEMPT = [/^\/api\/v1\/health/, /^\/api\/v1\/hooks\//, /^\/api\/v1\/ingest\//];

function originAllowed(req: FastifyRequest): boolean {
  const origin = req.headers.origin ?? req.headers.referer;
  if (!origin) return true; // non-browser clients (curl, server-to-server) carry no ambient cookies in practice
  try {
    return new URL(origin).host.toLowerCase().replace(/:\d+$/, '') === req.ctx.host;
  } catch {
    return false;
  }
}

export async function registerContext(app: FastifyInstance): Promise<void> {
  app.decorateRequest('ctx', null as never);

  app.addHook('onRequest', async (req, reply) => {
    const requestId = (req.headers['x-request-id'] as string | undefined)?.slice(0, 64) || randomUUID();
    reply.header('x-request-id', requestId);
    const rawHost = (
      (config.TRUST_PROXY || config.NODE_ENV !== 'production'
        ? (req.headers['x-forwarded-host'] as string | undefined)
        : undefined) ??
      req.headers.host ??
      ''
    ).toString();
    const host = rawHost.split(',')[0]!.trim().toLowerCase().replace(/:\d+$/, '');
    const proto = ((req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol)
      .split(',')[0]!
      .trim();
    req.ctx = {
      requestId,
      ip: req.ip,
      userAgent: (req.headers['user-agent'] ?? '').slice(0, 500),
      host,
      proto,
      tenant: null,
      platform: false,
      user: null,
      session: null,
      features: null,
    };

    // Explicit tenant header is honoured only in DEV_MODE / tests (never in production).
    const devSlug =
      config.DEV_MODE || config.NODE_ENV === 'test'
        ? (req.headers['x-tenant-slug'] as string | undefined)
        : undefined;
    if (devSlug) {
      req.ctx.tenant = await tenantBySlug(devSlug);
    } else {
      const r = await resolveHost(host);
      if (r.kind === 'platform') req.ctx.platform = true;
      else if (r.kind === 'tenant') req.ctx.tenant = r.tenant;
    }

    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      const v = await validateSession(token, req.ip);
      if (v) {
        const sameScope = req.ctx.platform
          ? v.tenantId === null
          : req.ctx.tenant
            ? v.tenantId === req.ctx.tenant.id
            : false;
        const superOnTenant = !req.ctx.platform && v.tenantId === null; // super admin viewing a tenant site: not allowed via cookie
        if (sameScope && !superOnTenant) {
          const user = await loadAuthUser(v.userId);
          if (user) {
            req.ctx.user = user;
            req.ctx.session = v.session;
            if (v.rotatedToken) setSessionCookies(reply, v.rotatedToken, v.session.csrfToken);
          }
        }
      }
    }
    if (req.ctx.tenant) req.ctx.features = (await effectiveFeatures(req.ctx.tenant.id)).features;
  });

  // CSRF: authenticated cookie sessions must echo the CSRF token; every state-changing request must be same-origin.
  app.addHook('preHandler', async (req) => {
    if (SAFE_METHODS.has(req.method)) return;
    if (CSRF_EXEMPT.some((r) => r.test(req.url))) return;
    if (!originAllowed(req)) throw new AppError(403, 'CSRF', '허용되지 않은 요청 출처입니다.');
    if (req.ctx.session) {
      const header = (req.headers['x-csrf-token'] as string | undefined) ?? '';
      if (!header || !safeEqual(header, req.ctx.session.csrfToken))
        throw new AppError(403, 'CSRF', '보안 토큰이 유효하지 않습니다. 페이지를 새로고침해 주세요.');
    }
  });
}
