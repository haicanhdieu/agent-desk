import { expect, test } from '@playwright/test';
import { INVOICER_API, ORG } from './mock';

test('the Settings tab opens Routing rules, the first item in the Desk menu', async ({ page }) => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/runs`);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings' }).click();

  await expect(page).toHaveURL(new RegExp(`/o/${ORG}/p/${INVOICER_API}/desk/rules$`));
  await expect(page.getByRole('heading', { name: 'Routing rules', level: 1 })).toBeVisible();

  const items = page.getByRole('navigation', { name: 'Desk' }).getByRole('link');
  await expect(items.first()).toHaveText('Routing rules');
  await expect(items.first()).toHaveAttribute('aria-current', 'page');
  await expect(items.nth(1)).toHaveText('Skills');
});

test("the Desk sidebar header shows the project's name, not the generic Desk label", async ({ page }) => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/desk/rules`);
  await expect(page.getByRole('heading', { name: 'Routing rules', level: 1 })).toBeVisible();

  const sidebar = page.getByRole('navigation', { name: 'Desk' });
  await expect(sidebar.locator('div', { hasText: /^invoicer-api$/ })).toBeVisible();
  await expect(sidebar.getByText('Desk', { exact: true })).toHaveCount(0);
});
