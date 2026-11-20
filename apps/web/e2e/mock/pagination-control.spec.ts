import { expect, test, type Locator, type Page } from '@playwright/test';
import { INVOICER_API, ORG, seedLists } from './mock';

/*
 * The Pagination control on the Runs screen (spec docs/superpowers/specs/2026-11-19-shared-pagination-design.md,
 * "E2E requirements": BR-2 to BR-10, BR-12 to BR-14, BR-16 and BR-39 to BR-43). Each test seeds its own list sizes
 * (mock.ts `seedLists`) and opens the Runs screen of invoicer-api. Runs are numbered total..1, newest first, so the
 * run at position p (1-based) of a list of `total` runs is number `total - p + 1`.
 */

const RUNS = `/o/${ORG}/p/${INVOICER_API}/runs`;
const PAGE_SIZE_KEY = 'agentdesk.pageSize';

const nav = (page: Page) => page.getByRole('navigation', { name: 'Pagination' });
const runLinks = (page: Page) => page.getByRole('link', { name: /^Run \d+$/ });
const rangeOf = (page: Page) => nav(page).locator('p');
const pageButton = (page: Page, n: number) => nav(page).getByRole('button', { name: `Page ${n}`, exact: true });
const step = (page: Page, name: 'Previous' | 'Next') => nav(page).getByRole('button', { name, exact: true });
const goBox = (page: Page) => nav(page).getByLabel('Go to page');
const goButton = (page: Page) => nav(page).getByRole('button', { name: 'Go', exact: true });
const sizeSelect = (page: Page) => nav(page).getByLabel('Rows per page');
const pageParam = (page: Page) => new URL(page.url()).searchParams.get('page');

/** The run numbers on the page, in the order shown. */
async function runNumbers(page: Page): Promise<number[]> {
  return (await runLinks(page).allTextContents()).map((t) => Number(t.replace('Run ', '')));
}

/** `from` down to `to`, both included. */
const descending = (from: number, to: number) => Array.from({ length: from - to + 1 }, (_, i) => from - i);

/** The page buttons and gaps the control shows now, read from the visible set (wide or narrow). */
const visiblePageSet = (page: Page) => nav(page).locator('ol:visible > li').allTextContents();

/** The browser already holds a saved page size (written once, before the app reads it). */
async function savePageSize(page: Page, value: string): Promise<void> {
  await page.addInitScript(
    ([key, v]) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, v);
    },
    [PAGE_SIZE_KEY, value] as const,
  );
}

/** Browser storage is blocked for the page size: reading and writing it throw. */
async function blockPageSizeStorage(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.getItem = function (this: Storage, k: string): string | null {
      if (k === key) throw new DOMException('blocked', 'SecurityError');
      return getItem.call(this, k);
    };
    Storage.prototype.setItem = function (this: Storage, k: string, v: string): void {
      if (k === key) throw new DOMException('blocked', 'SecurityError');
      setItem.call(this, k, v);
    };
  }, PAGE_SIZE_KEY);
}

/** Makes the control's container `width` px wide: the nav is the container, its parent sets the width. */
async function setContainerWidth(page: Page, width: number): Promise<void> {
  await nav(page).evaluate((el, w) => {
    const parent = el.parentElement;
    if (!parent) throw new Error('the control has no parent');
    parent.style.boxSizing = 'content-box';
    parent.style.width = `${w}px`;
    parent.style.minWidth = `${w}px`;
    parent.style.maxWidth = `${w}px`;
    parent.style.flex = 'none';
  }, width);
  await expect.poll(async () => (await nav(page).boundingBox())?.width).toBe(width);
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('the element is not rendered');
  return box;
}

/** Every shown control and the range sit in one row band: their vertical extents all overlap. */
async function isOneRow(page: Page): Promise<boolean> {
  // One synchronous snapshot: reading the boxes one by one lets the page scroll or reflow between reads.
  const boxes = await nav(page)
    .locator('button, input, select, p')
    .evaluateAll((els) =>
      els
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.height > 0)
        .map((r) => ({ y: r.y, height: r.height })),
    );
  expect(boxes.length).toBeGreaterThan(3);
  const top = Math.max(...boxes.map((b) => b.y));
  const bottom = Math.min(...boxes.map((b) => b.y + b.height));
  return top < bottom;
}

/** Visually hidden: not rendered, or clipped to a 1px box (still read by screen readers). */
async function isVisuallyHidden(locator: Locator): Promise<boolean> {
  const box = await locator.boundingBox();
  return box === null || (box.width <= 1 && box.height <= 1);
}

async function openRuns(page: Page, query = ''): Promise<void> {
  await page.goto(`${RUNS}${query}`);
  await expect(runLinks(page).first()).toBeVisible();
}

