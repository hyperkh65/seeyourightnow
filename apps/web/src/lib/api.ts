/**
 * Browser API client. Same-origin (/api/v1 is rewritten to the API server),
 * sends the CSRF token from the readable `sos_csrf` cookie and optional
 * Idempotency-Key for critical mutations.
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
    public requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function csrfToken(): string {
  if (typeof document === 'undefined') return '';
  const m = /(?:^|;\s*)sos_csrf=([^;]+)/.exec(document.cookie);
  return m ? decodeURIComponent(m[1]!) : '';
}

type StepUpHandler = () => Promise<boolean>;
let stepUpHandler: StepUpHandler | null = null;
export function setStepUpHandler(h: StepUpHandler | null) {
  stepUpHandler = h;
}

export interface RequestOptions {
  idempotencyKey?: string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** When false, STEP_UP_REQUIRED errors are not auto-handled. */
  stepUp?: boolean;
}

export function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers ?? {}) };
  if (method !== 'GET') {
    const t = csrfToken();
    if (t) headers['x-csrf-token'] = t;
  }
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    signal: opts.signal,
  });
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('application/json') ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    const e = (data ?? {}) as { code?: string; message?: string; details?: unknown; requestId?: string };
    const err = new ApiError(res.status, e.code ?? 'ERROR', e.message ?? '요청을 처리하지 못했습니다.', e.details, e.requestId);
    if (err.code === 'STEP_UP_REQUIRED' && opts.stepUp !== false && stepUpHandler) {
      const ok = await stepUpHandler();
      if (ok) return request<T>(method, path, body, { ...opts, stepUp: false });
    }
    throw err;
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('POST', path, body ?? {}, opts),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PUT', path, body ?? {}, opts),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PATCH', path, body ?? {}, opts),
  delete: <T>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, undefined, opts),
  upload: <T>(path: string, form: FormData, opts?: RequestOptions) => request<T>('POST', path, form, opts),
};

/** Human readable error text for toasts / inline errors. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'VALIDATION_ERROR') return '입력값을 확인해 주세요.';
    return e.message;
  }
  if (e instanceof Error) return e.message === 'Failed to fetch' ? '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.' : e.message;
  return '알 수 없는 오류가 발생했습니다.';
}

export async function openFile(fileOrDocUrlPath: string): Promise<void> {
  const r = await api.get<{ url: string }>(fileOrDocUrlPath);
  window.open(r.url, '_blank', 'noopener');
}
