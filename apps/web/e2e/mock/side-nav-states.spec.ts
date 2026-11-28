import { expect, test, type Locator, type Page } from '@playwright/test';
import { FOREIGN } from '../../src/mocks/msw/shellScenarios';
import {
  INVOICER_API,
  ORG,
  OTHER_PROJECT,
  SESSION_MOCK_NOW,
  holdReads,
  release,
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

/*
 * Loading and failure states of the shell (same spec, "E2E requirements": BR-8 load error, BR-11 loading, BR-14 error and
 * collapsed landmarks, BR-15 a menu that fails to load). Failing reads are retried with growing pauses, so the first
 * appearance of an error waits up to RETRIED.
 */
const RETRIED = 15_000;
const orgProjectsUrl = `/o/${ORG}/projects`;
const menuError = (menu: Locator): Locator => menu.getByText('Could not load the menu.');
const GATED =
  /^(Members|Invitations|Audit log|General|Manage in Platform|Configure|Access|Routing rules|Skills|Workspace setup)/;

test.describe('BR-8: a page that failed to load, after Retry', () => {
  test('TC-8.5: after Retry the loaded Runs page has exactly one h1 at the standard position and size', async ({
    page,
  }) => {
    await holdReads(page, { projectRuns: 'fail' });
    await seedProjectSpace(page, { role: 'owner' });
    await page.goto(runsUrl(INVOICER_API));

    const main = page.getByRole('main');
    await expect(main.getByRole('button', { name: 'Retry' })).toBeVisible({ timeout: RETRIED });
    await setRead(page, 'projectRuns', undefined);
    await main.getByRole('button', { name: 'Retry' }).click();

    const h1 = main.getByRole('heading', { level: 1 });
    await expect(h1).toHaveCount(1);
    await expect(h1).toBeVisible();
    const onRuns = await h1.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, size: getComputedStyle(el).fontSize };
    });

    // The standard: the h1 of another loaded page, reached from the same menu.
    await projectMenu(page).getByRole('link', { name: 'Routing rules' }).click();
    const other = main.getByRole('heading', { level: 1 });
    await expect(other).toHaveCount(1);
    await expect(other).toBeVisible();
    const onRules = await other.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, size: getComputedStyle(el).fontSize };
    });
    expect(onRuns).toEqual(onRules);
  });
});

test.describe('BR-11: loading keeps the top bar and the side menu', () => {
  test('TC-11.1: while the Members list is held the bar and menu stay and the loading state is in the main only', async ({
    page,
  }) => {
    await holdReads(page, { members: 'hold' });
    await seedProjectSpace(page, { role: 'owner' });
    await page.goto(orgProjectsUrl);
    await orgMenu(page).getByRole('link', { name: 'Members', exact: true }).click();

    await expect(page.getByRole('main').locator('[aria-busy="true"]').first()).toBeVisible();
    await expect(bar(page)).toBeVisible();
    await expect(orgMenu(page)).toBeVisible();
    await expect(orgMenu(page).getByRole('link', { name: 'Members', exact: true })).toBeVisible();
    await expect(orgMenu(page).locator('[aria-busy="true"]')).toHaveCount(0);

    await release(page, 'members');
    await expect(page.getByRole('main').locator('[aria-busy="true"]')).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('table')).toBeVisible();
  });

  test('TC-11.2: a project page opened by address with its content held shows the bar and a menu region around the loading state', async ({
    page,
  }) => {
    await holdReads(page, { projectRuns: 'hold' });
    await seedProjectSpace(page, { role: 'owner' });
    await page.goto(runsUrl(INVOICER_API));

    await expect(page.getByRole('main').locator('[aria-busy="true"]').first()).toBeVisible();
    await expect(bar(page)).toBeVisible();
    await expect(anyMenu(page)).toBeVisible();
  });
});

test.describe('BR-14: landmarks on a collapsed menu and on a failed page', () => {
  test('TC-14.3: a run page (collapsed menu) and a failed page each have one banner, one main and a menu named "Project menu"', async ({
    page,
  }) => {
    await holdReads(page, { rules: 'fail' });
    await seedProjectSpace(page, { role: 'owner' });
    await page.goto(`/o/${ORG}/p/${INVOICER_API}/runs/62`);
    await expect(page.getByRole('button', { name: 'Expand menu' })).toBeVisible();
    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(projectMenu(page)).toHaveCount(1);

    await page.goto(rulesUrl(INVOICER_API));
    await expect(page.getByRole('main').getByRole('button', { name: 'Retry' })).toBeVisible({ timeout: RETRIED });
    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(projectMenu(page)).toHaveCount(1);
    await page.getByRole('button', { name: 'Collapse menu' }).click();
    await expect(page.getByRole('button', { name: 'Expand menu' })).toBeVisible();
    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(projectMenu(page)).toHaveCount(1);
  });
});

