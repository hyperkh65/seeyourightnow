import { expect, test } from '@playwright/test';
import { host, newSession } from './helpers';

const PAGES = [
  ['/admin', /^안녕하세요/],
  ['/admin/projects', '프로젝트'],
  ['/admin/quotes', '견적'],
  ['/admin/shipments', '운송'],
  ['/admin/suppliers', '공급처'],
  ['/admin/customers', '고객'],
  ['/admin/compliance', '인증·규제'],
  ['/admin/freight', '운임'],
  ['/admin/margin', '마진·가격'],
  ['/admin/analytics', '분석'],
  ['/admin/settings', '설정'],
  ['/admin/settings/connections', 'API 연결'],
  ['/admin/settings/homepage', '홈페이지 구성'],
  ['/admin/users', '사용자·협력사'],
  ['/admin/system', '시스템 상태'],
  ['/admin/audit', '감사 로그'],
] as ReadonlyArray<readonly [string, string | RegExp]>;

test('every admin page renders with a clean console and no horizontal overflow', async ({ browser }) => {
  const { ctx, page, errors } = await newSession(browser, 'demo', 'owner@demo.local');
  for (const [path, heading] of PAGES) {
    await page.goto(`${host('demo')}${path}`);
    await expect(
      page.getByRole('heading', { name: heading, exact: typeof heading === 'string' }).first(),
    ).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow, `${path} overflows horizontally`).toBe(false);
  }
  expect(errors).toEqual([]);
  await ctx.close();
});

test('settings draft → publish creates a new version (brand)', async ({ browser }) => {
  const { ctx, page, errors } = await newSession(browser, 'demo', 'owner@demo.local');
  await page.goto(`${host('demo')}/admin/settings/brand`);
  const name = page.getByRole('textbox').first();
  const original = await name.inputValue();
  await name.fill(`${original} `);
  await name.fill(original);
  await page.getByRole('button', { name: '초안 저장' }).click();
  await expect(page.getByText(/초안 v\d+ 편집 중/)).toBeVisible();
  await page.getByRole('button', { name: '게시' }).click();
  await expect(page.getByText(/게시했습니다/)).toBeVisible();
  expect(errors).toEqual([]);
  await ctx.close();
});
