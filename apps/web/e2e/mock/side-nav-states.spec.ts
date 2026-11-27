import { expect, test, type Locator, type Page } from '@playwright/test';
import { FOREIGN } from '../../src/mocks/msw/shellScenarios';
import {
  INVOICER_API,
  ORG,
  OTHER_PROJECT,
  SESSION_MOCK_NOW,
  holdReads,
  seedOnboarding,
  seedPlatform,
  seedProjectSpace,
  seedShell,
  setRead,
} from './mock';

/*
 * The side-menu shell around error pages (spec 2026-11-25-sidebar-navigation-shell-design.md "E2E requirements":
 * BR-12 error pages keep the shell, BR-13 an inaccessible name appears nowhere, BR-16 "Go to projects" never leads back
 * to the address that was refused). The local halves of TC-12.1, TC-12.2, TC-12.3, TC-12.5, TC-13.1 to TC-13.3 and
 * TC-16.1 to TC-16.3 are not in this file: Task 43 adds them to e2e/local.
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

const notFound = (page: Page): Locator => page.getByRole('heading', { name: 'Page not found' });
const orgMenu = (page: Page): Locator => page.getByRole('navigation', { name: 'Organization menu' });
const projectMenu = (page: Page): Locator => page.getByRole('navigation', { name: 'Project menu' });
const platformMenu = (page: Page): Locator => page.getByRole('navigation', { name: 'Platform menu' });
const anyMenu = (page: Page): Locator => page.getByRole('navigation', { name: /menu$/ });
const bar = (page: Page): Locator => page.getByRole('banner').first();
const switcher = (page: Page): Locator => bar(page).getByRole('button', { name: /^Switch scope/ });
/** The org place of the bar: the switcher button, or the plain org name when there is only one org to be in. */
const orgPlace = (page: Page): Locator => bar(page).getByText('Alice', { exact: true });
const current = (menu: Locator): Locator => menu.locator('[aria-current="page"]');

/** Nothing of `text` is on the page: not in the visible text (bar, menu, crumbs, content) and not in the title. */
async function appearsNowhere(page: Page, ...texts: string[]): Promise<void> {
  for (const text of texts) {
    await expect(page.locator('body')).not.toContainText(text);
    expect(await page.title()).not.toContain(text);
  }
}

const rulesUrl = (project: string): string => `/o/${ORG}/p/${project}/desk/rules`;
const runsUrl = (project: string): string => `/o/${ORG}/p/${project}/runs`;

