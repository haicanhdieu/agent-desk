import { expect, test, type Locator, type Page } from '@playwright/test';
import type { PlatformScenario } from '../../src/mocks/msw/platformScenarios';
import { INVOICER_API, ORG, SESSION_MOCK_NOW, chooseAction, seedPlatform, seedShell } from './mock';

/*
 * Suspend, reactivate and the suspended org page (spec 2026-11-23-platform-admin-dashboard-design.md "E2E requirements":
 * TC-4.11, TC-32.1, TC-33.1 to TC-33.5, TC-34.1, TC-37.1 to TC-37.3, TC-48.1, TC-49.1, TC-51.1).
 *
 * Every test seeds the case's platform scenario (mock.ts `seedPlatform`) before its first goto, with a clock fixed at
 * SESSION_MOCK_NOW; the mock store reseeds on every page load, so each test stays in the app after it (clicks, no second
 * goto). `platformAdminOrgs` lists Acme (active, id ACME) among its directory orgs. `suspendedPlatformAdmin` is a platform
 * admin whose active org Alice is suspended with the reason `Billing hold`; `suspendedMember` is a member of Alice (their
 * active org, suspended with that reason) and of Acme (active).
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

const ACME = 'b8000000-0000-4000-8000-000000000001';
/** The suspended org of the two suspended scenarios: the mock org Alice (slug `alice`), listed in the directory. */
const ALICE_ID = 'b6000000-0000-4000-8000-000000000001';
const REASON = 'Billing hold';

async function open(page: Page, scenario: PlatformScenario, path: string): Promise<void> {
  await page.clock.install({ time: new Date(SESSION_MOCK_NOW) });
  await seedPlatform(page, scenario);
  await page.goto(path);
}

const dialog = (page: Page, name: string): Locator => page.getByRole('dialog', { name });
const reasonOf = (d: Locator): Locator => d.getByLabel('Reason');
const toast = (page: Page, text: string): Locator => page.getByRole('status').filter({ hasText: text });
/** The title block of the detail header: the name and its slug and status. */
const header = (page: Page): Locator => page.getByRole('heading', { level: 1 }).locator('xpath=..');
const banner = (page: Page): Locator => page.getByText('This organization is suspended', { exact: true });
const orgMenuButton = (page: Page): Locator => page.getByRole('button', { name: /^Switch scope/ });
const menu = (page: Page): Locator => page.getByRole('dialog', { name: 'Scope' });
const switchGroup = (page: Page): Locator => menu(page).getByRole('group', { name: 'Switch organization' });
const suspendedTitle = (page: Page): Locator =>
  page.getByRole('heading', { name: 'This organization is suspended', level: 1 });
const suspendedBody = (page: Page): Locator =>
  page.getByText("You can't open Alice right now. Contact your Agent Desk administrator.", { exact: true });

/** The Acme detail page is loaded and active. */
async function acmeLoaded(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Acme', level: 1 })).toBeVisible();
  await expect(header(page).getByText('Active', { exact: true })).toBeVisible();
}

/** The suspended Alice detail page is loaded. */
async function aliceLoaded(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Alice', level: 1 })).toBeVisible();
  await expect(header(page).getByText('Suspended', { exact: true })).toBeVisible();
}

async function openSuspend(page: Page): Promise<Locator> {
  await acmeLoaded(page);
  await chooseAction(page, 'Suspend organization');
  const d = dialog(page, 'Suspend Acme?');
  await expect(d).toBeVisible();
  return d;
}

