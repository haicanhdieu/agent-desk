import { expect, test } from '@playwright/test';
import { seedOnboarding } from './mock';

/**
 * Navigation shell accessibility (spec 2026-11-24-admin-navigation-consistency): the skip link, one banner and one
 * main, distinct nav names, and the title of an unknown route.
 */
test.describe('accessibility', () => {
  test('the first Tab focuses "Skip to main content" and Enter focuses main', async ({ page }) => {
    await seedOnboarding(page, 'owner');
    await page.goto('/o/acme/projects');
    await expect(page.getByRole('main')).toBeVisible();
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();
  });

  test('the org page has one banner, one main and no two navs with the same name', async ({ page }) => {
    await seedOnboarding(page, 'owner');
    await page.goto('/o/acme/projects');
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('banner')).toHaveCount(1);
    const labels = await page.locator('nav').evaluateAll((navs) => navs.map((n) => n.getAttribute('aria-label')));
    expect(labels.length).toBeGreaterThan(0);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).not.toContain('Main');
    expect(labels).not.toContain(null);
  });

  test('an unknown route is titled "Not found · Agent Desk"', async ({ page }) => {
    await seedOnboarding(page, 'owner');
    await page.goto('/no/such/page/anywhere');
    await expect(page).toHaveTitle('Not found · Agent Desk');
  });
});
