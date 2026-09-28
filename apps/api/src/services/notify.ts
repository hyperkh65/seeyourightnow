import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import { createHmac } from 'node:crypto';
import { CUSTOMER_ROLES, STAFF_ROLES, type EmailTrigger, type WebhookEvent } from '@sos/core';
import { config } from '../config.js';
import { withTenant, type Tx } from '../db/client.js';
import {
  emails,
  emailTemplates,
  notificationPreferences,
  notifications,
  sourcingProjects,
  userRoles,
  users,
  webhookDeliveries,
  webhooks,
} from '../db/schema/index.js';
import { safeFetch } from '../lib/http.js';
import { connectionsWithCapability } from './connections/index.js';
import { solapiAuthorization } from './connections/registry.js';
import { enqueue, registerJob } from './jobs.js';
import { readSecret } from './secrets.js';
import { getPublished } from './settings.js';
import { render } from './templates/render.js';

// ───────────────────────────── Email ─────────────────────────────

export async function brandContext(tx: Tx, tenantId: string) {
  const [brand, company] = await Promise.all([
    getPublished(tx, tenantId, 'brand'),
    getPublished(tx, tenantId, 'company'),
  ]);
  return { brand, company };
}

/** Queues a templated email (idempotent via dedupeKey). Sending happens in the `email.send` job. */
export async function queueTemplatedEmail(
  tx: Tx,
  tenantId: string,
  trigger: EmailTrigger,
  to: string,
  vars: Record<string, unknown>,
  opts: {
    projectId?: string | null;
    dedupeKey?: string;
    attachments?: Array<{ fileId: string; name: string }>;
  } = {},
): Promise<string | null> {
  if (!to) return null;
  const settings = await getPublished(tx, tenantId, 'notifications');
  const [tpl] = await tx
    .select()
    .from(emailTemplates)
    .where(
      and(
        eq(emailTemplates.tenantId, tenantId),
        eq(emailTemplates.trigger, trigger),
        eq(emailTemplates.status, 'PUBLISHED'),
      ),
    )
    .orderBy(desc(emailTemplates.version))
    .limit(1);
  if (!tpl || !tpl.enabled) return null;
  const ctx = { ...(await brandContext(tx, tenantId)), ...vars };
  const fromAddress = settings.senderEmail || config.EMAIL_FROM_DEFAULT;
  const fromName = settings.senderName || (ctx.brand as { siteName: string }).siteName;
  const [row] = await tx
    .insert(emails)
    .values({
      tenantId,
      trigger,
      projectId: opts.projectId ?? null,
      toAddress: to,
      fromAddress: `${fromName} <${fromAddress}>`,
      subject: render(tpl.subject, ctx),
      bodyHtml: render(tpl.bodyHtml, ctx),
      attachments: opts.attachments ?? [],
      status: settings.emailEnabled ? 'QUEUED' : 'SUPPRESSED',
      dedupeKey: opts.dedupeKey ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: emails.id });
  if (row && settings.emailEnabled)
    await enqueue(tx, tenantId, 'email.send', { emailId: row.id }, { maxAttempts: 6 });
  return row?.id ?? null;
}

async function transportFor(tx: Tx, tenantId: string) {
  const conns = await connectionsWithCapability(tx, tenantId, 'EMAIL');
  const smtp = conns.find((c) => c.provider === 'SMTP');
  if (smtp) {
    return {
      transport: nodemailer.createTransport({
        host: String(smtp.config.host),
        port: Number(smtp.config.port ?? 587),
        secure: !!smtp.config.secure,
        auth: smtp.config.user
          ? { user: String(smtp.config.user), pass: smtp.secrets.password ?? '' }
          : undefined,
      }),
      from: smtp.config.fromEmail
        ? `${String(smtp.config.fromName ?? '')} <${String(smtp.config.fromEmail)}>`
        : null,
    };
  }
  if (config.SMTP_HOST) {
    return {
      transport: nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: config.SMTP_SECURE,
        auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD ?? '' } : undefined,
      }),
      from: null,
    };
  }
  return null;
}

