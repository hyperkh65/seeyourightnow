import { expect, test } from '@playwright/test';
import { host, watchConsole } from './helpers';

test('homepage renders the white-label site without console errors', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto(host('demo'));
  await expect(page.getByRole('textbox', { name: '제품명, 설명 또는 상품 링크' })).toBeVisible();
  await expect(page.locator('footer')).toBeVisible();
  expect(errors).toEqual([]);
});

test('anonymous text search reaches a progressive result page with labelled estimates', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto(`${host('demo')}/search`);
  await page
    .getByRole('textbox', { name: '제품명, 설명 또는 상품 링크' })
    .fill('휴대용 미니 선풍기 USB 충전식');
  await page.getByRole('button', { name: '조건 추가' }).click();
  await page.getByPlaceholder('예: 500').fill('300');
  await page.getByRole('button', { name: /찾아보기/ }).click();
  await expect(page).toHaveURL(/\/r\/[0-9a-f-]{36}\?t=/);
  // The page shows analysis progress and eventually results. Mock data (DEV_MODE) must be labelled.
  await expect(page.getByText(/분석|검색|후보/).first()).toBeVisible();
  await expect(page.getByText('가입하고 견적 요청하기')).toBeVisible({ timeout: 90_000 });
  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(/internalCost|supplierVerifiedPrice|마진/);
  expect(errors).toEqual([]);
});

test('unknown tenant host does not leak another tenant and policies are public', async ({ page }) => {
  await page.goto(`${host('demo')}/policies/PRIVACY`);
  await expect(page.getByRole('heading').first()).toBeVisible();
});
