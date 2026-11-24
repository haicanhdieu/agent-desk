import { expect, test, type Page } from '@playwright/test';
import { INVOICER_API, ORG, USAGE_RUNS, seedProjectSpace } from './mock';

/*
 * Price dates, recorded costs and the viewer's view of run usage (spec docs/superpowers/specs/2026-11-24-run-token-usage-cost-design.md,
 * "E2E requirements": TC-10.1, TC-18.1, TC-19.1, TC-20.1 to TC-20.7). The runs are the usage fixtures seeded into the
 * browser mock (src/mocks/dto/usageRuns.ts). The browser time zone is fixed, so a price instant falls on the same
 * local day for every machine.
 */
test.use({ timezoneId: 'America/Los_Angeles', locale: 'en-US' });

const panel = (page: Page) => page.getByRole('complementary', { name: 'Run context' });
const usageSection = (page: Page) =>
  panel(page)
    .locator('section')
    .filter({ has: page.getByText('Usage', { exact: true }) });
const modelsTable = (page: Page) => usageSection(page).getByRole('table', { name: 'Usage by model' });

async function openDetail(page: Page, run: number): Promise<void> {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/runs/${run}`);
  await expect(panel(page)).toBeVisible();
}

/** The value shown next to a label in the Usage section's list. */
async function rowValue(page: Page, label: string): Promise<string> {
  const row = usageSection(page)
    .locator('dl > div')
    .filter({ has: page.getByText(label, { exact: true }) });
  return ((await row.locator('dd').first().textContent()) ?? '').trim();
}

/** The headline total: the value of the section's first row. */
const totalTokens = async (page: Page): Promise<string> =>
  ((await usageSection(page).locator('dl > div').first().locator('dd').first().textContent()) ?? '').trim();

/** The section's estimate note: the paragraph that starts with the estimate sentence. */
const note = (page: Page) => usageSection(page).getByText(/^Estimate at public API rates/);

const NOTE =
  'Estimate at public API rates, whatever credential the run used. Costs are fixed when recorded, so later price changes do not change them.';
const BILL = 'Your provider bill may differ.';
const priceNote = (date: string) => `${NOTE} Prices as of ${date}. ${BILL}`;

/** What the section shows for one run: the headline cost, the per-model costs and the note. */
async function snapshot(page: Page) {
  return {
    cost: await rowValue(page, 'Est. cost'),
    models: await modelsTable(page).locator('tbody tr').allInnerTexts(),
    note: ((await note(page).textContent()) ?? '').trim(),
  };
}

/** The Usage cell of a run's row on the Runs list: its first text node and its hover title. */
async function listCell(page: Page, run: number) {
  await expect(page.getByRole('link', { name: new RegExp(`^Run ${run}\\b`) })).toBeVisible();
  const heads = await page.getByRole('columnheader').allTextContents();
  const col = heads.findIndex((h) => h.trim() === 'Usage');
  expect(col).toBeGreaterThanOrEqual(0);
  const link = page.getByRole('link', { name: new RegExp(`^Run ${run}\\b`) });
  const cell = page.getByRole('row').filter({ has: link }).getByRole('cell').nth(col);
  await expect(cell).toBeVisible();
  return {
    cell,
    text: await cell.evaluate((el) => el.firstChild?.textContent ?? ''),
    title: await cell.getAttribute('title'),
  };
}

test('TC-10.1: a viewer sees the same usage cell and Usage section numbers as a member', async ({ page }) => {
  const seen: Record<'member' | 'viewer', { cell: string; total: string; cost: string; split: string[] }> = {
    member: { cell: '', total: '', cost: '', split: [] },
    viewer: { cell: '', total: '', cost: '', split: [] },
  };
  for (const role of ['member', 'viewer'] as const) {
    const fresh = await page.context().newPage();
    await seedProjectSpace(fresh, { role });
    await fresh.goto(`/o/${ORG}/p/${INVOICER_API}/runs`);
    const { text } = await listCell(fresh, USAGE_RUNS.oneModel);
    await openDetail(fresh, USAGE_RUNS.oneModel);
    seen[role] = {
      cell: text,
      total: await totalTokens(fresh),
      cost: await rowValue(fresh, 'Est. cost'),
      split: await Promise.all(
        ['Input (uncached)', 'Cache read', 'Cache write', 'Output'].map((l) => rowValue(fresh, l)),
      ),
    };
    await fresh.close();
  }
  expect(seen.viewer.cell).toBe('48.2k · ~$0.42');
  expect(seen.viewer.total).toBe('48,213');
  expect(seen.viewer.cost).toBe('~$0.42');
  expect(seen.viewer).toEqual(seen.member);
});

test('TC-18.1: the older run keeps its cost, model costs and price date after the newer run is opened', async ({
  page,
}) => {
  await openDetail(page, USAGE_RUNS.olderPrice);
  const first = await snapshot(page);
  expect(first.cost).toBe('~$0.20');
  expect(first.models).toHaveLength(1);
  expect(first.models[0]).toContain('~$0.20');
  expect(first.note).toBe(priceNote('1 Jun 2026'));

  await openDetail(page, USAGE_RUNS.newerPrice);
  const newer = await snapshot(page);
  expect(newer.cost).toBe('~$0.31');
  expect(newer.models[0]).toContain('~$0.31');
  expect(newer.note).toBe(priceNote('21 Nov 2026'));

  await openDetail(page, USAGE_RUNS.olderPrice);
  expect(await snapshot(page)).toEqual(first);
});

test('TC-19.1: a run priced on two dates shows one cost and a date range', async ({ page }) => {
  await openDetail(page, USAGE_RUNS.mixedPriceDates);
  expect(await rowValue(page, 'Est. cost')).toBe('~$0.45');
  expect(count(await totalTokens(page))).toBe(58_087);
  await expect(note(page)).toHaveText(priceNote('18 Nov 2026 to 21 Nov 2026'));
});

test('TC-20.1: identical earliest and latest price instants show one "Prices as of" date', async ({ page }) => {
  await openDetail(page, USAGE_RUNS.oneModel);
  await expect(note(page)).toHaveText(priceNote('21 Nov 2026'));
});

test('TC-20.3: price instants on 18 and 21 Nov 2026 show the range "18 Nov 2026 to 21 Nov 2026"', async ({ page }) => {
  await openDetail(page, USAGE_RUNS.mixedPriceDates);
  await expect(note(page)).toHaveText(priceNote('18 Nov 2026 to 21 Nov 2026'));
});

test('TC-20.2: two price instants on the same local day show one date, not a range', async ({ page }) => {
  await openDetail(page, USAGE_RUNS.sameDay);
  await expect(note(page)).toHaveText(priceNote('21 Nov 2026'));
  await expect(usageSection(page).getByText(/ to /)).toHaveCount(0);
});

test('TC-20.4: a run with no usage and a run with no priced model show no "Prices as of" sentence', async ({
  page,
}) => {
  await openDetail(page, USAGE_RUNS.noUsage);
  await expect(usageSection(page).getByText('No usage data for this run.')).toBeVisible();
  await expect(usageSection(page).getByText(/Prices as of/)).toHaveCount(0);

  await openDetail(page, USAGE_RUNS.nonePriced);
  expect(await rowValue(page, 'Est. cost')).toBe('—');
  await expect(usageSection(page).getByText(/Prices as of/)).toHaveCount(0);
});

test('TC-20.5: a zero-usage run shows ~$0.00 and the price date', async ({ page }) => {
  await openDetail(page, USAGE_RUNS.zeroUsage);
  expect(await rowValue(page, 'Est. cost')).toBe('~$0.00');
  await expect(note(page)).toHaveText(priceNote('21 Nov 2026'));
});

test('TC-20.6: a price instant just after midnight UTC shows the local day before in Los Angeles', async ({ page }) => {
  await openDetail(page, USAGE_RUNS.nearMidnight);
  await expect(note(page)).toHaveText(priceNote('20 Nov 2026'));
});

test('TC-20.7: the list cell and its title carry no date; the detail note puts the date before the bill sentence', async ({
  page,
}) => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/runs`);
  const { text, title } = await listCell(page, USAGE_RUNS.oneModel);
  expect(text).toBe('48.2k · ~$0.42');
  expect(title).not.toMatch(/Prices as of|2026|Nov/);

  await openDetail(page, USAGE_RUNS.oneModel);
  const full = ((await note(page).textContent()) ?? '').trim();
  expect(full).toBe(priceNote('21 Nov 2026'));
  expect(full.indexOf('Prices as of 21 Nov 2026.')).toBeLessThan(full.indexOf(BILL));
  expect(full.endsWith(BILL)).toBe(true);
});

function count(text: string): number {
  return Number(text.replace(/,/g, ''));
}
