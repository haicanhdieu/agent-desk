import { expect, test, type Locator, type Page } from '@playwright/test';
import type { PrState } from '../../src/ds/tokens';
import { INVOICER_API, ORG, runHeader, seedLists, setPrStates } from './mock';

// Live PR state colours on Run detail (spec show-pr-status-colors). Covers BR-3 (each state's colour), BR-4 (draft gray,
// closed red), BR-5 (issue icons unchanged, no request for an issue), BR-6 (colour fills in without a reload), BR-7
// (error and pending stay neutral, no banner or toast) and BR-9 and BR-15 (every Run detail surface, the collapsed rail).
// Not provable by e2e: the 60 s cache and the GitHub mapping (API integration tests), and the mock's fixed states.
// The Runs page cases live in the Runs page spec of the same feature.

/**
 * The icon's computed colour must equal the token's, read at test time from a probe styled with the token (or
 * `--muted` for neutral). A state also puts its `pr<State>` class on the wrapper.
 */
async function expectPrColour(icon: Locator, state: PrState | 'neutral'): Promise<void> {
  const token = state === 'neutral' ? '--muted' : `--pr-${state}`;
  const expected = await icon.page().evaluate((t) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${t})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, token);
  await expect(icon).toHaveCSS('color', expected);
  if (state !== 'neutral') {
    const cls = `pr${state[0]?.toUpperCase()}${state.slice(1)}`;
    await expect(icon).toHaveClass(new RegExp(cls));
  }
}

const word = (s: PrState): string => s[0]?.toUpperCase() + s.slice(1);
const runUrl = (n: number) => `/o/${ORG}/p/${INVOICER_API}/runs/${n}`;
const MERGED_RUN = 62;

test('Run detail on a merged PR: top bar, Ticket card, chain steps and collapsed rail are purple and say "Merged"', async ({
  page,
}) => {
  await page.goto(runUrl(MERGED_RUN));
  const bar = runHeader(page).getByLabel('Merged');
  await expect(bar).toBeVisible();
  const side = page.getByRole('complementary', { name: 'Run context' });
  const card = side.getByLabel('Merged');
  await expect(card.first()).toBeVisible();
  for (const icon of [bar, ...(await card.all())]) await expectPrColour(icon.locator('xpath=..'), 'merged');
  await page.getByRole('button', { name: 'Collapse context panel (])' }).click();
  await expect(page.getByTitle('Merged PR #148')).toBeVisible();
});

for (const [run, number, state] of [
  [1, 102, 'open'],
  [2, 104, 'draft'],
  [3, 106, 'merged'],
  [4, 108, 'closed'],
] as const) {
  test(`Run detail in each state: PR #${number} is ${state}`, async ({ page }) => {
    await seedLists(page, {
      ticketRuns: [
        { kind: 'pr', number: 102 },
        { kind: 'pr', number: 104 },
        { kind: 'pr', number: 106 },
        { kind: 'pr', number: 108 },
      ],
    });
    await page.goto(runUrl(run));
    const icon = runHeader(page).getByLabel(word(state));
    await expect(icon).toBeVisible();
    await expectPrColour(icon.locator('xpath=..'), state);
  });
}

test('Run detail on an issue run keeps the issue icon and sends no PR-state request', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/tickets/pr-states')) asked.push(r.url());
  });
  await page.goto(runUrl(61));
  await expect(page.getByRole('complementary', { name: 'Run context' })).toBeVisible();
  await expect(runHeader(page).getByLabel(/^(Open|Draft|Merged|Closed)$/)).toHaveCount(0);
  expect(asked).toEqual([]);
});

test('slow: Run detail shows neutral first, then purple without a reload', async ({ page }) => {
  await setPrStates(page, 'slow');
  await page.goto(runUrl(MERGED_RUN));
  await expect(runHeader(page).getByLabel('Merged')).toHaveCount(0);
  await expect(runHeader(page).getByLabel('Merged')).toBeVisible({ timeout: 10_000 });
});

