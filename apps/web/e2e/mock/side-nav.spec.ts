import { expect, test, type Locator, type Page } from '@playwright/test';
import { ids } from '../../src/mocks/dto/ids';
import type { PlatformScenario } from '../../src/mocks/msw/platformScenarios';
import { INVOICER_API, ORG, SESSION_MOCK_NOW, SIDE_MENU_NAME, chooseAction, holdReads, seedPlatform } from './mock';

/*
 * BR-44: the GitHub connection tab shows only what its trigger mode can do. Webhook: no "Send test ping", no "Manage
 * installation", no "Check now" and no empty action row. Polling: "Check now" only.
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

async function openGithubTab(page: Page, project: string) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/o/${ORG}/p/${project}/desk/agent?tab=github`);
  const connection = page.getByRole('region', { name: 'GitHub connection' });
  await expect(connection.getByText('Trigger mode', { exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return connection;
}

test('TC-44.2: a webhook-mode project shows no "Send test ping", "Manage installation" or "Check now"', async ({
  page,
}) => {
  const connection = await openGithubTab(page, INVOICER_API);
  await expect(connection.getByRole('radio', { name: 'Webhook' })).toBeChecked();
  await expect(page.getByText('Send test ping')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Manage installation' })).toHaveCount(0);
  await expect(page.getByText('Manage installation')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Check now' })).toHaveCount(0);
  // No empty action row is drawn where the buttons were: the panel has no button at all.
  await expect(connection.getByRole('button')).toHaveCount(0);
});

test('TC-44.4: a polling-mode project shows "Check now" but no "Send test ping" or "Manage installation"', async ({
  page,
}) => {
  const connection = await openGithubTab(page, ids.project.invoicerWeb);
  await expect(connection.getByRole('radio', { name: 'Polling' })).toBeChecked();
  await expect(connection.getByRole('button', { name: 'Check now' })).toBeVisible();
  await expect(page.getByText('Send test ping')).toHaveCount(0);
  await expect(page.getByText('Manage installation')).toHaveCount(0);
});

/*
 * Platform pages on the shell (spec 2026-11-25-sidebar-navigation-shell-design.md "E2E requirements": TC-5.1, TC-5.2,
 * TC-31.1, TC-31.2, TC-32.1, TC-32.2, TC-33.1 to TC-33.3, TC-34.1, TC-34.2, TC-35.1 to TC-35.3). The local halves are
 * in e2e/local.
 */
const ORGS = '/platform/orgs';
const ACME_ID = 'b8000000-0000-4000-8000-000000000001';
const ALICE_ORG = 'b6000000-0000-4000-8000-000000000001';
const ORG_BASE = `${ORGS}/${ACME_ID}`;

async function openPlatform(page: Page, scenario: PlatformScenario, path: string): Promise<void> {
  await page.clock.install({ time: new Date(SESSION_MOCK_NOW) });
  await seedPlatform(page, scenario);
  await page.goto(path);
}

const platformMenu = (page: Page): Locator => page.getByRole('navigation', { name: 'Platform menu' });
const itemsOf = (menu: Locator): Locator =>
  menu.getByRole('link', { name: /^(Overview|Projects|Members|Invitations)$/ });