test.describe('BR-2: range text', () => {
  test('TC-2.1: 1,000 runs, ?page=25 reads "Showing 481–500 of 1,000"', async ({ page }) => {
    await seedLists(page, { runs: { total: 1000 } });
    await openRuns(page, '?page=25');
    await expect(rangeOf(page)).toHaveText('Showing 481–500 of 1,000');
  });

  test('TC-2.2: 12,480 runs, ?page=312 groups the thousands', async ({ page }) => {
    await seedLists(page, { runs: { total: 12480 } });
    await openRuns(page, '?page=312');
    await expect(rangeOf(page)).toHaveText('Showing 6,221–6,240 of 12,480');
  });

  test('TC-2.3: 63 runs, ?page=4 reads the short last page "Showing 61–63 of 63"', async ({ page }) => {
    await seedLists(page, { runs: { total: 63 } });
    await openRuns(page, '?page=4');
    await expect(rangeOf(page)).toHaveText('Showing 61–63 of 63');
    expect(await runNumbers(page)).toEqual([3, 2, 1]);
  });

  test('TC-2.4: 21 runs read "Showing 1–20 of 21", then "Showing 21–21 of 21" on page 2', async ({ page }) => {
    await seedLists(page, { runs: { total: 21 } });
    await openRuns(page);
    await expect(rangeOf(page)).toHaveText('Showing 1–20 of 21');
    await pageButton(page, 2).click();
    await expect(rangeOf(page)).toHaveText('Showing 21–21 of 21');
  });

  test('TC-2.5: 63 runs read "Showing 1–20 of 63"', async ({ page }) => {
    await seedLists(page, { runs: { total: 63 } });
    await openRuns(page);
    await expect(rangeOf(page)).toHaveText('Showing 1–20 of 63');
  });
});

test.describe('BR-3: the control is hidden at 20 rows or fewer', () => {
  test('TC-3.3: 63 runs with a saved size of 100 show every run and still the control with "Rows per page"', async ({
    page,
  }) => {
    await seedLists(page, { runs: { total: 63 } });
    await savePageSize(page, '100');
    await openRuns(page);
    await expect(runLinks(page)).toHaveCount(63);
    await expect(nav(page)).toBeVisible();
    await expect(sizeSelect(page)).toHaveValue('100');
  });

  test('TC-3.4: picking 20 after a saved 100 shows 20 runs and the buttons for 4 pages', async ({ page }) => {
    await seedLists(page, { runs: { total: 63 } });
    await savePageSize(page, '100');
    await openRuns(page);
    await expect(runLinks(page)).toHaveCount(63);
    await sizeSelect(page).selectOption('20');
    await expect(runLinks(page)).toHaveCount(20);
    // Page 1 of 4 shows first, last and current ± 1 (BR-4): 1 2 … 4.
    await expect(nav(page).getByRole('button', { name: /^Page \d+$/ })).toHaveText(['1', '2', '4']);
    expect(await visiblePageSet(page)).toEqual(['1', '2', '…', '4']);
    await expect(rangeOf(page)).toHaveText('Showing 1–20 of 63');
  });

  test('TC-3.5: 15 runs with a saved size of 20 show all runs and no control', async ({ page }) => {
    await seedLists(page, { runs: { total: 15 } });
    await savePageSize(page, '20');
    await openRuns(page);
    await expect(runLinks(page)).toHaveCount(15);
    await expect(nav(page)).toHaveCount(0);
  });
});

