import { expect, test, type Locator, type Page } from '@playwright/test';
import { INVOICER_API, ORG, seedLists } from './mock';

/*
 * The Runs screen's data, grouping and server-fed numbers (spec docs/superpowers/specs/2026-11-19-shared-pagination-design.md,
 * "E2E requirements": BR-1, BR-11, BR-15, BR-17 to BR-19, BR-21 to BR-25 and BR-36). Each test seeds its own runs
 * (mock.ts `seedLists`) and opens the Runs screen of invoicer-api. Runs are numbered total..1, newest first, so the run
 * at position p (1-based) of a list of `total` runs is number `total - p + 1`; runs sit under tickets 100, 101, ... in
 * chunks of `ticketSize` from the newest. The Pagination control itself is covered by pagination-control.spec.ts.
 */

const RUNS = `/o/${ORG}/p/${INVOICER_API}/runs`;

const main = (page: Page) => page.getByRole('main');
const nav = (page: Page) => page.getByRole('navigation', { name: 'Pagination' });
const runLinks = (page: Page) => page.getByRole('link', { name: /^Run \d+$/ });
const rangeOf = (page: Page) => nav(page).locator('p');
const pageButton = (page: Page, n: number) => nav(page).getByRole('button', { name: `Page ${n}`, exact: true });
const goBox = (page: Page) => nav(page).getByLabel('Go to page');
const goButton = (page: Page) => nav(page).getByRole('button', { name: 'Go', exact: true });
const pageParam = (page: Page) => new URL(page.url()).searchParams.get('page');
const toggle = (page: Page) => page.getByRole('button', { name: 'Grouped by ticket' });
const chip = (page: Page, label: string) => main(page).getByRole('link', { name: new RegExp(`^${label}\\s*[\\d,]+$`) });
const chipCount = (page: Page, label: string) => chip(page, label).locator('b');
const todayLine = (page: Page) => main(page).getByText(/^Today: /);
const needsYouBanner = (page: Page) => page.getByText(/Run \d+ needs you\./);
const waitingNote = (page: Page) => page.getByText(/is waiting/);
const loadingArea = (page: Page) => page.getByRole('status', { name: 'Loading' });
const retry = (page: Page) => page.getByRole('button', { name: 'Retry' });

/** The run numbers on the page, in the order shown. */
async function runNumbers(page: Page): Promise<number[]> {
  return (await runLinks(page).allTextContents()).map((t) => Number(t.replace('Run ', '')));
}

/** `from` down to `to`, both included. */
const descending = (from: number, to: number) => Array.from({ length: from - to + 1 }, (_, i) => from - i);

/** The page buttons and gaps the control shows now, read from the visible set (wide or narrow). */
const visiblePageSet = (page: Page) => nav(page).locator('ol:visible > li').allTextContents();

/** The table rows top to bottom: a ticket header reads "H<ticket>:<N of max>", a run row "R<number>". */
async function layout(page: Page): Promise<string[]> {
  return page
    .getByRole('table')
    .getByRole('row')
    .evaluateAll((rows) =>
      rows.flatMap((row) => {
        const text = row.textContent ?? '';
        const header = /#(\d+).*?(\d+) of \d+ runs$/.exec(text);
        if (header) return [`H${header[1]}:${header[2]}`];
        const run = /Run (\d+)/.exec(text);
        return run ? [`R${run[1]}`] : [];
      }),
    );
}

/** The ticket headers on the page as `[ticket, N]`, in order. */
async function headers(page: Page): Promise<[number, number][]> {
  const rows = await layout(page);
  return rows.flatMap((r): [number, number][] => {
    const m = /^H(\d+):(\d+)$/.exec(r);
    return m ? [[Number(m[1]), Number(m[2])]] : [];
  });
}

const groupHeaderRows = (page: Page): Locator => page.getByRole('row').filter({ hasText: / of \d+ runs$/ });

async function openRuns(page: Page, query = ''): Promise<void> {
  await page.goto(`${RUNS}${query}`);
  await expect(runLinks(page).first()).toBeVisible();
}

