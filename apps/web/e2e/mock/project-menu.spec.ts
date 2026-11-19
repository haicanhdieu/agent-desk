import { expect, test } from '@playwright/test';
import { INVOICER_API, ORG } from './mock';

test('the project list More menu offers Runs and Settings and a disabled Delete', async ({ page }) => {
  await page.goto(`/o/${ORG}/projects`);
  await page.getByRole('button', { name: 'More for invoicer-api' }).click();
  const menu = page.getByRole('dialog', { name: 'Actions for invoicer-api' });
  await expect(menu.getByRole('link', { name: 'Runs' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Settings' })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Delete' })).toBeDisabled();

  await menu.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${ORG}/p/${INVOICER_API}/desk/agent$`));
});
