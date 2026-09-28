import { and, desc, eq, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { mape } from '@sos/core';
import {
  aiUsage,
  apiConnections,
  auditLogs,
  complianceChecks,
  contracts,
  emails,
  freightRfqs,
  jobs,
  marketListings,
  modelPredictions,
  partnerTasks,
  payments,
  productionOrders,
  quotations,
  quotationVersions,
  requestCandidates,
  searchEvents,
  shipments,
  sourceListings,
  sourcingProjects,
  sourcingRequests,
  suppliers,
} from '../db/schema/index.js';
import { notFound } from '../lib/errors.js';
import { db, requireFeature, requirePerm, staffOf, tenantOf } from '../http/context.js';
import type { App } from '../http/types.js';
import { audit } from '../services/audit.js';
import { systemHealth } from './health.js';
import { usageFor } from '../services/usage.js';

const dateRange = z.object({ from: z.string().optional(), to: z.string().optional() });
const n = (v: unknown) => Number(v ?? 0);

export async function insightRoutes(app: App) {
  /**
   * Exception-first dashboard: the 5 problems before the 500 normal items.
   * Every counter is a real query; each attention item links to where it is resolved.
   */
  app.get('/admin/dashboard', async (req) => {
    staffOf(req);
    requirePerm(req, 'sourcing.read');
    return db(req, async (tx) => {
      const today = new Date().toISOString().slice(0, 10);
      const startOfDay = new Date(`${today}T00:00:00Z`);
      const tomorrow = new Date(startOfDay.getTime() + 86_400_000);
      const [newRequests] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(sourcingRequests)
        .where(gte(sourcingRequests.createdAt, startOfDay));
      const approvalWaitingQuotes = await tx
        .select({
          id: quotations.id,
          number: quotations.number,
          projectId: quotations.projectId,
          updatedAt: quotations.updatedAt,
        })
        .from(quotations)
        .where(eq(quotations.status, 'CUSTOMER_APPROVED'));
      const approvalWaitingContracts = await tx
        .select({ id: contracts.id, number: contracts.number, projectId: contracts.projectId })
        .from(contracts)
        .where(eq(contracts.status, 'CUSTOMER_APPROVED'));
      const customsReview = await tx
        .select({
          id: partnerTasks.id,
          title: partnerTasks.title,
          projectId: partnerTasks.projectId,
          createdAt: partnerTasks.createdAt,
        })
        .from(partnerTasks)
        .where(
          and(eq(partnerTasks.kind, 'HS_REVIEW'), inArray(partnerTasks.status, ['OPEN', 'IN_PROGRESS'])),
        );
      const certReview = await tx
        .select({ id: complianceChecks.id, productId: complianceChecks.productId })
        .from(complianceChecks)
        .where(
          and(
            inArray(complianceChecks.estimatedStatus, [
              'RULE_MATCHED',
              'AI_LIKELY',
              'EXPERT_REVIEW_REQUIRED',
            ]),
            isNull(complianceChecks.verifiedStatus),
          ),
        );
      const forwarderPending = await tx
        .select({
          id: freightRfqs.id,
          code: freightRfqs.code,
          projectId: freightRfqs.projectId,
          createdAt: freightRfqs.createdAt,
        })
        .from(freightRfqs)
        .where(eq(freightRfqs.status, 'OPEN'));
      const supplierPending = await tx
        .select({ id: partnerTasks.id, title: partnerTasks.title })
        .from(partnerTasks)
        .where(
          and(eq(partnerTasks.kind, 'SUPPLIER_RFQ'), inArray(partnerTasks.status, ['OPEN', 'IN_PROGRESS'])),
        );
      const productionDelay = await tx
        .select({
          id: productionOrders.id,
          projectId: productionOrders.projectId,
          plannedEnd: productionOrders.plannedEnd,
          status: productionOrders.status,
          delayReason: productionOrders.delayReason,
        })
        .from(productionOrders)
        .where(
          sql`${productionOrders.status} = 'DELAYED' or (${productionOrders.status} not in ('COMPLETED','NOT_STARTED') and ${productionOrders.plannedEnd} < ${today})`,
        );
      const shipmentDelay = await tx
        .select({
          id: shipments.id,
          code: shipments.code,
          projectId: shipments.projectId,
          eta: shipments.eta,
          status: shipments.status,
        })
        .from(shipments)
        .where(
          and(
            lt(shipments.eta, new Date()),
            isNull(shipments.ata),
            sql`${shipments.status} not in ('DELIVERED','CANCELLED')`,
          ),
        );
      const trackingErrors = await tx
        .select({
          id: shipments.id,
          code: shipments.code,
          projectId: shipments.projectId,
          trackingError: shipments.trackingError,
        })
        .from(shipments)
        .where(
          sql`${shipments.trackingError} is not null and ${shipments.status} not in ('DELIVERED','CANCELLED')`,
        );
      const paymentOverdue = await tx
        .select({
          id: payments.id,
          projectId: payments.projectId,
          amount: payments.amount,
          currency: payments.currency,
          dueDate: payments.dueDate,
        })
        .from(payments)
        .where(
          and(eq(payments.status, 'PENDING'), eq(payments.direction, 'INBOUND'), lt(payments.dueDate, today)),
        );
      const arrivalsToday = await tx
        .select({
          id: shipments.id,
          code: shipments.code,
          projectId: shipments.projectId,
          eta: shipments.eta,
        })
        .from(shipments)
        .where(and(gte(shipments.eta, startOfDay), lt(shipments.eta, tomorrow)));
      const deadJobs = await tx
        .select({ id: jobs.id, type: jobs.type, lastError: jobs.lastError })
        .from(jobs)
        .where(eq(jobs.status, 'DEAD_LETTER'))
        .limit(20);
      const connErrors = await tx
        .select({
          id: apiConnections.id,
          provider: apiConnections.provider,
          label: apiConnections.label,
          lastError: apiConnections.lastError,
        })
        .from(apiConnections)
        .where(and(eq(apiConnections.enabled, true), eq(apiConnections.status, 'ERROR')));
      const failedEmails = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(emails)
        .where(
          and(
            inArray(emails.status, ['FAILED']),
            gte(emails.createdAt, new Date(Date.now() - 7 * 86_400_000)),
          ),
        );
      const notConfiguredEmails = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(emails)
        .where(
          and(
            eq(emails.status, 'NOT_CONFIGURED'),
            gte(emails.createdAt, new Date(Date.now() - 7 * 86_400_000)),
          ),
        );
      const expiringQuotes = await tx
        .select({
          id: quotations.id,
          number: quotations.number,
          projectId: quotations.projectId,
          validUntil: quotationVersions.validUntil,
        })
        .from(quotations)
        .innerJoin(quotationVersions, eq(quotationVersions.id, quotations.currentVersionId))
        .where(
          and(
            eq(quotations.status, 'SENT'),
            lte(
              quotationVersions.validUntil,
              new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
            ),
          ),
        );
      const flagged = await tx
        .select({
          id: sourcingProjects.id,
          code: sourcingProjects.code,
          title: sourcingProjects.title,
          attention: sourcingProjects.attention,
        })
        .from(sourcingProjects)
        .where(
          sql`jsonb_array_length(${sourcingProjects.attention}) > 0 and ${sourcingProjects.status} <> 'CLOSED'`,
        );
      const stalledRequests = await tx
        .select({
          id: sourcingRequests.id,
          projectId: sourcingRequests.projectId,
          createdAt: sourcingRequests.createdAt,
        })
        .from(sourcingRequests)
        .where(
          and(
            inArray(sourcingRequests.status, ['RECEIVED', 'ANALYZING']),
            lt(sourcingRequests.updatedAt, new Date(Date.now() - 30 * 60_000)),
          ),
        );

      type Item = {
        severity: 'CRITICAL' | 'WARNING' | 'INFO';
        kind: string;
        title: string;
        detail: string;
        link: string;
        at?: string | Date | null;
      };
      const attention: Item[] = [];
      for (const p of paymentOverdue)
        attention.push({
          severity: 'CRITICAL',
          kind: 'PAYMENT_OVERDUE',
          title: '입금 기한 경과',
          detail: `${p.amount} ${p.currency} · 기한 ${p.dueDate}`,
          link: `/admin/projects/${p.projectId}`,
          at: p.dueDate,
        });
      for (const s of shipmentDelay)
        attention.push({
          severity: 'WARNING',
          kind: 'SHIPMENT_DELAY',
          title: `${s.code} 도착 예정일 경과`,
          detail: `ETA ${s.eta?.toISOString().slice(0, 10)} · ${s.status}`,
          link: `/admin/shipments/${s.id}`,
          at: s.eta,
        });
      for (const p of productionDelay)
        attention.push({
          severity: 'WARNING',
          kind: 'PRODUCTION_DELAY',
          title: '생산 지연',
          detail: p.delayReason || `예정 완료일 ${p.plannedEnd}`,
          link: `/admin/projects/${p.projectId}`,
          at: p.plannedEnd,
        });
      for (const q of approvalWaitingQuotes)
        attention.push({
          severity: 'WARNING',
          kind: 'APPROVAL_WAITING',
          title: `${q.number} 고객 승인 완료 — 최종 승인 필요`,
          detail: '고객이 견적을 승인했습니다.',
          link: `/admin/quotes/${q.id}`,
          at: q.updatedAt,
        });
      for (const c of approvalWaitingContracts)
        attention.push({
          severity: 'WARNING',
          kind: 'CONTRACT_APPROVAL',
          title: `${c.number} 계약 회사 승인 필요`,
          detail: '고객이 계약서를 승인했습니다.',
          link: `/admin/contracts/${c.id}`,
        });
      for (const q of expiringQuotes)
        attention.push({
          severity: 'INFO',
          kind: 'QUOTE_EXPIRING',
          title: `${q.number} 유효기한 임박`,
          detail: `유효기한 ${q.validUntil}`,
          link: `/admin/quotes/${q.id}`,
        });
      for (const s of trackingErrors)
        attention.push({
          severity: 'INFO',
          kind: 'TRACKING_ERROR',
          title: `${s.code} 추적 정보 없음`,
          detail: s.trackingError ?? '',
          link: `/admin/shipments/${s.id}`,
        });
      for (const c of connErrors)
        attention.push({
          severity: 'WARNING',
          kind: 'CONNECTOR_ERROR',
          title: `${c.label || c.provider} 연결 오류`,
          detail: c.lastError ?? '',
          link: '/admin/settings/connections',
        });
      for (const j of deadJobs)
        attention.push({
          severity: 'WARNING',
          kind: 'JOB_FAILED',
          title: `작업 실패: ${j.type}`,
          detail: (j.lastError ?? '').slice(0, 140),
          link: '/admin/system',
        });
      for (const p of flagged)
        for (const a of p.attention)
          attention.push({
            severity: 'WARNING',
            kind: a.kind,
            title: `[${p.code}] ${a.message}`,
            detail: p.title,
            link: `/admin/projects/${p.id}`,
            at: a.since,
          });
      for (const r of stalledRequests)
        attention.push({
          severity: 'INFO',
          kind: 'ANALYSIS_STALLED',
          title: '분석이 30분 이상 진행 중',
          detail: '작업 큐 또는 외부 API 상태를 확인하세요.',
          link: r.projectId ? `/admin/projects/${r.projectId}` : '/admin/system',
          at: r.createdAt,
        });
      if (n(failedEmails[0]?.n) > 0)
        attention.push({
          severity: 'WARNING',
          kind: 'EMAIL_FAILED',
          title: `메일 발송 실패 ${failedEmails[0]!.n}건 (7일)`,
          detail: 'SMTP 설정을 확인하세요.',
          link: '/admin/system',
        });
      if (n(notConfiguredEmails[0]?.n) > 0)
        attention.push({
          severity: 'INFO',
          kind: 'EMAIL_NOT_CONFIGURED',
          title: `발송되지 않은 알림 메일 ${notConfiguredEmails[0]!.n}건`,
          detail: '메일 발송 서버(SMTP)가 설정되지 않았습니다.',
          link: '/admin/settings/connections',
        });
      const order = { CRITICAL: 0, WARNING: 1, INFO: 2 };
      attention.sort((a, b) => order[a.severity] - order[b.severity]);

      const stageCounts = await tx
        .select({ stage: sourcingProjects.stage, n: sql<number>`count(*)::int` })
        .from(sourcingProjects)
        .where(sql`${sourcingProjects.status} <> 'CLOSED'`)
        .groupBy(sourcingProjects.stage);
      return {
        today: { newRequests: n(newRequests?.n), arrivals: arrivalsToday.length },
        counters: {
          approvalWaiting: approvalWaitingQuotes.length + approvalWaitingContracts.length,
          customsReview: customsReview.length,
          certificationReview: certReview.length,
          forwarderPending: forwarderPending.length,
          supplierPending: supplierPending.length,
          productionDelay: productionDelay.length,
          shipmentDelay: shipmentDelay.length,
          paymentOverdue: paymentOverdue.length,
          arrivalsToday: arrivalsToday.length,
        },
        attention: attention.slice(0, 60),
        pipeline: stageCounts,
      };
    });
  });

  // ─────────────── Business analytics ───────────────
  app.get('/analytics/summary', { schema: { querystring: dateRange } }, async (req) => {
    requireFeature(req, 'ANALYTICS');
    requirePerm(req, 'analytics.read');
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 90 * 86_400_000);
    const to = req.query.to ? new Date(req.query.to) : new Date();
    return db(req, async (tx) => {
      const [reqs] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(sourcingRequests)
        .where(and(gte(sourcingRequests.createdAt, from), lte(sourcingRequests.createdAt, to)));
      const quotes = await tx
        .select({
          status: quotations.status,
          total: quotationVersions.total,
          internal: quotationVersions.internalSummary,
          sentAt: quotationVersions.sentAt,
        })
        .from(quotations)
        .innerJoin(quotationVersions, eq(quotationVersions.id, quotations.currentVersionId))
        .where(and(gte(quotations.createdAt, from), lte(quotations.createdAt, to)));
      const issued = quotes.filter((q) => q.sentAt);
      const won = quotes.filter((q) =>
        ['CUSTOMER_APPROVED', 'ADMIN_FINAL_APPROVED', 'LOCKED'].includes(q.status),
      );
      const revenue = won.reduce((a, q) => a + n(q.total), 0);
      const profit = won.reduce(
        (a, q) => a + n((q.internal as { expectedProfit?: string } | null)?.expectedProfit),
        0,
      );
      const exVat = won.reduce(
        (a, q) => a + n((q.internal as { customerTotalExVat?: string } | null)?.customerTotalExVat),
        0,
      );
      const completed = await tx
        .select({
          createdAt: sourcingProjects.createdAt,
          history: sourcingProjects.stageHistory,
          companyId: sourcingProjects.companyId,
        })
        .from(sourcingProjects)
        .where(eq(sourcingProjects.stage, 'COMPLETED'));
      const leadDays = completed
        .map((p) => {
          const done = p.history.find((h) => h.stage === 'COMPLETED')?.at;
          return done ? (new Date(done).getTime() - p.createdAt.getTime()) / 86_400_000 : null;
        })
        .filter((x): x is number => x !== null);
      const companiesProjects = await tx
        .select({ companyId: sourcingProjects.companyId, n: sql<number>`count(*)::int` })
        .from(sourcingProjects)
        .where(sql`${sourcingProjects.companyId} is not null`)
        .groupBy(sourcingProjects.companyId);
      const categoryRows = await tx.execute<{ category: string; requests: number }>(
        sql`select p.category, count(*)::int as requests from products p where p.created_at between ${from} and ${to} group by p.category order by requests desc limit 12`,
      );
      const supplierPerf = await tx
        .select({
          id: suppliers.id,
          name: suppliers.name,
          alias: suppliers.alias,
          metrics: suppliers.metrics,
        })
        .from(suppliers)
        .where(sql`(${suppliers.metrics}->>'orderCount')::int > 0`)
        .limit(20);
      return {
        range: { from, to },
        sourcingRequests: n(reqs?.n),
        quotesIssued: issued.length,
        quotesWon: won.length,
        conversionPct: issued.length ? Math.round((won.length / issued.length) * 1000) / 10 : null,
        revenue: Math.round(revenue),
        averageOrderValue: won.length ? Math.round(revenue / won.length) : null,
        grossProfit: Math.round(profit),
        marginPct: exVat ? Math.round((profit / exVat) * 1000) / 10 : null,
        averageLeadTimeDays: leadDays.length
          ? Math.round((leadDays.reduce((a, b) => a + b, 0) / leadDays.length) * 10) / 10
          : null,
        customerRetentionPct: companiesProjects.length
          ? Math.round((companiesProjects.filter((c) => c.n > 1).length / companiesProjects.length) * 1000) /
            10
          : null,
        categories: categoryRows.rows,
        supplierPerformance: supplierPerf,
      };
    });
  });

  /** Model accuracy: HS top-1/top-3, freight/landed MAPE, compliance correction rate, recommendation conversion. */
  app.get('/analytics/accuracy', async (req) => {
    requirePerm(req, 'analytics.read');
    return db(req, async (tx) => {
      const preds = await tx
        .select()
        .from(modelPredictions)
        .orderBy(desc(modelPredictions.createdAt))
        .limit(5000);
      const hs = preds.filter((p) => p.kind === 'HS' && (p.humanValue || p.actualValue));
      const truth = (p: (typeof preds)[number]) =>
        ((p.actualValue ?? p.humanValue) as { code?: string } | null)?.code?.replace(/\D/g, '').slice(0, 6);
      const hsTop1 = hs.filter(
        (p) => (p.predicted as { code?: string }).code?.slice(0, 6) === truth(p),
      ).length;
      const hsTop3 = hs.filter((p) =>
        ((p.predicted as { top3?: string[] }).top3 ?? []).some((c) => c.slice(0, 6) === truth(p)),
      ).length;
      const fr = preds.filter((p) => p.kind === 'FREIGHT' && p.actualValue);
      const lc = preds.filter((p) => p.kind === 'LANDED_COST' && p.actualValue);
      const comp = preds.filter((p) => p.kind === 'COMPLIANCE' && p.humanValue);
      const compChanged = comp.filter(
        (p) => (p.predicted as { status?: string }).status !== (p.humanValue as { status?: string }).status,
      ).length;
      const selected = await tx
        .select({
          tags: requestCandidates.tags,
          imageSimilarity: requestCandidates.imageSimilarity,
          requestId: requestCandidates.requestId,
          listingId: requestCandidates.listingId,
        })
        .from(requestCandidates)
        .where(eq(requestCandidates.selected, true));
      const recoConv = selected.length
        ? selected.filter((s) => s.tags.includes('BEST_MATCH')).length / selected.length
        : null;
      let imageTop1 = 0;
      let imageTop5 = 0;
      for (const s of selected) {
        const siblings = await tx
          .select({ listingId: requestCandidates.listingId, sim: requestCandidates.imageSimilarity })
          .from(requestCandidates)
          .where(eq(requestCandidates.requestId, s.requestId));
        const ranked = siblings
          .filter((x) => x.sim !== null)
          .sort((a, b) => (b.sim ?? 0) - (a.sim ?? 0))
          .map((x) => x.listingId);
        const idx = ranked.indexOf(s.listingId);
        if (idx === 0) imageTop1++;
        if (idx >= 0 && idx < 5) imageTop5++;
      }
      return {
        hs: {
          samples: hs.length,
          top1Pct: hs.length ? Math.round((hsTop1 / hs.length) * 1000) / 10 : null,
          top3Pct: hs.length ? Math.round((hsTop3 / hs.length) * 1000) / 10 : null,
        },
        freight: {
          samples: fr.length,
          mapePct: mape(
            fr.map((p) => ({
              predicted: String((p.predicted as { totalBase?: string }).totalBase ?? 0),
              actual: String((p.actualValue as { totalBase?: string }).totalBase ?? 0),
            })),
          ),
        },
        landedCost: {
          samples: lc.length,
          mapePct: mape(
            lc.map((p) => ({
              predicted: String((p.predicted as { total?: string }).total ?? 0),
              actual: String((p.actualValue as { total?: string }).total ?? 0),
            })),
          ),
        },
        compliance: {
          samples: comp.length,
          correctionRatePct: comp.length ? Math.round((compChanged / comp.length) * 1000) / 10 : null,
        },
        image: {
          samples: selected.length,
          top1Pct: selected.length ? Math.round((imageTop1 / selected.length) * 1000) / 10 : null,
          top5Pct: selected.length ? Math.round((imageTop5 / selected.length) * 1000) / 10 : null,
        },
        recommendationConversionPct: recoConv === null ? null : Math.round(recoConv * 1000) / 10,
        note: '표본이 적으면 수치가 불안정합니다. 실제 확정값이 쌓일수록 정확해집니다.',
      };
    });
  });

  /** Learning feedback: AI prediction vs human correction vs actual. Only approved rows may be used for training. */
  app.get(
    '/analytics/feedback',
    {
      schema: {
        querystring: z.object({ kind: z.string().optional(), corrected: z.coerce.boolean().optional() }),
      },
    },
    async (req) => {
      requirePerm(req, 'analytics.read');
      return db(req, async (tx) => ({
        items: await tx
          .select()
          .from(modelPredictions)
          .where(
            and(
              req.query.kind ? eq(modelPredictions.kind, req.query.kind) : undefined,
              req.query.corrected ? sql`${modelPredictions.humanValue} is not null` : undefined,
            ),
          )
          .orderBy(desc(modelPredictions.createdAt))
          .limit(300),
      }));
    },
  );

  app.post(
    '/analytics/feedback/:id/approve',
    { schema: { params: z.object({ id: z.string().uuid() }), body: z.object({ approved: z.boolean() }) } },
    async (req) => {
      const user = requirePerm(req, 'tenant.settings.write');
      return db(req, async (tx) => {
        await tx
          .update(modelPredictions)
          .set({ approvedForTraining: req.body.approved, approvedBy: user.id })
          .where(eq(modelPredictions.id, req.params.id));
        await audit(tx, req, {
          action: 'training_dataset.approval',
          entityType: 'model_prediction',
          entityId: req.params.id,
          after: req.body,
        });
        return { ok: true };
      });
    },
  );

  /** Demand intelligence (de-identified): what buyers search, how many distinct buyers, average target. */
  app.get(
    '/analytics/demand',
    { schema: { querystring: z.object({ days: z.coerce.number().int().min(1).max(365).default(90) }) } },
    async (req) => {
      requirePerm(req, 'analytics.read');
      return db(req, async (tx) => {
        const since = new Date(Date.now() - req.query.days * 86_400_000);
        const rows = await tx
          .select({
            query: searchEvents.clusterKey,
            category: sql<string>`mode() within group (order by ${searchEvents.category})`,
            searches: sql<number>`count(*)::int`,
            buyers: sql<number>`count(distinct ${searchEvents.buyerKey})::int`,
            avgQuantity: sql<number>`avg(${searchEvents.quantity})::int`,
            avgTargetKrw: sql<number>`avg(${searchEvents.targetPriceKrw})::int`,
          })
          .from(searchEvents)
          .where(and(gte(searchEvents.createdAt, since), sql`${searchEvents.clusterKey} <> ''`))
          .groupBy(searchEvents.clusterKey)
          .orderBy(desc(sql`count(*)`))
          .limit(100);
        return {
          days: req.query.days,
          items: rows,
          jointSourcingCandidates: rows
            .filter((r) => r.buyers >= 2)
            .map((r) => ({ ...r, combinedQuantity: r.avgQuantity ? r.avgQuantity * r.buyers : null })),
        };
      });
    },
  );

  /**
   * "오늘의 소싱 기회": computed only from real collected data (market listings + supplier listings).
   * Each opportunity lists its evidence; nothing is AI-generated.
   */
  app.get('/analytics/discovery', async (req) => {
    requireFeature(req, 'PRODUCT_DISCOVERY');
    requirePerm(req, 'analytics.read');
    return db(req, async (tx) => {
      const rows = await tx.execute<{
        request_id: string;
        market_median: number;
        market_count: number;
        title: string;
      }>(sql`
        select request_id, percentile_cont(0.5) within group (order by coalesce(discount_price, selling_price)::numeric) as market_median, count(*)::int as market_count, max(query) as title
        from market_listings where request_id is not null and is_dev_mock = false and collected_at > now() - interval '60 days'
        group by request_id having count(*) >= 5`);
      const out = [];
      for (const r of rows.rows) {
        const cands = await tx
          .select({ unit: requestCandidates.unitPriceBase, listingId: requestCandidates.listingId })
          .from(requestCandidates)
          .where(
            and(
              eq(requestCandidates.requestId, r.request_id),
              sql`${requestCandidates.unitPriceBase} is not null`,
            ),
          );
        const listingIds = cands.map((c) => c.listingId);
        const listingRows = listingIds.length
          ? await tx
              .select({ id: sourceListings.id, moq: sourceListings.moq, isDevMock: sourceListings.isDevMock })
              .from(sourceListings)
              .where(inArray(sourceListings.id, listingIds))
          : [];
        const byId = new Map(listingRows.map((l) => [l.id, l]));
        const real = cands.filter((c) => byId.get(c.listingId)?.isDevMock === false);
        const moqs = real.map((c) => byId.get(c.listingId)!);
        if (!real.length) continue;
        const minCost = Math.min(...real.map((c) => Number(c.unit)));
        const gapPct = ((Number(r.market_median) - minCost) / Number(r.market_median)) * 100;
        out.push({
          requestId: r.request_id,
          title: r.title,
          marketMedianKrw: Math.round(Number(r.market_median)),
          marketListings: r.market_count,
          lowestLandedEstimateKrw: Math.round(minCost),
          priceGapPct: Math.round(gapPct),
          lowMoq: moqs.some((m) => (m.moq ?? 999999) <= 100),
          evidence: '국내 시장가격(수집 데이터) vs 공급 후보 예상 도착원가(추정)',
        });
      }
      return {
        items: out.sort((a, b) => b.priceGapPct - a.priceGapPct).slice(0, 30),
        note: '가격 차이는 수집된 시장가격과 추정 도착원가의 비교입니다. 인증·마케팅 비용은 포함되지 않았습니다.',
      };
    });
  });

  // ─────────────── Operations ───────────────
  app.get(
    '/admin/audit',
    {
      schema: {
        querystring: z.object({
          entityType: z.string().optional(),
          entityId: z.string().optional(),
          action: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(500).default(200),
        }),
      },
    },
    async (req) => {
      requirePerm(req, 'tenant.audit.read');
      return db(req, async (tx) => ({
        items: await tx
          .select()
          .from(auditLogs)
          .where(
            and(
              req.query.entityType ? eq(auditLogs.entityType, req.query.entityType) : undefined,
              req.query.entityId ? eq(auditLogs.entityId, req.query.entityId) : undefined,
              req.query.action ? sql`${auditLogs.action} ilike ${req.query.action + '%'}` : undefined,
            ),
          )
          .orderBy(desc(auditLogs.createdAt))
          .limit(req.query.limit),
      }));
    },
  );

  app.get(
    '/admin/jobs',
    { schema: { querystring: z.object({ status: z.string().optional() }) } },
    async (req) => {
      requirePerm(req, 'tenant.jobs.manage');
      return db(req, async (tx) => {
        const counts = await tx
          .select({ status: jobs.status, n: sql<number>`count(*)::int` })
          .from(jobs)
          .groupBy(jobs.status);
        const items = await tx
          .select()
          .from(jobs)
          .where(req.query.status ? eq(jobs.status, req.query.status) : undefined)
          .orderBy(desc(jobs.updatedAt))
          .limit(200);
        return { counts, items };
      });
    },
  );

  app.post(
    '/admin/jobs/:id/retry',
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      requirePerm(req, 'tenant.jobs.manage');
      return db(req, async (tx) => {
        const [j] = await tx.select().from(jobs).where(eq(jobs.id, req.params.id)).limit(1);
        if (!j) throw notFound();
        await tx
          .update(jobs)
          .set({
            status: 'PENDING',
            attempts: 0,
            runAt: new Date(),
            lastError: null,
            finishedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(jobs.id, j.id));
        await audit(tx, req, {
          action: 'job.retried',
          entityType: 'job',
          entityId: j.id,
          before: { status: j.status, lastError: j.lastError },
        });
        return { ok: true };
      });
    },
  );

  app.get('/admin/system-status', async (req) => {
    requirePerm(req, 'tenant.settings.read');
    const tenant = tenantOf(req);
    const health = await systemHealth();
    return db(req, async (tx) => {
      const conns = await tx
        .select({
          id: apiConnections.id,
          provider: apiConnections.provider,
          label: apiConnections.label,
          category: apiConnections.category,
          enabled: apiConnections.enabled,
          status: apiConnections.status,
          lastTestAt: apiConnections.lastTestAt,
          lastSuccessAt: apiConnections.lastSuccessAt,
          lastError: apiConnections.lastError,
          circuitOpenUntil: apiConnections.circuitOpenUntil,
        })
        .from(apiConnections);
      const ai = await tx
        .select({
          provider: aiUsage.provider,
          task: aiUsage.task,
          calls: sql<number>`count(*)::int`,
          failures: sql<number>`count(*) filter (where not ${aiUsage.success})::int`,
          inputTokens: sql<number>`sum(${aiUsage.inputTokens})::int`,
          outputTokens: sql<number>`sum(${aiUsage.outputTokens})::int`,
          avgLatencyMs: sql<number>`avg(${aiUsage.latencyMs})::int`,
        })
        .from(aiUsage)
        .where(gte(aiUsage.createdAt, new Date(Date.now() - 30 * 86_400_000)))
        .groupBy(aiUsage.provider, aiUsage.task);
      const mail = await tx
        .select({ status: emails.status, n: sql<number>`count(*)::int` })
        .from(emails)
        .where(gte(emails.createdAt, new Date(Date.now() - 30 * 86_400_000)))
        .groupBy(emails.status);
      return { health, connections: conns, ai, email: mail, usage: await usageFor(tenant.id) };
    });
  });

  app.get('/admin/emails', async (req) => {
    requirePerm(req, 'email.manage');
    return db(req, async (tx) => ({
      items: await tx
        .select({
          id: emails.id,
          trigger: emails.trigger,
          toAddress: emails.toAddress,
          subject: emails.subject,
          status: emails.status,
          error: emails.error,
          projectId: emails.projectId,
          createdAt: emails.createdAt,
          sentAt: emails.sentAt,
          attachments: emails.attachments,
        })
        .from(emails)
        .orderBy(desc(emails.createdAt))
        .limit(300),
    }));
  });

  app.get(
    '/market/listings',
    { schema: { querystring: z.object({ requestId: z.string().uuid() }) } },
    async (req) => {
      requirePerm(req, 'market.read');
      return db(req, async (tx) => ({
        items: await tx
          .select()
          .from(marketListings)
          .where(eq(marketListings.requestId, req.query.requestId))
          .orderBy(marketListings.rank)
          .limit(300),
      }));
    },
  );
}
