import { expect, test, type Locator, type Page } from '@playwright/test';
import { INVOICER_API, ORG, seedLists, USAGE_RUNS } from './mock';

/** The routing rule command of run 65 (src/mocks/dto/runs.ts), long enough to be truncated in the Run List. */
const LONG_COMMAND = 'code-build-with-a-very-long-routing-rule-command-name-that-overflows-the-cell';

/**
 * The browser mock adds runs 67-120 (lifecycle, session, auto-resume and usage fixtures) newer than the base fixtures,
 * and the Run List shows 20 runs a page, so the base fixture runs sit on a later page: the long routing rule command
 * run on page 3, runs 52-64 on page 4. Only the first, last and nearby page buttons exist, so jump with Go to page.
 */
async function openRunsPage(page: Page, n: number): Promise<void> {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/runs`);
  // The page buttons show only the first, last and nearby pages, so jump with the Go to page box.
  const pagination = page.getByRole('navigation', { name: 'Pagination' });
  await pagination.getByLabel('Go to page').fill(String(n));
  await pagination.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(page.getByRole('link', { name: /^Run \d+$/ }).first()).toBeVisible();
}

test('the Grouped by ticket button toggles ticket grouping on the Run Board', async ({ page }) => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/runs`);
  const toggle = page.getByRole('button', { name: 'Grouped by ticket' });
  const runLinks = page.getByRole('link', { name: /^Run \d+$/ });
  const groupRows = page.locator('tr', { has: page.getByText(/ of \d+ runs$/) });
  // The toggle's fill, read from the browser so no colour value is hardcoded. Hover only changes the
  // border, so the fill tells pressed from unpressed.
  const fill = () => toggle.evaluate((el) => getComputedStyle(el).backgroundColor);

  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const pressedFill = await fill();
  await expect(runLinks.first()).toBeVisible();
  const runCount = await runLinks.count();
  const grouped = await groupRows.count();
  expect(grouped).toBeGreaterThan(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  const unpressedFill = await fill();
  expect(unpressedFill).not.toBe(pressedFill);
  await expect(groupRows).toHaveCount(0);
  await expect(runLinks).toHaveCount(runCount);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toHaveCSS('background-color', pressedFill);
  await expect(groupRows).toHaveCount(grouped);
  await expect(runLinks).toHaveCount(runCount);
});

test('the Grouped by ticket choice survives a reload of the Run List', async ({ page }) => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/runs`);
  const toggle = page.getByRole('button', { name: 'Grouped by ticket' });
  const groupRows = page.locator('tr', { has: page.getByText(/ of \d+ runs$/) });

  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  await page.reload();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('link', { name: /^Run \d+$/ }).first()).toBeVisible();
  await expect(groupRows).toHaveCount(0);
});

test('the Run List shows durations in compact units', async ({ page }) => {
  await openRunsPage(page, 4);
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
  await openRunsPage(page, 4);
  await expect(page.getByRole('columnheader', { name: 'Routing rule' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Skill' })).toHaveCount(0);

  const rowOf = (n: number) => page.getByRole('row').filter({ has: page.getByRole('link', { name: `Run ${n}` }) });
  // Run 60 is a skill run, run 52 a custom-prompt run: both show their rule command.
  await expect(rowOf(60).getByText('/code-build', { exact: true })).toBeVisible();
  await expect(rowOf(52).getByText('/triage', { exact: true })).toBeVisible();
});

test('a long routing rule command is truncated in the Run List and its full value is in the title', async ({
  page,
}) => {
  await openRunsPage(page, 3);
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

test('the Ticket column shows the ticket or PR title under the number when grouping is off', async ({ page }) => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/runs`);
  const toggle = page.getByRole('button', { name: 'Grouped by ticket' });
  const runRows = page.getByRole('row').filter({ has: page.getByRole('link', { name: /^Run \d+$/ }) });
  const rowTitle = (row: ReturnType<typeof runRows.first>) => row.getByRole('cell').nth(2).locator('div[title]');
  await expect(runRows.first()).toBeVisible();
  // Grouped: the group header carries the title, so run rows do not repeat it.
  await expect(rowTitle(runRows.first())).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  const count = await runRows.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const row = runRows.nth(i);
    const ticketCell = row.getByRole('cell').nth(2);
    const title = rowTitle(row);
    await expect(title).toHaveCount(1);
    await expect(title).not.toBeEmpty();
    // The title is the second line, below the ticket number.
    const numberBox = await ticketCell.getByRole('link', { name: /^#\d+$|^PR #\d+$/ }).boundingBox();
    const titleBox = await title.boundingBox();
    if (!numberBox || !titleBox) throw new Error('ticket number or title is not rendered');
    expect(titleBox.y).toBeGreaterThanOrEqual(numberBox.y + numberBox.height - 1);
  }
});

