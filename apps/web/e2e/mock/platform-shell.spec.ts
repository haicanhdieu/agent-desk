import { expect, test, type Locator, type Page } from '@playwright/test';
import type { PlatformScenario } from '../../src/mocks/msw/platformScenarios';
import { ORG, SESSION_MOCK_NOW, seedPlatform, startSignedOut } from './mock';

/*
 * The platform shell: the "Platform admin" entry of the org menu, and the forbidden and signed-out answers of /platform
 * (spec 2026-11-23-platform-admin-dashboard-design.md "E2E requirements": TC-1.1 to TC-1.3, TC-3.1, TC-3.3, TC-3.4).
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

const orgMenuButton = (page: Page): Locator =>
  page.getByRole('button', { name: /^(Switch organization|Organization menu)/ });
const menu = (page: Page): Locator => page.getByRole('dialog', { name: 'Organizations' });
const platformEntry = (page: Page): Locator => menu(page).getByRole('link', { name: 'Platform admin', exact: true });
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

  test('TC-1.2: a platform admin in no org sees "Platform admin" in the org menu', async ({ page }) => {
    await open(page, 'platformAdminNoOrg', '/');
    await expect(orgMenuButton(page)).toBeVisible();

    await orgMenuButton(page).click();

    await expect(menu(page)).toBeVisible();
    await expect(platformEntry(page)).toBeVisible();
  });

  test('TC-1.3: an org owner who is not a platform admin sees no "Platform admin" entry', async ({ page }) => {
    await open(page, 'ownerNoPlatform', `/o/${ORG}/projects`);
    await expect(page.getByText('invoicer-api', { exact: true }).first()).toBeVisible();

    await orgMenuButton(page).click();

    await expect(menu(page)).toBeVisible();
    await expect(platformEntry(page)).toHaveCount(0);
    await expect(menu(page).getByText('Platform admin')).toHaveCount(0);
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
    // No platform data: neither the page nor the platform side menu.
    await expect(page.getByRole('heading', { name: 'Platform admins' })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Platform admin' })).toHaveCount(0);
    await expect(page.getByRole('table')).toHaveCount(0);
    // The normal org top bar with its tabs stays above it.
    await expect(page.getByRole('banner').getByRole('link', { name: 'Projects' })).toBeVisible();
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
