import { expect, test, type Page } from '@playwright/test';
import { ids } from '../../src/mocks/dto/ids';
import { INVOICER_API, ORG } from './mock';

/*
 * BR-44: the GitHub connection tab shows only what its trigger mode can do. Webhook: no "Send test ping", no "Manage
 * installation", no "Check now" and no empty action row. Polling: "Check now" only.
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

async function openGithubTab(page: Page, project: string) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/o/${ORG}/p/${project}/desk/agent?tab=github`);
  const connection = page.getByRole('region', { name: 'GitHub connection' });
  await expect(connection.getByText('Trigger mode', { exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return connection;
}

test('TC-44.2: a webhook-mode project shows no "Send test ping", "Manage installation" or "Check now"', async ({
  page,
}) => {
  const connection = await openGithubTab(page, INVOICER_API);
  await expect(connection.getByRole('radio', { name: 'Webhook' })).toBeChecked();
  await expect(page.getByText('Send test ping')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Manage installation' })).toHaveCount(0);
  await expect(page.getByText('Manage installation')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Check now' })).toHaveCount(0);
  // No empty action row is drawn where the buttons were: the panel has no button at all.
  await expect(connection.getByRole('button')).toHaveCount(0);
});

test('TC-44.4: a polling-mode project shows "Check now" but no "Send test ping" or "Manage installation"', async ({
  page,
}) => {
  const connection = await openGithubTab(page, ids.project.invoicerWeb);
  await expect(connection.getByRole('radio', { name: 'Polling' })).toBeChecked();
  await expect(connection.getByRole('button', { name: 'Check now' })).toBeVisible();
  await expect(page.getByText('Send test ping')).toHaveCount(0);
  await expect(page.getByText('Manage installation')).toHaveCount(0);
});