/*
 * Issue and PR runs in one group (spec docs/superpowers/specs/2026-11-21-group-issue-pr-runs-design.md, E2E
 * requirements). `seedLists({ ticketRuns })` makes the explicit runs, oldest first, numbered 1..n; the default
 * fixtures hold issue #142 + PR #148 (linked) and issue #131 + PR #133 (linked).
 */

type TicketRun = NonNullable<Parameters<typeof seedLists>[1]['ticketRuns']>[number];
const i = (number: number): TicketRun => ({ kind: 'issue', number });
const p = (number: number, linked?: number[]): TicketRun => ({ kind: 'pr', number, ...(linked ? { linked } : {}) });

/** The grouped list in page order: each header's ticket label and the `run:ticket` of the rows under it. */
interface Group {
  head: string;
  rows: string[];
}
const board = (page: Page): Promise<Group[]> =>
  page.evaluate(() => {
    const groups: { head: string; rows: string[] }[] = [];
    for (const tr of Array.from(document.querySelectorAll('tbody tr'))) {
      const links = Array.from(tr.querySelectorAll('a')).map((a) => (a.textContent ?? '').trim());
      const run = links.find((t) => /^Run \d+$/.test(t));
      if (run === undefined) {
        groups.push({ head: links.find((t) => /^(Issue|PR) #\d+$/.test(t)) ?? '', rows: [] });
      } else {
        const ticket = links.find((t) => /^(PR )?#\d+$/.test(t)) ?? '';
        // A flat list has no header: its rows go to one group with an empty head.
        if (groups.length === 0) groups.push({ head: '', rows: [] });
        groups[groups.length - 1]?.rows.push(`${run.slice(4)}:${ticket}`);
      }
    }
    return groups;
  });

/** The rows of the group with this header label; poll it so the list has rendered. */
const rowsOf = (page: Page, head: string): Promise<string[] | undefined> =>
  board(page).then((b) => b.find((g) => g.head === head)?.rows);

/**
 * The accessible name of a ticket link. Once `tickets.prStates` answers, a PR link also names its live state
 * ("Merged PR #148", see TicketRef), so the name is matched with or without that state word.
 */
const ticketLink = (label: string): RegExp => new RegExp(`^(?:(?:Open|Draft|Merged|Closed) )?${label}$`);

/** The header row that holds the link named `label` and no `Run N` link. */
const header = (page: Page, label: string): Locator =>
  page
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name: ticketLink(label) }) })
    .filter({ hasNot: page.getByRole('link', { name: /^Run \d+$/ }) });