test.describe('BR-4: an unknown organization', () => {
  test('TC-4.11: an unknown org id shows "Page not found" inside the platform layout', async ({ page }) => {
    await open(page, 'platformAdminOrgs', '/platform/orgs/b8000000-0000-4000-8000-0000000000ff');

    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page.getByText('This organization does not exist.', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to organizations' })).toBeVisible();
    // Inside the platform area: the Platform menu is there with Organizations current, and no org menu.
    const menu = page.getByRole('navigation', { name: 'Platform menu' });
    await expect(menu.getByRole('link', { name: 'Organizations' })).toHaveAttribute('aria-current', 'page');
    await expect(menu.getByRole('link', { name: 'Platform admins' })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Overview' })).toHaveCount(0);
  });
});

test.describe('BR-32: suspend an active organization', () => {
  test('TC-32.1: Suspend with a reason shows the toast, "Suspended" in header, banner with the reason and the directory row', async ({
    page,
  }) => {
    await open(page, 'platformAdminOrgs', `/platform/orgs/${ACME}`);
    await acmeLoaded(page);
    await expect(banner(page)).toHaveCount(0);

    await chooseAction(page, 'Suspend organization');
    const d = dialog(page, 'Suspend Acme?');
    await expect(d).toBeVisible();
    await expect(
      d.getByText(
        'People in this organization cannot open it and no new runs start. Runs already in progress finish. Nothing is deleted.',
        { exact: true },
      ),
    ).toBeVisible();

    await reasonOf(d).fill(REASON);
    await d.getByRole('button', { name: 'Suspend', exact: true }).click();

    await expect(toast(page, 'Organization suspended')).toBeVisible();
    await expect(d).toHaveCount(0);
    await expect(header(page).getByText('Suspended', { exact: true })).toBeVisible();
    await expect(banner(page)).toBeVisible();
    await expect(page.getByText(`Reason: ${REASON}`, { exact: true })).toBeVisible();

    await page
      .getByRole('navigation', { name: 'Platform menu' })
      .getByRole('link', { name: /Organizations/ })
      .click();
    const row = page.locator('tbody tr').filter({ hasText: 'Acme' }).first();
    await expect(row).toContainText('Suspended');
  });
});

test.describe('BR-33: the reason of a status change', () => {
  test('TC-33.1: an empty reason shows "Enter a reason." at Reason and the org stays Active', async ({ page }) => {
    await open(page, 'platformAdminOrgs', `/platform/orgs/${ACME}`);
    const d = await openSuspend(page);

    await d.getByRole('button', { name: 'Suspend', exact: true }).click();

    await expect(d.getByText('Enter a reason.', { exact: true })).toBeVisible();
    await expect(reasonOf(d)).toHaveAttribute('aria-invalid', 'true');
    await expect(reasonOf(d)).toHaveAccessibleDescription('Enter a reason.');
    await expect(header(page).getByText('Active', { exact: true })).toBeVisible();
    await expect(header(page).getByText('Suspended', { exact: true })).toHaveCount(0);
    await expect(toast(page, 'Organization suspended')).toHaveCount(0);
  });

  test('TC-33.2: a reason of only spaces shows "Enter a reason." at Reason and the org stays active', async ({
    page,
  }) => {
    await open(page, 'platformAdminOrgs', `/platform/orgs/${ACME}`);
    const d = await openSuspend(page);

    await reasonOf(d).fill('     ');
    await d.getByRole('button', { name: 'Suspend', exact: true }).click();

    await expect(d.getByText('Enter a reason.', { exact: true })).toBeVisible();
    await expect(reasonOf(d)).toHaveAccessibleDescription('Enter a reason.');
    await expect(header(page).getByText('Active', { exact: true })).toBeVisible();
    await expect(header(page).getByText('Suspended', { exact: true })).toHaveCount(0);
  });

  test('TC-33.3: a 500-character reason suspends the org', async ({ page }) => {
    await open(page, 'platformAdminOrgs', `/platform/orgs/${ACME}`);
    const d = await openSuspend(page);

    await reasonOf(d).fill('a'.repeat(500));
    await d.getByRole('button', { name: 'Suspend', exact: true }).click();

    await expect(toast(page, 'Organization suspended')).toBeVisible();
    await expect(d).toHaveCount(0);
    await expect(header(page).getByText('Suspended', { exact: true })).toBeVisible();
    await expect(banner(page)).toBeVisible();
  });

  test('TC-33.4: a 501-character reason shows an error at Reason and the org stays Active', async ({ page }) => {
    await open(page, 'platformAdminOrgs', `/platform/orgs/${ACME}`);
    const d = await openSuspend(page);

    await reasonOf(d).fill('a'.repeat(501));
    await d.getByRole('button', { name: 'Suspend', exact: true }).click();

    // The spec leaves the wording open (Q2): the error is at the field, named by its description.
    await expect(reasonOf(d)).toHaveAttribute('aria-invalid', 'true');
    await expect(reasonOf(d)).toHaveAccessibleDescription(/\S/);
    await expect(d).toBeVisible();
    await expect(header(page).getByText('Active', { exact: true })).toBeVisible();
    await expect(header(page).getByText('Suspended', { exact: true })).toHaveCount(0);
    await expect(toast(page, 'Organization suspended')).toHaveCount(0);
  });

  test('TC-33.5: an empty reason on Reactivate shows "Enter a reason." at Reason and the org stays Suspended', async ({
    page,
  }) => {
    await open(page, 'suspendedPlatformAdmin', `/platform/orgs/${ALICE_ID}`);
    await aliceLoaded(page);
    await chooseAction(page, 'Reactivate organization');
    const d = dialog(page, 'Reactivate Alice?');
    await expect(d).toBeVisible();

    await d.getByRole('button', { name: 'Reactivate', exact: true }).click();

    await expect(d.getByText('Enter a reason.', { exact: true })).toBeVisible();
    await expect(reasonOf(d)).toHaveAttribute('aria-invalid', 'true');
    await expect(reasonOf(d)).toHaveAccessibleDescription('Enter a reason.');
    await expect(header(page).getByText('Suspended', { exact: true })).toBeVisible();
    await expect(header(page).getByText('Active', { exact: true })).toHaveCount(0);
    await expect(toast(page, 'Organization reactivated')).toHaveCount(0);
  });
});

test.describe('BR-34: reactivate a suspended organization', () => {
  test('TC-34.1: Reactivate with a reason shows the toast, "Active" in the header and no warning banner', async ({
    page,
  }) => {
    await open(page, 'suspendedPlatformAdmin', `/platform/orgs/${ALICE_ID}`);
    await aliceLoaded(page);
    await expect(banner(page)).toBeVisible();

    await chooseAction(page, 'Reactivate organization');
    const d = dialog(page, 'Reactivate Alice?');
    await expect(d).toBeVisible();
    await expect(d.getByText('People can open it again.', { exact: true })).toBeVisible();

    await reasonOf(d).fill('Paid');
    await d.getByRole('button', { name: 'Reactivate', exact: true }).click();

    await expect(toast(page, 'Organization reactivated')).toBeVisible();
    await expect(d).toHaveCount(0);
    await expect(header(page).getByText('Active', { exact: true })).toBeVisible();
    await expect(header(page).getByText('Suspended', { exact: true })).toHaveCount(0);
    await expect(banner(page)).toHaveCount(0);
  });
});

test.describe('BR-37: a member of a suspended organization', () => {
  test('TC-37.1: opening / shows "This organization is suspended" with its body and no org data', async ({ page }) => {
    await open(page, 'suspendedMember', '/');

    await expect(suspendedTitle(page)).toBeVisible();
    await expect(suspendedBody(page)).toBeVisible();
    // Role-based: a member sees no org data (no project of Alice).
    for (const name of ['invoicer-api', 'invoicer-web', 'docs-site', 'billing-jobs']) {
      await expect(page.getByText(name)).toHaveCount(0);
    }
  });

  test('TC-37.2: typing /o/alice/projects shows the same message and no project data', async ({ page }) => {
    await open(page, 'suspendedMember', `/o/${ORG}/projects`);

    await expect(suspendedTitle(page)).toBeVisible();
    await expect(suspendedBody(page)).toBeVisible();
    for (const name of ['invoicer-api', 'invoicer-web', 'docs-site', 'billing-jobs']) {
      await expect(page.getByText(name)).toHaveCount(0);
    }
  });

  test("TC-37.3: choosing the active org in the org menu opens that org's pages normally", async ({ page }) => {
    await open(page, 'suspendedMember', '/');
    await expect(suspendedTitle(page)).toBeVisible();

    await orgMenuButton(page).click();
    await expect(menu(page)).toBeVisible();
    await switchGroup(page).getByRole('link', { name: 'Acme', exact: true }).click();

    await expect(page).toHaveURL(/\/o\/acme\/projects$/);
    await expect(page.getByText('storefront', { exact: true }).first()).toBeVisible();
    await expect(suspendedTitle(page)).toHaveCount(0);
  });
});

test.describe('BR-48: the org menu of a suspended org', () => {
  test('TC-48.1: the suspended org is listed marked "Suspended" and the other org links to its pages', async ({
    page,
  }) => {
    await open(page, 'suspendedMember', '/');
    await expect(suspendedTitle(page)).toBeVisible();

    await orgMenuButton(page).click();

    await expect(menu(page)).toBeVisible();
    const links = switchGroup(page).getByRole('link');
    await expect(links).toHaveCount(2);
    const alice = links.filter({ hasText: 'Alice' });
    await expect(alice).toHaveCount(1);
    await expect(alice.getByText('Suspended', { exact: true })).toBeVisible();
    const acme = links.filter({ hasText: 'Acme' });
    await expect(acme).toHaveCount(1);
    await expect(acme.getByText('Suspended')).toHaveCount(0);
    await expect(acme).toHaveAttribute('href', '/o/acme/projects');
  });
});

test.describe('BR-49: the suspended message is fixed', () => {
  test('TC-49.1: the message shows its fixed title and body and "Billing hold" appears nowhere', async ({ page }) => {
    await open(page, 'suspendedMember', `/o/${ORG}/projects`);

    await expect(suspendedTitle(page)).toBeVisible();
    await expect(suspendedBody(page)).toBeVisible();
    await expect(page.getByText(REASON)).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(REASON);
  });
});

test.describe('BR-51: a platform admin whose active org is suspended', () => {
  test('TC-51.1: the switcher shows "Platform", /platform/orgs opens, and the org pages show the message', async ({
    page,
  }) => {
    await open(page, 'suspendedPlatformAdmin', `/o/${ORG}/projects`);
    // The org's own pages show the suspended message.
    await expect(suspendedTitle(page)).toBeVisible();
    await expect(suspendedBody(page)).toBeVisible();

    await orgMenuButton(page).click();
    await expect(menu(page)).toBeVisible();
    const entry = menu(page).getByRole('link', { name: 'Platform', exact: true });
    await expect(entry).toBeVisible();
    await entry.click();

    await expect(page).toHaveURL(/\/platform\/orgs$/);
    await expect(page.getByRole('heading', { name: 'Organizations', level: 1 })).toBeVisible();
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await expect(suspendedTitle(page)).toHaveCount(0);
  });
});

const anyMenu = (page: Page): Locator => page.getByRole('navigation', { name: /menu$/ });
const accountMenuButton = (page: Page): Locator =>
  page.getByRole('banner').getByRole('button', { name: /^Account menu for/ });

test.describe('BR-58: a suspended org with another way out', () => {
  test('TC-58.1: the suspended message shows with no side menu and the switcher; picking org A opens its Projects', async ({
    page,
  }) => {
    await open(page, 'suspendedMember', `/o/${ORG}/projects`);

    await expect(suspendedTitle(page)).toBeVisible();
    await expect(page.getByRole('main').getByRole('heading', { name: 'This organization is suspended' })).toBeVisible();
    await expect(anyMenu(page)).toHaveCount(0);
    await expect(orgMenuButton(page)).toBeVisible();

    await orgMenuButton(page).click();
    await switchGroup(page).getByRole('link', { name: 'Acme', exact: true }).click();

    await expect(page).toHaveURL(/\/o\/acme\/projects$/);
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
    await expect(suspendedTitle(page)).toHaveCount(0);
  });

  test('TC-58.2: a platform admin whose only org is suspended sees the message, no menu and the switcher, and leaves by Platform', async ({
    page,
  }) => {
    await open(page, 'suspendedPlatformAdmin', `/o/${ORG}/projects`);

    await expect(suspendedTitle(page)).toBeVisible();
    await expect(anyMenu(page)).toHaveCount(0);
    await expect(orgMenuButton(page)).toBeVisible();

    await orgMenuButton(page).click();
    await menu(page).getByRole('link', { name: 'Platform', exact: true }).click();

    await expect(page).toHaveURL(/\/platform\/orgs$/);
    await expect(page.getByRole('heading', { name: 'Organizations', level: 1 })).toBeVisible();
    await expect(suspendedTitle(page)).toHaveCount(0);
  });

  test('TC-58.3: a project address under the suspended org shows the message, no menu and no project data; the other org opens', async ({
    page,
  }) => {
    await open(page, 'suspendedMember', `/o/${ORG}/p/${INVOICER_API}/runs`);

    await expect(suspendedTitle(page)).toBeVisible();
    await expect(anyMenu(page)).toHaveCount(0);
    for (const name of ['invoicer-api', 'invoicer-web', 'docs-site', 'billing-jobs']) {
      await expect(page.getByText(name)).toHaveCount(0);
    }

    await orgMenuButton(page).click();
    await switchGroup(page).getByRole('link', { name: 'Acme', exact: true }).click();

    await expect(page).toHaveURL(/\/o\/acme\/projects$/);
    await expect(suspendedTitle(page)).toHaveCount(0);
  });
});

test.describe('BR-79: the only org is suspended and there is no platform role', () => {
  async function openOnlyOrg(page: Page, path: string): Promise<void> {
    await page.clock.install({ time: new Date(SESSION_MOCK_NOW) });
    await seedShell(page, 'suspendedOnly');
    await page.goto(path);
  }

  test('TC-79.1: opening the app shows the message with no menu and the org name as plain text', async ({ page }) => {
    await openOnlyOrg(page, '/');

    await expect(suspendedTitle(page)).toBeVisible();
    await expect(anyMenu(page)).toHaveCount(0);
    await expect(orgMenuButton(page)).toHaveCount(0);
    await expect(page.getByRole('banner').getByText('Alice', { exact: true })).toBeVisible();
  });

  test('TC-79.2: "My invitations" in the account menu opens /invitations, which stays with no menu and the same plain name', async ({
    page,
  }) => {
    await openOnlyOrg(page, `/o/${ORG}/projects`);
    await expect(suspendedTitle(page)).toBeVisible();

    await accountMenuButton(page).click();
    await page.getByRole('menuitem', { name: 'My invitations' }).click();

    await expect(page).toHaveURL(/\/invitations$/);
    await expect(page.getByRole('heading', { name: /invitations/i, level: 1 })).toBeVisible();
    await expect(anyMenu(page)).toHaveCount(0);
    await expect(orgMenuButton(page)).toHaveCount(0);
    await expect(page.getByRole('banner').getByText('Alice', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/invitations$/);
  });

  test('TC-79.3: "Logout" in the account menu ends the session and shows the sign-in page', async ({ page }) => {
    await openOnlyOrg(page, `/o/${ORG}/projects`);
    await expect(suspendedTitle(page)).toBeVisible();

    await accountMenuButton(page).click();
    await page.getByRole('menuitem', { name: 'Logout' }).click();

    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByRole('link', { name: 'Sign in with GitHub' })).toBeVisible();
  });
});
