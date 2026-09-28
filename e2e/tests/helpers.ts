import { expect, type Browser, type Page } from '@playwright/test';

export const PASSWORD = process.env.E2E_PASSWORD ?? 'Demo-Pass-2026!';
export const PORT = process.env.E2E_WEB_PORT ?? '3000';
export const host = (tenant: string) => `http://${tenant}.localhost:${PORT}`;

const IGNORED = /pretendard|jsdelivr|TUNNEL|openfreemap|favicon/i;

/** Collects console errors / page errors / 5xx responses so each test can assert a clean console. */
export function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORED.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  return errors;
}

type Cookies = Parameters<import('@playwright/test').BrowserContext['addCookies']>[0];
/** One real UI login per user per run: the login endpoint is rate limited (by design). */
const sessions = new Map<string, Cookies>();

export async function login(
  page: Page,
  tenant: string,
  email: string,
  opts: { fresh?: boolean } = {},
): Promise<void> {
  const key = `${tenant}:${email}`;
  const cached = sessions.get(key);
  if (cached && !opts.fresh) {
    await page.context().addCookies(cached);
    await page.goto(`${host(tenant)}/`);
    return;
  }
  await page.goto(`${host(tenant)}/login`);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('button[type=submit]').click();
  await expect(page).not.toHaveURL(/\/login(\?|$)/);
  sessions.set(
    key,
    (await page.context().cookies()).filter((c) => c.domain.includes(`${tenant}.localhost`)),
  );
}

export async function newSession(
  browser: Browser,
  tenant: string,
  email: string,
  viewport?: { width: number; height: number },
) {
  const ctx = await browser.newContext(viewport ? { viewport } : {});
  const page = await ctx.newPage();
  const errors = watchConsole(page);
  await login(page, tenant, email);
  return { ctx, page, errors };
}