test.describe('BR-4: page buttons and gaps', () => {
  test('TC-4.1: 3 pages show "Page 1", "Page 2", "Page 3" and no gap', async ({ page }) => {
    await seedLists(page, { runs: { total: 50 } });
    await openRuns(page);
    await expect(nav(page).getByRole('button', { name: /^Page \d+$/ })).toHaveText(['1', '2', '3']);
    expect(await visiblePageSet(page)).toEqual(['1', '2', '3']);
  });

  test('TC-4.2: 50 pages on page 1 read 1 2 … 50 with "Page 1" current', async ({ page }) => {
    await seedLists(page, { runs: { total: 1000 } });
    await openRuns(page);
    expect(await visiblePageSet(page)).toEqual(['1', '2', '…', '50']);
    await expect(pageButton(page, 1)).toHaveAttribute('aria-current', 'page');
  });

  test('TC-4.3: 50 pages on the last page read 1 … 49 50 with "Page 50" current', async ({ page }) => {
    await seedLists(page, { runs: { total: 1000 } });
    await openRuns(page, '?page=50');
    expect(await visiblePageSet(page)).toEqual(['1', '…', '49', '50']);
    await expect(pageButton(page, 50)).toHaveAttribute('aria-current', 'page');
  });

  test('TC-4.4: 50 pages on page 25 read 1 … 24 25 26 … 50; only "Page 25" is current', async ({ page }) => {
    await seedLists(page, { runs: { total: 1000 } });
    await openRuns(page, '?page=25');
    expect(await visiblePageSet(page)).toEqual(['1', '…', '24', '25', '26', '…', '50']);
    await expect(pageButton(page, 25)).toHaveAttribute('aria-current', 'page');
    for (const n of [1, 24, 26, 50]) await expect(pageButton(page, n)).not.toHaveAttribute('aria-current');
  });

  test('TC-4.5: 5 pages on page 3 read 1 2 3 4 5 with no gap', async ({ page }) => {
    await seedLists(page, { runs: { total: 100 } });
    await openRuns(page, '?page=3');
    expect(await visiblePageSet(page)).toEqual(['1', '2', '3', '4', '5']);
  });

  test('TC-4.6: each page button is named "Page N" and the gaps are hidden from assistive technology', async ({
    page,
  }) => {
    await seedLists(page, { runs: { total: 1000 } });
    await openRuns(page, '?page=25');
    const names = await nav(page)
      .getByRole('button', { name: /^Page \d+$/ })
      .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
    expect(names).toEqual(['Page 1', 'Page 24', 'Page 25', 'Page 26', 'Page 50']);
    const gaps = nav(page).locator('ol:visible > li', { hasText: '…' });
    await expect(gaps).toHaveCount(2);
    for (const gap of await gaps.all()) await expect(gap).toHaveAttribute('aria-hidden', 'true');
    await expect(nav(page).getByRole('listitem').filter({ hasText: '…' })).toHaveCount(0);
  });
});

test.describe('BR-5: click a page button', () => {
  test('TC-5.1: "Page 3" shows runs 41–60, the range, the current page and ?page=3', async ({ page }) => {
    await seedLists(page, { runs: { total: 63 } });
    await openRuns(page);
    await pageButton(page, 2).click();
    await pageButton(page, 3).click();
    await expect(rangeOf(page)).toHaveText('Showing 41–60 of 63');
    expect(await runNumbers(page)).toEqual(descending(23, 4));
    await expect(pageButton(page, 3)).toHaveAttribute('aria-current', 'page');
    expect(pageParam(page)).toBe('3');
  });

  test('TC-5.2: "Page 1" from ?page=3 shows runs 1–20 and leaves out the page parameter', async ({ page }) => {
    await seedLists(page, { runs: { total: 63 } });
    await openRuns(page, '?page=3');
    await pageButton(page, 1).click();
    await expect(rangeOf(page)).toHaveText('Showing 1–20 of 63');
    expect(await runNumbers(page)).toEqual(descending(63, 44));
    expect(pageParam(page)).toBeNull();
  });
});

test.describe('BR-6: Previous and Next', () => {
  test('TC-6.1: Next on page 2 shows page 3', async ({ page }) => {
    await seedLists(page, { runs: { total: 63 } });
    await openRuns(page, '?page=2');
    await step(page, 'Next').click();
    await expect(rangeOf(page)).toHaveText('Showing 41–60 of 63');
  });

  test('TC-6.2: Previous on page 3 shows page 2', async ({ page }) => {
    await seedLists(page, { runs: { total: 63 } });
    await openRuns(page, '?page=3');
    await step(page, 'Previous').click();
    await expect(rangeOf(page)).toHaveText('Showing 21–40 of 63');
  });

  test('TC-6.3: Previous is disabled on page 1 and a click leaves the page at 1', async ({ page }) => {
    await seedLists(page, { runs: { total: 63 } });
    await openRuns(page);
    await expect(step(page, 'Previous')).toBeDisabled();
    await step(page, 'Previous').click({ force: true });
    await expect(rangeOf(page)).toHaveText('Showing 1–20 of 63');
    expect(pageParam(page)).toBeNull();
  });

  test('TC-6.4: Next is disabled on the last page, Previous is enabled, and a click leaves the page at 4', async ({
    page,
  }) => {
    await seedLists(page, { runs: { total: 63 } });
    await openRuns(page, '?page=4');
    await expect(step(page, 'Next')).toBeDisabled();
    await expect(step(page, 'Previous')).toBeEnabled();
    await step(page, 'Next').click({ force: true });
    await expect(rangeOf(page)).toHaveText('Showing 61–63 of 63');
    expect(pageParam(page)).toBe('4');
  });

  test('TC-6.5: on page 2 both Previous and Next are enabled', async ({ page }) => {
    await seedLists(page, { runs: { total: 63 } });
    await openRuns(page, '?page=2');
    await expect(step(page, 'Previous')).toBeEnabled();
    await expect(step(page, 'Next')).toBeEnabled();
  });
});