registerJob('email.send', async (payload, { tx, tenantId }) => {
  const [e] = await tx
    .select()
    .from(emails)
    .where(eq(emails.id, String(payload.emailId)))
    .limit(1);
  if (!e || e.status === 'SENT' || e.status === 'DELIVERED') return { skipped: true };
  const t = await transportFor(tx, tenantId);
  if (!t) {
    await tx
      .update(emails)
      .set({ status: 'NOT_CONFIGURED', error: '메일 발송 서버(SMTP)가 설정되지 않았습니다.' })
      .where(eq(emails.id, e.id));
    return { status: 'NOT_CONFIGURED' };
  }
  const attachments = [];
  if (e.attachments.length) {
    const { fileBuffer } = await import('./files.js');
    for (const a of e.attachments) {
      const f = await fileBuffer(tx, a.fileId);
      attachments.push({ filename: a.name, content: f.buffer, contentType: f.mime });
    }
  }
  try {
    const info = await t.transport.sendMail({
      from: t.from ?? e.fromAddress,
      to: e.toAddress,
      subject: e.subject,
      html: e.bodyHtml,
      attachments,
    });
    await tx
      .update(emails)
      .set({ status: 'SENT', sentAt: new Date(), providerMessageId: info.messageId ?? null, error: null })
      .where(eq(emails.id, e.id));
    return { messageId: info.messageId };
  } catch (err) {
    await tx
      .update(emails)
      .set({ status: 'FAILED', error: err instanceof Error ? err.message : String(err) })
      .where(eq(emails.id, e.id));
    throw err;
  }
});

// ───────────────────────────── In-app / SMS / Kakao / Slack ─────────────────────────────

export interface NotifyInput {
  kind: string;
  title: string;
  body?: string;
  link?: string;
  projectId?: string | null;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  dedupeKey?: string;
}

export async function notifyUsers(
  tx: Tx,
  tenantId: string,
  userIds: string[],
  n: NotifyInput,
): Promise<void> {
  const unique = [...new Set(userIds)];
  if (!unique.length) return;
  const prefs = await tx
    .select()
    .from(notificationPreferences)
    .where(
      and(eq(notificationPreferences.tenantId, tenantId), inArray(notificationPreferences.userId, unique)),
    );
  for (const uid of unique) {
    const p =
      prefs.find((x) => x.userId === uid && x.kind === n.kind) ??
      prefs.find((x) => x.userId === uid && x.kind === '*');
    const channels = p?.channels ?? ['WEB', 'EMAIL'];
    if (!channels.includes('WEB')) continue;
    await tx
      .insert(notifications)
      .values({
        tenantId,
        userId: uid,
        kind: n.kind,
        title: n.title,
        body: n.body ?? '',
        link: n.link ?? '',
        projectId: n.projectId ?? null,
        severity: n.severity ?? 'INFO',
        channels,
        dedupeKey: n.dedupeKey ?? null,
      })
      .onConflictDoNothing();
  }
}

export async function staffUserIds(tx: Tx, tenantId: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(
      and(
        eq(userRoles.tenantId, tenantId),
        inArray(
          userRoles.role,
          [...STAFF_ROLES].filter((r) => r !== 'READ_ONLY'),
        ),
        eq(users.status, 'ACTIVE'),
      ),
    );
  return [...new Set(rows.map((r) => r.userId))];
}

/** Customer users attached to the project's company (or the project's requesting user). */
export async function projectCustomerUsers(tx: Tx, tenantId: string, projectId: string) {
  const [p] = await tx.select().from(sourcingProjects).where(eq(sourcingProjects.id, projectId)).limit(1);
  if (!p)
    return { project: null, users: [] as Array<{ id: string; email: string; name: string; phone: string }> };
  const conds = [eq(users.tenantId, tenantId), eq(users.status, 'ACTIVE'), isNull(users.anonymizedAt)];
  const rows = await tx
    .select({ id: users.id, email: users.email, name: users.name, phone: users.phone })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(
      and(
        ...conds,
        inArray(userRoles.role, [...CUSTOMER_ROLES]),
        p.companyId
          ? eq(users.companyId, p.companyId)
          : eq(users.id, p.customerUserId ?? '00000000-0000-0000-0000-000000000000'),
      ),
    );
  const dedup = new Map(rows.map((r) => [r.id, r]));
  return { project: p, users: [...dedup.values()] };
}

async function slackAlert(tx: Tx, tenantId: string, text: string): Promise<void> {
  const conns = await connectionsWithCapability(tx, tenantId, 'SLACK');
  for (const c of conns) {
    if (c.secrets.webhookUrl)
      await enqueue(tx, tenantId, 'slack.send', { connectionId: c.id, text }, { maxAttempts: 3 });
  }
}

registerJob(
  'slack.send',
  async (payload, { tenantId }) => {
    const conns = await withTenant({ tenantId }, (tx) => connectionsWithCapability(tx, tenantId, 'SLACK'));
    const c = conns.find((x) => x.id === payload.connectionId);
    if (!c?.secrets.webhookUrl) return { skipped: 'not configured' };
    const res = await safeFetch(c.secrets.webhookUrl, {
      method: 'POST',
      trusted: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: payload.text }),
    });
    if (!res.ok) throw new Error(`Slack HTTP ${res.status}`);
    return { ok: true };
  },
  { transactional: false },
);

