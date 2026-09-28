import { and, eq } from 'drizzle-orm';
import type { ProjectStage } from '@sos/core';
import type { Tx } from '../db/client.js';
import { sourcingProjects, workflowInstances } from '../db/schema/index.js';

/**
 * Durable order workflow. State lives in Postgres (workflow_instances), so a
 * server restart never loses progress; human-in-the-loop steps park the
 * instance in WAITING_HUMAN until the corresponding API action completes them.
 *
 * The engine is intentionally small and deterministic. It exposes the same
 * shape (definition → steps → signals) as a Temporal workflow, so the core
 * order flow can be moved to Temporal without changing callers (see ARCHITECTURE.md).
 */

export interface StepDef {
  key: string;
  label: string;
  human: boolean; // waits for a person (customer/staff/partner)
  stage: ProjectStage;
}

export const ORDER_FULFILLMENT: StepDef[] = [
  { key: 'QUOTE_ISSUED', label: '견적 발행', human: false, stage: 'QUOTE_PREPARING' },
  { key: 'CUSTOMER_APPROVAL', label: '고객 견적 승인', human: true, stage: 'QUOTE_PREPARING' },
  { key: 'ADMIN_APPROVAL', label: '관리자 최종 승인', human: true, stage: 'QUOTE_APPROVED' },
  { key: 'CONTRACT', label: '계약 체결', human: true, stage: 'CONTRACT' },
  { key: 'DEPOSIT', label: '계약금 입금', human: true, stage: 'CONTRACT' },
  { key: 'PURCHASE_ORDER', label: '공장 발주', human: true, stage: 'PRODUCTION' },
  { key: 'PRODUCTION', label: '생산', human: true, stage: 'PRODUCTION' },
  { key: 'INSPECTION', label: '검품', human: true, stage: 'INSPECTION' },
  { key: 'FORWARDER', label: '포워더 배정·선적 예약', human: true, stage: 'READY_TO_SHIP' },
  { key: 'SHIPPED', label: '선적', human: false, stage: 'SHIPPED' },
  { key: 'ARRIVED', label: '입항', human: false, stage: 'ARRIVED' },
  { key: 'CUSTOMS', label: '통관', human: true, stage: 'CUSTOMS' },
  { key: 'DELIVERY', label: '국내 배송', human: true, stage: 'DELIVERING' },
  { key: 'COMPLETED', label: '완료', human: false, stage: 'COMPLETED' },
];

export async function ensureWorkflow(tx: Tx, tenantId: string, projectId: string) {
  const [w] = await tx.select().from(workflowInstances).where(and(eq(workflowInstances.projectId, projectId), eq(workflowInstances.definition, 'ORDER_FULFILLMENT'))).limit(1);
  if (w) return w;
  const [n] = await tx
    .insert(workflowInstances)
    .values({ tenantId, definition: 'ORDER_FULFILLMENT', projectId, currentStep: ORDER_FULFILLMENT[0]!.key, status: 'RUNNING', history: [] })
    .onConflictDoNothing()
    .returning();
  if (n) return n;
  const [again] = await tx.select().from(workflowInstances).where(and(eq(workflowInstances.projectId, projectId), eq(workflowInstances.definition, 'ORDER_FULFILLMENT'))).limit(1);
  return again!;
}

/**
 * Marks `step` complete (idempotent) and moves to the following step.
 * Completing a later step implicitly completes skipped earlier steps (recorded as SKIPPED).
 */
export async function completeStep(tx: Tx, tenantId: string, projectId: string, step: string, by: string | null, note?: string) {
  const w = await ensureWorkflow(tx, tenantId, projectId);
  const idx = ORDER_FULFILLMENT.findIndex((s) => s.key === step);
  if (idx < 0) throw new Error(`unknown workflow step ${step}`);
  const curIdx = ORDER_FULFILLMENT.findIndex((s) => s.key === w.currentStep);
  if (w.status === 'COMPLETED' || idx < curIdx) return w; // already past this step
  const now = new Date().toISOString();
  const history = [...w.history];
  for (let i = curIdx; i < idx; i++) history.push({ step: ORDER_FULFILLMENT[i]!.key, status: 'SKIPPED', at: now, by });
  history.push({ step, status: 'DONE', at: now, by, ...(note ? { note } : {}) });
  const next = ORDER_FULFILLMENT[idx + 1];
  const status = !next || next.key === 'COMPLETED' ? (next ? 'COMPLETED' : 'COMPLETED') : next.human ? 'WAITING_HUMAN' : 'RUNNING';
  const currentStep = next?.key ?? 'COMPLETED';
  if (next?.key === 'COMPLETED') history.push({ step: 'COMPLETED', status: 'DONE', at: now, by });
  const [updated] = await tx
    .update(workflowInstances)
    .set({ currentStep, status, waitingFor: next?.human ? next.label : null, history, updatedAt: new Date() })
    .where(eq(workflowInstances.id, w.id))
    .returning();
  // Project stage follows the workflow (never moves backwards).
  const stage = (next ?? ORDER_FULFILLMENT[idx]!).stage;
  const [p] = await tx.select().from(sourcingProjects).where(eq(sourcingProjects.id, projectId)).limit(1);
  if (p && stageRank(stage) > stageRank(p.stage as ProjectStage)) {
    await tx
      .update(sourcingProjects)
      .set({ stage, stageHistory: [...p.stageHistory, { stage, at: now, by }], ...(stage === 'COMPLETED' ? { status: 'CLOSED' } : {}), updatedAt: new Date() })
      .where(eq(sourcingProjects.id, projectId));
  }
  return updated!;
}

const ORDER: ProjectStage[] = ['REQUESTED', 'SEARCHING', 'QUOTE_PREPARING', 'QUOTE_APPROVED', 'CONTRACT', 'PRODUCTION', 'INSPECTION', 'READY_TO_SHIP', 'SHIPPED', 'ARRIVED', 'CUSTOMS', 'DELIVERING', 'COMPLETED'];
function stageRank(s: ProjectStage): number {
  return ORDER.indexOf(s);
}

export async function workflowView(tx: Tx, projectId: string) {
  const [w] = await tx.select().from(workflowInstances).where(eq(workflowInstances.projectId, projectId)).limit(1);
  const done = new Set((w?.history ?? []).filter((h) => h.status === 'DONE' || h.status === 'SKIPPED').map((h) => h.step));
  return {
    status: w?.status ?? 'NOT_STARTED',
    currentStep: w?.currentStep ?? null,
    waitingFor: w?.waitingFor ?? null,
    steps: ORDER_FULFILLMENT.map((s) => ({ key: s.key, label: s.label, human: s.human, state: done.has(s.key) ? 'DONE' : w?.currentStep === s.key ? 'CURRENT' : 'PENDING', at: w?.history.find((h) => h.step === s.key)?.at ?? null })),
  };
}
