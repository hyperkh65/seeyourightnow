import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import {
  assessRisk,
  evaluateCompliance,
  suggestRequiredDocuments,
  type ComplianceEvaluation,
  type ProductAttributes,
  type RegulationRule,
  type TriAttributeKey,
  type ExpertType,
} from '@sos/core';
import type { Tx } from '../db/client.js';
import {
  complianceChecks,
  hsClassifications,
  products,
  regulations,
  regulationVersions,
} from '../db/schema/index.js';

/** Effective attributes = AI estimate overlaid with human-verified values (estimate itself is untouched). */
export function effectiveAttributes(p: typeof products.$inferSelect): ProductAttributes {
  return {
    ...(p.attributesEstimated ?? ({} as ProductAttributes)),
    ...(p.attributesVerified ?? {}),
  } as ProductAttributes;
}

export async function loadRules(tx: Tx, tenantId: string): Promise<RegulationRule[]> {
  const regs = await tx
    .select()
    .from(regulations)
    .where(
      and(or(isNull(regulations.tenantId), eq(regulations.tenantId, tenantId)), eq(regulations.active, true)),
    );
  const versionIds = regs.map((r) => r.currentVersionId).filter((v): v is string => !!v);
  if (!versionIds.length) return [];
  const versions = await tx
    .select()
    .from(regulationVersions)
    .where(inArray(regulationVersions.id, versionIds));
  const byId = new Map(versions.map((v) => [v.id, v]));
  return regs
    .filter((r) => r.currentVersionId && byId.has(r.currentVersionId))
    .map((r) => {
      const v = byId.get(r.currentVersionId!)!;
      return {
        regulationId: r.id,
        versionId: v.id,
        code: r.code,
        name: r.name,
        authority: r.authority,
        category: r.category,
        triggerAll: v.triggerAll as TriAttributeKey[],
        triggerAny: v.triggerAny as TriAttributeKey[],
        exceptions: v.exceptions as TriAttributeKey[],
        hsPrefixes: v.hsPrefixes,
        mandatory: v.mandatory,
        documentsRequired: v.documentsRequired,
        testsRequired: v.testsRequired,
        expertType: (v.expertType as ExpertType | null) ?? null,
        officialSource: v.officialSource,
      };
    });
}

/**
 * Evaluates all rules for a product and upserts compliance_checks.
 * Only estimated_* columns are written; expert-verified columns are preserved.
 */
export async function evaluateProductCompliance(
  tx: Tx,
  tenantId: string,
  productId: string,
): Promise<ComplianceEvaluation[]> {
  const [p] = await tx.select().from(products).where(eq(products.id, productId)).limit(1);
  if (!p) return [];
  const attrs = effectiveAttributes(p);
  const [hs] = await tx
    .select()
    .from(hsClassifications)
    .where(eq(hsClassifications.productId, productId))
    .limit(1);
  const hsCode = hs?.actualHs ?? hs?.verifiedHs ?? hs?.estimatedHs ?? null;
  const rules = await loadRules(tx, tenantId);
  const evals = evaluateCompliance(rules, attrs, hsCode);
  for (const e of evals) {
    await tx
      .insert(complianceChecks)
      .values({
        tenantId,
        productId,
        regulationId: e.regulationId,
        regulationVersionId: e.versionId,
        estimatedStatus: e.status,
        estimatedConfidence: e.confidence,
        reasons: e.reasons,
        missingAttributes: e.missingAttributes,
      })
      .onConflictDoUpdate({
        target: [complianceChecks.productId, complianceChecks.regulationId],
        set: {
          regulationVersionId: e.versionId,
          estimatedStatus: e.status,
          estimatedConfidence: e.confidence,
          reasons: e.reasons,
          missingAttributes: e.missingAttributes,
          stale: false,
          updatedAt: new Date(),
        },
      });
  }
  const risk = assessRisk({
    attributes: attrs,
    compliance: evals,
    hsVerified: !!hs?.verifiedHs,
    hsCandidates: hs?.candidates.length ?? 0,
  });
  const passport = {
    ...(p.passport ?? {}),
    requiredDocuments: suggestRequiredDocuments(attrs, evals),
    complianceSummary: evals
      .filter((e) => e.status !== 'NOT_APPLICABLE')
      .map((e) => ({ code: e.code, name: e.name, status: e.status })),
    updatedAt: new Date().toISOString(),
  };
  await tx
    .update(products)
    .set({ risk, passport, hsCodeEstimated: hs?.estimatedHs ?? p.hsCodeEstimated, updatedAt: new Date() })
    .where(eq(products.id, productId));
  return evals;
}

/** Effective status shown to users: expert decision wins over estimate. */
export function effectiveStatus(c: typeof complianceChecks.$inferSelect): string {
  return c.verifiedStatus ?? c.estimatedStatus;
}
