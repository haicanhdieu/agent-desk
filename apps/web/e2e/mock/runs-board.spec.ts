import { expect, test } from '@playwright/test';
import { INVOICER_API, ORG } from './mock';

/** The routing rule command of run 65 (src/mocks/dto/runs.ts), long enough to be truncated in the Run List. */
const LONG_COMMAND = 'code-build-with-a-very-long-routing-rule-command-name-that-overflows-the-cell';

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
  await expect(groupTicket).toHaveAttribute('href', /^https:\/\/github\.com\/.+\/(issues|pull)\/\d+$/);
  await expect(groupTicket).toHaveAttribute('target', '_blank');
  await expect(groupTicket).toHaveAttribute('rel', 'noopener noreferrer');
});

test('the Run List shows the routing rule command in a Routing rule column instead of Skill', async ({ page }) => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/runs`);
  await expect(page.getByRole('columnheader', { name: 'Routing rule' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Skill' })).toHaveCount(0);

  const rowOf = (n: number) => page.getByRole('row').filter({ has: page.getByRole('link', { name: `Run ${n}` }) });
  // Run 60 is a skill run, run 52 a custom-prompt run: both show their rule command.
  await expect(rowOf(60).getByRole('cell', { name: '/code-build', exact: true })).toBeVisible();
  await expect(rowOf(52).getByRole('cell', { name: '/triage', exact: true })).toBeVisible();
});

test('a long routing rule command is truncated in the Run List and its full value is in the title', async ({
  page,
}) => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/runs`);
  const longCommand = `/${LONG_COMMAND}`;
  const cell = page.getByText(longCommand, { exact: true });
  await expect(cell).toBeVisible();
  await expect(cell).toHaveAttribute('title', longCommand);

  // The span is inline (scrollWidth 0); the clipping happens on its parent <td>.
  const clipped = await cell.locator('xpath=..').evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(clipped).toBe(true);
  const overflowsPage = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflowsPage).toBe(false);
});
