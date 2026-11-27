import { expect, test, type Page } from '@playwright/test';
import { INVOICER_API, ORG } from './mock';

// The run detail, Routing rules, Skills and Setup pages are not in the window-scroll list: in the shell they fill the
// viewport and scroll inside (run-detail-layout.spec.ts, rules-layout.spec.ts, skills-layout.spec.ts,
// desk-setup-layout.spec.ts). The Desk Agent page has its own case below.
const pages: { name: string; path: string }[] = [
  { name: 'Projects', path: `/o/${ORG}/projects` },
  { name: 'Runs', path: `/o/${ORG}/p/${INVOICER_API}/runs` },
  { name: 'Needs you', path: `/o/${ORG}/p/${INVOICER_API}/needs-you` },
];

// Short enough that every page needs scrolling; the phone width covers the narrow layouts.
const viewports = [
  { name: 'desktop', width: 1280, height: 400 },
  { name: 'phone', width: 390, height: 400 },
];

async function scrollBy(page: Page, y: number) {
  await page.evaluate((dy) => window.scrollBy(0, dy), y);
}

for (const vp of viewports) {
  for (const { name, path } of pages) {
    test(`the top bar stays fixed while the ${name} page scrolls at ${vp.name} width`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(path);
      // A page on the shell draws its bar before its data has loaded: wait for the page's own heading, so it is as tall as it will be.
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      const bar = page.getByRole('banner').first();
      await expect(bar).toBeVisible();
      // The block that follows the bar is the page content.
      const content = bar.locator('xpath=following-sibling::*[1]');
      await expect(content).toBeVisible();

      const bar0 = await bar.boundingBox();
      const content0 = await content.boundingBox();
      if (!bar0 || !content0) throw new Error('the bar or the content has no box');
      expect(bar0.y).toBe(0);
      // The bar does not cover the content.
      expect(content0.y).toBeGreaterThanOrEqual(bar0.y + bar0.height);

      await scrollBy(page, 200);
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

      // The content scrolled underneath; the bar did not move.
      const bar1 = await bar.boundingBox();
      const content1 = await content.boundingBox();
      if (!bar1 || !content1) throw new Error('the bar or the content has no box');
      expect(bar1.y).toBe(0);
      expect(content1.y).toBeLessThan(content0.y);
      // What the bar sits over is the bar itself (the bar is on top).
      const topmost = await page.evaluate(() => document.elementFromPoint(8, 8)?.closest('header') !== null);
      expect(topmost).toBe(true);
    });
  }
}

// The Desk Agent page fills the viewport (TC-6.4): the window does not scroll, the active tab's panel does, and the top
// bar stays where it is and on top. (It used to scroll with the window, which the shell replaced.)
for (const vp of viewports) {
  test(`the top bar stays fixed while the Desk Agent page scrolls inside at ${vp.name} width`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(`/o/${ORG}/p/${INVOICER_API}/desk/agent`);
    await expect(page.getByRole('heading', { level: 1, name: 'Agent & settings' })).toBeVisible();
    const bar = page.getByRole('banner').first();
    await expect(bar).toBeVisible();
    const bar0 = await bar.boundingBox();
    if (!bar0) throw new Error('the bar has no box');
    expect(bar0.y).toBe(0);

    // The window never scrolls; the panel under the tab strip does.
    const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollHeight, inner: window.innerHeight }));
    expect(o.scroll).toBe(o.inner);
    await scrollBy(page, 200);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const moved = await page.getByRole('tabpanel').evaluate((el) => {
      const area = [el as HTMLElement, ...Array.from(el.querySelectorAll<HTMLElement>('*'))].find(
        (n) => ['auto', 'scroll'].includes(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight,
      );
      if (!area) return -1;
      area.scrollTo(0, 200);
      return area.scrollTop;
    });
    expect(moved).toBeGreaterThan(0);

    const bar1 = await bar.boundingBox();
    if (!bar1) throw new Error('the bar has no box');
    expect(bar1.y).toBe(0);
    // What sits at the bar's corner is the bar itself: the bar is on top.
    const topmost = await page.evaluate(() => document.elementFromPoint(8, 8)?.closest('header') !== null);
    expect(topmost).toBe(true);
  });
}

test('a dialog opened on a Desk page dims the top bar too', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 400 });
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/desk/skills`);
  await page.getByRole('button', { name: 'Delete skill' }).click();
  const dialog = page.getByRole('dialog', { name: /^Delete skill / });
  await expect(dialog).toBeVisible();

  const barIsCovered = await page.evaluate(
    () => !document.querySelector('header')?.contains(document.elementFromPoint(8, 8)),
  );
  expect(barIsCovered).toBe(true);
});
