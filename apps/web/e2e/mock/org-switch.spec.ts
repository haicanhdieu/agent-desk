import { expect, test, type Locator, type Page } from '@playwright/test';
import type { OnboardingScenario } from '../../src/mocks/msw/onboardingScenarios';
import type { TenantAdminScenario } from '../../src/mocks/msw/tenantAdminScenarios';
import { seedOnboarding, seedPlatform, seedTenantAdmin } from './mock';

/*
 * The org switcher in the top bar (spec 2026-11-21-org-onboarding-design.md "E2E requirements": TC-6.1, TC-6.2,
 * TC-9.1, TC-10.1, TC-12.1, TC-12.2, TC-44.1, TC-44.2, TC-46.1; those ids are that spec's: titles say org-onboarding; the
 * org-tenant-admin spec's BR-44 org menu cases TC-44.1 to TC-44.7 are in the last describe).
 *
 * Every test seeds the case's mock scenario before its first goto; the mock store reseeds on every page load, so each
 * test stays in the app after it (clicks and keys, no second goto). The user's orgs are Alice (org 1, the first and the
 * active one) and Acme (org 2); Alice holds invoicer-api, invoicer-web, docs-site and billing-jobs, Acme holds
 * storefront. `twoOrgsSlowSwitch` holds the `set-active` answer for 1.5 s, which is the "delayed" of TC-10.1.
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

const ALICE_ID = 'b6000000-0000-4000-8000-000000000001';
const ALICE_PROJECTS = ['invoicer-api', 'invoicer-web', 'docs-site', 'billing-jobs'];

async function open(page: Page, scenario: OnboardingScenario, path = '/o/alice/projects'): Promise<void> {
  await seedOnboarding(page, scenario);
  await page.goto(path);
}

const switcher = (page: Page, current: string): Locator =>
  page.getByRole('button', { name: `Switch scope, currently organization ${current}` });
const menu = (page: Page): Locator => page.getByRole('dialog', { name: 'Scope' });
const switchGroup = (page: Page): Locator => menu(page).getByRole('group', { name: 'Switch organization' });
const orgLinks = (page: Page): Locator => switchGroup(page).getByRole('link');
const orgItem = (page: Page, name: string): Locator => switchGroup(page).getByRole('link', { name, exact: true });

/** The Alice Projects page has loaded: its projects are listed. */
async function aliceLoaded(page: Page): Promise<void> {
  await expect(switcher(page, 'Alice')).toBeVisible();
  await expect(page.getByText('invoicer-api', { exact: true }).first()).toBeVisible();
}

/** The accessible name of the focused element, or '' when focus is on the body. */
const focusedName = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return '';
    return el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '';
  });