const openRuns = async (page: Page, ticketRuns?: TicketRun[]) => {
  if (ticketRuns) await seedLists(page, { ticketRuns });
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/runs`);
  await expect(page.getByRole('link', { name: /^Run \d+$/ }).first()).toBeVisible();
};

const OWN_COUNT = /\d+ of \d+ runs$/;
const CHAIN_ARROW = '→';

test.describe('BR-1 one group for an issue and its PR runs', () => {
  test('TC-1.1: the issue and its linked PR run share one Issue #142 group', async ({ page }) => {
    await openRuns(page, [i(142), p(148, [142])]);
    await expect(header(page, 'Issue #142')).toHaveCount(1);
    await expect(header(page, 'Issue #142')).toContainText('Issue 142: add a health check endpoint');
    await expect(header(page, 'Issue #142')).toContainText('user-story');
    await expect.poll(() => rowsOf(page, 'Issue #142')).toEqual(['1:#142', '2:PR #148']);
    await expect(header(page, 'PR #148')).toHaveCount(0);
  });
});

test.describe('BR-2 each ticket keeps its own count in the chain note', () => {
  test('TC-2.1: the chain note shows both counts and nothing is on the right', async ({ page }) => {
    await openRuns(page, [i(142), p(148, [142])]);
    const head = header(page, 'Issue #142');
    await expect(head.getByText('Issue #142 (1 of 10 runs) → PR #148 (1 of 10 runs)', { exact: true })).toBeVisible();
    await expect(head).not.toContainText(OWN_COUNT);
  });

  test('TC-2.2: a ticket with two runs shows 2 of 10, never a sum', async ({ page }) => {
    await openRuns(page, [i(142), i(142), p(148, [142])]);
    const head = header(page, 'Issue #142');
    await expect(head.getByText('Issue #142 (2 of 10 runs) → PR #148 (1 of 10 runs)', { exact: true })).toBeVisible();
    await expect(page.getByText('3 of 10 runs')).toHaveCount(0);
    await expect(head).not.toContainText(OWN_COUNT);
  });
});

test.describe('BR-4 several PRs in one group', () => {
  test('TC-4.1: one Issue #142 group lists both PRs in number order and no PR header', async ({ page }) => {
    await openRuns(page, [i(142), p(148, [142]), p(150, [142]), p(150, [142])]);
    const note = 'Issue #142 (1 of 10 runs) → PR #148 (1 of 10 runs), PR #150 (2 of 10 runs)';
    await expect(header(page, 'Issue #142').getByText(note, { exact: true })).toBeVisible();
    await expect.poll(async () => (await board(page)).map((g) => g.head)).toEqual(['Issue #142']);
    await expect.poll(() => rowsOf(page, 'Issue #142')).toEqual(['1:#142', '2:PR #148', '3:PR #150', '4:PR #150']);
  });
});

test.describe('BR-5 order inside and between groups', () => {
  test('TC-5.1: rows are oldest first, interleaved by creation time', async ({ page }) => {
    await openRuns(page, [i(142), p(148, [142]), i(142)]);
    await expect.poll(() => rowsOf(page, 'Issue #142')).toEqual(['1:#142', '2:PR #148', '3:#142']);
  });

  test('TC-5.2: the merged group, whose newest run is the latest, comes before the older single group', async ({
    page,
  }) => {
    await openRuns(page, [i(142), i(139), p(148, [142])]);
    await expect.poll(async () => (await board(page)).map((g) => g.head)).toEqual(['Issue #142', 'Issue #139']);
  });
});

test.describe('BR-6 a PR with no linked issue', () => {
  test('TC-6.1: the PR keeps its own group with its own count on the right and no chain note', async ({ page }) => {
    await openRuns(page, [p(160), p(160)]);
    const head = header(page, 'PR #160');
    await expect(head).toContainText('PR 160: add a health check endpoint');
    await expect(head).toContainText(/2 of 10 runs$/);
    await expect(head).not.toContainText(CHAIN_ARROW);
    await expect.poll(() => rowsOf(page, 'PR #160')).toEqual(['1:PR #160', '2:PR #160']);
  });
});

test.describe('BR-7 unlinked tickets stay apart', () => {
  test('TC-7.1: an issue and a PR with no link are two groups, each with its count and no note', async ({ page }) => {
    await openRuns(page, [i(131), p(148)]);
    for (const label of ['Issue #131', 'PR #148']) {
      await expect(header(page, label)).toContainText(/1 of 10 runs$/);
      await expect(header(page, label)).not.toContainText(CHAIN_ARROW);
    }
  });

  test('TC-7.2: an issue and a PR with the same number stay in their own groups', async ({ page }) => {
    await openRuns(page, [i(148), p(148)]);
    await expect(header(page, 'Issue #148')).not.toContainText(CHAIN_ARROW);
    await expect(header(page, 'PR #148')).not.toContainText(CHAIN_ARROW);
    await expect.poll(() => rowsOf(page, 'Issue #148')).toEqual(['1:#148']);
    await expect.poll(() => rowsOf(page, 'PR #148')).toEqual(['2:PR #148']);
  });
});

test.describe('BR-8 grouping off is the flat list', () => {
  test('TC-8.1: turning Grouped by ticket off shows every run as a row with its own ticket', async ({ page }) => {
    await openRuns(page, [i(142), p(148, [142])]);
    await expect(header(page, 'Issue #142')).toBeVisible();
    // The rows of the grouped list, before the toggle: the same runs must be in the flat list.
    const grouped = (await board(page)).flatMap((g) => g.rows);
    expect(grouped).toEqual(expect.arrayContaining(['1:#142', '2:PR #148']));
    await page.getByRole('button', { name: 'Grouped by ticket' }).click();
    await expect(page.getByRole('button', { name: 'Grouped by ticket' })).toHaveAttribute('aria-pressed', 'false');
    // No group header of any kind: every table row in the body holds a Run link.
    const bodyRows = page.locator('tbody tr');
    await expect(bodyRows).toHaveCount(grouped.length);
    await expect(bodyRows.filter({ hasNot: page.getByRole('link', { name: /^Run \d+$/ }) })).toHaveCount(0);
    await expect(page.getByText(CHAIN_ARROW)).toHaveCount(0);
    await expect(page.getByText(OWN_COUNT)).toHaveCount(0);
    // Same rows, each with its own Ticket value, newest run first (runs are numbered newest first).
    const flat = await board(page);
    expect(flat.map((g) => g.head)).toEqual(['']);
    const rows = flat[0]?.rows ?? [];
    expect([...rows].sort()).toEqual([...grouped].sort());
    const numbers = rows.map((r) => Number(r.split(':')[0]));
    expect(numbers).toEqual([...numbers].sort((x, y) => y - x));
  });
});

test.describe('BR-11 a PR linked to two issues joins the lower one', () => {
  test('TC-11.1: the PR run is a row in the Issue #142 group and in its note', async ({ page }) => {
    await openRuns(page, [i(142), i(150), p(148, [142, 150])]);
    await expect.poll(() => rowsOf(page, 'Issue #142')).toEqual(['1:#142', '3:PR #148']);
    await expect(header(page, 'Issue #142').getByText(/PR #148 \(1 of 10 runs\)/)).toBeVisible();
  });

  test('TC-11.2: Issue #150 holds only its own run and the PR run appears once', async ({ page }) => {
    await openRuns(page, [i(142), i(150), p(148, [142, 150])]);
    await expect.poll(() => rowsOf(page, 'Issue #150')).toEqual(['2:#150']);
    await expect(header(page, 'Issue #150')).toContainText(/1 of 10 runs$/);
    await expect(header(page, 'Issue #150')).not.toContainText(CHAIN_ARROW);
    await expect(page.getByRole('link', { name: ticketLink('PR #148') })).toHaveCount(1);
  });
});

test.describe('BR-12 a linked issue with no runs', () => {
  test('TC-12.1: the PR keeps its own group and no issue group appears', async ({ page }) => {
    await openRuns(page, [p(148, [142])]);
    const head = header(page, 'PR #148');
    await expect(head).toContainText(/1 of 10 runs$/);
    await expect(head).not.toContainText(CHAIN_ARROW);
    await expect(header(page, 'Issue #142')).toHaveCount(0);
  });
});

test.describe('BR-16 a PR whose link changed between runs', () => {
  test('TC-16.1: the linked run joins the issue group and the older unlinked run keeps the PR group', async ({
    page,
  }) => {
    await openRuns(page, [p(148), i(142), p(148, [142])]);
    await expect.poll(() => rowsOf(page, 'Issue #142')).toEqual(['2:#142', '3:PR #148']);
    await expect(header(page, 'Issue #142').getByText(/PR #148 \(2 of 10 runs\)/)).toBeVisible();
    await expect.poll(() => rowsOf(page, 'PR #148')).toEqual(['1:PR #148']);
    await expect(header(page, 'PR #148')).toContainText(/2 of 10 runs$/);
    await expect.poll(async () => (await board(page)).map((g) => g.head)).toEqual(['Issue #142', 'PR #148']);
  });
});

test.describe('BR-17 the newest linked run decides the group', () => {
  test('TC-17.1: both PR runs sit under Issue #142 and PR #148 is named once', async ({ page }) => {
    await openRuns(page, [i(150), i(142), p(148, [150]), p(148, [142])]);
    await expect.poll(() => rowsOf(page, 'Issue #142')).toEqual(['2:#142', '3:PR #148', '4:PR #148']);
    await expect.poll(() => rowsOf(page, 'Issue #150')).toEqual(['1:#150']);
    const note = header(page, 'Issue #142').getByText(/PR #148/);
    await expect(note).toHaveCount(1);
    await expect(note).toHaveText('Issue #142 (1 of 10 runs) → PR #148 (2 of 10 runs)');
  });

  test('TC-17.2: an unlinked newest run goes to a separate PR group', async ({ page }) => {
    await openRuns(page, [i(142), p(148, [142]), p(148, [142]), p(148)]);
    await expect.poll(() => rowsOf(page, 'Issue #142')).toEqual(['1:#142', '2:PR #148', '3:PR #148']);
    await expect.poll(() => rowsOf(page, 'PR #148')).toEqual(['4:PR #148']);
    await expect(header(page, 'PR #148')).toContainText(/3 of 10 runs$/);
  });
});

test.describe('BR-18 an issue with no linked PR runs', () => {
  test('TC-18.1: the issue keeps its own count on the right and no chain note', async ({ page }) => {
    await openRuns(page, [i(139), i(139), i(139)]);
    await expect(header(page, 'Issue #139')).toContainText(/3 of 10 runs$/);
    await expect(header(page, 'Issue #139')).not.toContainText(CHAIN_ARROW);
  });
});

/** The Usage column of the Runs list (spec 2026-11-24-run-token-usage-cost, BR-1, BR-4, BR-5, BR-12, BR-15). */
async function openUsageRuns(page: Page): Promise<void> {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/runs`);
  await expect(page.getByRole('link', { name: new RegExp(`^Run ${USAGE_RUNS.oneModel}\\b`) })).toBeVisible();
}

