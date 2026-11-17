import { expect, test } from '@playwright/test';
import { INVOICER_API, ORG } from './mock';

test('the Grouped by ticket button toggles ticket grouping on the Run Board', async ({ page }) => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/runs`);
  const toggle = page.getByRole('button', { name: 'Grouped by ticket' });
  const runLinks = page.getByRole('link', { name: /^Run \d+$/ });
  const groupRows = page.locator('tr', { has: page.getByText(/ of \d+ runs$/) });

  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(runLinks.first()).toBeVisible();
  const runCount = await runLinks.count();
  const grouped = await groupRows.count();
  expect(grouped).toBeGreaterThan(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(groupRows).toHaveCount(0);
  await expect(runLinks).toHaveCount(runCount);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(groupRows).toHaveCount(grouped);
  await expect(runLinks).toHaveCount(runCount);
});

test('the Run List shows durations in compact units', async ({ page }) => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/runs`);
  await expect(page.getByRole('cell', { name: '7m 50s', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: '30m', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: /^\d+m 0s$|^0\d/ })).toHaveCount(0);
});

test('ticket and PR numbers on the Run Board open GitHub in a new window', async ({ page }) => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/runs`);
  const rowTicket = page
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name: /^Run \d+$/ }) })
    .getByRole('link', { name: /^#\d+$|^PR #\d+$/ })
    .first();
  await expect(rowTicket).toBeVisible();
  await expect(rowTicket).toHaveAttribute('href', /^https:\/\/github\.com\/.+\/(issues|pull)\/\d+$/);
  await expect(rowTicket).toHaveAttribute('target', '_blank');
  await expect(rowTicket).toHaveAttribute('rel', 'noopener noreferrer');

  const groupTicket = page
    .getByRole('row')
    .filter({ hasText: / of \d+ runs$/ })
    .getByRole('link', { name: /^(Issue|PR) #\d+$/ })
    .first();
  await expect(groupTicket).toHaveAttribute('target', '_blank');
});
