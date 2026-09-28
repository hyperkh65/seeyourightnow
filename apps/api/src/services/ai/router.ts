import { withTenant, type Tx } from '../../db/client.js';
import { aiUsage } from '../../db/schema/index.js';
import { safeFetch } from '../../lib/http.js';
import { connectionById, connectionsWithCapability, recordConnectionResult, type LoadedConnection } from '../connections/index.js';
import { getPublished } from '../settings.js';

/**
 * AI Provider Router.
 *   - Text and vision tasks go to the tenant's primary provider, then fallback.
 *   - Failures feed the per-connection circuit breaker.
 *   - Every call is metered in ai_usage (tokens, latency, fallback) per tenant.
 * LLMs are used only for language/vision understanding — never for arithmetic,
 * tariff rates or anything that must come from official data.
 */

export type AiTask = 'VISION_UNDERSTAND' | 'TEXT_STRUCTURE' | 'TRANSLATE' | 'HS_RERANK' | 'RFQ_PARSE' | 'DOC_EXTRACT';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: 'text'; text: string } | { type: 'image'; mime: string; base64: string }>;
}

export interface AiResult {
  text: string;
  provider: string;
  model: string;
  fallbackUsed: boolean;
}

export class AiUnavailableError extends Error {
  constructor(message = 'AI provider not configured') {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

interface CallOutcome {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

async function callOpenAiCompatible(conn: LoadedConnection, messages: ChatMessage[], opts: { vision: boolean; json: boolean; maxTokens: number }): Promise<CallOutcome> {
  const baseUrl = String(conn.config.baseUrl ?? (conn.provider === 'GROQ' ? 'https://api.groq.com/openai/v1' : ''));
  const model = String((opts.vision ? conn.config.visionModel : conn.config.textModel) ?? '');
  if (!baseUrl || !model) throw new Error(`${conn.provider}: ${opts.vision ? 'vision' : 'text'} model not configured`);
  const body = {
    model,
    temperature: 0.1,
    max_tokens: opts.maxTokens,
    ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
    messages: messages.map((m) => ({
      role: m.role,
      content:
        typeof m.content === 'string'
          ? m.content
          : m.content.map((c) => (c.type === 'text' ? { type: 'text', text: c.text } : { type: 'image_url', image_url: { url: `data:${c.mime};base64,${c.base64}` } })),
    })),
  };
  const res = await safeFetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    trusted: true,
    timeoutMs: 60_000,
    headers: { 'Content-Type': 'application/json', ...(conn.secrets.apiKey ? { Authorization: `Bearer ${conn.secrets.apiKey}` } : {}) },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: { message?: string } };
  if (!res.ok) throw new Error(`${conn.provider} HTTP ${res.status}: ${json.error?.message ?? ''}`.slice(0, 500));
  return { text: json.choices?.[0]?.message?.content ?? '', inputTokens: json.usage?.prompt_tokens ?? 0, outputTokens: json.usage?.completion_tokens ?? 0, model };
}

async function callAnthropic(conn: LoadedConnection, messages: ChatMessage[], opts: { vision: boolean; json: boolean; maxTokens: number }): Promise<CallOutcome> {
  const model = String((opts.vision ? conn.config.visionModel : conn.config.textModel) ?? 'claude-sonnet-5');
  const system = messages.filter((m) => m.role === 'system').map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
  const body = {
    model,
    max_tokens: opts.maxTokens,
    temperature: 0.1,
    ...(system ? { system: system + (opts.json ? '\nRespond with a single JSON object only.' : '') } : {}),
    messages: messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : m.content.map((c) => (c.type === 'text' ? { type: 'text', text: c.text } : { type: 'image', source: { type: 'base64', media_type: c.mime, data: c.base64 } })),
      })),
  };
  const res = await safeFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    trusted: true,
    timeoutMs: 60_000,
    headers: { 'Content-Type': 'application/json', 'x-api-key': conn.secrets.apiKey ?? '', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { content?: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number }; error?: { message?: string } };
  if (!res.ok) throw new Error(`ANTHROPIC HTTP ${res.status}: ${json.error?.message ?? ''}`.slice(0, 500));
  return { text: (json.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join(''), inputTokens: json.usage?.input_tokens ?? 0, outputTokens: json.usage?.output_tokens ?? 0, model };
}

