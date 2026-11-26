import { expect, test } from '@playwright/test';
import { INVOICER_API, ORG } from './mock';

// Run detail sidebar, Pull request section: hidden while the run is active, and the ticket's linked PR once the run
// has ended, including after the page is reloaded. In the mock, PR #148 closes issue #142 (runs 60 and 62).
const runUrl = (n: number) => `/o/${ORG}/p/${INVOICER_API}/runs/${n}`;
const RUNNING_RUN = 61;
const ENDED_RUN_WITH_LINKED_PR = 60;
const ISSUE_RUN = 65;

test('a running run shows no Pull request section and no empty note', async ({ page }) => {
  await page.goto(runUrl(RUNNING_RUN));
  const side = page.getByRole('complementary', { name: 'Run context' });
  await expect(side).toBeVisible();
  await expect(side.getByText('Chain on this ticket')).toBeVisible();
  await expect(side.getByText('Pull request')).toHaveCount(0);
  await expect(side.getByText(/None yet/)).toHaveCount(0);
});

test('an ended run shows its ticket linked PR, with title and link, also after a reload', async ({ page }) => {
  await page.goto(runUrl(ENDED_RUN_WITH_LINKED_PR));
  const side = page.getByRole('complementary', { name: 'Run context' });
  const section = side.locator('section').filter({ has: page.getByText('Pull request', { exact: true }) });
  for (const reload of [false, true]) {
    if (reload) await page.reload();
    await expect(section).toBeVisible();
    await expect(section.getByText('PR #148')).toBeVisible();
    await expect(section.getByText(/^Export invoices as CSV/)).toBeVisible();
    await expect(section.getByRole('link', { name: /Open in GitHub/ })).toHaveAttribute(
      'href',
      'https://github.com/harbor-labs/invoicer-api/pull/148',
    );
  }
});

test('the pull request Open in GitHub link opens a new tab and leaves the run detail page open', async ({ page }) => {
  const url = runUrl(ENDED_RUN_WITH_LINKED_PR);
  await page.goto(url);
  const side = page.getByRole('complementary', { name: 'Run context' });
  const section = side.locator('section').filter({ has: page.getByText('Pull request', { exact: true }) });
  const link = section.getByRole('link', { name: /Open in GitHub/ });
  await expect(link).toHaveAttribute('href', 'https://github.com/harbor-labs/invoicer-api/pull/148');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');

  const popup = page.waitForEvent('popup');
  await link.click();
  await popup;
  expect(new URL(page.url()).pathname).toBe(url);
  await expect(link).toBeVisible();
});

test('the issue Open in GitHub link opens a new tab and leaves the run detail page open', async ({ page }) => {
  const url = runUrl(ISSUE_RUN);
  await page.goto(url);
  const side = page.getByRole('complementary', { name: 'Run context' });
  const section = side.locator('section').filter({ has: page.getByText('Ticket', { exact: true }) });
  const link = section.getByRole('link', { name: /Open in GitHub/ });
  await expect(link).toHaveAttribute('href', 'https://github.com/harbor-labs/invoicer-api/issues/153');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');

  const popup = page.waitForEvent('popup');
  await link.click();
  await popup;
  expect(new URL(page.url()).pathname).toBe(url);
  await expect(link).toBeVisible();
});