function usageRow(page: Page, run: number): Locator {
  return page.getByRole('row').filter({ has: page.getByRole('link', { name: new RegExp(`^Run ${run}\\b`) }) });
}

/** The row's Usage cell: the cell at the Usage header's column. */
async function usageCell(page: Page, run: number): Promise<Locator> {
  const heads = await page.getByRole('columnheader').allTextContents();
  const col = heads.findIndex((h) => h.trim() === 'Usage');
  expect(col).toBeGreaterThanOrEqual(0);
  return usageRow(page, run).getByRole('cell').nth(col);
}

/** The visible text of the cell: its first text node, without the screen-reader-only suffix. */
const visibleText = (cell: Locator) => cell.evaluate((el) => el.firstChild?.textContent ?? '');
/** Lines of the cell's visible text: the distinct tops of its text node's line boxes. */
const lineCount = (cell: Locator) =>
  cell.evaluate((el) => {
    const range = document.createRange();
    if (el.firstChild) range.selectNodeContents(el.firstChild);
    return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
  });
const titleOf = (cell: Locator) => cell.getAttribute('title');

test('TC-1.1: the Usage column follows Duration and shows tokens and cost without model or split', async ({ page }) => {
  await openUsageRuns(page);
  const heads = (await page.getByRole('columnheader').allTextContents()).map((h) => h.trim());
  const usage = heads.indexOf('Usage');
  expect(usage).toBeGreaterThan(-1);
  expect(usage).toBe(heads.indexOf('Duration') + 1);
  // Usage is the last data column: only the screen-reader-only Actions column follows it.
  expect(heads.slice(usage + 1)).toEqual(['Actions']);
  const cell = await usageCell(page, USAGE_RUNS.oneModel);
  expect(await visibleText(cell)).toBe('48.2k · ~$0.42');
  const row = usageRow(page, USAGE_RUNS.oneModel);
  await expect(row).not.toContainText(/model-[ab]|input|cache|output/i);
});

