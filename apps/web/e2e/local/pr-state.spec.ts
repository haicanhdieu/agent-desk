import { expect, test, type Locator, type Page } from '@playwright/test';
import type { PrState } from '@agentdesk/contracts';
import { API, addFakeTicket, commentOn, runOf, signInAndCreateProject } from './helpers';

/*
 * Local end-to-end for live PR state colours against the real stack (spec
 * docs/superpowers/specs/2026-11-21-show-pr-status-colors-design.md): BR-1 and BR-2 (rows and a PR-led header, flat and
 * grouped), BR-3 and BR-15 (Run detail top bar and Ticket card), BR-5 (an issue keeps its icon), BR-8 (a PR with no
 * state stays neutral), BR-11 (a state changed at the source shows after the cache window) and BR-13 (a run that
 * arrives live is coloured). The stack runs with KUBE_MODE=fake and the fake provider; every test signs in as a new
 * dev-login user, creates its own project and uses random ticket numbers on the shared fake board.
 *
 * Not local, by the spec's Testing section: BR-4 closed-draft (a fake PR has one state; the display precedence is
 * proved by the unit tests), BR-7 (the fake board cannot fail or hang from e2e), BR-10 (GitHub mapping, adapter unit
 * tests), the exact BR-11 60 s window (a timer: the cache unit test with an injected Clock; here the test only polls up
 * to 90 s) and BR-16 (real Ignored rows have no ticket kind, so they stay issue icons).
 *
 * PRs are commented with /code-review and issues with /code-build.
 */

test.describe.configure({ timeout: 300_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

const word = (s: PrState): string => s[0]?.toUpperCase() + s.slice(1);
const STATE_LABEL = /^(Open|Draft|Merged|Closed)$/;
const runsUrl = (handle: string, projectId: string) => `/o/${handle}/p/${projectId}/runs`;
const runRow = (page: Page, n: number): Locator =>
  page.getByRole('row').filter({ has: page.getByRole('link', { name: `Run ${n}`, exact: true }) });
const headerRow = (page: Page, label: RegExp): Locator =>
  page
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name: label }) })
    .filter({ hasNot: page.getByRole('link', { name: /^Run \d+$/ }) });
const stateIcon = (scope: Locator | Page, state: PrState): Locator => scope.getByLabel(word(state), { exact: true });

/** The glyph's computed colour must equal the token's, read from a probe styled with the token. */
async function expectPrColour(icon: Locator, state: PrState): Promise<void> {
  const expected = await icon.page().evaluate((t) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${t})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, `--pr-${state}`);
  await expect(icon).toHaveCSS('color', expected);
}

async function reviewOn(
  page: Page,
  handle: string,
  projectId: string,
  pr: number,
): Promise<{ runId: string; number: number }> {
  const comment = await commentOn(page, projectId, pr, '/code-review', handle);
  expect(comment.runId, `comment outcome ${comment.outcome}`).toBeTruthy();
  const runId = comment.runId ?? '';
  return { runId, number: (await runOf(page, runId)).number };
}

test("Runs rows and a PR-led header show each PR's state; an issue keeps its icon; a PR without a state stays neutral", async ({
  page,
}) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  const states = ['open', 'draft', 'merged', 'closed'] as const;
  const runs: { state: PrState; number: number; run: number }[] = [];
  for (const state of states) {
    const number = await addFakeTicket(page, 'pr', { prState: state });
    runs.push({ state, number, run: (await reviewOn(page, handle, projectId, number)).number });
  }
  const bare = await addFakeTicket(page, 'pr');
  const bareRun = (await reviewOn(page, handle, projectId, bare)).number;
  const issue = await addFakeTicket(page, 'issue');
  const issueComment = await commentOn(page, projectId, issue, '/code-build', handle);
  const issueRun = (await runOf(page, issueComment.runId ?? '')).number;

  await page.goto(runsUrl(handle, projectId));
  await expect(page.getByRole('heading', { name: 'Runs', level: 1 })).toBeVisible();
  await expect(runRow(page, issueRun)).toBeVisible();

  const checkRows = async () => {
    for (const { state, run } of runs) {
      const icon = stateIcon(runRow(page, run), state);
      await expect(icon).toBeVisible();
      await expect(icon.locator('xpath=..')).toHaveAttribute('title', word(state));
      await expectPrColour(icon.locator('xpath=..'), state);
    }
    await expect(runRow(page, bareRun).getByLabel(STATE_LABEL)).toHaveCount(0);
    await expect(runRow(page, bareRun).getByRole('link', { name: new RegExp(`PR #${bare}$`) })).toBeVisible();
    await expect(runRow(page, issueRun).getByLabel(STATE_LABEL)).toHaveCount(0);
  };

  // Grouped by ticket (the default): each PR leads its own group header.
  for (const { state, number } of runs) {
    await expectPrColour(stateIcon(headerRow(page, new RegExp(`PR #${number}$`)), state).locator('xpath=..'), state);
  }
  await expect(headerRow(page, new RegExp(`PR #${bare}$`)).getByLabel(STATE_LABEL)).toHaveCount(0);
  await expect(headerRow(page, new RegExp(`Issue #${issue}$`)).getByLabel(STATE_LABEL)).toHaveCount(0);
  await checkRows();

  // Flat.
  await page.getByRole('button', { name: 'Grouped by ticket' }).click();
  await checkRows();
});

test('Run detail of a PR run shows its state on the top bar and the Ticket card', async ({ page }) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  const pr = await addFakeTicket(page, 'pr', { prState: 'merged' });
  const { number } = await reviewOn(page, handle, projectId, pr);

  await page.goto(`${runsUrl(handle, projectId)}/${number}`);
  const bar = page.getByRole('banner').getByLabel('Merged');
  await expect(bar).toBeVisible();
  await expectPrColour(bar.locator('xpath=..'), 'merged');
  const card = page.getByRole('complementary', { name: 'Run context' }).getByLabel('Merged').first();
  await expect(card).toBeVisible();
  await expectPrColour(card.locator('xpath=..'), 'merged');
});

test('a PR run that arrives live gets its colour', async ({ page }) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  const first = await addFakeTicket(page, 'pr', { prState: 'open' });
  await reviewOn(page, handle, projectId, first);
  await page.goto(runsUrl(handle, projectId));
  await expect(stateIcon(page, 'open').first()).toBeVisible();

  const merged = await addFakeTicket(page, 'pr', { prState: 'merged' });
  const { number } = await reviewOn(page, handle, projectId, merged);
  const icon = stateIcon(runRow(page, number), 'merged');
  await expect(icon).toBeVisible();
  await expectPrColour(icon.locator('xpath=..'), 'merged');
});

test('a PR merged at the source shows purple after the cache window', async ({ page }) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  const pr = await addFakeTicket(page, 'pr', { prState: 'open' });
  const { number } = await reviewOn(page, handle, projectId, pr);
  await page.goto(runsUrl(handle, projectId));
  await expect(stateIcon(runRow(page, number), 'open')).toBeVisible();

  await addFakeTicket(page, 'pr', { number: pr, prState: 'merged' });
  // The API caches a state for 60 s, so reload until the new state shows.
  await expect
    .poll(
      async () => {
        await page.reload();
        await expect(runRow(page, number)).toBeVisible();
        return stateIcon(runRow(page, number), 'merged').count();
      },
      { timeout: 90_000, intervals: [5_000] },
    )
    .toBe(1);
  await expectPrColour(stateIcon(runRow(page, number), 'merged').locator('xpath=..'), 'merged');
});