for (const scenario of ['error', 'pending'] as const) {
  test(`${scenario}: Run detail stays neutral with no banner or toast, and the page works`, async ({ page }) => {
    await setPrStates(page, scenario);
    await page.goto(runUrl(MERGED_RUN));
    await expect(page.getByRole('complementary', { name: 'Run context' })).toBeVisible();
    await expect(page.getByLabel('Merged')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Finish run' }).first()).toBeEnabled();
  });
}

// Runs page (Task 7): list rows and PR-led headers, the Needs-you banner and the Ignored view.
const runsUrl = (query = '') => `/o/${ORG}/p/${INVOICER_API}/runs${query}`;
const runRow = (page: Page, n: number): Locator =>
  page.getByRole('row').filter({ has: page.getByRole('link', { name: `Run ${n}`, exact: true }) });
const headerRow = (page: Page, label: RegExp | string): Locator =>
  page
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name: label }) })
    .filter({ hasNot: page.getByRole('link', { name: /^Run \d+$/ }) });
const stateIcon = (scope: Locator | Page, state: PrState): Locator => scope.getByLabel(word(state), { exact: true });
const prStatesRequests = (page: Page): string[] => {
  const urls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/tickets/pr-states')) urls.push(r.url());
  });
  return urls;
};
const PRS = [
  { kind: 'pr', number: 102 },
  { kind: 'pr', number: 104 },
  { kind: 'pr', number: 106 },
  { kind: 'pr', number: 108 },
  { kind: 'pr', number: 110 },
  { kind: 'issue', number: 120 },
] as const;
const PR_RUNS = [
  [1, 'open'],
  [2, 'draft'],
  [3, 'merged'],
  [4, 'closed'],
] as const;