test.describe('BR-6: switcher lists the orgs with the current marked', () => {
  test('TC-6.1: the menu lists both orgs and marks the current one', async ({ page }) => {
    await open(page, 'twoOrgs');
    await aliceLoaded(page);
    const button = switcher(page, 'Alice');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(menu(page)).toHaveCount(0);

    await button.click();

    await expect(menu(page)).toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(orgLinks(page)).toHaveText(['Alice', 'Acme']);
    await expect(orgItem(page, 'Alice')).toHaveAttribute('aria-current', /.+/);
    await expect(orgItem(page, 'Alice').locator('svg')).toHaveCount(1);
    await expect(orgItem(page, 'Acme')).not.toHaveAttribute('aria-current', /.+/);
    await expect(orgItem(page, 'Acme').locator('svg')).toHaveCount(0);
  });

  test('TC-6.2: the keyboard opens the menu, moves through the orgs and Escape returns to the button', async ({
    page,
  }) => {
    await open(page, 'twoOrgs');
    await aliceLoaded(page);
    const button = switcher(page, 'Alice');
    await button.focus();
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute('aria-expanded', 'false');

    // 1. ArrowDown on the button opens the menu.
    await page.keyboard.press('ArrowDown');
    await expect(menu(page)).toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(orgLinks(page)).toHaveText(['Alice', 'Acme']);

    // 2. Focus moves through the items (Projects, Settings, then the orgs): ArrowDown, then Home (first item, Projects), then End (last org).
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => focusedName(page)).toMatch(/^(Projects|Org settings|Alice|Acme)/);
    await page.keyboard.press('Home');
    await expect(menu(page).getByRole('link', { name: 'Projects' })).toBeFocused();
    await page.keyboard.press('End');
    await expect(orgItem(page, 'Acme')).toBeFocused();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await expect(menu(page).getByRole('link', { name: 'Org settings' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(orgItem(page, 'Alice')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(orgItem(page, 'Acme')).toBeFocused();

    // 3. Escape closes the menu and focus returns to the button.
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(button).toBeFocused();
  });
});

test.describe('BR-9 and BR-44: one org, an org menu without the switch group', () => {
  test('TC-9.1: the org crumb is a button whose menu has Projects and no Switch organization', async ({ page }) => {
    await open(page, 'singleOrg');
    await expect(page.getByText('invoicer-api', { exact: true }).first()).toBeVisible();
    const button = page.getByRole('button', { name: 'Switch scope, currently organization Alice' });
    await expect(button).toBeVisible();
    await button.click();
    await expect(menu(page)).toBeVisible();
    await expect(menu(page).getByRole('heading', { name: 'Alice' })).toBeVisible();
    await expect(menu(page).getByRole('link', { name: 'Projects' })).toBeVisible();
    await expect(menu(page).getByText('Switch organization')).toHaveCount(0);
    await expect(menu(page).getByText('Create organization')).toHaveCount(0);
  });
});

test.describe('BR-10: loading state while switching', () => {
  test('TC-10.1: org 2 shows a loading state with no org 1 data, then its projects', async ({ page }) => {
    // The delay lives in a page timer (the mock's set-active holds its answer for 1.5 s), so the page clock freezes it:
    // the pending state lasts until the test lets the clock run, however slow the machine is.
    await page.clock.install();
    await open(page, 'twoOrgsSlowSwitch');
    await aliceLoaded(page);
    await page.clock.pauseAt(new Date(Date.now() + 10_000));

    await switcher(page, 'Alice').click();
    await orgItem(page, 'Acme').click();

    // set-active is pending (its 1.5 s timer is frozen). The router shows its loading state after 300 ms.
    await expect(page).toHaveURL(/\/o\/acme\/projects$/);
    await page.clock.runFor(400);
    await expect(page.getByRole('status', { name: 'Loading' })).toBeVisible();
    // (The router hides the page it left with display:none while the loading state shows, so read what is visible.)
    for (const name of [...ALICE_PROJECTS, 'storefront']) {
      await expect(page.locator('body')).not.toContainText(name, { useInnerText: true });
    }
    await expect(page).toHaveURL(/\/o\/acme\/projects$/);

    // set-active finishes: org 2's projects show, with no org 1 project.
    await page.clock.runFor(2000);
    await page.clock.resume();
    await expect(page.getByText('storefront', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0);
    await expect(page).toHaveURL(/\/o\/acme\/projects$/);
    for (const name of ALICE_PROJECTS) {
      await expect(page.locator('body')).not.toContainText(name, { useInnerText: true });
    }
  });
});

test.describe('BR-12: non-member org link is not found', () => {
  test('TC-12.1: an org the user is not in shows not found and none of its data', async ({ page }) => {
    await open(page, 'twoOrgs', '/o/other/projects');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page.getByText('Other', { exact: true })).toHaveCount(0);
    for (const name of [...ALICE_PROJECTS, 'storefront']) await expect(page.getByText(name)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: "You don't have access" })).toHaveCount(0);
  });

  test('TC-12.2: an unknown org shows not found', async ({ page }) => {
    await open(page, 'twoOrgs', '/o/unknown/projects');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page.getByRole('heading', { name: "You don't have access" })).toHaveCount(0);
    for (const name of [...ALICE_PROJECTS, 'storefront']) await expect(page.getByText(name)).toHaveCount(0);
  });
});

