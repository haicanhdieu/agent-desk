import { expect, test, type Page } from '@playwright/test';
import { API, addFakeTicket, cancelRun, commentOn, commentOnNewTicket, ok, signInAndCreateProject } from './helpers';

/*
 * Local end-to-end for issue and PR runs grouped together on the Runs page against the real stack (spec
 * docs/superpowers/specs/2026-11-21-group-issue-pr-runs-design.md, "E2E requirements": BR-1, 2, 3, 9, 12, 13, 14, 16 and
 * 20). The stack runs with KUBE_MODE=fake and the fake provider. Every test signs in as a new dev-login user, creates its
 * own project and uses random ticket numbers on the shared fake board, and asserts only inside its project.
 *
 * BR-10 and BR-15 are "Not e2e": the GitHub adapter test (plan Task 4) and the intake int tests (plan Task 6) prove them,
 * as the spec's `## Testing` says.
 *
 * Issues are commented with /code-build and PRs with /code-review. A second run of one skill on a ticket is refused
 * while one is active, so a test cancels that ticket's previous run before it comments on the ticket again (the
 * cancelled run still counts toward the ticket's runs).
 */

test.describe.configure({ timeout: 300_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

const LIMIT_TEXT = 'Ticket reached its run limit';

interface Group {
  /** The lead ticket as the header shows it, e.g. "Issue #142" or "PR #148". */
  lead: string;
  /** The chain note ("" when the header has none) and its `title` tooltip. */
  chain: string;
  chainTitle: string;
  /** The header's text without the chain note: where "N of 10 runs" shows on the right. */
  rest: string;
  /** Each run row's Ticket column text, in order, e.g. ["#142", "PR #148"]. */
  runs: string[];
}

const runsUrl = (handle: string, projectId: string) => `/o/${handle}/p/${projectId}/runs`;
const runRows = (page: Page) => page.getByRole('row').filter({ has: page.getByRole('link', { name: /^Run \d+$/ }) });

/** The groups on the page in DOM order: each header row with the run rows under it. */
async function readGroups(page: Page): Promise<Group[]> {
  return page.evaluate(() => {
    const groups: Group[] = [];
    for (const tr of Array.from(document.querySelectorAll('main tbody tr'))) {
      const isRun = Array.from(tr.querySelectorAll('a')).some((a) => /^Run \d+$/.test((a.textContent ?? '').trim()));
      if (isRun) {
        const ticket = (tr.querySelectorAll('td')[2]?.textContent ?? '').trim();
        groups[groups.length - 1]?.runs.push(ticket.match(/^(?:PR )?#\d+/)?.[0] ?? ticket);
        continue;
      }
      if (!tr.querySelector('td[colspan]')) continue;
      const text = (tr as HTMLElement).innerText;
      const chainEl = Array.from(tr.querySelectorAll('span')).find(
        (s) => (s.textContent ?? '').includes('→') && !s.querySelector('span'),
      );
      const chain = (chainEl?.textContent ?? '').trim();
      groups.push({
        lead: text.match(/^\s*(?:Issue|PR) #\d+/)?.[0].trim() ?? '',
        chain,
        chainTitle: chainEl?.getAttribute('title') ?? '',
        rest: chain ? text.replace(chain, '') : text,
        runs: [],
      });
    }
    return groups;
  });
}

/** Opens the Runs page and waits until it lists `count` run rows; returns its groups. */
async function openRuns(page: Page, handle: string, projectId: string, count: number): Promise<Group[]> {
  await page.goto(runsUrl(handle, projectId));
  await expect(page.getByRole('heading', { name: 'Runs', level: 1 })).toBeVisible();
  await expect(runRows(page)).toHaveCount(count);
  return readGroups(page);
}

async function setRunLimit(page: Page, projectId: string, maxRunsPerTicket: number) {
  await ok(await page.request.patch(`/api/projects/${projectId}`, { data: { maxRunsPerTicket } }), 200, 'run limit');
}

/** Comments `body` on the ticket and returns the run it created. */
async function runOn(page: Page, projectId: string, ticket: number, body: string): Promise<string> {
  const comment = await commentOn(page, projectId, ticket, body);
  expect(comment.runId, `comment outcome ${comment.outcome}`).toBeTruthy();
  return comment.runId ?? '';
}

const buildOn = (page: Page, projectId: string, issue: number) => runOn(page, projectId, issue, '/code-build');
const reviewOn = (page: Page, projectId: string, pr: number) => runOn(page, projectId, pr, '/code-review');

/** Opens the Ignored list and waits for it to load: with `shown`, until a "Ticket reached its run limit" row is there; without, until the counts are in. */
async function ignoredShowsLimit(page: Page, handle: string, projectId: string, shown: boolean) {
  await page.goto(`${runsUrl(handle, projectId)}?filter=ignored`);
  await expect(page.getByRole('heading', { name: 'Runs', level: 1 })).toBeVisible();
  const main = page.getByRole('main');
  await expect(main.getByRole('link', { name: /^Ignored\s*[\d,]+$/ })).toBeVisible();
  if (shown) await expect(main.getByText(LIMIT_TEXT).first()).toBeVisible();
  else {
    // The project is new and every comment in it started a run, so the loaded list is empty: its empty state proves it loaded.
    await expect(main.getByRole('heading', { name: 'Ignored commands' })).toBeVisible();
    await expect(main.getByText('No ignored commands')).toBeVisible();
    await expect(main.getByText(LIMIT_TEXT)).toHaveCount(0);
  }
}

/** Given: an issue with a run, and a PR linked to it (`linked: [issue]`) with a run. Returns the numbers and run ids. */
async function linkedPair(page: Page, projectId: string) {
  const issue = await addFakeTicket(page, 'issue');
  const issueRun = await buildOn(page, projectId, issue);
  const pr = await addFakeTicket(page, 'pr', { linked: [issue] });
  const prRun = await reviewOn(page, projectId, pr);
  return { issue, issueRun, pr, prRun };
}

// ---- BR-1: an issue and the PRs linked to it share one group ----

test.describe('BR-1: one group for an issue and its linked PR runs', () => {
  test('TC-1.2: a comment on a PR linked to a commented issue lands in the issue-led group', async ({ page }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const { issue, pr } = await linkedPair(page, projectId);

    const groups = await openRuns(page, handle, projectId, 2);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.lead).toBe(`Issue #${issue}`);
    expect(groups[0]?.runs).toEqual([`#${issue}`, `PR #${pr}`]);
  });
});

// ---- BR-2: each ticket's own count in the chain note ----

test.describe('BR-2: the chain note counts each ticket on its own', () => {
  test('TC-2.3: a second PR run raises only the PR count; nothing on the right', async ({ page }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const { issue, pr, prRun } = await linkedPair(page, projectId);
    await cancelRun(page, prRun);
    await reviewOn(page, projectId, pr);

    const groups = await openRuns(page, handle, projectId, 3);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.chain).toBe(`Issue #${issue} (1 of 10 runs) → PR #${pr} (2 of 10 runs)`);
    expect(groups[0]?.rest).not.toMatch(/\d+ of \d+ runs/);
  });
});

// ---- BR-3: the issue-led header on every page ----

test.describe('BR-3: a page holding only the PR runs is still led by the issue', () => {
  test('TC-3.3: the issue run falls on page 2, the PR run on page 1 under the issue-led header', async ({ page }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const issue = await addFakeTicket(page, 'issue');
    await buildOn(page, projectId, issue);
    for (let i = 0; i < 20; i++) await commentOnNewTicket(page, handle, projectId, '/code-review');
    const pr = await addFakeTicket(page, 'pr', { linked: [issue] });
    await reviewOn(page, projectId, pr);

    // 22 runs, newest first, 20 to a page: the PR run is on page 1 and the issue's run on page 2.
    await page.goto(runsUrl(handle, projectId));
    await expect(runRows(page)).toHaveCount(20);
    const merged = (await readGroups(page)).filter((g) => g.chain.includes(`PR #${pr} `));

    expect(merged).toHaveLength(1);
    expect(merged[0]?.lead).toBe(`Issue #${issue}`);
    expect(merged[0]?.chain).toBe(`Issue #${issue} (1 of 10 runs) → PR #${pr} (1 of 10 runs)`);
    expect(merged[0]?.runs).toEqual([`PR #${pr}`]);
  });
});

// ---- BR-9: the run limit counts per ticket ----

test.describe('BR-9: the run limit stays per ticket', () => {
  test('TC-9.1: a PR at its limit gets no third run, though its issue is in the group', async ({ page }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    await setRunLimit(page, projectId, 2);
    const { pr, prRun } = await linkedPair(page, projectId);
    await cancelRun(page, prRun);
    const second = await reviewOn(page, projectId, pr);
    await cancelRun(page, second);

    const third = await commentOn(page, projectId, pr, '/code-review');

    expect(third.outcome).toBe('ignored_max_runs');
    await ignoredShowsLimit(page, handle, projectId, true);
    await page.goto(runsUrl(handle, projectId));
    await expect(runRows(page)).toHaveCount(3);
    expect((await readGroups(page)).flatMap((g) => g.runs).filter((t) => t === `PR #${pr}`)).toHaveLength(2);
  });

  test('TC-9.2: the issue still gets a run when the PR is at its limit', async ({ page }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    await setRunLimit(page, projectId, 2);
    const { issue, issueRun, pr, prRun } = await linkedPair(page, projectId);
    await cancelRun(page, prRun);
    const second = await reviewOn(page, projectId, pr);
    await cancelRun(page, second);
    await cancelRun(page, issueRun);

    const comment = await commentOn(page, projectId, issue, '/code-build');

    expect(comment.outcome).toBe('run_created');
    const groups = await openRuns(page, handle, projectId, 4);
    expect(groups[0]?.chain).toBe(`Issue #${issue} (2 of 2 runs) → PR #${pr} (2 of 2 runs)`);
    await ignoredShowsLimit(page, handle, projectId, false);
  });

  test('TC-9.3: an issue at its limit gets no third run, though the linked PR has runs left', async ({ page }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    await setRunLimit(page, projectId, 2);
    const { issue, issueRun } = await linkedPair(page, projectId);
    await cancelRun(page, issueRun);
    const second = await buildOn(page, projectId, issue);
    await cancelRun(page, second);

    const third = await commentOn(page, projectId, issue, '/code-build');

    expect(third.outcome).toBe('ignored_max_runs');
    await ignoredShowsLimit(page, handle, projectId, true);
    await page.goto(runsUrl(handle, projectId));
    await expect(runRows(page)).toHaveCount(3);
    expect((await readGroups(page)).flatMap((g) => g.runs).filter((t) => t === `#${issue}`)).toHaveLength(2);
  });
});

// ---- BR-12: a link to an issue without runs does not group ----

test.describe('BR-12: an issue without runs does not lead a group', () => {
  test('TC-12.2: the PR keeps its own group with its own count on the right', async ({ page }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const issue = await addFakeTicket(page, 'issue');
    const pr = await addFakeTicket(page, 'pr', { linked: [issue] });
    await reviewOn(page, projectId, pr);

    const groups = await openRuns(page, handle, projectId, 1);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.lead).toBe(`PR #${pr}`);
    expect(groups[0]?.rest).toContain('1 of 10 runs');
    expect(groups[0]?.chain).toBe('');
    expect(groups.some((g) => g.lead === `Issue #${issue}`)).toBe(false);
  });
});

// ---- BR-13 and BR-14: either side of the link groups the runs ----

test.describe('BR-13: the link on the PR side (its description)', () => {
  test('TC-13.1: a PR naming the issue lands under the issue though the issue lists no PR', async ({ page }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const issue = await addFakeTicket(page, 'issue');
    await buildOn(page, projectId, issue);
    const pr = await addFakeTicket(page, 'pr', { linked: [issue] });
    await reviewOn(page, projectId, pr);

    const groups = await openRuns(page, handle, projectId, 2);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.lead).toBe(`Issue #${issue}`);
    expect(groups[0]?.runs).toEqual([`#${issue}`, `PR #${pr}`]);
    expect(groups[0]?.chain).toContain(`PR #${pr} (1 of 10 runs)`);
  });
});

test.describe('BR-14: the link on the issue side (its linked PRs)', () => {
  test('TC-14.1: an issue listing the PR groups it though the PR names nothing', async ({ page }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const issue = await addFakeTicket(page, 'issue');
    await buildOn(page, projectId, issue);
    const pr = await addFakeTicket(page, 'pr');
    await addFakeTicket(page, 'issue', { number: issue, linked: [pr] });
    await reviewOn(page, projectId, pr);

    const groups = await openRuns(page, handle, projectId, 2);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.lead).toBe(`Issue #${issue}`);
    expect(groups[0]?.runs).toEqual([`#${issue}`, `PR #${pr}`]);
    expect(groups[0]?.chain).toContain(`PR #${pr} (1 of 10 runs)`);
  });
});