test('Runs rows in each state, flat and grouped; a PR-led header matches its rows', async ({ page }) => {
  await seedLists(page, { ticketRuns: [...PRS] });
  await page.goto(runsUrl());
  for (const mode of ['grouped', 'flat'] as const) {
    if (mode === 'flat') await page.getByRole('button', { name: 'Grouped by ticket' }).click();
    for (const [run, state] of PR_RUNS) {
      const icon = stateIcon(runRow(page, run), state);
      await expect(icon).toBeVisible();
      await expect(icon.locator('xpath=..')).toHaveAttribute('title', word(state));
      await expectPrColour(icon.locator('xpath=..'), state);
    }
    // #110 has no state, and the issue is not a PR: neither gets a state.
    await expect(runRow(page, 5).getByLabel(/^(Open|Draft|Merged|Closed)$/)).toHaveCount(0);
    await expect(runRow(page, 6).getByLabel(/^(Open|Draft|Merged|Closed)$/)).toHaveCount(0);
    await expect(runRow(page, 5).getByRole('link', { name: /PR #110$/ })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Grouped by ticket' }).click();
  for (const [run, state] of PR_RUNS) {
    const number = 100 + run * 2;
    await expectPrColour(stateIcon(headerRow(page, new RegExp(`PR #${number}$`)), state).locator('xpath=..'), state);
    await expectPrColour(stateIcon(runRow(page, run), state).locator('xpath=..'), state);
  }
});

test('a merged group keeps its issue header and a plain chain note', async ({ page }) => {
  await seedLists(page, {
    ticketRuns: [
      { kind: 'issue', number: 120 },
      { kind: 'pr', number: 106, linked: [120] },
    ],
  });
  await page.goto(runsUrl());
  const lead = headerRow(page, 'Issue #120');
  await expect(lead).toBeVisible();
  await expect(lead).toContainText('→ PR #106');
  await expect(lead.getByLabel(/^(Open|Draft|Merged|Closed)$/)).toHaveCount(0);
  await expect(stateIcon(runRow(page, 2), 'merged')).toBeVisible();
});

test('the Needs-you banner on a merged PR is purple, also when the run is off the current page', async ({ page }) => {
  await seedLists(page, { ticketRuns: [{ kind: 'pr', number: 106, status: 'idle' }] });
  await page.goto(runsUrl());
  const inPage = page.getByText('Run 1 needs you.');
  await expect(inPage).toBeVisible();
  const bannerIcon = stateIcon(page.locator('div').filter({ has: inPage }).last(), 'merged').first();
  await expect(bannerIcon).toBeVisible();
  await expectPrColour(bannerIcon.locator('xpath=..'), 'merged');

  const offPage = await page.context().newPage();
  await seedLists(offPage, { runs: { total: 25 }, ticketRuns: [{ kind: 'pr', number: 106, status: 'idle' }] });
  await offPage.goto(runsUrl());
  await expect(offPage.getByText('Run 1 needs you.')).toBeVisible();
  await expect(runRow(offPage, 1)).toHaveCount(0);
  const offIcon = stateIcon(offPage, 'merged').first();
  await expect(offIcon).toBeVisible();
  await expectPrColour(offIcon.locator('xpath=..'), 'merged');
});

test('the Ignored view colours PR rows per state', async ({ page }) => {
  await seedLists(page, { ignored: 10 });
  await page.goto(runsUrl('?filter=ignored'));
  for (const state of ['open', 'draft', 'merged', 'closed'] as const) {
    const icon = stateIcon(page, state);
    await expect(icon).toHaveCount(1);
    await expectPrColour(icon.locator('xpath=..'), state);
  }
  await expect(page.getByLabel(/^(Open|Draft|Merged|Closed)$/)).toHaveCount(4);
});

test('page 2 and a filter change colour the newly shown PRs', async ({ page }) => {
  await seedLists(page, {
    runs: { total: 25 },
    ticketRuns: [
      { kind: 'pr', number: 104 },
      { kind: 'pr', number: 108, status: 'running' },
    ],
  });
  await page.goto(runsUrl());
  await expect(page.getByRole('link', { name: /^Run \d+$/ }).first()).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Pagination' })
    .getByRole('button', { name: 'Page 2', exact: true })
    .first()
    .click();
  await expect(page.getByRole('navigation', { name: 'Pagination' }).first()).toContainText('Showing 21');
  await expect(stateIcon(runRow(page, 1), 'draft')).toBeVisible();
  await expect(stateIcon(runRow(page, 2), 'closed')).toBeVisible();

  // A filter change: the Active list holds PR #108, the Ended list PR #104.
  const filtered = await page.context().newPage();
  await seedLists(filtered, {
    ticketRuns: [
      { kind: 'pr', number: 104 },
      { kind: 'pr', number: 108, status: 'running' },
    ],
  });
  await filtered.goto(runsUrl('?filter=active'));
  await expect(stateIcon(runRow(filtered, 2), 'closed')).toBeVisible();
  await filtered.getByRole('link', { name: /^Ended/ }).click();
  await expect(stateIcon(runRow(filtered, 1), 'draft')).toBeVisible();
});

test('slow: the Runs page shows neutral first, then colours without a reload', async ({ page }) => {
  await setPrStates(page, 'slow');
  await seedLists(page, { ticketRuns: [{ kind: 'pr', number: 106 }] });
  await page.goto(runsUrl());
  await expect(runRow(page, 1)).toBeVisible();
  await expect(stateIcon(runRow(page, 1), 'merged')).toHaveCount(0);
  await expect(stateIcon(runRow(page, 1), 'merged')).toBeVisible({ timeout: 10_000 });
});

for (const scenario of ['error', 'pending'] as const) {
  test(`${scenario}: the Runs page stays neutral, silent, and works`, async ({ page }) => {
    await setPrStates(page, scenario);
    await seedLists(page, { ticketRuns: [{ kind: 'pr', number: 106 }] });
    await page.goto(runsUrl());
    await expect(runRow(page, 1)).toBeVisible();
    await expect(page.getByLabel(/^(Open|Draft|Merged|Closed)$/)).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^Ended/ })).toBeVisible();
  });
}

test('partial: draft and closed stay neutral while the others are coloured', async ({ page }) => {
  await setPrStates(page, 'partial');
  await seedLists(page, { ticketRuns: [...PRS] });
  await page.goto(runsUrl());
  await expect(stateIcon(runRow(page, 1), 'open')).toBeVisible();
  await expect(stateIcon(runRow(page, 3), 'merged')).toBeVisible();
  await expect(runRow(page, 2).getByLabel(/^(Open|Draft|Merged|Closed)$/)).toHaveCount(0);
  await expect(runRow(page, 4).getByLabel(/^(Open|Draft|Merged|Closed)$/)).toHaveCount(0);
});

test('a page with only issues sends no PR-state request', async ({ page }) => {
  const asked = prStatesRequests(page);
  await seedLists(page, {
    ticketRuns: [
      { kind: 'issue', number: 120 },
      { kind: 'issue', number: 121 },
    ],
  });
  await page.goto(runsUrl());
  await expect(runRow(page, 1)).toBeVisible();
  await page.waitForTimeout(500);
  expect(asked).toEqual([]);
});