test.describe('BR-15: the data that decides the menu fails to load', () => {
  test('TC-15.1: a failed org access read leaves Projects and "Could not load the menu." with Retry and no gated item', async ({
    page,
  }) => {
    await holdReads(page, { orgAccess: 'fail' });
    await seedProjectSpace(page, { role: 'owner' });
    await page.goto(orgProjectsUrl);

    const menu = orgMenu(page);
    await expect(menu.getByRole('link', { name: 'Projects', exact: true })).toBeVisible();
    await expect(menuError(menu)).toBeVisible({ timeout: RETRIED });
    await expect(menu.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(menu.getByRole('link', { name: GATED })).toHaveCount(0);
    await expect(menu.getByText('Settings', { exact: true })).toHaveCount(0);
  });

  test('TC-15.2: a failed project read leaves Runs and the menu error with no project name, repository block, Configure or Access', async ({
    page,
  }) => {
    await holdReads(page, { projectDetail: 'fail' });
    await seedProjectSpace(page, { role: 'owner' });
    await page.goto(runsUrl(INVOICER_API));

    const menu = projectMenu(page);
    await expect(menu.getByRole('link', { name: 'Runs', exact: true })).toBeVisible();
    await expect(menuError(menu)).toBeVisible({ timeout: RETRIED });
    await expect(menu.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(menu).not.toContainText('invoicer-api');
    await expect(menu.getByRole('link', { name: 'Open repository' })).toHaveCount(0);
    await expect(menu.getByText(/^(Configure|Access)$/)).toHaveCount(0);
    await expect(menu.getByRole('link', { name: GATED })).toHaveCount(0);
  });

  test("TC-15.3: Retry in the failed menu clears the error and shows the owner's full org menu", async ({ page }) => {
    await holdReads(page, { orgAccess: 'fail' });
    await seedProjectSpace(page, { role: 'owner' });
    await page.goto(orgProjectsUrl);
    const menu = orgMenu(page);
    await expect(menuError(menu)).toBeVisible({ timeout: RETRIED });

    await setRead(page, 'orgAccess', undefined);
    await menu.getByRole('button', { name: 'Retry' }).click();

    await expect(menuError(menu)).toHaveCount(0);
    for (const name of ['Members', 'Invitations', 'Audit log', 'General']) {
      await expect(menu.getByRole('link', { name, exact: true })).toBeVisible();
    }
  });

  test('TC-15.4: a member on /invitations with the session access read failing sees the menu error, Retry and no gated item', async ({
    page,
  }) => {
    await seedOnboarding(page, 'member');
    await holdReads(page, { sessionAccess: 'fail' });
    await page.goto('/invitations');

    const menu = anyMenu(page);
    await expect(menuError(menu)).toBeVisible({ timeout: RETRIED });
    await expect(menu.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(menu.getByRole('link', { name: GATED })).toHaveCount(0);
  });

  test('TC-15.5: a platform admin on an org page whose platform check fails sees no platform item, no menu error and no Retry', async ({
    page,
  }) => {
    await seedOnboarding(page, 'platformAdminOneOrg');
    await holdReads(page, { platformAdmin: 'fail' });
    let answered = 0;
    page.on('response', (response) => {
      if (new URL(response.url()).pathname === '/api/me/platform') answered += 1;
    });
    await page.goto(orgProjectsUrl);

    const menu = orgMenu(page);
    await expect(menu.getByRole('link', { name: 'Projects', exact: true })).toBeVisible();
    // The failing check is tried twice more with growing pauses before it settles as failed: wait for the third answer.
    await expect.poll(() => answered, { timeout: RETRIED }).toBeGreaterThanOrEqual(3);
    await expect(menu.getByRole('link', { name: 'Manage in Platform' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Platform', exact: true })).toHaveCount(0);
    await expect(menuError(menu)).toHaveCount(0);
    await expect(menu.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  });
});
