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
    // One org has no switch button: the bar shows its name as text, and the title carries the same name.
    await expect(page).toHaveTitle(/^Projects · .+ · Agent Desk$/);
    const org = /^Projects · (.+) · Agent Desk$/.exec(await page.title())?.[1] ?? '';
    expect(org).not.toBe('');
    await expect(crumbs(page)).toContainText(org);
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

  test('a Desk page reads Skills, with no "Project settings" crumb (BR-10)', async ({ page }) => {
    await seedOnboarding(page, 'owner');
    await page.goto(`/o/acme/p/${INVOICER_API}/desk/skills`);
    await expect(crumbs(page).locator('[aria-current="page"]')).toHaveText('Skills');
    await expect(crumbs(page).getByText('Project settings', { exact: true })).toHaveCount(0);
    await expect(page).toHaveTitle('Skills · invoicer-api · Agent Desk');
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

test.describe('tab names', () => {
  test('the org menu reads Projects and the four Settings items, the project menu Runs and its Configure items, with no section tabs', async ({
    page,
  }) => {
    await seedOnboarding(page, 'owner');
    await page.goto('/o/acme/projects');
    const orgMenu = page.getByRole('navigation', { name: 'Organization menu' });
    await expect(orgMenu.getByRole('link')).toHaveText(['Projects', 'Members', 'Invitations', 'Audit log', 'General']);
    await expect(orgMenu.getByRole('link', { name: 'Org settings', exact: true })).toHaveCount(0);
    await expect(orgMenu.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0);

    await page.goto(`/o/acme/p/${INVOICER_API}/runs`);
    const projectMenu = page.getByRole('navigation', { name: 'Project menu' });
    await expect(projectMenu.getByRole('link', { name: /^Runs/ })).toBeVisible();
    await expect(projectMenu.getByRole('link', { name: 'Routing rules', exact: true })).toBeVisible();
    await expect(projectMenu.getByRole('link', { name: 'Project settings', exact: true })).toHaveCount(0);
    await expect(projectMenu.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Project sections' })).toHaveCount(0);
  });
});

test.describe('roles', () => {
  const orgMenu = (page: Page): Locator => page.getByRole('navigation', { name: 'Organization menu' });

  test('an org admin without the platform role sees no Platform entry and no "Manage in Platform"', async ({
    page,
  }) => {
    await seedOnboarding(page, 'orgAdmin');
    await page.goto('/o/acme/projects');
    await expect(orgMenu(page).getByRole('link', { name: 'Projects', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Platform', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Manage in Platform' })).toHaveCount(0);
  });

  test('a project admin sees no Platform entry and the org menu opens Invitations only', async ({ page }) => {
    await seedOnboarding(page, 'projectAdmin');
    await page.goto('/o/acme/projects');
    await expect(orgMenu(page).getByRole('link', { name: 'Projects', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Platform', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Manage in Platform' })).toHaveCount(0);

    await orgMenu(page).getByRole('link', { name: 'Invitations', exact: true }).click();
    await expect(orgMenu(page).getByRole('link', { name: 'Invitations', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    for (const name of ['General', 'Members', 'Audit log']) {
      await expect(orgMenu(page).getByRole('link', { name, exact: true })).toHaveCount(0);
    }
  });
});