test.describe('BR-7: Go to page', () => {
  test('TC-7.1: typing 25 and clicking Go shows page 25 and ?page=25', async ({ page }) => {
    await seedLists(page, { runs: { total: 1000 } });
    await openRuns(page);
    await goBox(page).fill('25');
    await goButton(page).click();
    await expect(rangeOf(page)).toHaveText('Showing 481–500 of 1,000');
    expect(pageParam(page)).toBe('25');
  });

  test('TC-7.2: typing 10 and pressing Enter shows page 10', async ({ page }) => {
    await seedLists(page, { runs: { total: 1000 } });
    await openRuns(page);
    await goBox(page).fill('10');
    await goBox(page).press('Enter');
    await expect(rangeOf(page)).toHaveText('Showing 181–200 of 1,000');
    expect(pageParam(page)).toBe('10');
  });

  test('TC-7.3: Go is disabled while the box is empty and a click leaves the page at 1', async ({ page }) => {
    await seedLists(page, { runs: { total: 1000 } });
    await openRuns(page);
    await expect(goBox(page)).toHaveValue('');
    await expect(goButton(page)).toBeDisabled();
    await goButton(page).click({ force: true });
    await expect(rangeOf(page)).toHaveText('Showing 1–20 of 1,000');
    expect(pageParam(page)).toBeNull();
  });

  test('TC-7.4: Go is enabled with a number and disabled again when the box is emptied', async ({ page }) => {
    await seedLists(page, { runs: { total: 1000 } });
    await openRuns(page);
    await goBox(page).pressSequentially('5');
    await expect(goButton(page)).toBeEnabled();
    await goBox(page).press('Backspace');
    await expect(goBox(page)).toHaveValue('');
    await expect(goButton(page)).toBeDisabled();
  });
});

test.describe('BR-8: Go to page outside the range', () => {
  const goTo = async (page: Page, text: string) => {
    await goBox(page).fill(text);
    await goButton(page).click();
  };

  test('TC-8.1: 80 of 50 pages shows page 50', async ({ page }) => {
    await seedLists(page, { runs: { total: 1000 } });
    await openRuns(page);
    await goTo(page, '80');
    await expect(rangeOf(page)).toHaveText('Showing 981–1,000 of 1,000');
  });

  test('TC-8.2: 51 of 50 pages shows page 50', async ({ page }) => {
    await seedLists(page, { runs: { total: 1000 } });
    await openRuns(page);
    await goTo(page, '51');
    await expect(rangeOf(page)).toHaveText('Showing 981–1,000 of 1,000');
  });

  test('TC-8.3: 50 of 50 pages shows page 50', async ({ page }) => {
    await seedLists(page, { runs: { total: 1000 } });
    await openRuns(page);
    await goTo(page, '50');
    await expect(rangeOf(page)).toHaveText('Showing 981–1,000 of 1,000');
    expect(pageParam(page)).toBe('50');
  });

  test('TC-8.4: 0 from page 25 shows page 1 and leaves out the page parameter', async ({ page }) => {
    await seedLists(page, { runs: { total: 1000 } });
    await openRuns(page, '?page=25');
    await goTo(page, '0');
    await expect(rangeOf(page)).toHaveText('Showing 1–20 of 1,000');
    expect(pageParam(page)).toBeNull();
  });

  test('TC-8.5: -3 from page 25 shows page 1', async ({ page }) => {
    await seedLists(page, { runs: { total: 1000 } });
    await openRuns(page, '?page=25');
    await goTo(page, '-3');
    await expect(rangeOf(page)).toHaveText('Showing 1–20 of 1,000');
  });

  test('TC-8.6: 1 from page 25 shows page 1', async ({ page }) => {
    await seedLists(page, { runs: { total: 1000 } });
    await openRuns(page, '?page=25');
    await goTo(page, '1');
    await expect(rangeOf(page)).toHaveText('Showing 1–20 of 1,000');
  });

  test('TC-8.7: letters do not go into the box, Go stays disabled and the page stays 25', async ({ page }) => {
    await seedLists(page, { runs: { total: 1000 } });
    await openRuns(page, '?page=25');
    await goBox(page).pressSequentially('abc');
    await expect(goBox(page)).toHaveValue('');
    await expect(goButton(page)).toBeDisabled();
    await expect(rangeOf(page)).toHaveText('Showing 481–500 of 1,000');
  });
});

