import { expect, test, type Page } from '@playwright/test';
import { INVOICER_API, ORG } from './mock';

// The Runs page remembers the chosen status chip and search per browser (issue 260): leaving the page and coming back
// to the bare Runs URL, or reloading it, brings both back; clearing them forgets the saved view.

const RUNS = `/o/${ORG}/p/${INVOICER_API}/runs`;
const searchBox = (page: Page) => page.getByRole('searchbox', { name: 'Search runs' });
const runLinks = (page: Page) => page.getByRole('link', { name: /^Run \d+$/ });
const chip = (page: Page, name: RegExp) => page.getByRole('main').getByRole('link', { name });
const savedView = (page: Page) =>
  page.evaluate((k) => localStorage.getItem(k), `agentdesk.runs.view:${ORG}:${INVOICER_API}`);

async function chooseView(page: Page) {
  await page.goto(RUNS);
  await expect(runLinks(page).first()).toBeVisible();
  const all = await runLinks(page).count();
  await chip(page, /^Ended/).click();
  await expect(page).toHaveURL(/[?&]filter=ended/);
  await searchBox(page).fill('code-review');
  await expect(page).toHaveURL(/[?&]q=code-review/);
  await expect(chip(page, /^Ended/)).toHaveAttribute('aria-current', /.+/);
  await expect
    .poll(async () => {
      const n = await runLinks(page).count();
      return n > 0 && n < all;
    })
    .toBe(true);
  return runLinks(page).allInnerTexts();
}

test('leaving the Runs page and coming back restores the chip, the search and the matching list', async ({ page }) => {
  const shown = await chooseView(page);
  await runLinks(page).first().click();
  await expect(page).not.toHaveURL(/\/runs(\?|$)/);
  await page.getByRole('link', { name: 'Runs', exact: true }).first().click();
  await expect(page).toHaveURL(/[?&]filter=ended/);
  await expect(searchBox(page)).toHaveValue('code-review');
  await expect(chip(page, /^Ended/)).toHaveAttribute('aria-current', /.+/);
  await expect(runLinks(page)).toHaveText(shown);
});

test('reloading the bare Runs URL restores the chip, the search and the matching list', async ({ page }) => {
  const shown = await chooseView(page);
  await page.goto(RUNS);
  await expect(page).toHaveURL(/[?&]filter=ended/);
  await expect(searchBox(page)).toHaveValue('code-review');
  await expect(chip(page, /^Ended/)).toHaveAttribute('aria-current', /.+/);
  await expect(runLinks(page)).toHaveText(shown);
});

test('clearing the search and choosing All forgets the saved view', async ({ page }) => {
  await chooseView(page);
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(searchBox(page)).toHaveValue('');
  await chip(page, /^All/).click();
  await expect(page).not.toHaveURL(/[?&](filter|q)=/);
  await expect.poll(() => savedView(page)).toBeNull();
  await page.goto(RUNS);
  await expect(runLinks(page).first()).toBeVisible();
  await expect(page).not.toHaveURL(/[?&](filter|q)=/);
  await expect(searchBox(page)).toHaveValue('');
});
