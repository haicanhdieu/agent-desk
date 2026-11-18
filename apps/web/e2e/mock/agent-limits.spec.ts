import { expect, test } from '@playwright/test';
import { INVOICER_API, ORG } from './mock';

const idleField = (page: import('@playwright/test').Page) => page.getByLabel('End idle runs after');

test('End idle runs after is editable, saved, and shown again after leaving the page', async ({ page }) => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/desk/agent`);
  await expect(idleField(page)).toHaveValue('30');
  await expect(idleField(page)).toBeEditable();

  await idleField(page).fill('90');
  await page.getByRole('button', { name: 'Save limits' }).click();
  await expect(page.getByText('Limits saved')).toBeVisible();

  // Leave by link (a reload would reseed the mock store) and come back: the saved value is read from the agent.
  await page.getByRole('link', { name: 'Routing rules' }).click();
  await page.getByRole('link', { name: 'Agent & settings' }).click();
  await expect(idleField(page)).toHaveValue('90');
});

test('End idle runs after under 5 minutes is refused with a message and nothing is saved', async ({ page }) => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/desk/agent`);
  await idleField(page).fill('2');
  await page.getByRole('button', { name: 'Save limits' }).click();
  await expect(page.getByText('Idle runs must end after between 5 minutes and 7 days')).toBeVisible();
  await expect(idleField(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Limits saved')).toHaveCount(0);
});

test('an idle run screen shows the End idle runs after the agent was saved with, not a fixed 30 minutes', async ({
  page,
}) => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/desk/agent`);
  await idleField(page).fill('10');
  await page.getByRole('button', { name: 'Save limits' }).click();
  await expect(page.getByText('Limits saved')).toBeVisible();

  // Client-side navigation keeps the mock store (a reload would reseed it).
  await page.getByRole('navigation', { name: 'Project' }).getByRole('link', { name: /^Runs/ }).click();
  await expect(page.getByText(/ends on its own after 10 minutes with nobody attached/)).toBeVisible();
  await expect(page.getByText(/Auto-finish after 10m unattended/)).toBeVisible();
});