test.describe('BR-9: the page in the address', () => {
  test('TC-9.1: page 3 is still shown after a reload, with the same rows and range', async ({ page }) => {
    await seedLists(page, { runs: { total: 63 } });
    await openRuns(page);
    await pageButton(page, 2).click();
    await pageButton(page, 3).click();
    await expect(rangeOf(page)).toHaveText('Showing 41–60 of 63');
    await page.reload();
    await expect(rangeOf(page)).toHaveText('Showing 41–60 of 63');
    expect(await runNumbers(page)).toEqual(descending(23, 4));
  });

  test('TC-9.2: Back from page 3 shows page 2 and ?page=2', async ({ page }) => {
    await seedLists(page, { runs: { total: 63 } });
    await openRuns(page);
    await pageButton(page, 2).click();
    await expect(rangeOf(page)).toHaveText('Showing 21–40 of 63');
    await pageButton(page, 3).click();
    await expect(rangeOf(page)).toHaveText('Showing 41–60 of 63');
    await page.goBack();
    await expect(rangeOf(page)).toHaveText('Showing 21–40 of 63');
    expect(pageParam(page)).toBe('2');
  });

  test('TC-9.3: a shared link with ?page=2 opens page 2', async ({ page }) => {
    await seedLists(page, { runs: { total: 63 } });
    await openRuns(page, '?page=2');
    await expect(rangeOf(page)).toHaveText('Showing 21–40 of 63');
    expect(await runNumbers(page)).toEqual(descending(43, 24));
  });

  test('TC-9.4: ?page=abc shows page 1', async ({ page }) => {
    await seedLists(page, { runs: { total: 63 } });
    await openRuns(page, '?page=abc');
    await expect(rangeOf(page)).toHaveText('Showing 1–20 of 63');
  });

  test('TC-9.5: ?page=0, ?page=-2 and ?page=1.5 each show page 1', async ({ page }) => {
    await seedLists(page, { runs: { total: 63 } });
    for (const value of ['0', '-2', '1.5']) {
      await openRuns(page, `?page=${value}`);
      await expect(rangeOf(page)).toHaveText('Showing 1–20 of 63');
    }
  });
});

test.describe('BR-10: a page beyond the last page', () => {
  test('TC-10.1: ?page=99 shows the last page and the address becomes ?page=4', async ({ page }) => {
    await seedLists(page, { runs: { total: 63 } });
    await openRuns(page, '?page=99');
    await expect(rangeOf(page)).toHaveText('Showing 61–63 of 63');
    await expect.poll(() => pageParam(page)).toBe('4');
  });

  test('TC-10.2: ?page=5 shows page 4 and the address becomes ?page=4', async ({ page }) => {
    await seedLists(page, { runs: { total: 63 } });
    await openRuns(page, '?page=5');
    await expect(rangeOf(page)).toHaveText('Showing 61–63 of 63');
    await expect.poll(() => pageParam(page)).toBe('4');
  });

  test('TC-10.3: ?page=4 shows page 4 and the address stays ?page=4', async ({ page }) => {
    await seedLists(page, { runs: { total: 63 } });
    await openRuns(page, '?page=4');
    await expect(rangeOf(page)).toHaveText('Showing 61–63 of 63');
    expect(pageParam(page)).toBe('4');
  });
});

test.describe('BR-12: rows per page', () => {
  test('TC-12.1: picking 50 on page 3 shows 50 rows from page 1 and leaves out the page parameter', async ({
    page,
  }) => {
    await seedLists(page, { runs: { total: 1000 } });
    await openRuns(page, '?page=3');
    await sizeSelect(page).selectOption('50');
    await expect(runLinks(page)).toHaveCount(50);
    await expect(rangeOf(page)).toHaveText('Showing 1–50 of 1,000');
    expect(pageParam(page)).toBeNull();
  });

  test('TC-12.2: picking 100 on page 3 shows 100 rows from page 1', async ({ page }) => {
    await seedLists(page, { runs: { total: 1000 } });
    await openRuns(page, '?page=3');
    await sizeSelect(page).selectOption('100');
    await expect(runLinks(page)).toHaveCount(100);
    await expect(rangeOf(page)).toHaveText('Showing 1–100 of 1,000');
    expect(pageParam(page)).toBeNull();
  });

  test('TC-12.3: picking 20 at size 50 on page 3 shows 20 rows from page 1', async ({ page }) => {
    await seedLists(page, { runs: { total: 1000 } });
    await savePageSize(page, '50');
    await openRuns(page, '?page=3');
    await expect(runLinks(page)).toHaveCount(50);
    await sizeSelect(page).selectOption('20');
    await expect(runLinks(page)).toHaveCount(20);
    await expect(rangeOf(page)).toHaveText('Showing 1–20 of 1,000');
    expect(pageParam(page)).toBeNull();
  });

  test('TC-12.4: "Rows per page" offers exactly 20, 50 and 100', async ({ page }) => {
    await seedLists(page, { runs: { total: 63 } });
    await openRuns(page);
    await expect(sizeSelect(page).locator('option')).toHaveText(['20', '50', '100']);
  });
});

