import { expect, test, type Locator, type Page } from '@playwright/test';
import { INVOICER_API, ORG } from './mock';

// The Skills page fits the viewport: the page itself never scrolls, and each of its three columns (the Desk nav, the
// skill list and the skill editor) scrolls inside its own area. The editor keeps its header and commit bar in view.

const SKILLS = `/o/${ORG}/p/${INVOICER_API}/desk/skills`;

// Short enough that every column overflows.
const HEIGHT = 300;

const pageScroll = (page: Page) =>
  page.evaluate(() => ({ scroll: document.documentElement.scrollHeight, inner: window.innerHeight }));

const box = async (loc: Locator) => {
  const b = await loc.boundingBox();
  if (!b) throw new Error('the element has no box');
  return b;
};

/** The column's own scroll area: the column itself or the first descendant that scrolls vertically. */
const scroller = async (column: Locator) => {
  const handle = await column.evaluateHandle((el) => {
    const scrolls = (n: HTMLElement) => ['auto', 'scroll'].includes(getComputedStyle(n).overflowY);
    const all = [el as HTMLElement, ...Array.from(el.querySelectorAll<HTMLElement>('*'))];
    return all.find((n) => scrolls(n) && n.scrollHeight > n.clientHeight) ?? null;
  });
  const found = handle.asElement();
  if (!found) throw new Error('the column has no scrolling area that overflows');
  return found;
};

test('the page fits the viewport; the Desk nav, the skill list and the editor each scroll on their own', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: HEIGHT });
  await page.goto(SKILLS);
  const nav = page.getByRole('navigation', { name: 'Desk' });
  const list = page.getByRole('navigation', { name: 'Skills' });
  const editor = page.getByRole('main');
  const commit = editor.getByRole('button', { name: 'Submit changes' });
  await expect(commit).toBeVisible();

  // The page does not grow with its columns, and the top bar stays put.
  const o = await pageScroll(page);
  expect(o.scroll).toBe(o.inner);
  expect((await box(page.getByRole('banner'))).y).toBe(0);

  // Each column ends inside the viewport, and the editor's header and commit bar are both in view.
  for (const column of [nav, list, editor]) {
    const b = await box(column);
    expect(b.y + b.height).toBeLessThanOrEqual(o.inner);
  }
  const head = await box(editor.getByRole('heading', { level: 2 }));
  const foot = await box(commit);
  expect(head.y).toBeGreaterThanOrEqual(0);
  expect(foot.y + foot.height).toBeLessThanOrEqual(o.inner);

  // Scrolling one column moves neither the page, nor the other columns, nor the editor's header and commit bar.
  for (const column of [nav, list, editor]) {
    const others = [nav, list, editor].filter((c) => c !== column);
    const before = await Promise.all(others.map(async (c) => (await scroller(c)).evaluate((el) => el.scrollTop)));
    const area = await scroller(column);
    await area.evaluate((el) => el.scrollTo(0, 5000));
    expect(await area.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const after = await Promise.all(others.map(async (c) => (await scroller(c)).evaluate((el) => el.scrollTop)));
    expect(after).toEqual(before);
    expect((await box(editor.getByRole('heading', { level: 2 }))).y).toBe(head.y);
    expect((await box(commit)).y).toBe(foot.y);
    await area.evaluate((el) => el.scrollTo(0, 0));
  }
});

test('the Skills header and path line stay in view while the skill list scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: HEIGHT });
  await page.goto(SKILLS);
  const list = page.getByRole('navigation', { name: 'Skills' });
  const head = list.getByRole('heading', { level: 2, name: 'Skills' });
  const path = list.getByText(/^\.claude\/skills\/ on /);
  await expect(head).toBeVisible();
  const before = { head: await box(head), path: await box(path) };

  const area = await scroller(list);
  await area.evaluate((el) => el.scrollTo(0, 5000));
  expect(await area.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

  // The header and path line did not move, and both are still inside the column.
  const column = await box(list);
  for (const [name, loc] of [
    ['head', head],
    ['path', path],
  ] as const) {
    const b = await box(loc);
    expect(b.y).toBe(before[name].y);
    expect(b.y).toBeGreaterThanOrEqual(column.y);
    expect(b.y + b.height).toBeLessThanOrEqual(column.y + column.height);
  }
});