test('TC-1.2: a cost under one cent reads ~<$0.01 in the usage cell', async ({ page }) => {
  await openUsageRuns(page);
  expect(await visibleText(await usageCell(page, USAGE_RUNS.subCent))).toBe('2.1k · ~<$0.01');
});

test('TC-1.3: a run with an unpriced model shows a + after the cost', async ({ page }) => {
  await openUsageRuns(page);
  expect(await visibleText(await usageCell(page, USAGE_RUNS.unpriced))).toBe('61.2k · ~$0.42+');
});

test('TC-1.4: a run with no priced model shows tokens and a dash for cost', async ({ page }) => {
  await openUsageRuns(page);
  expect(await visibleText(await usageCell(page, USAGE_RUNS.nonePriced))).toBe('12.8k · —');
});

test('TC-1.5: the usage cell titles give tokens, cost and model count', async ({ page }) => {
  await openUsageRuns(page);
  const one = await usageCell(page, USAGE_RUNS.oneModel);
  await one.hover();
  expect(await titleOf(one)).toBe('48,213 tokens in total, estimated cost $0.42, 1 model');
  const two = await usageCell(page, USAGE_RUNS.unpriced);
  await two.hover();
  expect(await titleOf(two)).toBe('61,173 tokens in total, estimated cost at least $0.42, 2 models');
});