async function resolveChain(tx: Tx, tenantId: string, vision: boolean): Promise<LoadedConnection[]> {
  const ai = await getPublished(tx, tenantId, 'ai');
  const ids = vision ? [ai.primaryVision, ai.fallbackVision] : [ai.primaryText, ai.fallbackText];
  const chain: LoadedConnection[] = [];
  for (const id of ids) {
    if (!id) continue;
    const c = await connectionById(tx, id);
    if (c) chain.push(c);
  }
  if (chain.length === 0) {
    // No explicit routing configured: use any enabled provider with the capability.
    chain.push(...(await connectionsWithCapability(tx, tenantId, vision ? 'VISION' : 'TEXT')));
  }
  return chain;
}

/**
 * Runs a chat completion with automatic fallback.
 * Throws AiUnavailableError when no provider is configured — callers must degrade gracefully.
 */
export async function aiChat(tenantId: string, task: AiTask, messages: ChatMessage[], opts: { vision?: boolean; json?: boolean; maxTokens?: number } = {}): Promise<AiResult> {
  const vision = !!opts.vision;
  const chain = await withTenant({ tenantId }, (tx) => resolveChain(tx, tenantId, vision));
  if (chain.length === 0) throw new AiUnavailableError(vision ? '비전 AI 제공자가 설정되지 않았습니다.' : '텍스트 AI 제공자가 설정되지 않았습니다.');
  const errors: string[] = [];
  for (let i = 0; i < chain.length; i++) {
    const conn = chain[i]!;
    const started = Date.now();
    try {
      const call = conn.provider === 'ANTHROPIC' ? callAnthropic : callOpenAiCompatible;
      const out = await call(conn, messages, { vision, json: !!opts.json, maxTokens: opts.maxTokens ?? 1200 });
      await recordConnectionResult(tenantId, conn.id, true);
      await withTenant({ tenantId }, (tx) =>
        tx.insert(aiUsage).values({ tenantId, provider: conn.provider, model: out.model, task, inputTokens: out.inputTokens, outputTokens: out.outputTokens, latencyMs: Date.now() - started, success: true, fallbackUsed: i > 0 }),
      );
      return { text: out.text, provider: conn.provider, model: out.model, fallbackUsed: i > 0 };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${conn.provider}: ${msg}`);
      await recordConnectionResult(tenantId, conn.id, false, msg);
      await withTenant({ tenantId }, (tx) =>
        tx.insert(aiUsage).values({ tenantId, provider: conn.provider, model: String(conn.config.textModel ?? ''), task, latencyMs: Date.now() - started, success: false, fallbackUsed: i > 0, error: msg.slice(0, 500) }),
      );
    }
  }
  throw new AiUnavailableError(`모든 AI 제공자 호출 실패: ${errors.join(' | ')}`);
}

/** Extracts the first JSON object from a model response. */
export function parseJsonLoose<T = unknown>(text: string): T | null {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '');
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ─── AI worker (Python) client ───

export interface WorkerClient {
  conn: LoadedConnection;
  post<T>(path: string, body: unknown, timeoutMs?: number): Promise<T>;
}

export async function aiWorker(tenantId: string): Promise<WorkerClient | null> {
  const conns = await withTenant({ tenantId }, (tx) => connectionsWithCapability(tx, tenantId, 'OCR'));
  const conn = conns.find((c) => c.provider === 'AI_WORKER');
  if (!conn) return null;
  return {
    conn,
    async post<T>(path: string, body: unknown, timeoutMs = 60_000): Promise<T> {
      const res = await safeFetch(`${String(conn.config.baseUrl)}${path}`, {
        method: 'POST',
        trusted: true,
        timeoutMs,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${conn.secrets.token ?? ''}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        await recordConnectionResult(tenantId, conn.id, false, `HTTP ${res.status}`);
        throw new Error(`AI worker ${path} HTTP ${res.status}`);
      }
      return (await res.json()) as T;
    },
  };
}
