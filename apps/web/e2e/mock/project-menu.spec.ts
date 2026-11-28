import { expect, test } from '@playwright/test';
import { INVOICER_API, ORG } from './mock';

test('the project list More menu offers Runs and Agent & settings and an enabled Delete project', async ({ page }) => {
  await page.goto(`/o/${ORG}/projects`);
  await page.getByRole('button', { name: 'More for invoicer-api' }).click();
  const menu = page.getByRole('dialog', { name: 'Actions for invoicer-api' });
  await expect(menu.getByRole('link', { name: 'Runs' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Agent & settings' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0);
  await expect(menu.getByRole('button', { name: 'Delete project' })).toBeEnabled();

  await menu.getByRole('link', { name: 'Agent & settings' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${ORG}/p/${INVOICER_API}/desk/agent$`));
});

test('Delete project in the project list More menu asks to confirm, then removes the row', async ({ page }) => {
  await page.goto(`/o/${ORG}/projects`);
  await page.getByRole('button', { name: 'More for invoicer-api' }).click();
  await page
    .getByRole('dialog', { name: 'Actions for invoicer-api' })
    .getByRole('button', { name: 'Delete project' })
    .click();
  const confirm = page.getByRole('dialog', { name: 'Delete project' });
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('link', { name: 'invoicer-api', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'More for invoicer-api' }).click();
  await page
    .getByRole('dialog', { name: 'Actions for invoicer-api' })
    .getByRole('button', { name: 'Delete project' })
    .click();
  await confirm.getByRole('button', { name: 'Delete project' }).click();
  await expect(page.getByRole('link', { name: 'invoicer-api', exact: true })).toHaveCount(0);
});