test('TC-4.1: the list cell has a ~ cost, an estimate title and no provider bill note', async ({ page }) => {
  await openUsageRuns(page);
  const cell = await usageCell(page, USAGE_RUNS.oneModel);
  await cell.hover();
  expect(await visibleText(cell)).toContain('~$0.42');
  const title = (await titleOf(cell)) ?? '';
  expect(title).toContain('estimated cost');
  expect(title.toLowerCase()).not.toContain('provider bill');
  await expect(cell).not.toContainText(/provider bill/i);
});

test('TC-4.3: a sub-cent run shows ~<$0.01 and an under-one-cent title', async ({ page }) => {
  await openUsageRuns(page);
  const cell = await usageCell(page, USAGE_RUNS.subCent);
  await cell.hover();
  expect(await visibleText(cell)).toContain('~<$0.01');
  expect(await titleOf(cell)).toBe('2,104 tokens in total, estimated cost under $0.01, 1 model');
});

test('TC-5.1: a run without recorded usage shows a dash and the title No usage data', async ({ page }) => {
  await openUsageRuns(page);
  const cell = await usageCell(page, USAGE_RUNS.noUsage);
  await cell.hover();
  expect(await visibleText(cell)).toBe('—');
  expect(await titleOf(cell)).toBe('No usage data');
  expect(await visibleText(cell)).not.toMatch(/\$|\b0\b/);
});

test('TC-12.1: every row has one one-line usage cell and no model, split, note or price date', async ({ page }) => {
  await openUsageRuns(page);
  const heads = await page.getByRole('columnheader').allTextContents();
  expect(heads.filter((h) => h.trim() === 'Usage')).toHaveLength(1);
  const rows = page.getByRole('row').filter({ has: page.getByRole('link', { name: /^Run \d+\b/ }) });
  const count = await rows.count();
  expect(count).toBeGreaterThan(5);
  const col = heads.findIndex((h) => h.trim() === 'Usage');
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    await expect(row.getByRole('cell')).toHaveCount(heads.length);
    expect(await lineCount(row.getByRole('cell').nth(col))).toBe(1);
    await expect(row).not.toContainText(
      /model-[ab]|Input \(uncached\)|Cache read|Cache write|provider bill|Prices as of/i,
    );
  }
});

test('TC-12.2: at a narrow viewport the usage cell stays on one line and the page does not scroll sideways', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openUsageRuns(page);
  for (const run of [USAGE_RUNS.oneModel, USAGE_RUNS.unpriced, USAGE_RUNS.nonePriced]) {
    const cell = await usageCell(page, run);
    await expect(cell).toBeVisible();
    const fits = await cell.evaluate((el) => el.scrollWidth <= el.clientWidth);
    expect(fits).toBe(true);
    expect(await lineCount(cell)).toBe(1);
  }
  // The table scrolls inside its section: the section is the scroll container and the table adds no page width.
  // (The app shell's own header is wider than 390 px, so the page width is compared with the section hidden.)
  const section = page.getByRole('region', { name: 'Run results' });
  const sectionScrolls = await section.evaluate(
    (el) => getComputedStyle(el).overflowX === 'auto' && el.scrollWidth > el.clientWidth,
  );
  expect(sectionScrolls).toBe(true);
  // The shell's header is wider while the web fonts still load (714 px against 684 px), so measure both widths only
  // once the fonts are loaded.
  await expect.poll(() => page.evaluate(async () => (await document.fonts.ready).status)).toBe('loaded');
  const pageWidth = () => page.evaluate(() => document.documentElement.scrollWidth);
  const withTable = await pageWidth();
  await section.evaluate((el) => (el.style.display = 'none'));
  expect(withTable).toBeLessThanOrEqual(await pageWidth());
});

test('TC-15.2: a run that reached the call cap carries a + after the cost in the list', async ({ page }) => {
  await openUsageRuns(page);
  expect(await visibleText(await usageCell(page, USAGE_RUNS.capPartial))).toBe('48.2k · ~$0.42+');
});
