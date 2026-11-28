import { randomInt, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { RunListResponse, type RunDto } from '@agentdesk/contracts';
import { API, CommentResult, ok, runHeader, runOf, signInAs, waitForStatus } from './helpers';
import {
  REPO_P1,
  REPO_P2,
  buildCast,
  disposeCast,
  disposeSecondOrg,
  secondOrg,
  type Actor,
  type Cast,
} from './rbac-cast';

/*
 * Run usage and cost through the real pipeline: fake pod -> runner usage lines -> worker -> Postgres -> API -> UI (spec
 * docs/superpowers/specs/2026-11-24-run-token-usage-cost-design.md, "E2E requirements": TC-7.1, TC-7.2, TC-8.1 to
 * TC-8.3, TC-9.1 to TC-9.3, TC-10.2 to TC-10.5, TC-13.1, TC-13.2). Needs the stack with MODEL_PRICES_SOURCE=fake (the
 * `.env.example` default). A run started with the fake pod flag `--fake-usage` records 3050 tokens in its first turn
 * (fake-model-a 2500, fake-model-b 550); every later turn adds 240. A fresh org and project per case; runs are
 * cancelled in `afterEach`.
 */
test.describe.configure({ timeout: 300_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

const FIRST_TURN = { total: 3050, modelA: 2500, modelB: 550 };
const LATER_TURN = 240;

let cast: Cast;
/** The cast to dispose: unset until a build succeeded, and again after its disposal. */
let built: Cast | undefined;
const startedRuns: string[] = [];
let second: Awaited<ReturnType<typeof secondOrg>> | undefined;

test.beforeEach(async ({ browser }) => {
  built = undefined;
  built = await buildCast(browser);
  cast = built;
});

test.afterEach(async () => {
  for (const runId of startedRuns.splice(0)) {
    await cast.o.api.post(`/api/runs/${runId}/cancel`).catch(() => null);
  }
  const other = second;
  second = undefined;
  if (other) await disposeSecondOrg(other);
  const done = built;
  built = undefined;
  if (done) await disposeCast(done);
});

/** Starts a run with the fake pod flags on a new pull request of `repoPath` as `who` and waits until it is `status`. */
async function startUsageRun(
  who: Actor,
  projectId: string,
  repoPath: string,
  flags: string,
  status: RunDto['status'] = 'idle',
): Promise<string> {
  const ticketNumber = randomInt(100_000, 1_000_000_000);
  await ok(
    await who.api.post('/dev/fake/tickets', {
      data: { repoPath, number: ticketNumber, kind: 'pr', title: `usage ${who.handle}` },
    }),
    201,
    'fake ticket',
  );
  const comment = CommentResult.parse(
    await ok(
      await who.api.post('/dev/fake/comments', {
        data: {
          repoPath,
          ticketNumber,
          body: `/rbac-run ${flags}`,
          deliver: 'webhook',
          projectId,
          author: who.handle,
        },
      }),
      201,
      'fake comment',
    ),
  );
  expect(comment.runId, `comment outcome ${comment.outcome}`).toBeTruthy();
  const runId = comment.runId ?? '';
  startedRuns.push(runId);
  await waitForStatus(who.page, runId, status, 90_000);
  return runId;
}

/** The run's usage as the API shows it (throws the test when the run has none yet). */
async function usageOf(who: Actor, runId: string) {
  const { usage } = await runOf(who.page, runId);
  expect(usage, 'the run has recorded usage').not.toBeNull();
  if (usage === null) throw new Error('unreachable');
  return usage;
}

/** Polls the API until the run's total is `total`. */
async function waitForTotal(who: Actor, runId: string, total: number): Promise<void> {
  await expect
    .poll(async () => (await runOf(who.page, runId)).usage?.totalTokens ?? 0, {
      timeout: 60_000,
      intervals: [200, 500, 1000],
    })
    .toBe(total);
}

const panel = (page: Page) => page.getByRole('complementary', { name: 'Run context' });
const usageSection = (page: Page) =>
  panel(page)
    .locator('section')
    .filter({ has: page.getByText('Usage', { exact: true }) });
const pill = (page: Page, label: string) => runHeader(page).getByText(label, { exact: true });
const liveTerminal = (page: Page) => page.getByRole('group', { name: 'Claude Code terminal' });
const area = (page: Page) => page.getByRole('region', { name: /^(Terminal|Transcript)$/ });

/** A problem body without its per-request id, which is the only thing that differs between two not-found answers. */
const withoutRequestId = (body: string): string => body.replace(/"requestId":"[^"]*"/, '');

const exact = (n: number): string => n.toLocaleString('en-US');

/** How long the route's loading status may stay up: a first request of a user outside the org can exceed the default 5 s. */
const ROUTE_SETTLE_MS = 30_000;

/**
 * Opens `path`, waits for the not found page (the loading status must be gone, so the text is the settled page), then
 * returns the page text.
 */
async function notFoundTextOf(page: Page, path: string): Promise<string> {
  await page.goto(path);
  await expect(page.getByText('Page not found')).toBeVisible({ timeout: ROUTE_SETTLE_MS });
  await expect(page.getByRole('status', { name: 'Loading' })).toBeHidden();
  return page.locator('body').innerText();
}

async function openDetail(page: Page, projectId: string, runId: string): Promise<void> {
  const run = await runOf(page, runId);
  await page.goto(`/o/${cast.slug}/p/${projectId}/runs/${run.number}`);
  await expect(panel(page)).toBeVisible({ timeout: ROUTE_SETTLE_MS });
  await expect(page.getByRole('status', { name: 'Loading' })).toBeHidden();
}

/** The value next to a label in the Usage section's list. */
async function rowValue(page: Page, label: string): Promise<string> {
  const row = usageSection(page)
    .locator('dl > div')
    .filter({ has: page.getByText(label, { exact: true }) });
  return ((await row.locator('dd').first().textContent()) ?? '').trim();
}

/** The headline total: the value of the section's first row. */
const totalShown = async (page: Page): Promise<string> =>
  ((await usageSection(page).locator('dl > div').first().locator('dd').first().textContent()) ?? '').trim();

/** What the detail's Usage section shows: total, split, cost and the per-model rows. */
async function detailSnapshot(page: Page) {
  await expect(usageSection(page).getByText('Total tokens')).toBeVisible();
  return {
    total: await totalShown(page),
    input: await rowValue(page, 'Input (uncached)'),
    cacheRead: await rowValue(page, 'Cache read'),
    cacheWrite: await rowValue(page, 'Cache write'),
    output: await rowValue(page, 'Output'),
    cost: await rowValue(page, 'Est. cost'),
    models: await usageSection(page).getByRole('table', { name: 'Usage by model' }).locator('tbody tr').allInnerTexts(),
  };
}

/** The Usage cell of a run's row on the project's Runs list: its first text node and hover title. */
async function listCell(page: Page, projectId: string, number: number) {
  await page.goto(`/o/${cast.slug}/p/${projectId}/runs`);
  const link = page.getByRole('link', { name: new RegExp(`^Run ${number}\\b`) });
  await expect(link).toBeVisible({ timeout: 30_000 });
  const heads = await page.getByRole('columnheader').allTextContents();
  const col = heads.findIndex((h) => h.trim() === 'Usage');
  expect(col, 'the Runs list has a Usage column').toBeGreaterThanOrEqual(0);
  const cell = page.getByRole('row').filter({ has: link }).getByRole('cell').nth(col);
  await expect(cell).toBeVisible();
  return {
    text: await cell.evaluate((el) => el.firstChild?.textContent ?? ''),
    title: await cell.getAttribute('title'),
  };
}

/** The text of the Runs list of `projectId` in `orgSlug` as `who` sees it, once its own rows have loaded. */
async function runsListText(who: Actor, orgSlug: string, projectId: string): Promise<string> {
  await who.page.goto(`/o/${orgSlug}/p/${projectId}/runs`);
  await expect(who.page.getByRole('link', { name: /^Run \d+\b/ }).first()).toBeVisible({ timeout: 30_000 });
  return who.page.locator('body').innerText();
}

/** Types a line into the live terminal of the open run page; the fake pod answers it with one more 240-token call. */
async function typeLine(page: Page, line: string): Promise<void> {
  const terminal = liveTerminal(page);
  await expect(terminal).toContainText('Fake Claude Code', { timeout: 15_000 });
  await terminal.click();
  await page.keyboard.type(line);
  await page.keyboard.press('Enter');
}

/** A done run (`--fake-usage --fake-done`) finished, reopened, one line typed and closed again: succeeded with 3290. */
async function reopenedAndClosed(): Promise<{ runId: string; number: number }> {
  const { o } = cast;
  const runId = await startUsageRun(o, cast.p1, REPO_P1, '--fake-usage --fake-done', 'done');
  await waitForTotal(o, runId, FIRST_TURN.total);
  await openDetail(o.page, cast.p1, runId);
  await runHeader(o.page).getByRole('button', { name: 'Finish run' }).click();
  await expect(pill(o.page, 'Succeeded')).toBeVisible({ timeout: 60_000 });
  const reopen = o.page.getByRole('button', { name: 'Reopen session' });
  await expect(reopen).toBeEnabled({ timeout: 30_000 });
  await reopen.click();
  await expect(pill(o.page, 'Succeeded · Session open')).toBeVisible({ timeout: 60_000 });
  await typeLine(o.page, 'one more step');
  await waitForTotal(o, runId, FIRST_TURN.total + LATER_TURN);
  const close = runHeader(o.page).getByRole('button', { name: 'Close session' });
  await expect(close).toBeEnabled({ timeout: 60_000 });
  await close.click();
  await expect(pill(o.page, 'Succeeded')).toBeVisible({ timeout: 90_000 });
  await waitForStatus(o.page, runId, 'succeeded');
  const run = await runOf(o.page, runId);
  return { runId, number: run.number };
}

test('TC-7.1: a message written as several rows is counted once, at its final counts, and a cost shows', async () => {
  const { o } = cast;
  const runId = await startUsageRun(o, cast.p1, REPO_P1, '--fake-usage');
  await waitForTotal(o, runId, FIRST_TURN.total);
  const usage = await usageOf(o, runId);
  expect(usage.totalTokens).toBe(FIRST_TURN.total);
  expect(usage.estimatedCostUsd, 'a cost is shown').not.toBeNull();

  await openDetail(o.page, cast.p1, runId);
  const shown = await detailSnapshot(o.page);
  expect(shown.total).toBe(exact(FIRST_TURN.total));
  expect(shown.cost).toMatch(/^~/);
});

test('TC-7.2: one Models row per model, the retry counts as a separate call, and the rows add up to the total', async () => {
  const { o } = cast;
  const runId = await startUsageRun(o, cast.p1, REPO_P1, '--fake-usage');
  await waitForTotal(o, runId, FIRST_TURN.total);
  const usage = await usageOf(o, runId);
  expect(usage.models).toHaveLength(2);
  const tokensOf = (name: string): number => usage.models.find((m) => m.model === name)?.totalTokens ?? -1;
  expect(tokensOf('fake-model-a')).toBe(FIRST_TURN.modelA);
  expect(tokensOf('fake-model-b')).toBe(FIRST_TURN.modelB);
  expect(usage.models.reduce((sum, m) => sum + m.totalTokens, 0)).toBe(usage.totalTokens);

  await openDetail(o.page, cast.p1, runId);
  const rows = usageSection(o.page).getByRole('table', { name: 'Usage by model' }).locator('tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: 'fake-model-a' })).toContainText(exact(FIRST_TURN.modelA));
  await expect(rows.filter({ hasText: 'fake-model-b' })).toContainText(exact(FIRST_TURN.modelB));
});

test('TC-8.1: a run stopped and resumed without a reply keeps its total, not reset and not doubled', async () => {
  const { o } = cast;
  const runId = await startUsageRun(o, cast.p1, REPO_P1, '--fake-usage');
  await waitForTotal(o, runId, FIRST_TURN.total);
  await openDetail(o.page, cast.p1, runId);
  await expect(liveTerminal(o.page)).toContainText('Fake Claude Code', { timeout: 15_000 });

  await runHeader(o.page).getByRole('button', { name: 'Stop session' }).click();
  await expect(o.page.getByText(/^Stopped: can be resumed for /)).toBeVisible({ timeout: 60_000 });
  expect((await runOf(o.page, runId)).usage?.totalTokens, 'while stopped').toBe(FIRST_TURN.total);

  await area(o.page).getByRole('button', { name: 'Resume' }).click();
  await expect(liveTerminal(o.page)).toContainText('Fake Claude Code', { timeout: 60_000 });
  await waitForStatus(o.page, runId, 'idle', 90_000);
  expect((await runOf(o.page, runId)).usage?.totalTokens, 'after the resume').toBe(FIRST_TURN.total);

  await openDetail(o.page, cast.p1, runId);
  expect((await detailSnapshot(o.page)).total).toBe(exact(FIRST_TURN.total));
});

test('TC-8.2: a reopened session adds only its own calls and the run ends succeeded', async () => {
  const { runId } = await reopenedAndClosed();
  const run = await runOf(cast.o.page, runId);
  expect(run.status).toBe('succeeded');
  expect(run.usage?.totalTokens).toBe(FIRST_TURN.total + LATER_TURN);
  await openDetail(cast.o.page, cast.p1, runId);
  await expect(pill(cast.o.page, 'Succeeded')).toBeVisible();
  expect((await detailSnapshot(cast.o.page)).total).toBe(exact(FIRST_TURN.total + LATER_TURN));
});

test('TC-8.3: after the reopened run ended, a reload shows the same total, split and cost', async () => {
  const { o } = cast;
  const { runId } = await reopenedAndClosed();
  await openDetail(o.page, cast.p1, runId);
  const before = await detailSnapshot(o.page);
  const apiBefore = await usageOf(o, runId);

  await o.page.reload();
  await expect(panel(o.page)).toBeVisible();
  expect(await detailSnapshot(o.page)).toEqual(before);
  expect(await usageOf(o, runId)).toEqual(apiBefore);
});

test('TC-9.1: while the run is active its total is a number so far and a later read and a reload show more', async () => {
  const { o } = cast;
  const runId = await startUsageRun(o, cast.p1, REPO_P1, '--fake-usage');
  await waitForTotal(o, runId, FIRST_TURN.total);
  await openDetail(o.page, cast.p1, runId);
  expect(await totalShown(o.page)).toBe(exact(FIRST_TURN.total));

  await typeLine(o.page, 'step 1');
  await expect
    .poll(async () => (await runOf(o.page, runId)).usage?.totalTokens ?? 0, { timeout: 60_000 })
    .toBe(FIRST_TURN.total + LATER_TURN);
  expect((await runOf(o.page, runId)).status).not.toBe('succeeded');

  // The open page (no goto, no reload) shows the larger number on the existing run refetch: the detail query refetches
  // on window focus once it is older than its 30 s staleTime, so each poll round signals a return to the tab.
  await expect
    .poll(
      async () => {
        await o.page.evaluate(() => {
          window.dispatchEvent(new Event('visibilitychange'));
        });
        return totalShown(o.page);
      },
      { timeout: 90_000, intervals: [1_000, 2_000, 5_000] },
    )
    .toBe(exact(FIRST_TURN.total + LATER_TURN));

  await o.page.reload();
  await expect(panel(o.page)).toBeVisible();
  await expect(
    usageSection(o.page)
      .getByText(exact(FIRST_TURN.total + LATER_TURN), { exact: true })
      .first(),
  ).toBeVisible();
  expect(await totalShown(o.page)).toBe(exact(FIRST_TURN.total + LATER_TURN));
});

test('TC-9.2: a finished run is succeeded and still shows the usage it recorded', async () => {
  const { o } = cast;
  const runId = await startUsageRun(o, cast.p1, REPO_P1, '--fake-usage --fake-done', 'done');
  await waitForTotal(o, runId, FIRST_TURN.total);
  await openDetail(o.page, cast.p1, runId);
  await runHeader(o.page).getByRole('button', { name: 'Finish run' }).click();
  await expect(pill(o.page, 'Succeeded')).toBeVisible({ timeout: 60_000 });
  await waitForStatus(o.page, runId, 'succeeded');

  const run = await runOf(o.page, runId);
  expect(run.usage?.totalTokens).toBeGreaterThanOrEqual(FIRST_TURN.total);
  await openDetail(o.page, cast.p1, runId);
  await expect(usageSection(o.page).getByText('No usage data for this run.')).toHaveCount(0);
  expect(await totalShown(o.page)).toBe(exact(run.usage?.totalTokens ?? -1));
});

test('TC-9.3: a cancelled run keeps its usage on the detail and on the Runs list', async () => {
  const { o } = cast;
  const runId = await startUsageRun(o, cast.p1, REPO_P1, '--fake-usage');
  await waitForTotal(o, runId, FIRST_TURN.total);
  await ok(await o.api.post(`/api/runs/${runId}/cancel`), 202, 'cancel');
  await waitForStatus(o.page, runId, 'cancelled', 90_000);

  const run = await runOf(o.page, runId);
  expect(run.usage?.totalTokens).toBe(FIRST_TURN.total);
  await openDetail(o.page, cast.p1, runId);
  await expect(pill(o.page, 'Cancelled')).toBeVisible();
  expect(await totalShown(o.page)).toBe(exact(FIRST_TURN.total));
  const cell = await listCell(o.page, cast.p1, run.number);
  expect(cell.text).toMatch(/^3\.[01]k · ~/); // 3050 tokens: 3.1k by decimal rounding, 3.0k by toFixed on the binary 3.05
});

test('TC-10.2: an org viewer sees the usage cell on the Runs list and the Usage section on the run', async () => {
  const { o, v } = cast;
  const runId = await startUsageRun(o, cast.p1, REPO_P1, '--fake-usage');
  await waitForTotal(o, runId, FIRST_TURN.total);
  const run = await runOf(v.page, runId);

  const cell = await listCell(v.page, cast.p1, run.number);
  expect(cell.text).toMatch(/^\d+(\.\d)?k · ~/);
  await openDetail(v.page, cast.p1, runId);
  const shown = await detailSnapshot(v.page);
  expect(shown.total).toBe(exact(FIRST_TURN.total));
  expect(shown.cost).toMatch(/^~/);
});

test('TC-10.3: the owner, an admin and a member see the same usage and cost', async () => {
  const { o, a, b } = cast;
  const runId = await startUsageRun(o, cast.p1, REPO_P1, '--fake-usage');
  await waitForTotal(o, runId, FIRST_TURN.total);

  const seen = [];
  for (const who of [o, a, b]) {
    await openDetail(who.page, cast.p1, runId);
    seen.push({ ui: await detailSnapshot(who.page), api: await usageOf(who, runId) });
  }
  expect(seen[1]).toEqual(seen[0]);
  expect(seen[2]).toEqual(seen[0]);
  expect(seen[0]?.ui.total).toBe(exact(FIRST_TURN.total));
});

test('TC-10.4: an admin of P1 only gets the same not found for a P2 run as for a missing run, and no P2 rows in P1', async () => {
  const { o, a } = cast;
  const runId = await startUsageRun(o, cast.p2, REPO_P2, '--fake-usage');
  await waitForTotal(o, runId, FIRST_TURN.total);
  const run = await runOf(o.page, runId);

  const notFoundText = (number: number): Promise<string> =>
    notFoundTextOf(a.page, `/o/${cast.slug}/p/${cast.p2}/runs/${number}`);
  const real = await notFoundText(run.number);
  const missing = await notFoundText(run.number + 100_000);
  expect(real).toBe(missing);
  expect(real).not.toContain(exact(FIRST_TURN.total));

  const hit = await a.api.get(`/api/runs/${runId}`);
  const none = await a.api.get(`/api/runs/${randomUUID()}`);
  expect(hit.status()).toBe(404);
  expect(none.status()).toBe(404);
  expect(withoutRequestId(await hit.text())).toBe(withoutRequestId(await none.text()));

  const list = RunListResponse.parse(
    await ok(await a.api.get(`/api/projects/${cast.p1}/runs?filter=all&pageSize=100`), 200, 'runs.list P1'),
  );
  expect(list.items.map((r) => r.id)).not.toContain(runId);
  expect(list.items.length, 'P1 still lists its own runs').toBeGreaterThan(0);

  expect(await runsListText(a, cast.slug, cast.p1)).not.toMatch(/3\.[01]k/);
});

test('TC-10.5: a user of another org gets the same not found as for a missing run and sees no usage of org A', async ({
  browser,
}) => {
  const { o, pa } = cast;
  const runId = await startUsageRun(o, cast.p1, REPO_P1, '--fake-usage');
  await waitForTotal(o, runId, FIRST_TURN.total);
  const run = await runOf(o.page, runId);
  second = await secondOrg(browser, pa);
  const y = second.owner;

  const notFoundText = (number: number): Promise<string> =>
    notFoundTextOf(y.page, `/o/${cast.slug}/p/${cast.p1}/runs/${number}`);
  const real = await notFoundText(run.number);
  const missing = await notFoundText(run.number + 100_000);
  expect(real).toBe(missing);
  expect(real).not.toContain(exact(FIRST_TURN.total));

  const hit = await y.api.get(`/api/runs/${runId}`);
  const none = await y.api.get(`/api/runs/${randomUUID()}`);
  expect(hit.status()).toBe(404);
  expect(none.status()).toBe(404);
  expect(withoutRequestId(await hit.text())).toBe(withoutRequestId(await none.text()));

  const list = RunListResponse.parse(
    await ok(await y.api.get(`/api/projects/${second.project}/runs?filter=all&pageSize=100`), 200, 'runs.list org B'),
  );
  expect(list.items.map((r) => r.id)).not.toContain(runId);
  expect(list.items.length, 'org B still lists its own runs').toBeGreaterThan(0);

  expect(await runsListText(y, second.slug, second.project)).not.toMatch(/3\.[01]k/);
});

test('TC-13.1: reloading the Runs list and the run shows the same usage cell, numbers and cost', async () => {
  const { o } = cast;
  const runId = await startUsageRun(o, cast.p1, REPO_P1, '--fake-usage --fake-done', 'done');
  await waitForTotal(o, runId, FIRST_TURN.total);
  await openDetail(o.page, cast.p1, runId);
  await runHeader(o.page).getByRole('button', { name: 'Finish run' }).click();
  await waitForStatus(o.page, runId, 'succeeded');
  const run = await runOf(o.page, runId);

  const cellBefore = await listCell(o.page, cast.p1, run.number);
  await openDetail(o.page, cast.p1, runId);
  const detailBefore = await detailSnapshot(o.page);

  await o.page.goto(`/o/${cast.slug}/p/${cast.p1}/runs`);
  await o.page.reload();
  expect(await listCell(o.page, cast.p1, run.number)).toEqual(cellBefore);
  await openDetail(o.page, cast.p1, runId);
  await o.page.reload();
  await expect(panel(o.page)).toBeVisible();
  expect(await detailSnapshot(o.page)).toEqual(detailBefore);
});

test('TC-13.2: a new browser session of the same user sees equal numbers and cost', async ({ browser }) => {
  const { o } = cast;
  const runId = await startUsageRun(o, cast.p1, REPO_P1, '--fake-usage --fake-done', 'done');
  await waitForTotal(o, runId, FIRST_TURN.total);
  await openDetail(o.page, cast.p1, runId);
  await runHeader(o.page).getByRole('button', { name: 'Finish run' }).click();
  await waitForStatus(o.page, runId, 'succeeded');
  const run = await runOf(o.page, runId);
  const cellFirst = await listCell(o.page, cast.p1, run.number);
  await openDetail(o.page, cast.p1, runId);
  const detailFirst = await detailSnapshot(o.page);

  const ctx = await browser.newContext();
  try {
    const page = await signInAs(ctx, o.handle);
    await expect(page.getByRole('banner')).toBeVisible({ timeout: 30_000 });
    expect(await listCell(page, cast.p1, run.number)).toEqual(cellFirst);
    await openDetail(page, cast.p1, runId);
    expect(await detailSnapshot(page)).toEqual(detailFirst);
  } finally {
    await ctx.close();
  }
});
