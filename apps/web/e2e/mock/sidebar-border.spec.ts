import { expect, test, type Page } from '@playwright/test';
import { INVOICER_API, ORG, seedProjectSpace } from './mock';

/** The element that actually draws the side menu's vertical separator, and where that line ends on screen. */
async function separatorOf(page: Page, menuName: string) {
  return page.getByRole('navigation', { name: menuName }).evaluate((nav) => {
    for (let el: Element | null = nav; el; el = el.parentElement) {
      const border = Number.parseFloat(getComputedStyle(el).borderRightWidth);
      if (border > 0) {
        const box = el.getBoundingClientRect();
        return { border, top: box.top, bottom: box.bottom, viewportBottom: window.innerHeight };
      }
    }
    return { border: 0, top: 0, bottom: 0, viewportBottom: window.innerHeight };
  });
}

test('TC-323.1: the project menu separator reaches the bottom of a tall viewport with short menu content', async ({
  page,
}) => {
  await seedProjectSpace(page, { role: 'member' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/runs`);
  const menu = page.getByRole('navigation', { name: 'Project menu' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Runs' })).toBeVisible();

  const separator = await separatorOf(page, 'Project menu');
  expect(separator.border).toBe(1);
  // The line must still be drawn on the last pixel above the bottom of the window, not stop at the last menu link.
  expect(separator.top).toBeLessThan(separator.viewportBottom - 1);
  expect(separator.bottom).toBeGreaterThanOrEqual(separator.viewportBottom - 1);
});
