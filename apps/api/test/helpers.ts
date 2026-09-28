import type { LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app.js';
import '../src/jobs/index.js';

export type TestApp = Awaited<ReturnType<typeof buildApp>>;
let appPromise: Promise<TestApp> | null = null;
export function getApp(): Promise<TestApp> {
  appPromise ??= buildApp().then(async (a) => {
    await a.ready();
    return a;
  });
  return appPromise;
}

export const PASSWORD = 'Test-Pass-2026!';

/** Minimal browser-like client: keeps cookies, sends CSRF header and host. */
export class Client {
  cookies = new Map<string, string>();
  csrf = '';
  constructor(
    public app: TestApp,
    public host: string,
  ) {}

  private cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async request(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<LightMyRequestResponse> {
    const res = await this.app.inject({
      method: method as 'GET',
      url: `/api/v1${url}`,
      headers: {
        'x-forwarded-host': this.host,
        origin: `http://${this.host}:3000`,
        ...(this.csrf ? { 'x-csrf-token': this.csrf } : {}),
        ...(this.cookies.size ? { cookie: this.cookieHeader() } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    });
    for (const c of res.cookies) {
      if (c.value === '' || (c.maxAge !== undefined && c.maxAge <= 0)) this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
    const csrf = this.cookies.get('sos_csrf');
    if (csrf) this.csrf = csrf;
    return res;
  }
  get(url: string) {
    return this.request('GET', url);
  }
  post(url: string, body: unknown = {}, headers?: Record<string, string>) {
    return this.request('POST', url, body, headers);
  }
  put(url: string, body: unknown = {}) {
    return this.request('PUT', url, body);
  }
  patch(url: string, body: unknown = {}, headers?: Record<string, string>) {
    return this.request('PATCH', url, body, headers);
  }
  delete(url: string) {
    return this.request('DELETE', url);
  }
  async login(email: string, password = PASSWORD) {
    const r = await this.post('/auth/login', { email, password });
    if (r.statusCode !== 200) throw new Error(`login failed for ${email}: ${r.statusCode} ${r.body}`);
    return this;
  }
}

export async function client(host: string, email?: string): Promise<Client> {
  const c = new Client(await getApp(), host);
  if (email) await c.login(email);
  return c;
}

export function json<T = Record<string, unknown>>(r: LightMyRequestResponse): T {
  return JSON.parse(r.body) as T;
}
