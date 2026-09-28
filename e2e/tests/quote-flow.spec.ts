import { expect, test } from '@playwright/test';
import { host, newSession } from './helpers';

/**
 * Full business flow across two roles:
 * customer search → staff selects a candidate → quote draft → issue (PDF + hash)
 * → customer approval with evidence → staff final approval (LOCKED) → contract draft.
 */
test('customer ↔ staff quotation approval flow', async ({ browser }) => {
  test.setTimeout(240_000);
  const buyer = await newSession(browser, 'demo', 'buyer@demo.local');
  await buyer.page.goto(`${host('demo')}/search`);
  const product = `E2E 실리콘 주방 집게 ${Date.now().toString().slice(-6)}`;
  await buyer.page.getByRole('textbox', { name: '제품명, 설명 또는 상품 링크' }).fill(product);
  await buyer.page.getByRole('button', { name: '조건 추가' }).click();
  await buyer.page.getByPlaceholder('예: 500').fill('500');
  await buyer.page.getByRole('button', { name: /찾아보기/ }).click();
  await expect(buyer.page).toHaveURL(/\/r\//);
  const projectLink = buyer.page.locator('a[href^="/portal/projects/"]').first();
  await expect(projectLink).toBeVisible({ timeout: 90_000 });
  const projectId = (await projectLink.getAttribute('href'))!.split('/').pop()!;

  const staff = await newSession(browser, 'demo', 'owner@demo.local');
  await staff.page.goto(`${host('demo')}/admin/projects/${projectId}?tab=sourcing`);
  const select = staff.page.getByRole('button', { name: '견적 대상으로' }).first();
  await expect(select).toBeVisible({ timeout: 90_000 });
  await select.click();
  await expect(staff.page.getByRole('button', { name: '견적 대상', exact: true }).first()).toBeVisible();

  await staff.page.goto(`${host('demo')}/admin/projects/${projectId}?tab=quotes`);
  await staff.page.getByRole('button', { name: '선택한 후보로 견적 만들기' }).click();
  const dialog = staff.page.getByRole('dialog');
  await dialog.getByPlaceholder('자동').first().fill('8900');
  await dialog.getByRole('button', { name: '초안 만들기' }).click();
  await expect(staff.page).toHaveURL(/\/admin\/quotes\/[0-9a-f-]{36}/);
  const quoteUrl = new URL(staff.page.url());
  const quoteId = quoteUrl.pathname.split('/').pop()!;

  await staff.page.getByRole('button', { name: '발행 · 고객 발송' }).click();
  await staff.page.getByRole('dialog').getByRole('button', { name: '발행하고 보내기' }).click();
  await expect(staff.page.getByText('발송됨 · 고객 확인 대기').first()).toBeVisible();
  // Staff sees the internal profit preview; the customer view must not.
  await expect(staff.page.getByText(/예상 이익|내부/).first()).toBeVisible();

  await buyer.page.goto(`${host('demo')}/portal/quotes/${quoteId}`);
  await expect(buyer.page.getByText('₩8,900').first()).toBeVisible();
  const body = await buyer.page.locator('body').innerText();
  expect(body).not.toMatch(/예상 이익|원가|마진/);
  await buyer.page.getByRole('button', { name: '승인하기' }).click();
  const approve = buyer.page.getByRole('dialog');
  await approve.getByText(/내용을 확인했으며 승인합니다/).click();
  await approve.getByRole('button', { name: '승인합니다' }).click();
  await expect(buyer.page.getByText(/승인 완료|최종 확인 중/).first()).toBeVisible();

  await staff.page.reload();
  await staff.page.getByRole('button', { name: '최종 승인' }).first().click();
  await staff.page.getByRole('dialog').getByRole('button', { name: '최종 승인' }).click();
  await expect(staff.page.getByText('확정').first()).toBeVisible();
  await staff.page.getByRole('button', { name: '계약서 만들기' }).click();
  await expect(staff.page).toHaveURL(/\/admin\/contracts\//);

  expect(buyer.errors).toEqual([]);
  expect(staff.errors).toEqual([]);
  await buyer.ctx.close();
  await staff.ctx.close();
});