test.describe('BR-13: the page size is remembered', () => {
  test('TC-13.1: picking 50 and reloading keeps 50 in "Rows per page" and 50 rows', async ({ page }) => {
    await seedLists(page, { runs: { total: 63 } });
    await openRuns(page);
    await sizeSelect(page).selectOption('50');
    await expect(runLinks(page)).toHaveCount(50);
    await page.reload();
    await expect(sizeSelect(page)).toHaveValue('50');
    await expect(runLinks(page)).toHaveCount(50);
  });
});

test.describe('BR-14: an invalid or blocked saved page size', () => {
  for (const [id, saved] of [
    ['TC-14.1', '33'],
    ['TC-14.2', 'abc'],
    ['TC-14.3', '0'],
  ] as const) {
    test(`${id}: a saved size of "${saved}" gives 20 rows per page`, async ({ page }) => {
      await seedLists(page, { runs: { total: 63 } });
      await savePageSize(page, saved);
      await openRuns(page);
      await expect(runLinks(page)).toHaveCount(20);
      await expect(sizeSelect(page)).toHaveValue('20');
    });
  }

  test('TC-14.4: a saved size of 100 shows 63 runs on one page', async ({ page }) => {
    await seedLists(page, { runs: { total: 63 } });
    await savePageSize(page, '100');
    await openRuns(page);
    await expect(runLinks(page)).toHaveCount(63);
  });

  test('TC-14.5: with storage blocked, size 50 applies on the Runs screen and on Projects for the visit', async ({
    page,
  }) => {
    await seedLists(page, { runs: { total: 63 }, projects: 26 });
    await blockPageSizeStorage(page);
    await openRuns(page);
    await sizeSelect(page).selectOption('50');
    await expect(runLinks(page)).toHaveCount(50);
    await expect(sizeSelect(page)).toHaveValue('50');
    // Click through: a second `goto` would be a new visit.
    await page.locator(`a[href="/o/${ORG}/projects"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/projects$`));
    await expect(sizeSelect(page)).toHaveValue('50');
  });

  test('TC-14.6: with storage blocked, a new visit goes back to 20 rows per page', async ({ page, browser }) => {
    await seedLists(page, { runs: { total: 63 } });
    await blockPageSizeStorage(page);
    await openRuns(page);
    await sizeSelect(page).selectOption('50');
    await expect(runLinks(page)).toHaveCount(50);

    const visit = await browser.newContext();
    try {
      const next = await visit.newPage();
      await seedLists(next, { runs: { total: 63 } });
      await blockPageSizeStorage(next);
      await next.goto(RUNS);
      await expect(runLinks(next).first()).toBeVisible();
      await expect(runLinks(next)).toHaveCount(20);
      await expect(sizeSelect(next)).toHaveValue('20');
    } finally {
      await visit.close();
    }
  });
});

test.describe('BR-16: busy state while the next page loads', () => {
  const controls = (page: Page) => nav(page).locator('button:visible, input:visible, select:visible');

  test('TC-16.1: while page 2 is held, page 1 stays and the list and the control are busy', async ({ page }) => {
    await seedLists(page, { runs: { total: 63 }, hold: [{ route: 'runs.list', page: 2, ms: 2500 }] });
    await openRuns(page);
    await pageButton(page, 2).click();
    await expect(nav(page)).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('table')).toHaveAttribute('aria-busy', 'true');
    expect(await runNumbers(page)).toEqual(descending(63, 44));
    // The control still describes the page on screen: page 1's range, page 1 current, page 2 not.
    await expect(rangeOf(page)).toHaveText('Showing 1–20 of 63');
    await expect(pageButton(page, 1)).toHaveAttribute('aria-current', 'page');
    await expect(pageButton(page, 2)).not.toHaveAttribute('aria-current');
    await expect(nav(page)).toHaveAttribute('aria-busy', 'false', { timeout: 10_000 });
    await expect(rangeOf(page)).toHaveText('Showing 21–40 of 63');
  });

  test('TC-16.2: while page 2 is held, every control is disabled', async ({ page }) => {
    await seedLists(page, { runs: { total: 63 }, hold: [{ route: 'runs.list', page: 2, ms: 2500 }] });
    await openRuns(page);
    await goBox(page).fill('3');
    await pageButton(page, 2).click();
    await expect(nav(page)).toHaveAttribute('aria-busy', 'true');
    const all = await controls(page).all();
    // Previous, Next, the page buttons, the Go box, Go and the size.
    expect(all.length).toBeGreaterThanOrEqual(8);
    for (const control of all) await expect(control).toBeDisabled();
    await expect(goButton(page)).toBeDisabled();
    await expect(nav(page)).toHaveAttribute('aria-busy', 'false', { timeout: 10_000 });
  });

  test('TC-16.3: releasing the response shows page 2, enables the controls and clears the busy mark', async ({
    page,
  }) => {
    await seedLists(page, { runs: { total: 63 }, hold: [{ route: 'runs.list', page: 2, ms: 1500 }] });
    await openRuns(page);
    await goBox(page).fill('3');
    await pageButton(page, 2).click();
    await expect(nav(page)).toHaveAttribute('aria-busy', 'true');
    await expect(nav(page)).toHaveAttribute('aria-busy', 'false', { timeout: 10_000 });
    await expect(rangeOf(page)).toHaveText('Showing 21–40 of 63');
    expect(await runNumbers(page)).toEqual(descending(43, 24));
    await expect(page.getByRole('table')).not.toHaveAttribute('aria-busy');
    for (const control of await controls(page).all()) await expect(control).toBeEnabled();
  });

  test('TC-16.4: while the 50-row page is held, the rows stay and the control is disabled until it shows', async ({
    page,
  }) => {
    await seedLists(page, { runs: { total: 63 }, hold: [{ route: 'runs.list', pageSize: 50, ms: 2500 }] });
    await openRuns(page);
    await sizeSelect(page).selectOption('50');
    await expect(nav(page)).toHaveAttribute('aria-busy', 'true');
    await expect(runLinks(page)).toHaveCount(20);
    for (const control of await controls(page).all()) await expect(control).toBeDisabled();
    await expect(nav(page)).toHaveAttribute('aria-busy', 'false', { timeout: 10_000 });
    await expect(runLinks(page)).toHaveCount(50);
    await expect(sizeSelect(page)).toBeEnabled();
  });

  test('TC-16.5: with no request pending nothing is busy and the controls are enabled', async ({ page }) => {
    await seedLists(page, { runs: { total: 63 } });
    await openRuns(page, '?page=2');
    await expect(nav(page)).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByRole('table')).not.toHaveAttribute('aria-busy');
    await goBox(page).fill('3');
    for (const control of await controls(page).all()) await expect(control).toBeEnabled();
  });
});

