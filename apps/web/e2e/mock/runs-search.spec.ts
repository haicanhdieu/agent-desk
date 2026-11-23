import { expect, test, type Page } from '@playwright/test';
import { INVOICER_API, ORG } from './mock';

// Runs page search (issue 234): server-side search over the run and its tickets, debounced typing, the query in the
// URL, a clear button, a search-specific empty state, and no search box on the Ignored view. The matching rules
// themselves (every field, linked tickets, pagination totals) are proven by the API integration tests.

const RUNS = `/o/${ORG}/p/${INVOICER_API}/runs`;
const searchBox = (page: Page) => page.getByRole('searchbox', { name: 'Search runs' });
const runLinks = (page: Page) => page.getByRole('link', { name: /^Run \d+$/ });

test('typing narrows the list after a pause and puts q in the URL; the clear button restores it', async ({ page }) => {
  await page.goto(RUNS);
  await expect(runLinks(page)).toHaveCount(12);
  await searchBox(page).fill('kim-hale');
  await expect(page).toHaveURL(/[?&]q=kim-hale/);
  await expect.poll(() => runLinks(page).count()).toBeLessThan(12);
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(searchBox(page)).toHaveValue('');
  await expect(page).not.toHaveURL(/[?&]q=/);
  await expect(runLinks(page)).toHaveCount(12);
});

test('a link with ?q= shows the query in the box and keeps it on the status chips', async ({ page }) => {
  await page.goto(`${RUNS}?q=kim-hale`);
  await expect(searchBox(page)).toHaveValue('kim-hale');
  await expect(page.getByRole('main').getByRole('link', { name: /^Ended/ })).toHaveAttribute('href', /q=kim-hale/);
});

test('a search with no match says so with the query and offers Clear search', async ({ page }) => {
  await page.goto(`${RUNS}?q=nomatchatall`);
  await expect(page.getByRole('heading', { level: 2, name: 'No runs match “nomatchatall”' })).toBeVisible();
  await page.getByRole('main').getByRole('button', { name: 'Clear search' }).last().click();
  await expect(runLinks(page)).toHaveCount(12);
});

test('the Ignored view has no search box', async ({ page }) => {
  await page.goto(`${RUNS}?filter=ignored`);
  await expect(page.getByRole('heading', { level: 2, name: 'Ignored commands' })).toBeVisible();
  await expect(searchBox(page)).toHaveCount(0);
});
