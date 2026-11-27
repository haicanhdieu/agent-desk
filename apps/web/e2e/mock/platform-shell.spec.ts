import { expect, test, type Locator, type Page } from '@playwright/test';
import type { PlatformScenario } from '../../src/mocks/msw/platformScenarios';
import { ORG, SESSION_MOCK_NOW, seedPlatform, startSignedOut } from './mock';

/*
 * The platform shell: the "Platform admin" entry of the org menu, and the forbidden and signed-out answers of /platform
 * (spec 2026-11-23-platform-admin-dashboard-design.md "E2E requirements": TC-1.1 to TC-1.3, TC-2.1 to TC-2.3, TC-3.1, TC-3.3, TC-3.4).
 *
 * Every test seeds the case's platform scenario (mock.ts `seedPlatform`) before its first goto; the mock store reseeds on
 * every page load, so each test stays in the app after it (clicks, no second goto).
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

async function open(page: Page, scenario: PlatformScenario, path: string): Promise<void> {
  await page.clock.install({ time: new Date(SESSION_MOCK_NOW) });
  await seedPlatform(page, scenario);
  await page.goto(path);
}

const orgMenuButton = (page: Page): Locator => page.getByRole('button', { name: /^Switch scope/ });
const menu = (page: Page): Locator => page.getByRole('dialog', { name: 'Scope' });
const platformEntry = (page: Page): Locator => menu(page).getByRole('link', { name: 'Platform', exact: true });
const createEntry = (page: Page): Locator => menu(page).getByRole('link', { name: 'Create organization', exact: true });

test.describe('BR-1: the Platform admin entry of the org menu', () => {
  test('TC-1.1: a platform admin in an org sees "Platform admin" above "Create organization"', async ({ page }) => {
    await open(page, 'platformAdminOrgs', `/o/${ORG}/projects`);
    await expect(page.getByText('invoicer-api', { exact: true }).first()).toBeVisible();

    await orgMenuButton(page).click();

    await expect(menu(page)).toBeVisible();
    await expect(platformEntry(page)).toBeVisible();
    await expect(createEntry(page)).toBeVisible();
    const platform = await platformEntry(page).boundingBox();
    const create = await createEntry(page).boundingBox();
    if (!platform || !create) throw new Error('the menu entries have no box');
    expect(platform.y).toBeLessThan(create.y);
  });

  test('TC-1.2: a platform admin in no org sees "Platform" in the org menu', async ({ page }) => {
    await open(page, 'platformAdminNoOrg', '/');
    await expect(orgMenuButton(page)).toBeVisible();

    await orgMenuButton(page).click();

    await expect(menu(page)).toBeVisible();
    await expect(platformEntry(page)).toBeVisible();
  });

  test('TC-1.3: an org owner who is not a platform admin sees no "Platform admin" entry', async ({ page }) => {
    await open(page, 'ownerNoPlatform', `/o/${ORG}/projects`);
    await expect(page.getByText('invoicer-api', { exact: true }).first()).toBeVisible();

    // One org and no platform role: there is nothing to switch to, so the bar has no scope menu to open.
    await expect(orgMenuButton(page)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Platform', exact: true })).toHaveCount(0);
    await expect(page.getByText('Platform admin')).toHaveCount(0);
  });
});

test.describe('BR-3: /platform for a person who is not a platform admin', () => {
  test('TC-3.1: the forbidden state shows with the org top bar and no /api/platform request', async ({ page }) => {
    const platformRequests: string[] = [];
    page.on('request', (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.startsWith('/api/platform/')) platformRequests.push(pathname);
    });

    await open(page, 'ownerNoPlatform', '/platform/admins');

    await expect(page.getByText("You don't have access", { exact: true })).toBeVisible();
    await expect(page.getByText('This area is for platform admins.', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to projects' })).toBeVisible();
    // No platform data and no menu: neither the page, nor a side menu, nor a section link.
    await expect(page.getByRole('heading', { name: 'Platform admins' })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Platform menu' })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Platform sections' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Platform admins' })).toHaveCount(0);
    await expect(page.getByRole('table')).toHaveCount(0);
    // The top bar stays (switcher, account) with no section links.
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('banner').getByRole('link', { name: 'Projects', exact: true })).toHaveCount(0);
    expect(platformRequests).toEqual([]);
  });

  test('TC-3.3: "Go to projects" opens the org projects page', async ({ page }) => {
    await open(page, 'ownerNoPlatform', '/platform/admins');
    await expect(page.getByText("You don't have access", { exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Go to projects' }).click();

    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/projects$`));
    await expect(page.getByText('invoicer-api', { exact: true }).first()).toBeVisible();
  });

  test('TC-3.4: a signed-out person goes to sign-in, not the forbidden state', async ({ page }) => {
    await startSignedOut(page);
    await page.goto('/platform/admins');

    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByText("You don't have access", { exact: true })).toHaveCount(0);
  });
});

test.describe('BR-2: the entry lands on the Organizations directory', () => {
  const directoryHeading = (page: Page): Locator => page.getByRole('heading', { name: 'Organizations', level: 1 });

  test('TC-2.1: "Platform admin" opens /platform/orgs with the Platform menu and no org tabs', async ({ page }) => {
    await open(page, 'platformAdminOrgs', `/o/${ORG}/projects`);
    await expect(page.getByText('invoicer-api', { exact: true }).first()).toBeVisible();

    await orgMenuButton(page).click();
    await platformEntry(page).click();

    await expect(page).toHaveURL(/\/platform\/orgs$/);
    await expect(directoryHeading(page)).toBeVisible();
    const side = page.getByRole('navigation', { name: 'Platform menu' });
    await expect(side).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Platform sections' })).toHaveCount(0);
    await expect(side.getByRole('link', { name: 'Organizations' })).toBeVisible();
    await expect(side.getByRole('link', { name: 'Platform admins' })).toBeVisible();
    await expect(side.getByRole('link', { name: 'Audit log' })).toBeVisible();
    const bar = page.getByRole('banner');
    await expect(bar.getByRole('button', { name: 'Switch scope, currently Platform' })).toBeVisible();
    await expect(bar.getByText('No organization')).toHaveCount(0);
    await expect(bar.getByRole('link', { name: 'Projects', exact: true })).toHaveCount(0);
    await expect(bar.getByRole('link', { name: 'Org settings' })).toHaveCount(0);
  });

  test('TC-2.2: a platform admin in no org opens the same directory from "/"', async ({ page }) => {
    await open(page, 'platformAdminNoOrg', '/');
    await expect(orgMenuButton(page)).toBeVisible();

    await orgMenuButton(page).click();
    await platformEntry(page).click();

    await expect(page).toHaveURL(/\/platform\/orgs$/);
    await expect(directoryHeading(page)).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Platform menu' })).toBeVisible();
  });

  test('TC-2.3: typing /platform ends on /platform/orgs with the "Organizations" heading', async ({ page }) => {
    await open(page, 'platformAdminOrgs', '/platform');

    await expect(page).toHaveURL(/\/platform\/orgs$/);
    await expect(directoryHeading(page)).toBeVisible();
  });
});

const ACME_ID = 'b8000000-0000-4000-8000-000000000001';

test.describe('the Platform scope bar and the org-only side menu', () => {
  test('the platform bar reads Platform and the Platform menu shows Organizations, Platform admins and Audit log', async ({
    page,
  }) => {
    await open(page, 'platformAdminOrgs', '/platform/orgs');

    const bar = page.getByRole('banner');
    await expect(bar.getByRole('button', { name: 'Switch scope, currently Platform' })).toBeVisible();
    const tabs = page.getByRole('navigation', { name: 'Platform menu' });
    await expect(tabs.getByRole('link', { name: 'Organizations' })).toHaveAttribute('aria-current', 'page');
    await expect(tabs.getByRole('link', { name: 'Platform admins' })).toBeVisible();
    await expect(tabs.getByRole('link', { name: 'Audit log' })).toBeVisible();
    // The directory has no org, so there is no org menu and no section tabs in the bar.
    await expect(page.getByRole('navigation', { name: 'Platform sections' })).toHaveCount(0);
  });

  test('a platform org members page reads Platform / Organizations / <org> / Members', async ({ page }) => {
    await open(page, 'platformAdminOrgs', `/platform/orgs/${ACME_ID}/members`);

    const crumbs = page.getByRole('banner').getByRole('navigation', { name: 'Breadcrumb' });
    await expect(crumbs.getByRole('button', { name: 'Switch scope, currently Platform' })).toBeVisible();
    await expect(crumbs.getByRole('link', { name: 'Organizations', exact: true })).toHaveAttribute(
      'href',
      '/platform/orgs',
    );
    await expect(crumbs.getByRole('link', { name: 'Acme' })).toHaveAttribute('href', `/platform/orgs/${ACME_ID}`);
    await expect(crumbs.locator('b[aria-current="page"]')).toHaveText('Members');
  });

  test('the Overview item in the side menu opens Overview', async ({ page }) => {
    await open(page, 'platformAdminOrgs', `/platform/orgs/${ACME_ID}/members`);
    const side = page.getByRole('navigation', { name: 'Platform menu' });
    await expect(side.getByRole('link', { name: 'Members', exact: true })).toHaveAttribute('aria-current', 'page');

    await side.getByRole('link', { name: 'Overview', exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`/platform/orgs/${ACME_ID}$`));
    await expect(side.getByRole('link', { name: 'Overview', exact: true })).toHaveAttribute('aria-current', 'page');
  });

  test('a platform admin with no membership sees no "Switch organization" group', async ({ page }) => {
    await open(page, 'platformAdminNoOrg', '/');
    await expect(orgMenuButton(page)).toBeVisible();

    await orgMenuButton(page).click();

    await expect(menu(page)).toBeVisible();
    await expect(platformEntry(page)).toBeVisible();
    await expect(menu(page).getByRole('group', { name: 'Switch organization' })).toHaveCount(0);
  });
});

test.describe('the logo of a platform admin with no org', () => {
  test('opens Platform > Organizations', async ({ page }) => {
    await open(page, 'platformAdminNoOrg', '/');
    await expect(orgMenuButton(page)).toBeVisible();
    const logo = page
      .getByRole('banner')
      .getByRole('link', { name: /agent ?desk/i })
      .first();
    await expect(logo).toHaveAttribute('href', '/platform/orgs');

    await logo.click();

    await expect(page).toHaveURL(/\/platform\/orgs$/);
    await expect(page.getByRole('heading', { name: 'Organizations', level: 1 })).toBeVisible();
  });
});
