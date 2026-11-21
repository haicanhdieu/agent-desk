import { expect, test, type Locator, type Page } from '@playwright/test';
import type { OnboardingScenario } from '../../src/mocks/msw/onboardingScenarios';
import { seedOnboarding } from './mock';

/*
 * The org switcher in the top bar (spec 2026-11-21-org-onboarding-design.md "E2E requirements": TC-6.1, TC-6.2,
 * TC-9.1, TC-10.1, TC-12.1, TC-12.2, TC-44.1, TC-44.2, TC-46.1).
 *
 * Every test seeds the case's mock scenario before its first goto; the mock store reseeds on every page load, so each
 * test stays in the app after it (clicks and keys, no second goto). The user's orgs are Alice (org 1, the first and the
 * active one) and Acme (org 2); Alice holds invoicer-api, invoicer-web, docs-site and billing-jobs, Acme holds
 * storefront. `twoOrgsSlowSwitch` holds the `set-active` answer for 1.5 s, which is the "delayed" of TC-10.1.
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

const ALICE_PROJECTS = ['invoicer-api', 'invoicer-web', 'docs-site', 'billing-jobs'];

async function open(page: Page, scenario: OnboardingScenario, path = '/o/alice/projects'): Promise<void> {
  await seedOnboarding(page, scenario);
  await page.goto(path);
}

const switcher = (page: Page, current: string): Locator =>
  page.getByRole('button', { name: `Switch organization, currently ${current}` });
const menu = (page: Page): Locator => page.getByRole('dialog', { name: 'Organizations' });
const orgItem = (page: Page, name: string): Locator => menu(page).getByRole('link', { name, exact: true });

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
    await expect(menu(page).getByRole('link')).toHaveText(['Alice', 'Acme']);
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
    await expect(menu(page).getByRole('link')).toHaveText(['Alice', 'Acme']);

    // 2. Focus moves through the orgs: ArrowDown, then Home (first org), then End (last org).
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => focusedName(page)).toMatch(/^(Alice|Acme)/);
    await page.keyboard.press('Home');
    await expect(orgItem(page, 'Alice')).toBeFocused();
    await page.keyboard.press('End');
    await expect(orgItem(page, 'Acme')).toBeFocused();
    await page.keyboard.press('Home');
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

test.describe('BR-9: one org, no switcher', () => {
  test('TC-9.1: the org name is plain text and no switcher shows', async ({ page }) => {
    await open(page, 'singleOrg');
    await expect(page.getByText('invoicer-api', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('banner').getByText('Alice', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Switch organization/ })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Organizations' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Alice' })).toHaveCount(0);
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
  test('TC-44.1: org 2 shows no access and the switcher is still usable', async ({ page }) => {
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
    await expect(menu(page).getByRole('link')).toHaveText(['Alice', 'Acme']);
    await expect(orgItem(page, 'Acme')).toHaveAttribute('aria-current', /.+/);
  });

  test('TC-44.2: from the no-access state, org 1 shows its projects', async ({ page }) => {
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
  test('TC-46.1: a non-admin owner of two orgs sees no Create organization item', async ({ page }) => {
    await open(page, 'twoOrgs');
    await aliceLoaded(page);

    await switcher(page, 'Alice').click();

    await expect(menu(page)).toBeVisible();
    await expect(menu(page).getByRole('link')).toHaveText(['Alice', 'Acme']);
    await expect(menu(page).getByText('Create organization')).toHaveCount(0);
    await expect(page.getByText('Create organization')).toHaveCount(0);
  });
});