registerJob(
  'sms.send',
  async (payload, { tenantId }) => {
    const conns = await withTenant({ tenantId }, (tx) => connectionsWithCapability(tx, tenantId, 'SMS'));
    const c = conns.find((x) => x.provider === 'SOLAPI');
    if (!c) return { skipped: 'SMS not configured' };
    const kakao = payload.channel === 'KAKAO' && c.config.kakaoPfId && payload.templateId;
    const message: Record<string, unknown> = {
      to: String(payload.to).replace(/\D/g, ''),
      from: String(c.config.sender ?? ''),
      text: String(payload.text),
    };
    if (kakao)
      message.kakaoOptions = {
        pfId: c.config.kakaoPfId,
        templateId: payload.templateId,
        variables: payload.variables ?? {},
      };
    const res = await safeFetch('https://api.solapi.com/messages/v4/send', {
      method: 'POST',
      trusted: true,
      headers: {
        'Content-Type': 'application/json',
        Authorization: solapiAuthorization(c.secrets.apiKey ?? '', c.secrets.apiSecret ?? ''),
      },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) throw new Error(`SOLAPI HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return { ok: true };
  },
  { transactional: false },
);

// ───────────────────────────── Webhooks ─────────────────────────────

export async function dispatchWebhook(
  tx: Tx,
  tenantId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<void> {
  const hooks = await tx
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.tenantId, tenantId), eq(webhooks.enabled, true)));
  for (const h of hooks) {
    if (!h.events.includes(event) && !h.events.includes('*')) continue;
    const payload = { id: crypto.randomUUID(), event, createdAt: new Date().toISOString(), data };
    const [d] = await tx
      .insert(webhookDeliveries)
      .values({ tenantId, webhookId: h.id, event, payload })
      .returning({ id: webhookDeliveries.id });
    await enqueue(tx, tenantId, 'webhook.deliver', { deliveryId: d!.id }, { maxAttempts: 8 });
  }
}

export function webhookSignature(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

registerJob(
  'webhook.deliver',
  async (payload, { tenantId, attempt }) => {
    const { d, hook, secret } = await withTenant({ tenantId }, async (tx) => {
      const [d] = await tx
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.id, String(payload.deliveryId)))
        .limit(1);
      const [hook] = d ? await tx.select().from(webhooks).where(eq(webhooks.id, d.webhookId)).limit(1) : [];
      const secret = hook ? await readSecret(tx, hook.secretRef) : null;
      return { d, hook, secret };
    });
    if (!d || !hook || !hook.enabled || d.status === 'SUCCESS') return { skipped: true };
    const body = JSON.stringify(d.payload);
    const ts = Math.floor(Date.now() / 1000);
    let status = 0;
    let text = '';
    try {
      const res = await safeFetch(hook.url, {
        method: 'POST',
        timeoutMs: 10_000,
        headers: {
          'Content-Type': 'application/json',
          'X-SOS-Event': d.event,
          'X-SOS-Delivery': d.id,
          'X-SOS-Signature': `t=${ts},v1=${webhookSignature(secret ?? '', ts, body)}`,
        },
        body,
      });
      status = res.status;
      text = (await res.text()).slice(0, 1000);
    } catch (e) {
      text = e instanceof Error ? e.message : String(e);
    }
    const ok = status >= 200 && status < 300;
    await withTenant({ tenantId }, async (tx) => {
      await tx
        .update(webhookDeliveries)
        .set({
          status: ok ? 'SUCCESS' : 'FAILED',
          attempts: attempt,
          responseStatus: status || null,
          responseBody: text,
          lastAttemptAt: new Date(),
        })
        .where(eq(webhookDeliveries.id, d.id));
      const failures = ok ? 0 : hook.consecutiveFailures + 1;
      await tx
        .update(webhooks)
        .set({
          consecutiveFailures: failures,
          ...(failures >= 20 ? { enabled: false, disabledReason: '연속 실패로 자동 비활성화' } : {}),
          updatedAt: new Date(),
        })
        .where(eq(webhooks.id, hook.id));
    });
    if (!ok) throw new Error(`webhook HTTP ${status}: ${text.slice(0, 200)}`);
    return { status };
  },
  { transactional: false },
);

// ───────────────────────────── Business events ─────────────────────────────

const WEBHOOK_FOR: Partial<Record<EmailTrigger, WebhookEvent>> = {
  QUOTE_ISSUED: 'quote.issued',
  QUOTE_APPROVED: 'quote.approved',
  CONTRACT_COMPLETED: 'contract.completed',
  PI_ISSUED: 'invoice.issued',
  PAYMENT_RECEIVED: 'payment.received',
  PRODUCTION_STARTED: 'production.started',
  VESSEL_DEPARTED: 'shipment.departed',
  ARRIVED: 'shipment.arrived',
  CUSTOMS_COMPLETED: 'customs.completed',
  DELIVERED: 'delivery.completed',
};

const STAFF_ALERT: EmailTrigger[] = [
  'QUOTE_APPROVED',
  'CONTRACT_COMPLETED',
  'PAYMENT_RECEIVED',
  'PRODUCTION_DELAY',
  'ETA_CHANGED',
];

/**
 * Fans a business event out to: customer email (template), in-app notifications
 * (customers + staff), Slack (staff alerts), and signed webhooks. Deduplicated by key.
 */
export async function notifyEvent(
  tx: Tx,
  tenantId: string,
  trigger: EmailTrigger,
  projectId: string,
  vars: Record<string, unknown> = {},
  opts: {
    dedupeKey?: string;
    attachments?: Array<{ fileId: string; name: string }>;
    skipCustomer?: boolean;
  } = {},
): Promise<void> {
  const { project, users: customers } = await projectCustomerUsers(tx, tenantId, projectId);
  if (!project) return;
  const baseVars = {
    projectCode: project.code,
    projectTitle: project.title,
    productName: project.title,
    ...vars,
  };
  const dedupe = opts.dedupeKey ?? `${trigger}:${projectId}:${JSON.stringify(vars).slice(0, 100)}`;
  const customerLink = `/portal/projects/${projectId}`;
  if (!opts.skipCustomer) {
    for (const c of customers) {
      await queueTemplatedEmail(
        tx,
        tenantId,
        trigger,
        c.email,
        { ...baseVars, recipientName: c.name || c.email, link: `${config.PUBLIC_WEB_URL}${customerLink}` },
        { projectId, dedupeKey: `${dedupe}:${c.id}`, attachments: opts.attachments },
      );
    }
    await notifyUsers(
      tx,
      tenantId,
      customers.map((c) => c.id),
      {
        kind: trigger,
        title: triggerTitle(trigger, project.code),
        link: customerLink,
        projectId,
        dedupeKey: dedupe,
      },
    );
  }
  const staff = await staffUserIds(tx, tenantId);
  await notifyUsers(tx, tenantId, staff, {
    kind: trigger,
    title: triggerTitle(trigger, project.code),
    link: `/admin/projects/${projectId}`,
    projectId,
    dedupeKey: `staff:${dedupe}`,
    severity: trigger === 'PRODUCTION_DELAY' || trigger === 'ETA_CHANGED' ? 'WARNING' : 'INFO',
  });
  if (STAFF_ALERT.includes(trigger))
    await slackAlert(tx, tenantId, `[${project.code}] ${triggerTitle(trigger, project.code)}`);
  const hook = WEBHOOK_FOR[trigger];
  if (hook) await dispatchWebhook(tx, tenantId, hook, { projectId, projectCode: project.code, ...vars });
}

export function triggerTitle(trigger: EmailTrigger, code: string): string {
  const map: Record<EmailTrigger, string> = {
    SOURCING_RECEIVED: '소싱 요청이 접수되었습니다',
    ANALYSIS_COMPLETED: '제품 분석이 완료되었습니다',
    QUOTE_ISSUED: '견적서가 발행되었습니다',
    QUOTE_REMINDER: '견적 유효기한이 곧 끝납니다',
    QUOTE_APPROVED: '고객이 견적을 승인했습니다',
    CONTRACT_READY: '계약서 확인이 필요합니다',
    CONTRACT_COMPLETED: '계약이 체결되었습니다',
    PI_ISSUED: 'Proforma Invoice가 발행되었습니다',
    PAYMENT_RECEIVED: '입금이 확인되었습니다',
    PRODUCTION_STARTED: '생산이 시작되었습니다',
    PRODUCTION_DELAY: '생산 일정이 지연되었습니다',
    INSPECTION_COMPLETED: '검품이 완료되었습니다',
    SHIPMENT_BOOKED: '선적 예약이 완료되었습니다',
    VESSEL_DEPARTED: '화물이 출항했습니다',
    ETA_CHANGED: '도착 예정일이 변경되었습니다',
    ARRIVED: '화물이 도착했습니다',
    CUSTOMS_COMPLETED: '통관이 완료되었습니다',
    DELIVERY_STARTED: '국내 배송이 시작되었습니다',
    DELIVERED: '배송이 완료되었습니다',
  };
  return `[${code}] ${map[trigger]}`;
}

export async function unreadCount(tx: Tx, tenantId: string, userId: string): Promise<number> {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.tenantId, tenantId),
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
      ),
    );
  return r?.n ?? 0;
}