test.describe('BR-44: a member with no role in an org can still switch', () => {
  test('org-onboarding TC-44.1: org 2 shows no access and the switcher is still usable', async ({ page }) => {
    await open(page, 'twoOrgsNoRoleInSecond');
    await aliceLoaded(page);

    await switcher(page, 'Alice').click();
    await orgItem(page, 'Acme').click();

    await expect(page).toHaveURL(/\/o\/acme\/projects$/);
    await expect(page.getByRole('heading', { name: "You don't have access" })).toBeVisible();
    for (const name of [...ALICE_PROJECTS, 'storefront']) await expect(page.getByText(name)).toHaveCount(0);
    const button = switcher(page, 'Acme');
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();
    await button.click();
    await expect(menu(page)).toBeVisible();
    await expect(orgLinks(page)).toHaveText(['Alice', 'Acme']);
    await expect(orgItem(page, 'Acme')).toHaveAttribute('aria-current', /.+/);
  });

  test('org-onboarding TC-44.2: from the no-access state, org 1 shows its projects', async ({ page }) => {
    await open(page, 'twoOrgsNoRoleInSecond');
    await aliceLoaded(page);
    await switcher(page, 'Alice').click();
    await orgItem(page, 'Acme').click();
    await expect(page.getByRole('heading', { name: "You don't have access" })).toBeVisible();

    await switcher(page, 'Acme').click();
    await orgItem(page, 'Alice').click();

    await expect(page).toHaveURL(/\/o\/alice\/projects$/);
    await expect(page.getByText('invoicer-api', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: "You don't have access" })).toHaveCount(0);
    await expect(switcher(page, 'Alice')).toBeVisible();
  });
});

test.describe('BR-46: org creation is for platform admins', () => {
  test('org-onboarding TC-46.1: a non-admin owner of two orgs sees no Create organization item', async ({ page }) => {
    await open(page, 'twoOrgs');
    await aliceLoaded(page);

    await switcher(page, 'Alice').click();

    await expect(menu(page)).toBeVisible();
    await expect(orgLinks(page)).toHaveText(['Alice', 'Acme']);
    await expect(menu(page).getByText('Create organization')).toHaveCount(0);
    await expect(page.getByText('Create organization')).toHaveCount(0);
  });
});

/*
 * The org menu per role (spec 2026-11-22-org-tenant-admin-design.md "E2E requirements" BR-44, TC-44.1 to TC-44.7).
 * The menu's links are read in order inside the "Organizations" dialog, so an absent item is always checked next to the
 * items that must be there (the menu is open and the links are listed).
 */
async function openOrgMenu(page: Page, label: string, landing = 'Projects'): Promise<Locator> {
  await expect(page.getByRole('heading', { name: landing })).toBeVisible();
  const button = page.getByRole('button', { name: label });
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).getByRole('heading', { level: 2, name: 'Alice' })).toBeVisible();
  return menu(page);
}

async function asOnboarding(page: Page, scenario: OnboardingScenario): Promise<void> {
  await seedOnboarding(page, scenario);
  await page.goto('/o/alice/projects');
}

async function asTenantAdmin(page: Page, scenario: TenantAdminScenario): Promise<void> {
  await seedTenantAdmin(page, scenario);
  await page.goto('/o/alice/projects');
}

const ONE_ORG = 'Switch scope, currently organization Alice';
const TWO_ORGS = 'Switch scope, currently organization Alice';

