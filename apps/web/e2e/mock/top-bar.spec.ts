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
const bar = (page: Page): Locator => page.getByRole('banner');
const orgButton = (page: Page): Locator =>
  page.getByRole('button', { name: 'Switch scope, currently organization Alice' });

test.describe('BR-43: top-bar tabs per level', () => {
  test('TC-43.1: the owner on Projects sees the tabs Projects and Settings, Projects active', async ({ page }) => {
    await open(page, 'twoOwners', PROJECTS);
    await expect(mainNav(page).getByRole('link')).toHaveText(['Projects', 'Settings']);
    await expect(tab(page, 'Projects')).toHaveAttribute('aria-current', 'page');
    await expect(tab(page, 'Settings')).not.toHaveAttribute('aria-current', 'page');
  });

  test('TC-43.2: the owner on Settings, General has Settings active', async ({ page }) => {
    await open(page, 'twoOwners', `/o/${ORG}/settings/general`);
    await expect(tab(page, 'Settings')).toHaveAttribute('aria-current', 'page');
    await expect(tab(page, 'Projects')).not.toHaveAttribute('aria-current', 'page');
  });

  test('TC-43.3: a member on Projects sees only the Projects tab', async ({ page }) => {
    await open(page, 'member', PROJECTS);
    await expect(mainNav(page).getByRole('link')).toHaveText(['Projects']);
    await expect(tab(page, 'Settings')).toHaveCount(0);
  });

  test('TC-43.4: the owner on a project page sees the tabs Runs and Settings', async ({ page }) => {
    await open(page, 'twoOwners', `${PROJECT}/runs`);
    await expect(page.getByRole('navigation', { name: 'Project sections' }).getByRole('link')).toHaveText([
      /^Runs/,
      'Settings',
    ]);
    await expect(tab(page, 'Projects')).toHaveCount(0);
  });

  test('TC-43.5: a run page shows crumbs only and no tab list', async ({ page }) => {
    await open(page, 'twoOwners', RUN);
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
    await expect(mainNav(page)).toHaveCount(0);
    await expect(bar(page).getByRole('navigation')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Projects', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0);
  });

  test('TC-43.6: the My invitations page shows the org bar with no tab active', async ({ page }) => {
    await open(page, 'twoOwners', '/invitations');
    await expect(tab(page, 'Projects')).toBeVisible();
    await expect(tab(page, 'Settings')).toBeVisible();
    await expect(mainNav(page).locator('[aria-current]')).toHaveCount(0);
  });

  test('TC-43.7: the needs-you page shows the org bar with no tab active', async ({ page }) => {
    await open(page, 'twoOwners', `${PROJECT}/needs-you`);
    await expect(tab(page, 'Projects')).toBeVisible();
    await expect(tab(page, 'Settings')).toBeVisible();
    await expect(mainNav(page).locator('[aria-current]')).toHaveCount(0);
  });

  test('TC-43.8: the Create organization page shows no tabs', async ({ page }) => {
    await seedOnboarding(page, 'platformAdminNoOrg');
    await page.goto('/orgs/new');
    await expect(page.getByRole('heading', { name: 'Create an organization', level: 1 })).toBeVisible();
    await expect(bar(page)).toBeVisible();
    await expect(mainNav(page)).toHaveCount(0);
    await expect(bar(page).getByRole('navigation')).toHaveCount(1);
    await expect(bar(page).getByRole('navigation')).toHaveAccessibleName('Breadcrumb');
    await expect(bar(page).getByRole('link', { name: 'Projects', exact: true })).toHaveCount(0);
    await expect(bar(page).getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0);
  });
});

test.describe('BR-46: run page crumbs', () => {
  test('TC-46.1: the crumbs read Org / Project / Runs / Run N', async ({ page }) => {
    await open(page, 'twoOwners', RUN);
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(crumbs).toBeVisible();
    await expect(crumbs.getByRole('button').first()).toHaveAccessibleName('Switch scope, currently organization Alice');
    await expect(crumbs.getByRole('button', { name: 'Switch project, currently invoicer-api' })).toBeVisible();
    await expect(crumbs.getByRole('link', { name: 'Runs', exact: true })).toBeVisible();
    await expect(crumbs.getByText(`Run ${SCRIPTED_RUN}`, { exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(crumbs.locator('b[aria-current="page"], a, button')).toHaveText([
      /^Alice/,
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
  async function settingsInTwoClicks(page: Page, landing: RegExp, subTab: string, only?: string): Promise<void> {
    await orgButton(page).click();
    await page.getByRole('dialog', { name: 'Scope' }).getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(landing);
    await expect(page.getByRole('heading', { name: subTab, level: 1 })).toBeVisible();
    await expect(tab(page, 'Settings')).toHaveAttribute('aria-current', 'page');
    const sideMenu = page.getByRole('navigation', { name: 'Organization settings' });
    await expect(sideMenu.getByRole('link', { name: subTab, exact: true })).toHaveAttribute('aria-current', 'page');
    if (only !== undefined) await expect(sideMenu.getByRole('link')).toHaveText([only]);
  }

  test('TC-47.1: the owner on a project Runs page reaches General', async ({ page }) => {
    await open(page, 'twoOwners', `${PROJECT}/runs`);
    await settingsInTwoClicks(page, /\/settings\/general$/, 'General');
  });

  test('TC-47.2: a project admin on a Runs page reaches Invitations', async ({ page }) => {
    await open(page, 'projectAdmin', `${PROJECT}/runs`);
    await settingsInTwoClicks(page, /\/settings\/invitations$/, 'Invitations', 'Invitations');
  });

  test('TC-47.3: the owner on a Desk page reaches General', async ({ page }) => {
    await open(page, 'twoOwners', `${PROJECT}/desk/agent`);
    await settingsInTwoClicks(page, /\/settings\/general$/, 'General');
  });

  test('TC-47.4: the owner on a run page reaches General', async ({ page }) => {
    await open(page, 'twoOwners', RUN);
    await settingsInTwoClicks(page, /\/settings\/general$/, 'General');
  });
});

test.describe('BR-48: the logo', () => {
  const logo = (page: Page): Locator => page.getByRole('link', { name: 'Agent Desk, all projects' });

  test('TC-48.1: on a project page the logo opens the org Projects page', async ({ page }) => {
    await open(page, 'twoOwners', `${PROJECT}/runs`);
    await logo(page).click();
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/projects$`));
    await expect(tab(page, 'Projects')).toHaveAttribute('aria-current', 'page');
  });

  test('TC-48.2: on a run page and on Settings the logo opens the org Projects page', async ({ page }) => {
    await open(page, 'twoOwners', RUN);
    await logo(page).click();
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/projects$`));
    await expect(tab(page, 'Projects')).toHaveAttribute('aria-current', 'page');

    await page.goto(`/o/${ORG}/settings/general`);
    await expect(tab(page, 'Settings')).toHaveAttribute('aria-current', 'page');
    await logo(page).click();
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/projects$`));
    await expect(tab(page, 'Projects')).toHaveAttribute('aria-current', 'page');
  });
});
