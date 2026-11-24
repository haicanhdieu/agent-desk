import { expect, test, type Locator, type Page } from '@playwright/test';
import { INVOICER_API, SCRIPTED_RUN, seedOnboarding, seedPlatform } from './mock';

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

const crumbs = (page: Page): Locator => page.getByRole('navigation', { name: 'Breadcrumb' });
const ACME_ID = 'b8000000-0000-4000-8000-000000000001';

test.describe('breadcrumb and title', () => {
  test('the org Projects page reads Projects and is titled "Projects · Alice · Agent Desk"', async ({ page }) => {
    await seedOnboarding(page, 'owner');
    await page.goto('/o/acme/projects');
    await expect(crumbs(page).locator('b[aria-current="page"]')).toHaveText('Projects');
    const org = (await crumbs(page).getByRole('button').first().textContent())?.trim() ?? '';
    expect(org).not.toBe('');
    await expect(page).toHaveTitle(`Projects · ${org} · Agent Desk`);
  });

  test('a run page reads Runs / Run N with Runs linking to the project runs', async ({ page }) => {
    await seedOnboarding(page, 'owner');
    await page.goto(`/o/acme/p/${INVOICER_API}/runs/${SCRIPTED_RUN}`);
    await expect(crumbs(page).locator('b[aria-current="page"]')).toHaveText(`Run ${SCRIPTED_RUN}`);
    const runs = crumbs(page).getByRole('link', { name: 'Runs', exact: true });
    await expect(runs).toHaveAttribute('href', `/o/acme/p/${INVOICER_API}/runs`);
    await expect(page).toHaveTitle(`Run ${SCRIPTED_RUN} · invoicer-api · Agent Desk`);
    await runs.click();
    await expect(page).toHaveURL(new RegExp(`/o/acme/p/${INVOICER_API}/runs$`));
    await expect(page).toHaveTitle('Runs · invoicer-api · Agent Desk');
  });

  test('a Desk page reads Project settings / Skills', async ({ page }) => {
    await seedOnboarding(page, 'owner');
    await page.goto(`/o/acme/p/${INVOICER_API}/desk/skills`);
    await expect(crumbs(page).getByText('Project settings', { exact: true })).toBeVisible();
    await expect(crumbs(page).locator('b[aria-current="page"]')).toHaveText('Skills');
  });

  test('a platform org members page reads Organizations / <org> / Members and every crumb but the last is a link', async ({
    page,
  }) => {
    await seedPlatform(page, 'platformAdminOrgs');
    await page.goto(`/platform/orgs/${ACME_ID}/members`);
    await expect(crumbs(page).locator('b[aria-current="page"]')).toHaveText('Members');
    await expect(crumbs(page).getByRole('link', { name: 'Organizations', exact: true })).toHaveAttribute(
      'href',
      '/platform/orgs',
    );
    await expect(crumbs(page).getByRole('link', { name: 'Acme' })).toHaveAttribute('href', `/platform/orgs/${ACME_ID}`);
  });
});
