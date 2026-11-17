import { expect, test, type Page } from '@playwright/test';
import { INVOICER_API, ORG, PAUSED_RUN } from './mock';

const pages: { name: string; path: string }[] = [
  { name: 'Projects', path: `/o/${ORG}/projects` },
  { name: 'Runs', path: `/o/${ORG}/p/${INVOICER_API}/runs` },
  { name: 'Needs you', path: `/o/${ORG}/p/${INVOICER_API}/needs-you` },
  { name: 'Desk skills', path: `/o/${ORG}/p/${INVOICER_API}/desk/skills` },
  { name: 'Desk routing rules', path: `/o/${ORG}/p/${INVOICER_API}/desk/rules` },
  { name: 'Run detail', path: `/o/${ORG}/p/${INVOICER_API}/runs/${PAUSED_RUN}` },
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
      const bar = page.getByRole('banner');
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

test('a dialog opened on a Desk page dims the top bar too, even after scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 400 });
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/desk/skills`);
  await page.getByRole('button', { name: 'Delete skill' }).click();
  const dialog = page.getByRole('dialog', { name: /^Delete skill / });
  await expect(dialog).toBeVisible();

  await scrollBy(page, 200);
  const barIsCovered = await page.evaluate(
    () => !document.querySelector('header')?.contains(document.elementFromPoint(8, 8)),
  );
  expect(barIsCovered).toBe(true);
});