// ---- BR-16 and BR-20: a link added later regroups only the new run ----

/** Given: an issue with a run; a PR with no link and one cancelled run. Then the link is added and the PR commented again. */
async function linkAddedLater(page: Page, projectId: string) {
  const issue = await addFakeTicket(page, 'issue');
  await buildOn(page, projectId, issue);
  const pr = await addFakeTicket(page, 'pr');
  const first = await reviewOn(page, projectId, pr);
  await cancelRun(page, first);
  return {
    issue,
    pr,
    link: async () => {
      await addFakeTicket(page, 'pr', { number: pr, linked: [issue] });
      await reviewOn(page, projectId, pr);
    },
  };
}

test.describe('BR-16: a link added later does not move earlier runs', () => {
  test('TC-16.2: run 1 stays in the PR group, run 2 joins the issue group', async ({ page }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const { issue, pr, link } = await linkAddedLater(page, projectId);
    await link();

    const groups = await openRuns(page, handle, projectId, 3);

    expect(groups).toHaveLength(2);
    const own = groups.find((g) => g.lead === `PR #${pr}`);
    const merged = groups.find((g) => g.lead === `Issue #${issue}`);
    expect(own?.rest).toContain('2 of 10 runs');
    expect(own?.runs).toEqual([`PR #${pr}`]);
    expect(merged?.runs).toEqual([`#${issue}`, `PR #${pr}`]);
    expect(merged?.chain).toContain(`PR #${pr} (2 of 10 runs)`);
  });
});

test.describe('BR-20: the group view follows a link added at the source', () => {
  test('TC-20.1: the PR group reads 1 of 10 before the link, then splits into two groups after it', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const { issue, pr, link } = await linkAddedLater(page, projectId);

    const before = await openRuns(page, handle, projectId, 2);
    const ownBefore = before.find((g) => g.lead === `PR #${pr}`);
    expect(ownBefore?.rest).toContain('1 of 10 runs');

    await link();
    const after = await openRuns(page, handle, projectId, 3);

    const own = after.find((g) => g.lead === `PR #${pr}`);
    const merged = after.find((g) => g.lead === `Issue #${issue}`);
    expect(own?.rest).toContain('2 of 10 runs');
    expect(own?.runs).toEqual([`PR #${pr}`]);
    expect(merged?.runs).toEqual([`#${issue}`, `PR #${pr}`]);
    expect(merged?.chain).toContain(`PR #${pr} (2 of 10 runs)`);
  });
});
