import { expect, test, type Locator, type Page } from '@playwright/test';
import { INVOICER_API, ORG, SCRIPTED_RUN, seedOnboarding, seedTenantAdmin } from './mock';
import type { TenantAdminScenario } from '../../src/mocks/msw/tenantAdminScenarios';

/**
 * The app top bar (spec 2026-11-22-org-tenant-admin-design.md "E2E requirements": TC-43.1 to TC-43.8, TC-46.1 to
 * TC-46.3, TC-47.1 to TC-47.4, TC-48.1, TC-48.2). The caller's role is the tenant-admin mock scenario, seeded before
 * the first goto.
 */

const PROJECTS = `/o/${ORG}/projects`;
const PROJECT = `/o/${ORG}/p/${INVOICER_API}`;
const RUN = `${PROJECT}/runs/${SCRIPTED_RUN}`;

async function open(page: Page, scenario: TenantAdminScenario, path: string): Promise<void> {
  await seedTenantAdmin(page, scenario);
  await page.goto(path);
}

const mainNav = (page: Page): Locator => page.getByRole('navigation', { name: 'Organization sections' });
const tab = (page: Page, name: string): Locator => mainNav(page).getByRole('link', { name, exact: true });
// Org, project and run pages are on the shell: the org entries are in the org menu, and the old tab bar is gone.
const orgMenu = (page: Page): Locator => page.getByRole('navigation', { name: 'Organization menu' });
const menuLink = (page: Page, name: string): Locator => orgMenu(page).getByRole('link', { name, exact: true });
const FULL_MENU = ['Projects', 'Members', 'Invitations', 'Audit log', 'General'];
const bar = (page: Page): Locator => page.getByRole('banner');

