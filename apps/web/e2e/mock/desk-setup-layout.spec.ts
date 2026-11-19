import { expect, test, type Locator, type Page } from '@playwright/test';
import { INVOICER_API, ORG } from './mock';

// The Setup page splits the viewport between the script editor and the test log: the page itself never scrolls, each
// area scrolls on its own, and the editor takes the log's space when the log is hidden.

const SETUP = `/o/${ORG}/p/${INVOICER_API}/desk/setup`;

const pageScroll = (page: Page) =>
  page.evaluate(() => ({ scroll: document.documentElement.scrollHeight, inner: window.innerHeight }));

const box = async (loc: Locator) => {
  const b = await loc.boundingBox();
  if (!b) throw new Error('the element has no box');
  return b;
};

const scrolls = (loc: Locator) =>
  loc.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, top: el.scrollTop }));

/** The scroll container of the script editor (the textarea sits inside it). */
const editorArea = (page: Page) =>
  page.getByRole('textbox', { name: 'Setup script' }).locator('xpath=ancestor::div[2]');

/** A script long enough to need scrolling in any viewport used here. */
const longScript = Array.from({ length: 120 }, (_, i) => `echo "step ${i}"`).join('\n');

async function fillEditor(page: Page, text: string) {
  const ta = page.getByRole('textbox', { name: 'Setup script' });
  await ta.fill(text);
}

test('the script editor fits the viewport and scrolls on its own when its script is long', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto(SETUP);
  await expect(page.getByText('Version 1, saved by kim-hale')).toBeVisible();
  await fillEditor(page, longScript);

  // The page does not grow with the script.
  const o = await pageScroll(page);
  expect(o.scroll).toBe(o.inner);

  const editor = editorArea(page);
  const before = await scrolls(editor);
  expect(before.scrollHeight).toBeGreaterThan(before.clientHeight);
  await editor.evaluate((el) => el.scrollTo(0, 200));
  expect((await scrolls(editor)).top).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect((await box(page.getByRole('banner'))).y).toBe(0);
});

test('the editor and the log split the viewport and scroll on their own; hiding the log gives the editor its space', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 520 });
  await page.goto(SETUP);
  await expect(page.getByText('Version 1, saved by kim-hale')).toBeVisible();
  await fillEditor(page, longScript);
  const editor = editorArea(page);

  await page.getByRole('button', { name: 'Test setup' }).click();
  // The pass ends the workspace; its stored log opens from the banner.
  await expect(page.getByText('Last test passed')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'View log' }).click();
  const log = page.getByRole('log', { name: 'Test workspace terminal' });
  await expect(log).toBeVisible();
  await expect(log).toContainText('setup passed');

  // Both areas are on screen, inside the viewport, and the page itself does not scroll.
  const o = await pageScroll(page);
  expect(o.scroll).toBe(o.inner);
  const e = await box(editor);
  const l = await box(log);
  expect(e.height).toBeGreaterThan(40);
  expect(l.height).toBeGreaterThan(40);
  expect(Math.round(l.y + l.height)).toBeLessThanOrEqual(o.inner);
  expect(e.y + e.height).toBeLessThanOrEqual(l.y);

  // The log has its own scroll area, the editor has its own; scrolling one moves neither the page nor the other.
  const logScroll = await scrolls(log);
  expect(logScroll.scrollHeight).toBeGreaterThan(logScroll.clientHeight);
  expect(await log.evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto');
  await log.evaluate((el) => el.scrollTo(0, 0));
  expect((await scrolls(log)).top).toBe(0);
  await editor.evaluate((el) => el.scrollTo(0, 100));
  expect((await scrolls(editor)).top).toBeGreaterThan(0);
  expect((await scrolls(log)).top).toBe(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // Hiding the log (End closes an ended test's log) lets the editor take the space.
  await page.getByRole('button', { name: 'End test' }).click();
  await expect(log).toHaveCount(0);
  // The editor takes the whole column above the save bar, which sits right under it.
  const after = await box(editor);
  expect(after.height).toBeGreaterThanOrEqual(120);
  const note = await box(page.getByRole('textbox', { name: /Change note/ }));
  expect(note.y).toBeGreaterThanOrEqual(after.y + after.height);
  expect(note.y - (after.y + after.height)).toBeLessThan(120);
  const o2 = await pageScroll(page);
  expect(o2.scroll).toBe(o2.inner);
});
