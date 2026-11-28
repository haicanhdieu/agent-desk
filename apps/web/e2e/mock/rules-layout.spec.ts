import { expect, test, type Locator, type Page } from '@playwright/test';
import { INVOICER_API, ORG, seedLists } from './mock';

// The Routing rules page fits the viewport: the page itself never scrolls, and the open rule pane keeps its header and
// footer in view while only its body scrolls.

const RULES = `/o/${ORG}/p/${INVOICER_API}/desk/rules`;

const pageScroll = (page: Page) =>
  page.evaluate(() => ({ scroll: document.documentElement.scrollHeight, inner: window.innerHeight }));

const box = async (loc: Locator) => {
  const b = await loc.boundingBox();
  if (!b) throw new Error('the element has no box');
  return b;
};

test('the rule pane keeps its header and footer in view; only its body scrolls, not the page', async ({ page }) => {
  // Shorter than the pane's form, so the body has to scroll.
  await page.setViewportSize({ width: 1280, height: 420 });
  await page.goto(RULES);
  await page.getByRole('button', { name: 'Edit rule /code-build' }).click();
  const pane = page.getByRole('complementary', { name: 'Edit rule' });
  const header = pane.getByRole('heading', { name: 'Edit rule' });
  const save = pane.getByRole('button', { name: 'Save rule' });
  await expect(save).toBeVisible();

  // The page does not grow with the pane, and the top bar stays put.
  const o = await pageScroll(page);
  expect(o.scroll).toBe(o.inner);
  expect((await box(page.getByRole('banner'))).y).toBe(0);

  // The header and the footer are inside the viewport.
  const head0 = await box(header);
  const foot0 = await box(save);
  expect(head0.y).toBeGreaterThanOrEqual(0);
  expect(foot0.y + foot0.height).toBeLessThanOrEqual(o.inner);

  // The pane's body is the one scroll area: it overflows, and scrolling it moves neither the page nor the header.
  const scroller = await pane.evaluateHandle((el) => {
    const found = Array.from(el.querySelectorAll<HTMLElement>('*')).find(
      (n) => getComputedStyle(n).overflowY === 'auto' && n.scrollHeight > n.clientHeight,
    );
    return found ?? null;
  });
  const scrollerEl = scroller.asElement();
  if (!scrollerEl) throw new Error('the pane has no scrolling body');
  await scrollerEl.evaluate((el) => el.scrollTo(0, 300));
  expect(await scrollerEl.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect((await box(header)).y).toBe(head0.y);
  expect((await box(save)).y).toBe(foot0.y);
});

// BR-61 / TC-61.7: at 1280x420 the Routing rules header, "New rule" and the pager stay in view while the list scrolls.
test('TC-61.7: the Routing rules header, New rule and the pager stay in view; the list scrolls, not the page', async ({
  page,
}) => {
  // More rules than one page, so the pager shows.
  await seedLists(page, { rules: 45 });
  await page.setViewportSize({ width: 1280, height: 420 });
  await page.goto(RULES);
  const header = page.getByRole('heading', { level: 1, name: 'Routing rules' });
  const newRule = page.getByRole('button', { name: 'New rule' });
  const pager = page.getByRole('navigation', { name: 'Pagination' });
  await expect(newRule).toBeVisible();
  await expect(pager).toBeVisible();

  const o = await pageScroll(page);
  expect(o.scroll).toBe(o.inner);
  const head0 = await box(header);
  const new0 = await box(newRule);
  const pager0 = await box(pager);
  expect(pager0.y + pager0.height).toBeLessThanOrEqual(o.inner);

  // Scroll whatever scrolls in the main area: the header, New rule and the pager do not move.
  const scrolled = await page.getByRole('main').evaluate((main) => {
    const found = Array.from(main.querySelectorAll<HTMLElement>('*')).find(
      (n) => getComputedStyle(n).overflowY === 'auto' && n.scrollHeight > n.clientHeight,
    );
    if (!found) return null;
    found.scrollTo(0, 300);
    return found.scrollTop;
  });
  expect(scrolled).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect((await box(header)).y).toBe(head0.y);
  expect((await box(newRule)).y).toBe(new0.y);
  expect((await box(pager)).y).toBe(pager0.y);
  await expect(newRule).toBeInViewport();
  await expect(pager).toBeInViewport();
});

// TC-6.4 (sidebar spec, page fit with the shell): at 1280x420 and at the 240 px window the page does not scroll,
// scrolling the side menu moves no header, "New rule" or pager, and the 120 px scroll area holds.
for (const height of [420, 240]) {
  test(`sidebar TC-6.4: scrolling the Project menu at 1280x${height} moves no Routing rules header, New rule or pager`, async ({
    page,
  }) => {
    await seedLists(page, { rules: 45 });
    await page.setViewportSize({ width: 1280, height });
    await page.goto(RULES);
    const header = page.getByRole('heading', { level: 1, name: 'Routing rules' });
    const newRule = page.getByRole('button', { name: 'New rule' });
    const pager = page.getByRole('navigation', { name: 'Pagination' });
    const list = page.getByRole('region', { name: 'Rules list' });
    await expect(newRule).toBeVisible();
    await expect(pager).toBeVisible();

    const o = await pageScroll(page);
    expect(o.scroll).toBe(o.inner);
    const head0 = await box(header);
    const new0 = await box(newRule);
    const pager0 = await box(pager);
    const list0 = await box(list);
    expect(list0.height).toBeGreaterThanOrEqual(120);

    const menu = page.getByRole('navigation', { name: 'Project menu' });
    await expect(menu).toBeVisible();
    const handle = await menu.evaluateHandle((el) => {
      const scrolls = (n: HTMLElement) => ['auto', 'scroll'].includes(getComputedStyle(n).overflowY);
      const all = [el as HTMLElement, ...Array.from(el.querySelectorAll<HTMLElement>('*'))];
      return all.find((n) => scrolls(n) && n.scrollHeight > n.clientHeight) ?? null;
    });
    const scroller = handle.asElement();
    if (!scroller) throw new Error('the Project menu has no scrolling area that overflows');
    await scroller.evaluate((el) => el.scrollTo(0, 5000));
    expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await pageScroll(page)).toEqual(o);
    expect(await box(header)).toEqual(head0);
    expect(await box(newRule)).toEqual(new0);
    expect(await box(pager)).toEqual(pager0);
    expect((await box(list)).height).toBe(list0.height);
  });
}