test.describe('BR-12: error pages keep the shell', () => {
  test('TC-12.1: a member on Routing rules sees "You don\'t have access" in the main with the project menu and no current item', async ({
    page,
  }) => {
    await seedProjectSpace(page, { role: 'member' });
    await page.goto(rulesUrl(INVOICER_API));

    await expect(page.getByRole('main').getByRole('heading', { name: "You don't have access" })).toBeVisible();
    await expect(bar(page)).toBeVisible();
    await expect(orgPlace(page)).toBeVisible();
    const menu = projectMenu(page);
    await expect(menu.getByRole('link', { name: 'Runs' })).toBeVisible();
    // The repository block: the repo's link and its owner and name.
    await expect(menu.getByRole('link', { name: 'Open repository' })).toBeVisible();
    await expect(menu.getByText('invoicer-api').first()).toBeVisible();
    await expect(current(menu)).toHaveCount(0);
  });

  test('TC-12.2: a project admin of P1 on P2\'s Runs address sees "Page not found" with the org menu and no current item', async ({
    page,
  }) => {
    await seedProjectSpace(page, { role: 'projectAdmin' });
    await page.goto(runsUrl(OTHER_PROJECT));

    await expect(page.getByRole('main').getByRole('heading', { name: 'Page not found' })).toBeVisible();
    const menu = orgMenu(page);
    await expect(menu).toBeVisible();
    await expect(current(menu)).toHaveCount(0);
    await expect(projectMenu(page)).toHaveCount(0);
    await expect(orgPlace(page)).toBeVisible();
  });

  test('TC-12.3: a non-member org slug shows "Page not found" with no menu and the switcher reading "Organization"', async ({
    page,
  }) => {
    await seedOnboarding(page, 'twoOrgs');
    await page.goto('/o/zephyr-foreign/projects');

    await expect(page.getByRole('main').getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(anyMenu(page)).toHaveCount(0);
    await expect(bar(page)).toBeVisible();
    await expect(switcher(page)).toHaveText(/Organization/);
    await expect(orgMenu(page)).toHaveCount(0);
  });

  test('TC-12.4: an unknown address outside any org shows "Page not found" with no menu and the switcher', async ({
    page,
  }) => {
    await seedOnboarding(page, 'twoOrgs');
    await page.goto('/nowhere/at/all');

    await expect(page.getByRole('main').getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(anyMenu(page)).toHaveCount(0);
    await expect(bar(page)).toBeVisible();
    await expect(switcher(page)).toBeVisible();
  });

  test('TC-12.5: a person who is not a platform admin on /platform/orgs sees the forbidden message with no menu', async ({
    page,
  }) => {
    await seedPlatform(page, 'ownerNoPlatform');
    await page.goto('/platform/orgs');

    const main = page.getByRole('main');
    await expect(main.getByText('This area is for platform admins.', { exact: true })).toBeVisible();
    await expect(anyMenu(page)).toHaveCount(0);
    await expect(bar(page)).toBeVisible();
    await expect(orgPlace(page)).toBeVisible();
  });

  test('TC-12.6: an unknown platform org shows "Page not found" with the platform menu and Organizations current', async ({
    page,
  }) => {
    await seedPlatform(page, 'platformAdminOrgs');
    await page.goto('/platform/orgs/b8000000-0000-4000-8000-0000000000ff');

    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(main.getByText('This organization does not exist.', { exact: true })).toBeVisible();
    await expect(platformMenu(page).getByRole('link', { name: 'Organizations', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('TC-12.7: a failing Routing rules read shows the banner with request id and Retry, the switchers and Routing rules current', async ({
    page,
  }) => {
    await holdReads(page, { rules: 'fail' });
    await seedProjectSpace(page, { role: 'owner' });
    await page.goto(rulesUrl(INVOICER_API));

    const main = page.getByRole('main');
    await expect(main.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(main.getByText(/Request ID/)).toBeVisible();
    await expect(orgPlace(page)).toBeVisible();
    await expect(projectMenu(page).getByRole('link', { name: 'Routing rules' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('TC-12.8: a crashing Routing rules page shows "Something went wrong" with Reload, the project menu and its item current', async ({
    page,
  }) => {
    await holdReads(page, { rules: 'crash' });
    await seedProjectSpace(page, { role: 'owner' });
    await page.goto(rulesUrl(INVOICER_API));

    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Reload' })).toBeVisible();
    await expect(orgPlace(page)).toBeVisible();
    await expect(projectMenu(page).getByRole('link', { name: 'Routing rules' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('TC-12.9: with one org and no platform role a non-member slug shows Not found, no menu and the switcher place as plain text', async ({
    page,
  }) => {
    await seedShell(page, 'oneOrgNoPlatform');
    await page.goto('/o/zephyr-foreign/projects');

    await expect(page.getByRole('main').getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(anyMenu(page)).toHaveCount(0);
    await expect(bar(page).getByRole('button', { name: /^Switch scope/ })).toHaveCount(0);
    await expect(bar(page).getByText('Alice', { exact: true })).toBeVisible();
  });

  test('TC-12.10: Tab then Enter on the skip link focuses the main that holds the error message', async ({ page }) => {
    await seedOnboarding(page, 'twoOrgs');
    await page.goto('/nowhere/at/all');
    await expect(notFound(page)).toBeVisible();

    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');

    const main = page.getByRole('main');
    await expect(main).toBeFocused();
    await expect(main.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  });
});

test.describe('BR-13: an inaccessible name appears nowhere', () => {
  test("TC-13.1: org B's name and its project's name appear nowhere on its Projects and Runs addresses", async ({
    page,
  }) => {
    await seedShell(page, 'foreignOrg');

    await page.goto(`/o/${FOREIGN.orgSlug}/projects`);
    await expect(notFound(page)).toBeVisible();
    await appearsNowhere(page, FOREIGN.orgName, FOREIGN.projectName);

    await page.goto(`/o/${FOREIGN.orgSlug}/p/${FOREIGN.projectId}/runs`);
    await expect(notFound(page)).toBeVisible();
    await appearsNowhere(page, FOREIGN.orgName, FOREIGN.projectName);
  });

  test("TC-13.2: a project admin of P1 sees P2's name nowhere on its Runs and Routing rules addresses", async ({
    page,
  }) => {
    await seedProjectSpace(page, { role: 'projectAdmin' });

    await page.goto(runsUrl(OTHER_PROJECT));
    await expect(notFound(page)).toBeVisible();
    await appearsNowhere(page, 'invoicer-web');

    await page.goto(rulesUrl(OTHER_PROJECT));
    await expect(notFound(page)).toBeVisible();
    await appearsNowhere(page, 'invoicer-web');
  });

  test("TC-13.3: org B's project id under org A's slug is Not found and names neither org B nor its project", async ({
    page,
  }) => {
    await seedShell(page, 'foreignOrg');
    await page.goto(runsUrl(FOREIGN.projectId));

    await expect(notFound(page)).toBeVisible();
    await appearsNowhere(page, FOREIGN.orgName, FOREIGN.projectName);
  });

  test("TC-13.4: after P2's read starts answering 404, going back to P2 shows Not found and names it nowhere", async ({
    page,
  }) => {
    await page.clock.install({ time: new Date(SESSION_MOCK_NOW) });
    await seedProjectSpace(page, { role: 'owner' });
    await page.goto(runsUrl(OTHER_PROJECT));
    await expect(page.getByText('invoicer-web').first()).toBeVisible();

    await page.getByRole('navigation', { name: 'Project menu' }).getByRole('link', { name: 'All projects' }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/projects$`));

    // Access is removed while the app keeps running: the project read answers 404 (the list never answers, so the
    // Projects page cannot refill what the app knows of P2), and what it knows is old enough to be asked again.
    await setRead(page, 'projectDetail', 'notFound');
    await setRead(page, 'projectList', 'pending');
    await page.clock.fastForward('02:00');
    await page.evaluate(() => window.history.back());

    await expect(notFound(page)).toBeVisible();
    await appearsNowhere(page, 'invoicer-web');
  });
});

test.describe('BR-16: "Go to projects" never leads back to the refused address', () => {
  test('TC-16.1: from a non-member org\'s address "Go to projects" opens the active org\'s Projects', async ({
    page,
  }) => {
    await seedShell(page, 'foreignOrg');
    await page.goto(`/o/${FOREIGN.orgSlug}/projects`);
    await expect(notFound(page)).toBeVisible();

    await page.getByRole('link', { name: 'Go to projects' }).click();

    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
    await expect(notFound(page)).toHaveCount(0);
    expect(page.url()).not.toContain(FOREIGN.orgSlug);
  });

  test('TC-16.2: from P2\'s Not found "Go to projects" opens org A\'s Projects', async ({ page }) => {
    await seedProjectSpace(page, { role: 'projectAdmin' });
    await page.goto(runsUrl(OTHER_PROJECT));
    await expect(notFound(page)).toBeVisible();

    await page.getByRole('link', { name: 'Go to projects' }).click();

    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/projects$`));
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
  });

  test('TC-16.3: from the forbidden /platform/orgs "Go to projects" opens the active org\'s Projects', async ({
    page,
  }) => {
    await seedPlatform(page, 'ownerNoPlatform');
    await page.clock.install({ time: new Date(SESSION_MOCK_NOW) });
    await page.goto('/platform/orgs');
    await expect(page.getByText('This area is for platform admins.', { exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Go to projects' }).click();

    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/\/o\/[^/]+\/projects$/);
  });

  test('TC-16.4: with no org, "Go to projects" on an unknown address opens /invitations', async ({ page }) => {
    await seedOnboarding(page, 'noOrgInvited');
    await page.goto('/nowhere/at/all');
    await expect(notFound(page)).toBeVisible();

    await page.getByRole('link', { name: 'Go to projects' }).click();

    await expect(page).toHaveURL(/\/invitations$/);
    await expect(notFound(page)).toHaveCount(0);
  });
});
