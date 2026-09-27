import type { Role } from './enums.js';

/**
 * RBAC permission matrix. The API enforces these server-side on every route;
 * the web app uses the same table only to decide what to *show*.
 * ABAC checks (e.g. "customer may only see own company", "partner only sees
 * assigned tasks") are enforced in the service layer on top of this.
 */

export const PERMISSIONS = [
  'tenant.settings.read',
  'tenant.settings.write',
  'tenant.bank.write', // step-up required
  'tenant.connections.write', // step-up required
  'tenant.users.manage',
  'tenant.domains.manage',
  'tenant.audit.read',
  'tenant.jobs.manage',
  'crm.read',
  'crm.write',
  'crm.internal_notes',
  'sourcing.read',
  'sourcing.write',
  'supplier.read',
  'supplier.write',
  'supplier.secret', // real names/contacts of private-network suppliers
  'market.read',
  'compliance.read',
  'compliance.write',
  'compliance.rules.manage',
  'hs.read',
  'hs.write',
  'freight.read',
  'freight.write',
  'cost.read', // internal cost visibility
  'margin.manage', // step-up required
  'pricing.final', // set ADMIN_FINAL_PRICE
  'quote.read',
  'quote.write',
  'quote.approve_final',
  'contract.write',
  'contract.approve_company',
  'invoice.write',
  'payment.write',
  'order.write',
  'shipment.read',
  'shipment.write',
  'document.read',
  'document.template.manage',
  'email.manage',
  'analytics.read',
  'webhook.manage',
  'import.export',
  'partner.tasks',
  'customer.portal',
  'platform.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL_TENANT: Permission[] = PERMISSIONS.filter((p) => p !== 'platform.manage' && p !== 'customer.portal' && p !== 'partner.tasks');

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: [...PERMISSIONS],
  TENANT_OWNER: ALL_TENANT,
  TENANT_ADMIN: ALL_TENANT,
  SALES: [
    'tenant.settings.read',
    'crm.read',
    'crm.write',
    'crm.internal_notes',
    'sourcing.read',
    'sourcing.write',
    'supplier.read',
    'market.read',
    'compliance.read',
    'hs.read',
    'freight.read',
    'cost.read',
    'quote.read',
    'quote.write',
    'contract.write',
    'shipment.read',
    'document.read',
    'analytics.read',
  ],
  SOURCING_MANAGER: [
    'tenant.settings.read',
    'crm.read',
    'sourcing.read',
    'sourcing.write',
    'supplier.read',
    'supplier.write',
    'supplier.secret',
    'market.read',
    'compliance.read',
    'compliance.write',
    'hs.read',
    'hs.write',
    'freight.read',
    'freight.write',
    'cost.read',
    'quote.read',
    'quote.write',
    'order.write',
    'shipment.read',
    'shipment.write',
    'document.read',
    'analytics.read',
    'import.export',
  ],
  FINANCE: [
    'tenant.settings.read',
    'crm.read',
    'sourcing.read',
    'cost.read',
    'quote.read',
    'invoice.write',
    'payment.write',
    'shipment.read',
    'document.read',
    'analytics.read',
    'import.export',
  ],
  WAREHOUSE: ['sourcing.read', 'shipment.read', 'shipment.write', 'order.write', 'document.read'],
  CUSTOMS_PARTNER: ['partner.tasks'],
  FORWARDER_PARTNER: ['partner.tasks'],
  CERTIFICATION_PARTNER: ['partner.tasks'],
  SUPPLIER_PARTNER: ['partner.tasks'],
  CUSTOMER_ADMIN: ['customer.portal'],
  CUSTOMER_USER: ['customer.portal'],
  READ_ONLY: ['tenant.settings.read', 'crm.read', 'sourcing.read', 'supplier.read', 'market.read', 'compliance.read', 'hs.read', 'freight.read', 'quote.read', 'shipment.read', 'document.read', 'analytics.read'],
};

/** Permissions that require a recent step-up authentication (re-auth / MFA within N minutes). */
export const STEP_UP_PERMISSIONS: Permission[] = ['tenant.bank.write', 'tenant.connections.write', 'margin.manage'];

export function hasPermission(roles: readonly Role[], perm: Permission): boolean {
  return roles.some((r) => ROLE_PERMISSIONS[r]?.includes(perm));
}

export function permissionsOf(roles: readonly Role[]): Permission[] {
  return [...new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r] ?? []))];
}

/**
 * Fields that must never leave the API for customer or partner audiences.
 * Redaction happens server-side in the response serializer — hiding in UI is not enough.
 */
export const INTERNAL_FIELDS = [
  'internalCost',
  'internal_cost',
  'supplierListPrice',
  'supplierVerifiedPrice',
  'actualPurchasePrice',
  'estimatedLandedCost',
  'verifiedLandedCost',
  'actualLandedCost',
  'calculatedCustomerPrice',
  'costBreakdown',
  'marginPct',
  'markupPct',
  'profit',
  'profitBase',
  'internalNotes',
  'internal_notes',
  'privateNote',
  'supplierId',
  'supplierName',
  'supplierContact',
  'supplierBank',
  'sourceUrl',
  'marginExplanation',
  'riskInternal',
] as const;

export function redactInternal<T>(value: T, extraKeys: readonly string[] = []): T {
  const keys = new Set<string>([...INTERNAL_FIELDS, ...extraKeys]);
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (keys.has(k)) continue;
        out[k] = walk(x);
      }
      return out;
    }
    return v;
  };
  return walk(value) as T;
}
