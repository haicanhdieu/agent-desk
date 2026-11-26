import { expect, test } from '@playwright/test';
import { INVOICER_API, ORG } from './mock';

const agentTab = (page: import('@playwright/test').Page, name: string) =>
  page.getByRole('tablist', { name: 'Agent and project settings' }).getByRole('tab', { name, exact: true });

// BR-43: Limits is its own tab, labelled Project-wide, apart from Agents.
test('TC-43.1: the Limits tab shows Project-wide, the every-agent line and the limits, not the Agents rows', async ({
  page,
}) => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/desk/agent`);
  await agentTab(page, 'Limits').click();
  await expect(page.getByText('Project-wide', { exact: true })).toBeVisible();
  await expect(page.getByText('Applies to every agent in this project.')).toBeVisible();
  for (const label of [
    'Run time limit',
    'Keep a paused run for',
    "Keep a finished run's session for",
    'End idle runs after',
    'Automatic resumes after a crash',
  ]) {
    await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole('heading', { level: 2, name: 'Agents', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add agent' })).toHaveCount(0);
});

test('TC-43.2: the Agents tab shows no limit field', async ({ page }) => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/desk/agent`);
  await expect(page.getByRole('heading', { level: 2, name: 'Agents', exact: true })).toBeVisible();
  for (const label of [
    'Run time limit',
    'Keep a paused run for',
    "Keep a finished run's session for",
    'End idle runs after',
    'Automatic resumes after a crash',
  ]) {
    await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
  }
});

const idleField = (page: import('@playwright/test').Page) => page.getByLabel('End idle runs after');

test('End idle runs after is editable, saved, and shown again after leaving the page', async ({ page }) => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/desk/agent?tab=limits`);
  await expect(idleField(page)).toHaveValue('30');
  await expect(idleField(page)).toBeEditable();

  await idleField(page).fill('90');
  await page.getByRole('button', { name: 'Save limits' }).click();
  await expect(page.getByText('Limits saved')).toBeVisible();

  // Leave by link (a reload would reseed the mock store) and come back: the saved value is read from the agent.
  await page.getByRole('link', { name: 'Routing rules' }).click();
  await page.getByRole('link', { name: 'Agent & settings' }).click();
  await page.getByRole('tab', { name: 'Limits' }).click();
  await expect(idleField(page)).toHaveValue('90');
});

test('End idle runs after under 5 minutes is refused with a message and nothing is saved', async ({ page }) => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/desk/agent?tab=limits`);
  await idleField(page).fill('2');
  await page.getByRole('button', { name: 'Save limits' }).click();
  await expect(page.getByText('Idle runs must end after between 5 minutes and 7 days')).toBeVisible();
  await expect(idleField(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Limits saved')).toHaveCount(0);
});

test('an idle run screen shows the End idle runs after the agent was saved with, not a fixed 30 minutes', async ({
  page,
}) => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/desk/agent?tab=limits`);
  await idleField(page).fill('10');
  await page.getByRole('button', { name: 'Save limits' }).click();
  await expect(page.getByText('Limits saved')).toBeVisible();

  // Client-side navigation keeps the mock store (a reload would reseed it).
  await page.getByRole('navigation', { name: 'Project sections' }).getByRole('link', { name: /^Runs/ }).click();
  await expect(page.getByText(/ends on its own after 10 minutes with nobody attached/)).toBeVisible();
  // The board can list several idle runs: every idle note must show the saved 10m, none a fixed 30m.
  // The idle runs are listed under Needs you; the first page of the default view holds none of them.
  await page.getByRole('link', { name: /^Needs you/ }).click();
  const anyNote = page.getByText(/Auto-finish after \d+m unattended/);
  await expect(anyNote.first()).toBeVisible();
  const total = await anyNote.count();
  await expect(page.getByText(/Auto-finish after 10m unattended/)).toHaveCount(total);
  await expect(page.getByText(/Auto-finish after 30m unattended/)).toHaveCount(0);
});