test.describe('BR-1: the first 20 rows', () => {
  test('TC-1.1: 63 runs hold exactly 20 runs; the 21st run is not shown', async ({ page }) => {
    await seedLists(page, { runs: { total: 63 } });
    await openRuns(page);
    await expect(runLinks(page)).toHaveCount(20);
    expect(await runNumbers(page)).toEqual(descending(63, 44));
    await expect(page.getByRole('link', { name: 'Run 43', exact: true })).toHaveCount(0);
  });

  test('TC-1.2: 21 runs hold 20 runs and a pagination control shows page 2', async ({ page }) => {
    await seedLists(page, { runs: { total: 21 } });
    await openRuns(page);
    await expect(runLinks(page)).toHaveCount(20);
    await expect(nav(page)).toBeVisible();
    await expect(pageButton(page, 2)).toBeVisible();
  });

  test('TC-1.3: 20 runs hold all 20 runs and no pagination control', async ({ page }) => {
    await seedLists(page, { runs: { total: 20 } });
    await openRuns(page);
    await expect(runLinks(page)).toHaveCount(20);
    await expect(nav(page)).toHaveCount(0);
  });
});

test.describe('BR-11: empty Runs list', () => {
  test('TC-11.1: no run matches the filter: the empty state, "Show all runs" and no control', async ({ page }) => {
    await seedLists(page, { runs: { total: 30 } });
    await page.goto(`${RUNS}?filter=queued`);
    await expect(page.getByRole('heading', { name: 'No runs match this filter' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Show all runs' })).toBeVisible();
    await expect(nav(page)).toHaveCount(0);
  });

  test('TC-11.7: "Show all runs" shows the unfiltered list with its own control', async ({ page }) => {
    await seedLists(page, { runs: { total: 30 } });
    await page.goto(`${RUNS}?filter=queued`);
    await page.getByRole('link', { name: 'Show all runs' }).click();
    await expect(runLinks(page)).toHaveCount(20);
    await expect(rangeOf(page)).toHaveText('Showing 1–20 of 30');
  });
});

test.describe('BR-15: a change of view returns to page 1', () => {
  test('TC-15.1: a status chip on page 3 shows page 1 of its result, with no page in the address', async ({ page }) => {
    await seedLists(page, { runs: { total: 63, statuses: { running: 4 } } });
    await openRuns(page, '?page=3');
    await chip(page, 'Ended').click();
    await expect(rangeOf(page)).toHaveText('Showing 1–20 of 59');
    expect(await runNumbers(page)).toEqual(descending(59, 40));
    expect(pageParam(page)).toBeNull();
    expect(new URL(page.url()).searchParams.get('filter')).toBe('ended');
  });

  test('TC-15.2: the Ignored chip on page 3 shows page 1 of the ignored list, with no page in the address', async ({
    page,
  }) => {
    await seedLists(page, { runs: { total: 63 }, ignored: 27 });
    await openRuns(page, '?page=3');
    await chip(page, 'Ignored').click();
    await expect(rangeOf(page)).toHaveText('Showing 1–20 of 27');
    expect(pageParam(page)).toBeNull();
  });

  test('TC-15.4: the "Grouped by ticket" toggle on page 3 shows page 1', async ({ page }) => {
    await seedLists(page, { runs: { total: 63 } });
    await openRuns(page, '?page=3');
    await expect(rangeOf(page)).toHaveText('Showing 41–60 of 63');
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(rangeOf(page)).toHaveText('Showing 1–20 of 63');
    expect(pageParam(page)).toBeNull();
    expect(await runNumbers(page)).toEqual(descending(63, 44));
  });

  test('TC-15.5: "Page 4" on page 3 moves to page 4 and does not reset to page 1', async ({ page }) => {
    await seedLists(page, { runs: { total: 63 } });
    await openRuns(page, '?page=3');
    await pageButton(page, 4).click();
    await expect(rangeOf(page)).toHaveText('Showing 61–63 of 63');
    expect(pageParam(page)).toBe('4');
  });
});

test.describe('BR-17: first load', () => {
  test('TC-17.1: while the runs response is held the loading area shows, with no empty text and no control', async ({
    page,
  }) => {
    await seedLists(page, { runs: { total: 63 }, hold: [{ route: 'runs.list', ms: 3000 }] });
    await page.goto(RUNS);
    await expect(loadingArea(page)).toBeVisible();
    await expect(loadingArea(page)).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByText('No runs match this filter')).toHaveCount(0);
    await expect(nav(page)).toHaveCount(0);
    await expect(runLinks(page)).toHaveCount(0);
  });

  test('TC-17.3: releasing the response replaces the loading area with the list and the control', async ({ page }) => {
    await seedLists(page, { runs: { total: 63 }, hold: [{ route: 'runs.list', ms: 1500 }] });
    await page.goto(RUNS);
    await expect(loadingArea(page)).toBeVisible();
    await expect(loadingArea(page)).toHaveCount(0, { timeout: 10_000 });
    await expect(runLinks(page)).toHaveCount(20);
    await expect(nav(page)).toBeVisible();
  });
});

test.describe('BR-18: failed load', () => {
  test('TC-18.1: a failing runs request shows the route error, the request ID and Retry, with no control', async ({
    page,
  }) => {
    await seedLists(page, { runs: { total: 63 }, fail: [{ route: 'runs.list' }] });
    await page.goto(RUNS);
    await expect(page.getByText('Internal server error')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Request ID: \S+/)).toBeVisible();
    await expect(retry(page)).toBeVisible();
    await expect(nav(page)).toHaveCount(0);
  });

  test('TC-18.2: Retry after the failure clears loads the first page', async ({ page }) => {
    // Three failures cover the first load and Query's two retries; the next request succeeds.
    await seedLists(page, { runs: { total: 63 }, fail: [{ route: 'runs.list', times: 3 }] });
    await page.goto(RUNS);
    await expect(retry(page)).toBeVisible({ timeout: 15_000 });
    await retry(page).click();
    await expect(runLinks(page).first()).toBeVisible();
    await expect(rangeOf(page)).toHaveText('Showing 1–20 of 63');
    expect(await runNumbers(page)).toEqual(descending(63, 44));
  });

  test('TC-18.4: Retry while the failure persists repeats the request and shows the route error again', async ({
    page,
  }) => {
    await seedLists(page, { runs: { total: 63 }, fail: [{ route: 'runs.list' }] });
    let listRequests = 0;
    const onRequest = (request: { method(): string; url(): string }) => {
      if (request.method() === 'GET' && new URL(request.url()).pathname === `/api/projects/${INVOICER_API}/runs`) {
        listRequests += 1;
      }
    };
    page.on('request', onRequest);
    try {
      await page.goto(RUNS);
      await expect(retry(page)).toBeVisible({ timeout: 15_000 });
      const before = listRequests;
      expect(before).toBeGreaterThan(0);
      await retry(page).click();
      await expect.poll(() => listRequests, { timeout: 15_000 }).toBeGreaterThan(before);
      await expect(page.getByText('Internal server error')).toBeVisible({ timeout: 15_000 });
      await expect(retry(page)).toBeVisible();
    } finally {
      page.off('request', onRequest);
    }
  });
});

test.describe('BR-19: more than 1000 runs', () => {
  test('TC-19.1: 1,004 runs: page 51 reads "Showing 1,001–1,004 of 1,004" with buttons 1 … 50 51', async ({ page }) => {
    await seedLists(page, { runs: { total: 1004 } });
    await openRuns(page, '?page=51');
    await expect(rangeOf(page)).toHaveText('Showing 1,001–1,004 of 1,004');
    expect(await visiblePageSet(page)).toEqual(['1', '…', '50', '51']);
  });

  test('TC-19.2: 1,004 runs: "All" shows the real total, not 1000', async ({ page }) => {
    await seedLists(page, { runs: { total: 1004 } });
    await openRuns(page);
    await expect(chipCount(page, 'All')).toHaveText(/^1,?004$/);
  });

  test('TC-19.3: exactly 1,000 runs: page 50 reads "Showing 981–1,000 of 1,000"', async ({ page }) => {
    await seedLists(page, { runs: { total: 1000 } });
    await openRuns(page, '?page=50');
    await expect(rangeOf(page)).toHaveText('Showing 981–1,000 of 1,000');
  });

  test('TC-19.4: typing 51 in "Go to page" reaches the last four runs', async ({ page }) => {
    await seedLists(page, { runs: { total: 1004 } });
    await openRuns(page);
    await goBox(page).fill('51');
    await goButton(page).click();
    await expect(rangeOf(page)).toHaveText('Showing 1,001–1,004 of 1,004');
    expect(await runNumbers(page)).toEqual([4, 3, 2, 1]);
  });
});

test.describe('BR-21: grouped by ticket across a page break', () => {
  // ticketSize 3: ticket 106 holds runs 45, 44 (page 1, positions 19-20) and 43 (page 2, position 21).
  test('TC-21.1: a ticket crossing the page break shows its header on both pages', async ({ page }) => {
    await seedLists(page, { runs: { total: 63, ticketSize: 3 } });
    await openRuns(page);
    const first = await layout(page);
    expect(first.slice(-3)).toEqual(['H106:3', 'R44', 'R45']);
    await pageButton(page, 2).click();
    await expect(rangeOf(page)).toHaveText('Showing 21–40 of 63');
    const second = await layout(page);
    expect(second.slice(0, 2)).toEqual(['H106:3', 'R43']);
  });

  test('TC-21.2: grouped, page 1 shows runs under ticket headers and still holds 20 runs', async ({ page }) => {
    await seedLists(page, { runs: { total: 63, ticketSize: 3 } });
    await openRuns(page);
    await expect(runLinks(page)).toHaveCount(20);
    expect((await headers(page)).length).toBe(7);
    expect((await layout(page))[0]).toMatch(/^H\d+:\d+$/);
  });

  test('TC-21.3: a ticket entirely inside page 1 has no header on page 2', async ({ page }) => {
    await seedLists(page, { runs: { total: 63, ticketSize: 3 } });
    await openRuns(page);
    expect((await headers(page)).map(([ticket]) => ticket)).toContain(100);
    await pageButton(page, 2).click();
    await expect(rangeOf(page)).toHaveText('Showing 21–40 of 63');
    expect((await headers(page)).map(([ticket]) => ticket)).not.toContain(100);
  });

  test('TC-21.4: grouped off, page 2 is a flat list with no ticket headers', async ({ page }) => {
    await seedLists(page, { runs: { total: 63, ticketSize: 3 } });
    await openRuns(page);
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await pageButton(page, 2).click();
    await expect(rangeOf(page)).toHaveText('Showing 21–40 of 63');
    await expect(runLinks(page)).toHaveCount(20);
    await expect(groupHeaderRows(page)).toHaveCount(0);
    expect(await runNumbers(page)).toEqual(descending(43, 24));
  });
});

test.describe('BR-22: ticket header counts every run of the ticket', () => {
  test('TC-22.1: a ticket split across pages 3 and 4 reads 7 on both pages', async ({ page }) => {
    // ticketSize 7: ticket 108 holds runs 7..1; 4 of them (positions 57-60) are on page 3 and 3 on page 4.
    await seedLists(page, { runs: { total: 63, ticketSize: 7 } });
    await openRuns(page, '?page=3');
    await expect(rangeOf(page)).toHaveText('Showing 41–60 of 63');
    const onPage3 = await layout(page);
    expect(onPage3.slice(-5)).toEqual(['H108:7', 'R4', 'R5', 'R6', 'R7']);
    await pageButton(page, 4).click();
    await expect(rangeOf(page)).toHaveText('Showing 61–63 of 63');
    expect(await layout(page)).toEqual(['H108:7', 'R1', 'R2', 'R3']);
  });

  test('TC-22.2: a ticket with a single run reads 1 of max runs', async ({ page }) => {
    await seedLists(page, { runs: { total: 25 } });
    await openRuns(page);
    expect((await headers(page))[0]).toEqual([100, 1]);
    await expect(groupHeaderRows(page).first()).toContainText(/\D1 of \d+ runs$/);
  });

  test('TC-22.3: a ticket at the per-ticket maximum of 50 runs reads 50 of max runs', async ({ page }) => {
    await seedLists(page, { runs: { total: 60, ticketSize: 50 } });
    await openRuns(page);
    expect((await headers(page))[0]).toEqual([100, 50]);
    await expect(groupHeaderRows(page).first()).toContainText(/\D50 of \d+ runs$/);
  });
});

test.describe('BR-23: chip counts are the project totals', () => {
  const statuses = { starting: 1, running: 1, paused: 1, queued: 1 };
  const expectChips = async (page: Page) => {
    await expect(chipCount(page, 'Needs you')).toHaveText('1');
    await expect(chipCount(page, 'Active')).toHaveText('2');
    await expect(chipCount(page, 'Queued')).toHaveText('1');
    await expect(chipCount(page, 'Ended')).toHaveText('59');
    await expect(chipCount(page, 'All')).toHaveText('63');
    await expect(chipCount(page, 'Ignored')).toHaveText('3');
  };

  test('TC-23.1: page 4 reads Needs you 1, Active 2, Queued 1, Ended 59, All 63, Ignored 3', async ({ page }) => {
    await seedLists(page, { runs: { total: 63, statuses }, ignored: 3 });
    await openRuns(page, '?page=4');
    await expect(rangeOf(page)).toHaveText('Showing 61–63 of 63');
    await expectChips(page);
  });

  test('TC-23.2: the chip counts are the same on page 1 and page 4', async ({ page }) => {
    await seedLists(page, { runs: { total: 63, statuses }, ignored: 3 });
    await openRuns(page);
    await expectChips(page);
    await pageButton(page, 4).click();
    await expect(rangeOf(page)).toHaveText('Showing 61–63 of 63');
    await expectChips(page);
  });

  test('TC-23.3: the "Ended" chip shows a range total of 59 and the chip still reads 59', async ({ page }) => {
    await seedLists(page, { runs: { total: 63, statuses }, ignored: 3 });
    await openRuns(page);
    await chip(page, 'Ended').click();
    await expect(rangeOf(page)).toHaveText('Showing 1–20 of 59');
    await expect(chipCount(page, 'Ended')).toHaveText('59');
  });

  test('TC-23.4: with no ignored commands and no needs-you runs those chips read 0', async ({ page }) => {
    await seedLists(page, { runs: { total: 30 }, ignored: 0 });
    await openRuns(page);
    await expect(chipCount(page, 'Needs you')).toHaveText('0');
    await expect(chipCount(page, 'Ignored')).toHaveText('0');
  });
});

test.describe('BR-24: the Today line', () => {
  test('TC-24.1: 9 runs today, 1 failed: page 4 reads "Today: 9 runs, 1 failed"', async ({ page }) => {
    await seedLists(page, { runs: { total: 63, today: 9, statuses: { failed: 1 } } });
    await openRuns(page, '?page=4');
    await expect(rangeOf(page)).toHaveText('Showing 61–63 of 63');
    await expect(todayLine(page)).toHaveText('Today: 9 runs, 1 failed');
  });

  test('TC-24.2: the same Today line shows on page 1', async ({ page }) => {
    await seedLists(page, { runs: { total: 63, today: 9, statuses: { failed: 1 } } });
    await openRuns(page);
    await expect(todayLine(page)).toHaveText('Today: 9 runs, 1 failed');
  });

  test('TC-24.3: no run queued today reads "Today: 0 runs"', async ({ page }) => {
    await seedLists(page, { runs: { total: 63 } });
    await openRuns(page);
    await expect(todayLine(page)).toHaveText('Today: 0 runs');
  });
});

test.describe('BR-25: the needs-you banner on any page', () => {
  // Run 63 is the only queued run (the oldest); the idle run is added on top as run 64.
  const mix = { runs: { total: 63, statuses: { queued: 1 } }, needsYou: 1 };

  test('TC-25.1: page 4 names the newest idle run and reads "Run 63 is waiting"', async ({ page }) => {
    await seedLists(page, mix);
    await openRuns(page, '?page=4');
    await expect(rangeOf(page)).toHaveText('Showing 61–64 of 64');
    await expect(needsYouBanner(page)).toHaveText(/Run 64 needs you\./);
    await expect(waitingNote(page)).toContainText('Run 63 is waiting');
  });

  test('TC-25.2: page 1 shows the same banner', async ({ page }) => {
    await seedLists(page, mix);
    await openRuns(page);
    await expect(needsYouBanner(page)).toHaveText(/Run 64 needs you\./);
    await expect(waitingNote(page)).toContainText('Run 63 is waiting');
  });

  test('TC-25.3: with no idle run and no queued run there is no banner', async ({ page }) => {
    await seedLists(page, { runs: { total: 30 } });
    await openRuns(page);
    await expect(needsYouBanner(page)).toHaveCount(0);
    await expect(waitingNote(page)).toHaveCount(0);
  });

  test('TC-25.4: only queued runs: the banner shows the waiting run number and names no idle run', async ({ page }) => {
    await seedLists(page, { runs: { total: 30, statuses: { queued: 1 } } });
    await openRuns(page);
    await expect(waitingNote(page)).toContainText('Run 30 is waiting');
    await expect(needsYouBanner(page)).toHaveCount(0);
  });

  test('TC-25.5: only an idle run: the banner names it and has no "is waiting" line', async ({ page }) => {
    await seedLists(page, { runs: { total: 30 }, needsYou: 1 });
    await openRuns(page);
    await expect(needsYouBanner(page)).toHaveText(/Run 31 needs you\./);
    await expect(waitingNote(page)).toHaveCount(0);
  });
});

test.describe('BR-36: a live status change', () => {
  test('TC-36.3: a status change for a run on page 2 shows in its row without a reload', async ({ page }) => {
    // The mock's scripted runs (`runScript`) target fixture run ids that a seeded list replaces, and nothing in the
    // page reaches the mock store. So the message the project stream carries is delivered on the page's own project
    // EventSource, in the wire shape the app parses (ProjectRunEvent).
    await page.addInitScript(() => {
      const Original = window.EventSource;
      const opened: EventSource[] = [];
      class Recording extends Original {
        constructor(url: string | URL, init?: EventSourceInit) {
          super(url, init);
          opened.push(this);
        }
      }
      window.EventSource = Recording;
      Object.defineProperty(window, '__eventSources', { value: opened });
    });
    await seedLists(page, { runs: { total: 63 } });
    await openRuns(page);
    await pageButton(page, 2).click();
    await expect(rangeOf(page)).toHaveText('Showing 21–40 of 63');
    await page.evaluate(() => {
      Object.defineProperty(window, '__keptAlive', { value: true });
    });
    const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Run 30', exact: true }) });
    await expect(row).toContainText('Succeeded');

    await page.evaluate(
      ([projectId, runId]) => {
        const sources: EventSource[] = Reflect.get(window, '__eventSources');
        const stream = sources.find((s) => s.url.endsWith(`/api/projects/${projectId}/events`) && s.readyState !== 2);
        if (!stream) throw new Error('the project event stream is not open');
        const data = JSON.stringify({ runId, number: 30, status: 'failed', seq: 1000 });
        stream.dispatchEvent(new MessageEvent('run', { data }));
      },
      [INVOICER_API, 'd1000000-0000-4000-8000-000000000030'] as const,
    );

    await expect(row).toContainText('Failed');
    await expect(rangeOf(page)).toHaveText('Showing 21–40 of 63');
    expect(await page.evaluate(() => Reflect.get(window, '__keptAlive'))).toBe(true);
  });
});