test.describe('BR-5: back to the Organizations directory', () => {
  test('TC-5.1: "← Organizations" on a platform org Members page opens the directory with Organizations current', async ({
    page,
  }) => {
    await openPlatform(page, 'platformAdminOrgs', `${ORG_BASE}/members`);
    await expect(page.getByRole('heading', { name: 'Members', level: 2 })).toBeVisible();

    await platformMenu(page)
      .getByRole('link', { name: /Organizations/ })
      .click();

    await expect(page).toHaveURL(/\/platform\/orgs$/);
    await expect(page.getByRole('heading', { name: 'Organizations', level: 1 })).toBeVisible();
    await expect(platformMenu(page).getByRole('link', { name: 'Organizations' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(platformMenu(page).getByRole('link', { name: 'Platform admins' })).toBeVisible();
  });

  test('TC-5.2: from the direct address of an org Overview, "← Organizations" opens the directory', async ({
    page,
  }) => {
    await openPlatform(page, 'platformAdminOrgs', ORG_BASE);
    await expect(page.getByRole('heading', { name: 'Acme', level: 1 })).toBeVisible();

    await platformMenu(page)
      .getByRole('link', { name: /Organizations/ })
      .click();

    await expect(page).toHaveURL(/\/platform\/orgs$/);
    await expect(page.getByRole('heading', { name: 'Organizations', level: 1 })).toBeVisible();
  });
});

test.describe('BR-31: the Platform menu', () => {
  test('TC-31.1: Organizations, Platform admins and Audit log each mark only the matching item current', async ({
    page,
  }) => {
    await openPlatform(page, 'platformAdminOrgs', ORGS);
    const menu = platformMenu(page);
    const links = ['Organizations', 'Platform admins', 'Audit log'];
    for (const [i, current] of links.entries()) {
      if (i > 0) {
        await menu.getByRole('link', { name: current, exact: true }).click();
        await expect(page).toHaveURL(i === 1 ? /\/platform\/admins$/ : /\/platform\/audit$/);
      }
      await expect(menu.getByRole('link')).toHaveText(links);
      for (const name of links) {
        const link = menu.getByRole('link', { name, exact: true });
        if (name === current) await expect(link).toHaveAttribute('aria-current', 'page');
        else await expect(link).not.toHaveAttribute('aria-current', 'page');
      }
    }
  });

  test('TC-31.2: the create organization form shows the same three items with Organizations current', async ({
    page,
  }) => {
    await openPlatform(page, 'platformAdminOrgs', ORGS);
    await page.getByRole('main').getByRole('link', { name: 'Create organization' }).click();
    await expect(page).toHaveURL(/\/platform\/orgs\/new$/);

    const menu = platformMenu(page);
    await expect(menu.getByRole('link')).toHaveText(['Organizations', 'Platform admins', 'Audit log']);
    await expect(menu.getByRole('link', { name: 'Organizations', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

test.describe('BR-32: the platform org menu', () => {
  test('TC-32.1: an active org shows "← Organizations", the name with "Active" and the four items, each current on its page', async ({
    page,
  }) => {
    await openPlatform(page, 'platformAdminOrgs', ORG_BASE);
    const menu = platformMenu(page);
    await expect(menu.getByRole('link', { name: /Organizations/ })).toHaveAttribute('href', ORGS);
    await expect(menu.getByText('Acme', { exact: true })).toBeVisible();
    await expect(menu.getByText('Active', { exact: true })).toBeVisible();
    await expect(itemsOf(menu)).toHaveText(['Overview', 'Projects', 'Members', 'Invitations']);
    await expect(menu.getByRole('link', { name: 'Overview', exact: true })).toHaveAttribute('aria-current', 'page');

    for (const [name, path] of [
      ['Projects', 'projects'],
      ['Members', 'members'],
      ['Invitations', 'invitations'],
    ] as const) {
      await menu.getByRole('link', { name, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${ORG_BASE}/${path}$`));
      await expect(page.getByRole('heading', { name, level: 2 })).toBeVisible();
      await expect(menu.getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(menu.getByRole('link', { name: 'Overview', exact: true })).not.toHaveAttribute(
        'aria-current',
        'page',
      );
    }
  });

  test('TC-32.2: a suspended org shows its name with "Suspended" and the same four items', async ({ page }) => {
    await openPlatform(page, 'platformOrgEditSuspended', `${ORGS}/b9100000-0000-4000-8000-000000000001`);
    const menu = platformMenu(page);
    await expect(menu.getByText('Acme', { exact: true })).toBeVisible();
    await expect(menu.getByText('Suspended', { exact: true })).toBeVisible();
    await expect(menu.getByText('Active', { exact: true })).toHaveCount(0);
    await expect(itemsOf(menu)).toHaveText(['Overview', 'Projects', 'Members', 'Invitations']);
  });
});

test.describe('BR-33: More actions on a platform org', () => {
  test('TC-33.1: "View audit log" opens the platform Audit log filtered to the org with a removable chip', async ({
    page,
  }) => {
    await openPlatform(page, 'platformAdminOrgs', ORG_BASE);
    await expect(page.getByRole('heading', { name: 'Acme', level: 1 })).toBeVisible();

    await chooseAction(page, 'View audit log');

    await expect(page).toHaveURL(new RegExp(`/platform/audit\\?org=${ACME_ID}`));
    await expect(page.getByText('Organization: Acme', { exact: true })).toBeVisible();
    await expect(platformMenu(page).getByRole('link', { name: 'Audit log', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const remove = page.getByRole('button', { name: 'Remove filter Organization: Acme', exact: true });
    await expect(remove).toBeVisible();
    await remove.click();
    await expect(page.getByText('Organization: Acme', { exact: true })).toHaveCount(0);
    await expect(page).not.toHaveURL(/org=/);
  });

  test('TC-33.2: "Open organization" on an org the admin belongs to opens its Projects page', async ({ page }) => {
    await openPlatform(page, 'platformAdminMemberOrg', `${ORGS}/${ALICE_ORG}`);
    await chooseAction(page, 'Open organization');
    await expect(page).toHaveURL(/\/o\/alice\/projects$/);
  });

  test('TC-33.3: on an org the admin is not a member of, "View audit log" shows and "Open organization" does not', async ({
    page,
  }) => {
    await openPlatform(page, 'platformAdminOrgs', ORG_BASE);
    await expect(page.getByRole('heading', { name: 'Acme', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'More actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'View audit log' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Open organization' })).toHaveCount(0);
  });
});

test.describe('BR-34: who may open the platform pages', () => {
  test('TC-34.1: an org owner who is not a platform admin sees the forbidden state, no side menu and no platform data', async ({
    page,
  }) => {
    await openPlatform(page, 'ownerNoPlatform', ORGS);
    for (const path of [ORGS, '/platform/admins', '/platform/audit', `${ORG_BASE}/members`]) {
      await page.goto(path);
      await expect(page.getByText("You don't have access", { exact: true })).toBeVisible();
      await expect(page.getByText('This area is for platform admins.', { exact: true })).toBeVisible();
      await expect(page.getByRole('navigation', { name: SIDE_MENU_NAME })).toHaveCount(0);
      await expect(page.getByRole('navigation', { name: 'Platform menu' })).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText('Beta');
      await expect(page.locator('body')).not.toContainText('Quiet Works');
      await expect(page).toHaveTitle(/^[^·]*You don't have access/);
      await expect(page).not.toHaveTitle(/Acme|Beta/);
    }
  });

  test('TC-34.2: a platform admin sees the directory and the Platform menu', async ({ page }) => {
    await openPlatform(page, 'platformAdminOrgs', ORGS);
    await expect(page.getByRole('heading', { name: 'Organizations', level: 1 })).toBeVisible();
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await expect(platformMenu(page)).toBeVisible();
  });
});

test.describe('BR-35: the platform org menu while the org read loads, fails or finds nothing', () => {
  test('TC-35.1: with the org read held the menu shows "← Organizations" and placeholders, no org name', async ({
    page,
  }) => {
    await holdReads(page, { platformOrg: 'hold' });
    await openPlatform(page, 'platformAdminOrgs', `${ORG_BASE}/members`);
    const menu = platformMenu(page);
    await expect(menu.getByRole('link', { name: /Organizations/ })).toBeVisible();
    await expect(menu.getByRole('status', { name: 'Loading organization' })).toBeAttached();
    await expect(menu.getByText('Loading menu')).toBeAttached();
    await expect(menu.getByText('Acme')).toHaveCount(0);
  });

  test('TC-35.2: when the org read fails with 500 the menu labels "Organization" with no status and keeps the four links', async ({
    page,
  }) => {
    await holdReads(page, { platformOrg: 'fail' });
    await openPlatform(page, 'platformAdminOrgs', `${ORG_BASE}/members`);
    const menu = platformMenu(page);
    await expect(menu.getByRole('link', { name: /Organizations/ })).toBeVisible();
    await expect(menu.getByText('Organization', { exact: true })).toBeVisible();
    await expect(menu.getByText('Active', { exact: true })).toHaveCount(0);
    await expect(menu.getByText('Suspended', { exact: true })).toHaveCount(0);
    await expect(itemsOf(menu)).toHaveText(['Overview', 'Projects', 'Members', 'Invitations']);
  });

  test('TC-35.3: an unknown org id shows the Platform menu with Organizations current and "Page not found"', async ({
    page,
  }) => {
    await openPlatform(page, 'platformAdminOrgs', `${ORGS}/b8000000-0000-4000-8000-0000000000ff/members`);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page.getByText('This organization does not exist.', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to organizations' })).toBeVisible();
    const menu = platformMenu(page);
    await expect(menu.getByRole('link', { name: 'Organizations', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(menu.getByRole('link')).toHaveText(['Organizations', 'Platform admins', 'Audit log']);
  });
});
