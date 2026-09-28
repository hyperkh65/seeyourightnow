import { expect, test } from '@playwright/test';
import { host, login, watchConsole } from './helpers';

test('customer portal is usable at 390px', async ({ page }) => {
  const errors = watchConsole(page);
  await login(page, 'demo', 'buyer@demo.local');
  for (const path of ['/portal', '/portal/quotes', '/portal/shipments', '/account/security']) {
    await page.goto(`${host('demo')}${path}`);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow, `${path} overflows`).toBe(false);
  }
  expect(errors).toEqual([]);
});

test('home and search are usable at 390px', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto(host('demo'));
  await expect(page.getByRole('textbox', { name: '제품명, 설명 또는 상품 링크' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});
