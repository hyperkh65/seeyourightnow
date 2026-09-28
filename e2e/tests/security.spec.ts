import { expect, test } from '@playwright/test';
import { host, login, newSession } from './helpers';

test('customers are redirected away from the admin console', async ({ page }) => {
  await login(page, 'demo', 'buyer@demo.local');
  await page.goto(`${host('demo')}/admin`);
  await expect(page).toHaveURL(/\/portal/);
});

test('partners only reach the partner portal', async ({ page }) => {
  await login(page, 'demo', 'customs@demo.local');
  await expect(page).toHaveURL(/\/partner/);
  await page.goto(`${host('demo')}/admin/settings`);
  await expect(page).toHaveURL(/\/partner/);
});

test('a session from tenant A is not valid on tenant B', async ({ browser }) => {
  const { ctx, page } = await newSession(browser, 'demo', 'owner@demo.local');
  await page.goto(`${host('acme')}/admin`);
  await expect(page).toHaveURL(/acme\.localhost.*\/login/);
  await ctx.close();
});

test('another tenant’s project id returns an error state, never data', async ({ browser }) => {
  const demo = await newSession(browser, 'demo', 'owner@demo.local');
  // Requests run inside the browser page so *.localhost resolves the same way it does for users.
  const { items } = await demo.page.evaluate(
    async () =>
      (await fetch('/api/v1/projects?limit=1')).json() as Promise<{
        items: Array<{ id: string; title: string }>;
      }>,
  );
  test.skip(!items.length, 'demo tenant has no projects');
  const acme = await newSession(browser, 'acme', 'owner@acme.local');
  const status = await acme.page.evaluate(
    async (id) => (await fetch(`/api/v1/projects/${id}/overview`)).status,
    items[0]!.id,
  );
  expect([403, 404]).toContain(status);
  await acme.page.goto(`${host('acme')}/admin/projects/${items[0]!.id}`);
  await expect(acme.page.getByText(items[0]!.title)).toHaveCount(0);
  await demo.ctx.close();
  await acme.ctx.close();
});

test('open redirect in login `next` is ignored', async ({ page }) => {
  await page.goto(`${host('demo')}/login?next=//evil.example.com/steal`);
  await page.locator('#email').fill('sales@demo.local');
  await page.locator('#password').fill(process.env.E2E_PASSWORD ?? 'Demo-Pass-2026!');
  await page.locator('button[type=submit]').click();
  await expect(page).toHaveURL(/demo\.localhost(:\d+)?\/admin/);
});
