import { expect, test, type Locator, type Page } from '@playwright/test';
import { INVOICER_API, ORG } from './mock';

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