test.describe('BR-44: org menu (org-tenant-admin)', () => {
  test('TC-44.1: an owner in one org sees the org name, Projects and Settings, no Switch organization', async ({
    page,
  }) => {
    await asOnboarding(page, 'singleOrg');
    const m = await openOrgMenu(page, ONE_ORG);
    await expect(m.getByRole('link')).toHaveText(['Projects', 'Org settings']);
    await expect(m.getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/o/alice/projects');
    await expect(m.getByRole('link', { name: 'Org settings' })).toHaveAttribute('href', '/o/alice/settings');
    await expect(m.getByText('Switch organization')).toHaveCount(0);
    await expect(m.getByRole('group')).toHaveCount(0);
  });

  test('TC-44.2: an owner in two orgs also sees Switch organization listing both orgs, a check on the current one', async ({
    page,
  }) => {
    await asOnboarding(page, 'twoOrgs');
    const m = await openOrgMenu(page, TWO_ORGS);
    await expect(m.getByRole('link')).toHaveText(['Projects', 'Org settings', 'Alice', 'Acme']);
    await expect(switchGroup(page)).toBeVisible();
    await expect(orgLinks(page)).toHaveText(['Alice', 'Acme']);
    await expect(orgItem(page, 'Alice')).toHaveAttribute('aria-current', /.+/);
    await expect(orgItem(page, 'Alice').locator('svg')).toHaveCount(1);
    await expect(orgItem(page, 'Acme')).not.toHaveAttribute('aria-current', /.+/);
    await expect(orgItem(page, 'Acme').locator('svg')).toHaveCount(0);
  });

  test('TC-44.3: a member in one org sees the org name and Projects, no Settings, no Switch organization', async ({
    page,
  }) => {
    await asTenantAdmin(page, 'member');
    const m = await openOrgMenu(page, ONE_ORG);
    await expect(m.getByRole('link')).toHaveText(['Projects']);
    await expect(m.getByRole('link', { name: 'Projects' })).toBeVisible();
    await expect(m.getByRole('link', { name: 'Org settings' })).toHaveCount(0);
    await expect(m.getByText('Switch organization')).toHaveCount(0);
    await expect(m.getByRole('group')).toHaveCount(0);
  });

  test('TC-44.4: a project admin sees Settings in the org menu', async ({ page }) => {
    await asTenantAdmin(page, 'projectAdmin');
    const m = await openOrgMenu(page, ONE_ORG);
    await expect(m.getByRole('link')).toHaveText(['Projects', 'Org settings']);
    await expect(m.getByRole('link', { name: 'Org settings' })).toHaveAttribute('href', '/o/alice/settings');
  });

  test('TC-44.5: a platform admin with no org role sees Switch organization and Create organization, no Settings', async ({
    page,
  }) => {
    await asOnboarding(page, 'platformAdminNoRole');
    const m = await openOrgMenu(page, TWO_ORGS, "You don't have access");
    await expect(m.getByRole('link', { name: 'Projects' })).toBeVisible();
    await expect(switchGroup(page)).toBeVisible();
    await expect(m.getByRole('link', { name: 'Create organization' })).toBeVisible();
    await expect(m.getByRole('link', { name: 'Org settings' })).toHaveCount(0);
  });

  test('TC-44.6: an owner who is not a platform admin, in two orgs, sees no Create organization', async ({ page }) => {
    await asOnboarding(page, 'twoOrgs');
    const m = await openOrgMenu(page, TWO_ORGS);
    await expect(switchGroup(page)).toBeVisible();
    await expect(orgLinks(page)).toHaveText(['Alice', 'Acme']);
    await expect(m.getByRole('link', { name: 'Create organization' })).toHaveCount(0);
    await expect(m.getByText('Create organization')).toHaveCount(0);
  });

  test('TC-44.7: ArrowDown on the focused crumb opens the menu, Escape closes it with focus back on the crumb', async ({
    page,
  }) => {
    await asOnboarding(page, 'singleOrg');
    await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
    const button = page.getByRole('button', { name: ONE_ORG });
    await button.focus();
    await expect(button).toBeFocused();
    await expect(menu(page)).toHaveCount(0);

    await page.keyboard.press('ArrowDown');
    await expect(menu(page)).toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(menu(page).getByRole('link')).toHaveText(['Projects', 'Org settings']);

    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(button).toBeFocused();
  });
});

test.describe('the Platform group in the scope menu', () => {
  test('a platform admin sees the Platform group first in the scope menu', async ({ page }) => {
    await seedPlatform(page, 'platformAdminOrgs');
    await page.goto('/o/alice/projects');
    await expect(page.getByText('invoicer-api', { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: /^Switch scope/ }).click();

    const platform = await menu(page).getByRole('link', { name: 'Platform admin', exact: true }).boundingBox();
    const firstOrg = await menu(page)
      .getByRole('group', { name: 'Switch organization' })
      .getByRole('link')
      .first()
      .boundingBox();
    if (!platform || !firstOrg) throw new Error('the menu entries have no box');
    expect(platform.y).toBeLessThan(firstOrg.y);
  });

  test('"Manage this org in Platform" opens /platform/orgs/<id>', async ({ page }) => {
    await seedPlatform(page, 'platformAdminOrgs');
    await page.goto('/o/alice/projects');
    await expect(page.getByText('invoicer-api', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: /^Switch scope/ }).click();
    await menu(page).getByRole('link', { name: 'Manage this org in Platform' }).click();
    await expect(page).toHaveURL(new RegExp(`/platform/orgs/${ALICE_ID}$`));
  });
});