test.describe('BR-43: top-bar tabs per level', () => {
  test('TC-43.1: the owner on Projects sees Projects and the Settings items in the org menu, Projects current', async ({
    page,
  }) => {
    await open(page, 'twoOwners', PROJECTS);
    await expect(orgMenu(page).getByRole('link')).toHaveText(FULL_MENU);
    await expect(menuLink(page, 'Projects')).toHaveAttribute('aria-current', 'page');
    await expect(menuLink(page, 'General')).not.toHaveAttribute('aria-current', 'page');
  });

  test('TC-43.2: the owner on Settings, General has General current in the org menu', async ({ page }) => {
    await open(page, 'twoOwners', `/o/${ORG}/settings/general`);
    await expect(menuLink(page, 'General')).toHaveAttribute('aria-current', 'page');
    await expect(menuLink(page, 'Projects')).not.toHaveAttribute('aria-current', 'page');
  });

  test('TC-43.3: a member on Projects sees only the Projects item', async ({ page }) => {
    await open(page, 'member', PROJECTS);
    await expect(orgMenu(page).getByRole('link')).toHaveText(['Projects']);
    await expect(orgMenu(page).getByText('Settings', { exact: true })).toHaveCount(0);
  });

  test('TC-43.4: the owner on a project page sees the Project menu with Runs and no section tabs in the bar', async ({
    page,
  }) => {
    await open(page, 'twoOwners', `${PROJECT}/runs`);
    await expect(
      page.getByRole('navigation', { name: 'Project menu' }).getByRole('link', { name: /^Runs/ }),
    ).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Project sections' })).toHaveCount(0);
    await expect(bar(page).getByRole('link', { name: 'Project settings' })).toHaveCount(0);
    await expect(tab(page, 'Projects')).toHaveCount(0);
  });

  test('TC-43.5: a run page shows crumbs only and no tab list', async ({ page }) => {
    await open(page, 'twoOwners', RUN);
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
    await expect(mainNav(page)).toHaveCount(0);
    await expect(bar(page).getByRole('navigation')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Projects', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Org settings', exact: true })).toHaveCount(0);
  });

  // The tabs moved to the side menu (BR-56): the page shows the active org's menu with no current item, and no bar tabs.
  test('TC-43.6: the My invitations page shows the org menu with no item current and no tabs in the bar', async ({
    page,
  }) => {
    await open(page, 'twoOwners', '/invitations');
    const menu = page.getByRole('navigation', { name: 'Organization menu' });
    await expect(menu.getByRole('link', { name: 'Projects' })).toBeVisible();
    await expect(menu.locator('[aria-current]')).toHaveCount(0);
    await expect(mainNav(page)).toHaveCount(0);
  });

  test('TC-43.7: the old needs-you address is "Page not found" with no organization tabs in the bar', async ({
    page,
  }) => {
    await open(page, 'twoOwners', `${PROJECT}/needs-you`);
    await expect(page.getByRole('main').getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(mainNav(page)).toHaveCount(0);
  });

  test('TC-43.8: the Create organization page shows no organization tabs', async ({ page }) => {
    await seedOnboarding(page, 'platformAdminNoOrg');
    await page.goto('/platform/orgs/new');
    await expect(page.getByRole('heading', { name: 'Create an organization', level: 1 })).toBeVisible();
    await expect(bar(page)).toBeVisible();
    await expect(mainNav(page)).toHaveCount(0);
    // The page is in the platform shell: the bar carries the breadcrumb and no section links; the Platform menu is beside the page.
    await expect(bar(page).getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
    await expect(bar(page).getByRole('navigation', { name: 'Platform sections' })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Platform menu' })).toBeVisible();
    await expect(bar(page).getByRole('link', { name: 'Projects', exact: true })).toHaveCount(0);
    await expect(bar(page).getByRole('link', { name: 'Org settings', exact: true })).toHaveCount(0);
  });
});

test.describe('BR-46: run page crumbs', () => {
  test('TC-46.1: the crumbs read Org / Project / Runs / Run N', async ({ page }) => {
    await open(page, 'twoOwners', RUN);
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(crumbs).toBeVisible();
    // One org: the org crumb is its plain name (BR-47 of the shell spec); the run page's menu starts collapsed.
    await expect(crumbs.getByText('Alice', { exact: true })).toBeVisible();
    await expect(crumbs.getByRole('button', { name: 'Switch project, currently invoicer-api' })).toBeVisible();
    await expect(crumbs.getByRole('link', { name: 'Runs', exact: true })).toBeVisible();
    await expect(crumbs.getByText(`Run ${SCRIPTED_RUN}`, { exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(crumbs.locator('b[aria-current="page"], a, button')).toHaveText([
      /invoicer-api/,
      'Runs',
      `Run ${SCRIPTED_RUN}`,
    ]);
  });

  test('TC-46.2: pressing Runs opens the project Runs list', async ({ page }) => {
    await open(page, 'twoOwners', RUN);
    await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Runs', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${PROJECT}/runs$`));
  });

  test('TC-46.3: pressing the project crumb opens the project switcher', async ({ page }) => {
    await open(page, 'twoOwners', RUN);
    const button = page.getByRole('button', { name: 'Switch project, currently invoicer-api' });
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('dialog', { name: 'Projects' })).toBeVisible();
  });
});

test.describe('BR-47: Settings in two clicks', () => {
  // On the shell the org switcher holds scopes only (BR-45): from a project page the org Settings are "All projects"
  // in the project menu, then the Settings item in the org menu.
  async function settingsFromProject(page: Page, landing: RegExp, subTab: string, only?: string): Promise<void> {
    await page.getByRole('navigation', { name: 'Project menu' }).getByRole('link', { name: 'All projects' }).click();
    await menuLink(page, subTab).click();
    await expect(page).toHaveURL(landing);
    await expect(page.getByRole('heading', { name: subTab, level: 1 })).toBeVisible();
    await expect(menuLink(page, subTab)).toHaveAttribute('aria-current', 'page');
    if (only !== undefined) await expect(orgMenu(page).getByRole('link')).toHaveText(['Projects', only]);
  }

  test('TC-47.1: the owner on a project Runs page reaches Members', async ({ page }) => {
    await open(page, 'twoOwners', `${PROJECT}/runs`);
    await settingsFromProject(page, /\/settings\/members$/, 'Members');
  });

  test('TC-47.2: a project admin on a Runs page reaches Invitations', async ({ page }) => {
    await open(page, 'projectAdmin', `${PROJECT}/runs`);
    await settingsFromProject(page, /\/settings\/invitations$/, 'Invitations', 'Invitations');
  });

  test('TC-47.3: the owner on a Desk page reaches Members', async ({ page }) => {
    await open(page, 'twoOwners', `${PROJECT}/desk/agent`);
    await settingsFromProject(page, /\/settings\/members$/, 'Members');
  });

  test('TC-47.4: the owner on a run page reaches Members', async ({ page }) => {
    await open(page, 'twoOwners', RUN);
    await page.getByRole('button', { name: 'Expand menu' }).click();
    await settingsFromProject(page, /\/settings\/members$/, 'Members');
  });
});

test.describe('BR-48: the logo', () => {
  const logo = (page: Page): Locator => page.getByRole('link', { name: 'Agent Desk, all projects' });

  test('TC-48.1: on a project page the logo opens the org Projects page', async ({ page }) => {
    await open(page, 'twoOwners', `${PROJECT}/runs`);
    await logo(page).click();
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/projects$`));
    await expect(menuLink(page, 'Projects')).toHaveAttribute('aria-current', 'page');
  });

  test('TC-48.2: on a run page and on Settings the logo opens the org Projects page', async ({ page }) => {
    await open(page, 'twoOwners', RUN);
    await logo(page).click();
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/projects$`));
    await expect(menuLink(page, 'Projects')).toHaveAttribute('aria-current', 'page');

    await page.goto(`/o/${ORG}/settings/general`);
    await expect(menuLink(page, 'General')).toHaveAttribute('aria-current', 'page');
    await logo(page).click();
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/projects$`));
    await expect(menuLink(page, 'Projects')).toHaveAttribute('aria-current', 'page');
  });
});
