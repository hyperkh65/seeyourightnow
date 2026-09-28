import type { FastifyReply, FastifyRequest } from 'fastify';
import { audienceOf, hasPermission, STEP_UP_PERMISSIONS, type Audience, type FeatureModule, type Permission, type Role } from '@sos/core';
import { config } from '../config.js';
import { withTenant, type Tx } from '../db/client.js';
import { featureDisabled, forbidden, mfaRequired, notFound, stepUpRequired, unauthorized } from '../lib/errors.js';

export interface TenantInfo {
  id: string;
  slug: string;
  name: string;
  status: string;
  isDemo: boolean;
}

export interface AuthUser {
  id: string;
  tenantId: string | null;
  email: string;
  name: string;
  roles: Role[];
  audience: Audience;
  companyId: string | null;
  isSuperAdmin: boolean;
  mfaEnabled: boolean;
  expertTypes: string[];
}

export interface SessionInfo {
  id: string;
  csrfToken: string;
  mfaVerified: boolean;
  stepUpAt: Date | null;
  impersonatorId: string | null;
}

export interface RequestContext {
  requestId: string;
  ip: string;
  userAgent: string;
  host: string;
  proto: string;
  tenant: TenantInfo | null;
  platform: boolean;
  user: AuthUser | null;
  session: SessionInfo | null;
  features: Set<FeatureModule> | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    ctx: RequestContext;
  }
}

export function tenantOf(req: FastifyRequest): TenantInfo {
  const t = req.ctx.tenant;
  if (!t) throw notFound('사이트를 찾을 수 없습니다.');
  if (t.status !== 'ACTIVE') throw forbidden('이 사이트는 현재 이용이 중지되었습니다.');
  return t;
}

export function userOf(req: FastifyRequest): AuthUser {
  const u = req.ctx.user;
  if (!u || !req.ctx.session) throw unauthorized();
  const needsMfa = u.mfaEnabled || u.isSuperAdmin;
  if (needsMfa && !req.ctx.session.mfaVerified) throw mfaRequired();
  return u;
}

export function staffOf(req: FastifyRequest): AuthUser {
  const u = userOf(req);
  if (u.audience !== 'STAFF' && u.audience !== 'PLATFORM') throw forbidden();
  return u;
}

/** RBAC gate. Step-up (recent re-authentication) is enforced for sensitive permissions. */
export function requirePerm(req: FastifyRequest, perm: Permission): AuthUser {
  const u = userOf(req);
  if (!hasPermission(u.roles, perm)) throw forbidden();
  if (STEP_UP_PERMISSIONS.includes(perm)) requireStepUp(req);
  return u;
}

export function can(req: FastifyRequest, perm: Permission): boolean {
  const u = req.ctx.user;
  return !!u && hasPermission(u.roles, perm);
}

export function requireStepUp(req: FastifyRequest): void {
  const s = req.ctx.session;
  if (!s?.stepUpAt || Date.now() - s.stepUpAt.getTime() > config.STEP_UP_MINUTES * 60_000) throw stepUpRequired();
}

export function requireFeature(req: FastifyRequest, module: FeatureModule): void {
  const f = req.ctx.features;
  if (f && !f.has(module)) throw featureDisabled(module);
}

export function isStaff(req: FastifyRequest): boolean {
  const a = req.ctx.user?.audience;
  return a === 'STAFF' || a === 'PLATFORM';
}

/** Tenant-scoped transaction for the current request. */
export function db<T>(req: FastifyRequest, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const t = tenantOf(req);
  return withTenant({ tenantId: t.id, userId: req.ctx.user?.id ?? null }, fn);
}

export function audienceFromRoles(roles: Role[]): Audience {
  return audienceOf(roles);
}

export function noStore(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store');
}
