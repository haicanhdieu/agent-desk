import { expect, test, type Locator, type Page } from '@playwright/test';
import type { PrState } from '../../src/ds/tokens';
import { INVOICER_API, ORG, seedLists, setPrStates } from './mock';

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
const topBar = (page: Page) => page.getByRole('banner');
const runUrl = (n: number) => `/o/${ORG}/p/${INVOICER_API}/runs/${n}`;
const MERGED_RUN = 62;

test('Run detail on a merged PR: top bar, Ticket card, chain steps and collapsed rail are purple and say "Merged"', async ({
  page,
}) => {
  await page.goto(runUrl(MERGED_RUN));
  const bar = topBar(page).getByLabel('Merged');
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
    const icon = topBar(page).getByLabel(word(state));
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
  await expect(topBar(page).getByLabel(/^(Open|Draft|Merged|Closed)$/)).toHaveCount(0);
  expect(asked).toEqual([]);
});

test('slow: Run detail shows neutral first, then purple without a reload', async ({ page }) => {
  await setPrStates(page, 'slow');
  await page.goto(runUrl(MERGED_RUN));
  await expect(topBar(page).getByLabel('Merged')).toHaveCount(0);
  await expect(topBar(page).getByLabel('Merged')).toBeVisible({ timeout: 10_000 });
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