test.describe('BR-39: container under 1070px', () => {
  test('TC-39.1: at 1070px the labels and the words Previous and Next are visible, on one row', async ({ page }) => {
    await seedLists(page, { runs: { total: 1000 } });
    await openRuns(page);
    await setContainerWidth(page, 1070);
    for (const text of ['Go to page', 'Rows per page', 'Previous', 'Next']) {
      expect(await isVisuallyHidden(nav(page).getByText(text, { exact: true }))).toBe(false);
    }
    expect(await isOneRow(page)).toBe(true);
  });

  test('TC-39.2: at 1069px the labels and words are visually hidden and Previous and Next are square icons, on one row', async ({
    page,
  }) => {
    await seedLists(page, { runs: { total: 1000 } });
    await openRuns(page);
    await setContainerWidth(page, 1069);
    for (const text of ['Go to page', 'Rows per page', 'Previous', 'Next']) {
      expect(await isVisuallyHidden(nav(page).getByText(text, { exact: true }))).toBe(true);
    }
    for (const name of ['Previous', 'Next'] as const) {
      const box = await boxOf(step(page, name));
      expect(box.width).toBe(box.height);
    }
    expect(await isOneRow(page)).toBe(true);
  });

  test('TC-39.3: at 900px "Previous" and "Next" are still announced', async ({ page }) => {
    await seedLists(page, { runs: { total: 1000 } });
    await openRuns(page);
    await setContainerWidth(page, 900);
    await expect(page.getByRole('button', { name: 'Previous', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeVisible();
    await expect(goBox(page)).toBeVisible();
    await expect(sizeSelect(page)).toBeVisible();
  });
});

test.describe('BR-40: container under 790px', () => {
  test('TC-40.1: at 790px the range keeps "Showing" and the full page set shows', async ({ page }) => {
    await seedLists(page, { runs: { total: 1000 } });
    await openRuns(page, '?page=25');
    await setContainerWidth(page, 790);
    await expect(rangeOf(page)).toHaveText('Showing 481–500 of 1,000', { useInnerText: true });
    expect(await visiblePageSet(page)).toEqual(['1', '…', '24', '25', '26', '…', '50']);
  });

  test('TC-40.2: at 789px "Showing" is dropped, the page set is 1 … 25 … 50, the Go box and size are narrower, on one row', async ({
    page,
  }) => {
    await seedLists(page, { runs: { total: 1000 } });
    await openRuns(page, '?page=25');
    await setContainerWidth(page, 790);
    const wideJump = (await boxOf(goBox(page))).width;
    const wideSize = (await boxOf(sizeSelect(page))).width;
    await setContainerWidth(page, 789);
    await expect(rangeOf(page)).toHaveText('481–500 of 1,000', { useInnerText: true });
    expect(await visiblePageSet(page)).toEqual(['1', '…', '25', '…', '50']);
    expect((await boxOf(goBox(page))).width).toBeLessThan(wideJump);
    expect((await boxOf(sizeSelect(page))).width).toBeLessThan(wideSize);
    expect(await isOneRow(page)).toBe(true);
  });
});

test.describe('BR-41: container under 590px', () => {
  test('TC-41.1: at 590px the range is shown', async ({ page }) => {
    await seedLists(page, { runs: { total: 1000 } });
    await openRuns(page);
    await setContainerWidth(page, 590);
    await expect(rangeOf(page)).toBeVisible();
    await expect(rangeOf(page)).toHaveText('1–20 of 1,000', { useInnerText: true });
  });

  test('TC-41.2: at 589px the range is gone, the buttons are smaller in height and text, the Go box and size select are smaller in height, with tighter gaps, on one row', async ({
    page,
  }) => {
    await seedLists(page, { runs: { total: 1000 } });
    await openRuns(page);
    await setContainerWidth(page, 590);
    const measure = async () => {
      const previous = await boxOf(step(page, 'Previous'));
      const first = await boxOf(pageButton(page, 1));
      return {
        go: (await boxOf(goButton(page))).height,
        jump: (await boxOf(goBox(page))).height,
        size: (await boxOf(sizeSelect(page))).height,
        pageButton: first.height,
        gap: first.x - (previous.x + previous.width),
        // The prototype (Pagination.dc.html, max-width 589px) shrinks the text of the buttons: `.pg .btn{height:26px;font-size:12.5px}`.
        fontSize: parseFloat(await goButton(page).evaluate((el) => getComputedStyle(el).fontSize)),
      };
    };
    const before = await measure();
    await setContainerWidth(page, 589);
    await expect(rangeOf(page)).toBeHidden();
    const after = await measure();
    expect(after.go).toBeLessThan(before.go);
    expect(after.jump).toBeLessThan(before.jump);
    expect(after.size).toBeLessThan(before.size);
    expect(after.pageButton).toBeLessThan(before.pageButton);
    expect(after.gap).toBeLessThan(before.gap);
    expect(after.fontSize).toBeLessThan(before.fontSize);
    expect(await isOneRow(page)).toBe(true);
  });
});

test.describe('BR-42: container under 360px', () => {
  test('TC-42.1: at 360px the page buttons are still shown', async ({ page }) => {
    await seedLists(page, { runs: { total: 1000 } });
    await openRuns(page, '?page=25');
    await setContainerWidth(page, 360);
    await expect(
      nav(page)
        .getByRole('button', { name: /^Page \d+$/ })
        .first(),
    ).toBeVisible();
  });

  test('TC-42.2: at 359px only the current page number shows between the arrows, and the arrows still work', async ({
    page,
  }) => {
    await seedLists(page, { runs: { total: 1000 } });
    await openRuns(page, '?page=25');
    await setContainerWidth(page, 359);
    await expect(nav(page).getByRole('button', { name: /^Page \d+$/ })).toHaveCount(0);
    const current = nav(page).locator('[aria-current="page"]:visible');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveText(/^(Page )?25$/);
    // Nothing else between the arrows: no visible page list (so no other number) and no visible "…".
    expect(await visiblePageSet(page)).toEqual([]);
    await expect(nav(page).getByText('…').locator('visible=true')).toHaveCount(0);
    await step(page, 'Next').click();
    await expect.poll(() => pageParam(page)).toBe('26');
    await expect(current).toContainText('26');
    await step(page, 'Previous').click();
    await expect.poll(() => pageParam(page)).toBe('25');
  });
});

test.describe('BR-43: one row down to 240px', () => {
  test('TC-43.1: at 1400px the control is on one row', async ({ page }) => {
    await seedLists(page, { runs: { total: 1000 } });
    await openRuns(page);
    await setContainerWidth(page, 1400);
    expect(await isOneRow(page)).toBe(true);
  });

  test('TC-43.2: at 241px the control is on one row', async ({ page }) => {
    await seedLists(page, { runs: { total: 1000 } });
    await openRuns(page);
    await setContainerWidth(page, 241);
    expect(await isOneRow(page)).toBe(true);
  });

  test('TC-43.3: at 240px the control wraps to a second row', async ({ page }) => {
    await seedLists(page, { runs: { total: 1000 } });
    await openRuns(page);
    await setContainerWidth(page, 240);
    expect(await isOneRow(page)).toBe(false);
  });

  test('TC-43.4: at a phone width of 375px the control is on one row', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await seedLists(page, { runs: { total: 1000 } });
    await openRuns(page);
    expect((await boxOf(nav(page))).width).toBeLessThanOrEqual(375);
    expect(await isOneRow(page)).toBe(true);
  });
});
