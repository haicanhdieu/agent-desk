import { expect, test } from '@playwright/test';
import { INVOICER_API, ORG } from './mock';

test('switch the trigger from webhook to polling every 5 min', async ({ page }) => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/desk/agent`);
  const connection = page.getByRole('region', { name: 'GitHub connection' });
  await expect(connection.getByRole('radio', { name: 'Webhook' })).toBeChecked();

  await connection.getByRole('radio', { name: 'Polling' }).check();
  await expect(connection.getByRole('radio', { name: 'Polling' })).toBeChecked();
  // Polling starts at the default interval, 5 min.
  await expect(
    connection.getByRole('radiogroup', { name: 'Check every' }).getByRole('radio', { name: '5 min', exact: true }),
  ).toBeChecked();
  await expect(page.getByText('Polling every 5 min')).toBeVisible();

  // Saved on the server: the project list shows the new trigger.
  await page.getByRole('link', { name: 'Agent Desk, all projects' }).click();
  const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'invoicer-api', exact: true }) });
  await expect(row).toContainText('Polling every 5 min');
});
