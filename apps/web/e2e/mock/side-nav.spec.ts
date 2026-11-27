import { expect, test, type Locator, type Page } from '@playwright/test';
import { ids } from '../../src/mocks/dto/ids';
import type { PlatformScenario } from '../../src/mocks/msw/platformScenarios';
import type { TenantAdminScenario } from '../../src/mocks/msw/tenantAdminScenarios';
import {
  IDLE_RUN,
  INVOICER_API,
  ORG,
  OTHER_PROJECT,
  SESSION_MOCK_NOW,
  SIDE_MENU_NAME,
  chooseAction,
  holdReads,
  seedAgents,
  seedLists,
  seedPlatform,
  seedProjectSpace,
  seedShell,
  seedTenantAdmin,
} from './mock';

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

/*
 * Organization pages on the shell (spec 2026-11-25-sidebar-navigation-shell-design.md "E2E requirements": TC-17.1,
 * TC-17.2, TC-18.1, TC-18.2, TC-19.1, TC-20.1, TC-20.2, TC-21.1 to TC-21.5). The local halves are in e2e/local.
 * A second `seed*` call before a `goto` replaces the first scenario: the init scripts run in order and the last wins.
 */
const ALICE_SLUG = ORG;
const orgMenu = (page: Page): Locator => page.getByRole('navigation', { name: 'Organization menu' });
const FULL_ORG_MENU = ['Projects', 'Members', 'Invitations', 'Audit log', 'General'];
const settingsHeading = (page: Page): Locator => orgMenu(page).getByText('Settings', { exact: true });

async function openOrgAs(page: Page, scenario: TenantAdminScenario, path = `/o/${ALICE_SLUG}/projects`): Promise<void> {
  await seedTenantAdmin(page, scenario);
  await page.goto(path);
}

test.describe('BR-17: owner and admin org menu', () => {
  test('TC-17.1: an owner, then an org admin, see Projects and a Settings group of Members, Invitations, Audit log, General', async ({
    page,
  }) => {
    for (const scenario of ['twoOwners', 'admin'] as const) {
      await openOrgAs(page, scenario);
      await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
      await expect(orgMenu(page).getByRole('link')).toHaveText(FULL_ORG_MENU);
      await expect(settingsHeading(page)).toBeVisible();
    }
  });

  test('TC-17.2: an org admin opens Members, Invitations, Audit log, General and Projects, each in one click with that item current', async ({
    page,
  }) => {
    await openOrgAs(page, 'admin');
    await expect(orgMenu(page).getByRole('link', { name: 'Projects', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    for (const [name, path] of [
      ['Members', 'settings/members'],
      ['Invitations', 'settings/invitations'],
      ['Audit log', 'settings/audit'],
      ['General', 'settings/general'],
      ['Projects', 'projects'],
    ] as const) {
      await orgMenu(page).getByRole('link', { name, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/o/${ALICE_SLUG}/${path}$`));
      await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
      await expect(orgMenu(page).getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(orgMenu(page).locator('[aria-current]')).toHaveCount(1);
      await expect(orgMenu(page).getByRole('link')).toHaveText(FULL_ORG_MENU);
    }
  });
});

test.describe('BR-18: member and viewer org menu', () => {
  test('TC-18.1: an org member, then an org viewer, see Projects only: no Settings heading or Settings pages', async ({
    page,
  }) => {
    for (const scenario of ['member', 'viewer'] as const) {
      await openOrgAs(page, scenario);
      await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
      await expect(orgMenu(page).getByRole('link')).toHaveText(['Projects']);
      await expect(settingsHeading(page)).toHaveCount(0);
      for (const name of ['Members', 'Invitations', 'Audit log', 'General']) {
        await expect(orgMenu(page).getByRole('link', { name, exact: true })).toHaveCount(0);
      }
    }
  });

  test('TC-18.2: a member of one project and viewer of another sees Projects only, with no empty group heading', async ({
    page,
  }) => {
    await seedShell(page, 'memberP1ViewerP2');
    await page.goto(`/o/${ALICE_SLUG}/projects`);
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
    await expect(orgMenu(page).getByRole('link')).toHaveText(['Projects']);
    await expect(settingsHeading(page)).toHaveCount(0);
  });
});

test.describe('BR-19: project-only admin org menu', () => {
  test('TC-19.1: an admin of one project sees Projects and Invitations under Settings, and Invitations opens', async ({
    page,
  }) => {
    await seedShell(page, 'adminP1ViewerP2');
    await page.goto(`/o/${ALICE_SLUG}/projects`);
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
    await expect(orgMenu(page).getByRole('link')).toHaveText(['Projects', 'Invitations']);
    await expect(settingsHeading(page)).toBeVisible();
    for (const name of ['Members', 'Audit log', 'General']) {
      await expect(orgMenu(page).getByRole('link', { name, exact: true })).toHaveCount(0);
    }
    await orgMenu(page).getByRole('link', { name: 'Invitations', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${ALICE_SLUG}/settings/invitations$`));
    await expect(page.getByRole('heading', { name: 'Invitations', level: 1 })).toBeVisible();
  });
});

test.describe('BR-20: "Manage in Platform"', () => {
  test('TC-20.1: a platform admin on org Members presses "Manage in Platform", the last item, and the org opens in the platform area', async ({
    page,
  }) => {
    await seedPlatform(page, 'platformAdminMemberOrg');
    await page.goto(`/o/${ALICE_SLUG}/settings/members`);
    const manage = orgMenu(page).getByRole('link', { name: 'Manage in Platform' });
    await expect(manage).toBeVisible();
    const last = orgMenu(page).getByRole('link').last();
    await expect(last).toHaveText('Manage in Platform');
    await manage.click();
    await expect(page).toHaveURL(new RegExp(`/platform/orgs/${ALICE_ORG}$`));
    const menu = platformMenu(page);
    await expect(menu.getByText('Alice', { exact: true })).toBeVisible();
    await expect(itemsOf(menu)).toHaveText(['Overview', 'Projects', 'Members', 'Invitations']);
  });

  test('TC-20.2: an org owner who is not a platform admin sees the org menu on Projects and each Settings page, never "Manage in Platform"', async ({
    page,
  }) => {
    await openOrgAs(page, 'twoOwners');
    for (const path of ['projects', 'settings/members', 'settings/invitations', 'settings/audit', 'settings/general']) {
      await page.goto(`/o/${ALICE_SLUG}/${path}`);
      await expect(orgMenu(page).getByRole('link')).toHaveText(FULL_ORG_MENU);
      await expect(page.getByRole('link', { name: 'Manage in Platform' })).toHaveCount(0);
    }
  });
});

test.describe('BR-21: /o/<org>/settings redirect order', () => {
  test('TC-21.1: an owner, then an org admin, open /settings and land on Members', async ({ page }) => {
    for (const scenario of ['twoOwners', 'admin'] as const) {
      await openOrgAs(page, scenario, `/o/${ALICE_SLUG}/settings`);
      await expect(page).toHaveURL(new RegExp(`/o/${ALICE_SLUG}/settings/members$`));
      await expect(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible();
    }
  });

  test('TC-21.2: an admin of one project opens /settings and lands on Invitations', async ({ page }) => {
    await seedShell(page, 'adminP1ViewerP2');
    await page.goto(`/o/${ALICE_SLUG}/settings`);
    await expect(page).toHaveURL(new RegExp(`/o/${ALICE_SLUG}/settings/invitations$`));
    await expect(page.getByRole('heading', { name: 'Invitations', level: 1 })).toBeVisible();
  });

  test('TC-21.3: a person with only the audit log right opens /settings and lands on Audit log', async ({ page }) => {
    await seedShell(page, 'auditOnly');
    await page.goto(`/o/${ALICE_SLUG}/settings`);
    await expect(page).toHaveURL(new RegExp(`/o/${ALICE_SLUG}/settings/audit$`));
    await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();
  });

  test('TC-21.4: a person with only the org update right opens /settings and lands on General', async ({ page }) => {
    await seedShell(page, 'orgUpdateOnly');
    await page.goto(`/o/${ALICE_SLUG}/settings`);
    await expect(page).toHaveURL(new RegExp(`/o/${ALICE_SLUG}/settings/general$`));
    await expect(page.getByRole('heading', { name: 'General', level: 1 })).toBeVisible();
  });

  test('TC-21.5: an org member opens /settings and sees "You don\'t have access" with the org menu holding Projects only', async ({
    page,
  }) => {
    await openOrgAs(page, 'member', `/o/${ALICE_SLUG}/settings`);
    await expect(page.getByRole('heading', { name: "You don't have access" })).toBeVisible();
    await expect(orgMenu(page).getByRole('link')).toHaveText(['Projects']);
    await expect(settingsHeading(page)).toHaveCount(0);
  });
});

/*
 * Runs and project configuration pages on the shell (spec 2026-11-25-sidebar-navigation-shell-design.md "E2E requirements":
 * TC-4.x, TC-6.4, TC-7.5, TC-7.6, TC-8.6, TC-9.x, TC-10.5, TC-22.x to TC-27.x, TC-44.3). TC-44.2 and TC-44.4 are
 * above, TC-27.1 is in external-links.spec.ts. The local halves, TC-25.3 and the run page step of TC-24.1 are in other
 * tasks. A second `seed*` call before a `goto` replaces the first scenario.
 */
const P1 = INVOICER_API;
const P2 = OTHER_PROJECT;
const projectMenu = (page: Page): Locator => page.getByRole('navigation', { name: 'Project menu' });
const runsUrl = (project = P1) => `/o/${ORG}/p/${project}/runs`;
const deskUrl = (page: string, project = P1) => `/o/${ORG}/p/${project}/desk/${page}`;
const WARNING = 'The setup script has not passed a test yet';
const CONFIGURE = ['Routing rules', 'Skills', 'Workspace setup', 'Agent & settings'];
const ACCESS = ['Members', 'Audit log'];

/** The box of an element in the window; throws when it has none. */
async function box(loc: Locator) {
  const b = await loc.boundingBox();
  if (!b) throw new Error('the element has no box');
  return b;
}

/** The labels of the menu's links, with the needs-you badge text left off the Runs label. */
async function menuLabels(menu: Locator): Promise<string[]> {
  return (await menu.getByRole('link').allTextContents()).map((t) => t.replace(/\d+ needs you$/, '').trim());
}

test.describe('BR-4: "All projects" in the project menu', () => {
  test('TC-4.1: "All projects" on Runs opens the org Projects page with the org menu', async ({ page }) => {
    await seedProjectSpace(page, { role: 'member' });
    await page.goto(runsUrl());
    await projectMenu(page).getByRole('link', { name: 'All projects' }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/projects$`));
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
    await expect(orgMenu(page)).toBeVisible();
    await expect(projectMenu(page)).toHaveCount(0);
  });

  test('TC-4.2: from the Routing rules address, "All projects" opens Projects and Back returns to Routing rules', async ({
    page,
  }) => {
    await seedProjectSpace(page, { role: 'owner' });
    await page.goto(deskUrl('rules'));
    await expect(page.getByRole('heading', { name: 'Routing rules', level: 1 })).toBeVisible();
    await projectMenu(page).getByRole('link', { name: 'All projects' }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/projects$`));
    await expect(orgMenu(page)).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/p/${P1}/desk/rules$`));
    await expect(page.getByRole('heading', { name: 'Routing rules', level: 1 })).toBeVisible();
    await expect(projectMenu(page)).toBeVisible();
  });
});

test.describe('BR-9: the setup warning sits below the page header', () => {
  /** The h1 box of the page, read once the fonts are loaded. */
  async function measureH1(page: Page) {
    const h1 = page.getByRole('heading', { level: 1 }).first();
    await expect(h1).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    return box(h1);
  }

  /** The h1 box and the box of the setup banner. */
  async function measureWithBanner(page: Page) {
    const h1 = await measureH1(page);
    const text = page.getByText(WARNING);
    await expect(text).toBeVisible();
    return { h1, banner: await box(text) };
  }

  test('TC-9.1: on Routing rules the banner is below the h1 and does not overlap it', async ({ page }) => {
    await seedProjectSpace(page, { role: 'owner' });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(deskUrl('rules'));
    const m = await measureWithBanner(page);
    expect(m.banner.y).toBeGreaterThanOrEqual(m.h1.y + m.h1.height);
  });

  test('TC-9.2: the h1 of Routing rules is at the same position with and without the banner', async ({ page }) => {
    await seedProjectSpace(page, { role: 'owner' });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(deskUrl('rules', P1));
    const withBanner = await measureWithBanner(page);
    // The project that has no setup script (the setup warning comes from the seeded fixtures, so a reload keeps it).
    await page.goto(deskUrl('rules', P2));
    await expect(page.getByRole('heading', { level: 1, name: 'Routing rules' })).toBeVisible();
    await expect(page.getByText(WARNING)).toHaveCount(0);
    const without = await measureH1(page);
    expect(Math.abs(without.y - withBanner.h1.y)).toBeLessThanOrEqual(1);
  });

  test('TC-9.3: on each Agent & settings tab the banner is the first item of the scrolling area, below the h1 and tab strip', async ({
    page,
  }) => {
    await seedProjectSpace(page, { role: 'owner' });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(deskUrl('agent'));
    const tabs = page.getByRole('tablist', { name: 'Agent and project settings' });
    const h1Positions: number[] = [];
    for (const name of ['Agents', 'GitHub connection', 'Limits', 'Danger zone']) {
      await tabs.getByRole('tab', { name, exact: true }).click();
      const m = await measureWithBanner(page);
      const strip = await box(tabs);
      expect(m.banner.y).toBeGreaterThanOrEqual(m.h1.y + m.h1.height);
      expect(m.banner.y).toBeGreaterThanOrEqual(strip.y + strip.height);
      // First in the scrolling area: the banner's nearest scrolling ancestor holds nothing visible above it.
      const first = await page.getByText(WARNING).evaluate((banner) => {
        let area: HTMLElement | null = banner.parentElement;
        while (area && !['auto', 'scroll'].includes(getComputedStyle(area).overflowY)) area = area.parentElement;
        if (!area) return false;
        const top = banner.getBoundingClientRect().top;
        return Array.from(area.querySelectorAll<HTMLElement>('*')).every((n) => {
          const r = n.getBoundingClientRect();
          return n.contains(banner) || banner.contains(n) || r.height === 0 || r.top >= top - 1;
        });
      });
      expect(first).toBe(true);
      h1Positions.push(m.h1.y);
    }
    await page.goto(deskUrl('agent', P2));
    await expect(page.getByRole('heading', { level: 1, name: 'Agent & settings' })).toBeVisible();
    for (const [i, name] of ['Agents', 'GitHub connection', 'Limits', 'Danger zone'].entries()) {
      await tabs.getByRole('tab', { name, exact: true }).click();
      await expect(page.getByText(WARNING)).toHaveCount(0);
      const h1 = await measureH1(page);
      const baseline = h1Positions[i];
      if (baseline === undefined) throw new Error('no baseline for the tab');
      expect(Math.abs(h1.y - baseline)).toBeLessThanOrEqual(1);
    }
  });
});

test.describe('BR-22: the project menu by role', () => {
  const FULL = ['All projects', 'Runs', ...CONFIGURE, ...ACCESS, 'Open repository'];

  test('TC-22.1: an owner, an org admin and the project admin see the full project menu in order', async ({ page }) => {
    for (const role of ['owner', 'admin', 'projectAdmin'] as const) {
      await seedProjectSpace(page, { role });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(runsUrl());
      const menu = projectMenu(page);
      await expect(menu.getByRole('link', { name: 'Audit log' })).toBeVisible();
      await expect.poll(() => menuLabels(menu)).toEqual(FULL);
      const text = await menu.innerText();
      const at = (needle: string) => text.indexOf(needle);
      const order = ['Runs', 'Configure', 'Routing rules', 'Access', 'Members', 'Repository'].map(at);
      expect(order.every((i) => i >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      await expect(menu.getByRole('region', { name: 'Repository' })).toBeVisible();
    }
  });

  test('TC-22.2: the project admin opens each Configure and Access item, each with the same menu and that item current', async ({
    page,
  }) => {
    await seedProjectSpace(page, { role: 'projectAdmin' });
    await page.goto(runsUrl());
    const menu = projectMenu(page);
    for (const name of [...CONFIGURE, ...ACCESS]) {
      await menu.getByRole('link', { name, exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
      await expect(menu.getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(menu.locator('[aria-current]')).toHaveCount(1);
      await expect.poll(() => menuLabels(menu)).toEqual(FULL);
    }
  });

  test('TC-23.1: a member, then a viewer, see "All projects", Runs and the repository block only', async ({ page }) => {
    for (const role of ['member', 'viewer'] as const) {
      await seedProjectSpace(page, { role });
      await page.goto(runsUrl());
      const menu = projectMenu(page);
      await expect(menu.getByRole('link', { name: /^Runs/ })).toBeVisible();
      await expect(menu.getByRole('region', { name: 'Repository' })).toBeVisible();
      await expect.poll(() => menuLabels(menu)).toEqual(['All projects', 'Runs', 'Open repository']);
      await expect(menu.getByText('Configure', { exact: true })).toHaveCount(0);
      await expect(menu.getByText('Access', { exact: true })).toHaveCount(0);
    }
  });

  test('TC-23.3: a member on a forbidden Skills address sees Forbidden and the same menu with the repository block', async ({
    page,
  }) => {
    await seedProjectSpace(page, { role: 'member' });
    await page.goto(deskUrl('skills'));
    await expect(page.getByRole('heading', { name: "You don't have access" })).toBeVisible();
    const menu = projectMenu(page);
    await expect(menu.getByRole('region', { name: 'Repository' })).toBeVisible();
    await expect.poll(() => menuLabels(menu)).toEqual(['All projects', 'Runs', 'Open repository']);
    await expect(menu.getByText('Configure', { exact: true })).toHaveCount(0);
    await expect(menu.getByText('Access', { exact: true })).toHaveCount(0);
  });
});

test.describe('BR-24: the project menu follows each project and org grant', () => {
  test('TC-24.1: admin of P1 and viewer of P2: P1 shows Configure and Access, P2 shows Runs and the repository only', async ({
    page,
  }) => {
    await seedShell(page, 'adminP1ViewerP2');
    await page.goto(runsUrl(P1));
    const menu = projectMenu(page);
    await expect(menu.getByRole('link', { name: 'Audit log' })).toBeVisible();
    await expect(menu.getByText('Configure', { exact: true })).toBeVisible();
    await expect(menu.getByText('Access', { exact: true })).toBeVisible();
    // Client-side navigation keeps the mock store: the project switcher opens P2.
    await page.getByRole('button', { name: /^Switch project, currently/ }).click();
    await page.getByRole('dialog', { name: 'Projects' }).getByRole('link', { name: 'invoicer-web' }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/p/${P2}/runs$`));
    await expect(menu.getByRole('link', { name: /^Runs/ })).toBeVisible();
    await expect.poll(() => menuLabels(menu)).toEqual(['All projects', 'Runs', 'Open repository']);
    await expect(menu.getByText('Configure', { exact: true })).toHaveCount(0);
    await expect(menu.getByText('Access', { exact: true })).toHaveCount(0);
  });

  test('TC-24.2, TC-24.3: org admin of A and member of B: B has Projects only and no Configure or Access; A shows both in full', async ({
    page,
  }) => {
    await seedShell(page, 'adminAMemberB');
    await page.goto(`/o/${ALICE_SLUG}/projects`);
    await expect(orgMenu(page).getByRole('link')).toHaveText(FULL_ORG_MENU);
    await page.getByRole('button', { name: /^Switch scope, currently organization/ }).click();
    await page.getByRole('dialog', { name: 'Scope' }).getByRole('link', { name: 'Acme', exact: true }).click();
    await expect(page).toHaveURL(/\/o\/acme\/projects$/);
    await expect(orgMenu(page).getByRole('link')).toHaveText(['Projects']);
    await page.getByRole('link', { name: 'storefront', exact: true }).first().click();
    await expect(page).toHaveURL(/\/o\/acme\/p\/[^/]+\/runs/);
    const menu = projectMenu(page);
    await expect(menu.getByRole('link', { name: /^Runs/ })).toBeVisible();
    await expect(menu.getByText('Configure', { exact: true })).toHaveCount(0);
    await expect(menu.getByText('Access', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: /^Switch scope, currently organization/ }).click();
    await page.getByRole('dialog', { name: 'Scope' }).getByRole('link', { name: 'Alice', exact: true }).click();
    await expect(page).toHaveURL(/\/o\/alice\/projects$/);
    await expect(orgMenu(page).getByRole('link')).toHaveText(FULL_ORG_MENU);
    await page.getByRole('link', { name: 'invoicer-api', exact: true }).first().click();
    await expect(menu.getByRole('link', { name: 'Audit log' })).toBeVisible();
    await expect
      .poll(() => menuLabels(menu))
      .toEqual(['All projects', 'Runs', ...CONFIGURE, ...ACCESS, 'Open repository']);
  });
});

test.describe('BR-25: the needs you badge', () => {
  test('TC-25.1: with one run that needs a person, the Runs item shows 1 labelled "needs you"', async ({ page }) => {
    // Replaces every run of invoicer-api with one idle run, the only one that needs a person.
    await seedLists(page, { needsYou: 1 });
    await page.goto(deskUrl('rules'));
    const runs = projectMenu(page).getByRole('link', { name: /^Runs/ });
    await expect(runs).toContainText('1');
    await expect(runs).toHaveAccessibleName(/1 needs you/);
  });

  test('TC-25.2: with no run that needs a person, the Runs item shows no badge and no 0', async ({ page }) => {
    await page.goto(runsUrl(P2));
    const runs = projectMenu(page).getByRole('link', { name: /^Runs/ });
    await expect(runs).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible();
    await expect(runs).toHaveText('Runs');
    await expect(runs).not.toContainText('0');
    await expect(runs).not.toContainText('needs you');
  });
});

test.describe('BR-26: the repository block', () => {
  const block = (page: Page): Locator => projectMenu(page).getByRole('region', { name: 'Repository' });

  test('TC-26.1: an OK project shows the repository, develop (not main), "Connected" and "Open repository"', async ({
    page,
  }) => {
    await seedShell(page, 'developBranch');
    await page.goto(runsUrl());
    await expect(block(page).getByText('Repository', { exact: true })).toBeVisible();
    await expect(block(page)).toContainText('harbor-labs');
    await expect(block(page)).toContainText('invoicer-api');
    await expect(block(page).getByText('develop', { exact: true })).toBeVisible();
    await expect(block(page).getByText('main', { exact: true })).toHaveCount(0);
    await expect(block(page).getByText('Connected')).toBeVisible();
    await expect(block(page).getByRole('link', { name: 'Open repository' })).toBeVisible();
  });

  /** The computed colour of a design token, read through a probe element (the status line sets `color: var(--<token>)`). */
  const tokenColor = (page: Page, token: string): Promise<string> =>
    page.evaluate((t) => {
      const probe = document.createElement('span');
      probe.style.color = `var(--${t})`;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    }, token);
  const colorOf = (line: Locator): Promise<string> => line.evaluate((el) => getComputedStyle(el).color);

  test('TC-26.2: a warning connection shows the warning line', async ({ page }) => {
    await seedShell(page, 'connectionWarn');
    await page.goto(runsUrl());
    const line = block(page).getByText('No webhooks for 2 days');
    await expect(line).toBeVisible();
    // The warning style: the warning (idle) tone, not the error tone.
    expect(await colorOf(line)).toBe(await tokenColor(page, 'idle'));
    expect(await colorOf(line)).not.toBe(await tokenColor(page, 'fail'));
  });

  test('TC-26.3: an error connection shows the error line', async ({ page }) => {
    await seedShell(page, 'connectionError');
    await page.goto(runsUrl());
    const line = block(page).getByText(/^Polling failed: /);
    await expect(line).toBeVisible();
    // The error style: the failure tone, not the warning tone.
    expect(await colorOf(line)).toBe(await tokenColor(page, 'fail'));
    expect(await colorOf(line)).not.toBe(await tokenColor(page, 'idle'));
  });

  test('TC-26.4: a project with no default branch shows no branch line and no "main"', async ({ page }) => {
    await seedShell(page, 'noDefaultBranch');
    await page.goto(runsUrl());
    await expect(block(page)).toContainText('invoicer-api');
    await expect(block(page).getByRole('link', { name: 'Open repository' })).toBeVisible();
    await expect(block(page).getByText('main', { exact: true })).toHaveCount(0);
    await expect(block(page).getByText('No webhooks for 2 days')).toBeVisible();
  });
});

test('TC-27.2: the top bar has no repository button or link on Runs, a run page and a Desk page', async ({ page }) => {
  // Each page proves it has loaded first. The run page is not on the shell yet, so it has no project menu to wait for.
  const pages: [string, () => Promise<void>][] = [
    [runsUrl(), () => expect(projectMenu(page)).toBeVisible()],
    [`${runsUrl()}/${IDLE_RUN}`, () => expect(page.getByText('Triggered by')).toBeVisible()],
    [deskUrl('rules'), () => expect(projectMenu(page)).toBeVisible()],
  ];
  for (const [url, loaded] of pages) {
    await page.goto(url);
    await loaded();
    const bar = page.getByRole('banner').first();
    await expect(bar.getByRole('link', { name: /repo|repository|GitHub/i })).toHaveCount(0);
    await expect(bar.getByRole('button', { name: /repo|repository|GitHub/i })).toHaveCount(0);
  }
});

test('TC-44.3: a skill open on Skills has no History control', async ({ page }) => {
  await page.goto(deskUrl('skills'));
  // The skill is open: its source editor and its h2 are there before the absence checks mean anything.
  await expect(page.getByRole('textbox', { name: 'SKILL.md source' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('heading', { level: 2 }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'History' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'History' })).toHaveCount(0);
});

test.describe('Agent & settings in the shell', () => {
  const AGENT = deskUrl('agent');
  const TABS = ['Agents', 'GitHub connection', 'Limits', 'Danger zone'];
  const current = (page: Page): Locator => projectMenu(page).locator('[aria-current="page"]');
  const tabButton = (page: Page, name: string): Locator =>
    page.getByRole('tablist', { name: 'Agent and project settings' }).getByRole('tab', { name, exact: true });

  test('TC-7.5: on every tab "Agent & settings" is the one current menu item', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(AGENT);
    await expect(current(page)).toHaveText('Agent & settings');
    for (const name of TABS.slice(1)) {
      await tabButton(page, name).click();
      await expect(tabButton(page, name)).toHaveAttribute('aria-selected', 'true');
      await expect(current(page)).toHaveCount(1);
      await expect(current(page)).toHaveText('Agent & settings');
    }
  });

  test('TC-7.6: with the add pane or an edit pane open, "Agent & settings" is the one current item', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(AGENT);
    await page.getByRole('button', { name: 'Add agent' }).click();
    await expect(page).toHaveURL(/agent=new/);
    await expect(current(page)).toHaveCount(1);
    await expect(current(page)).toHaveText('Agent & settings');
    await page.keyboard.press('Escape');
    await expect(page).not.toHaveURL(/agent=/);
    await page.getByRole('button', { name: /^Edit/ }).first().click();
    await expect(page).toHaveURL(/agent=[0-9a-f-]{36}/);
    await expect(current(page)).toHaveCount(1);
    await expect(current(page)).toHaveText('Agent & settings');
  });

  test('TC-8.6: the h1 is single, "Agent & settings", and as placed as on Runs on each tab and pane', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(runsUrl());
    const runsH1 = page.getByRole('heading', { level: 1, name: 'Runs' });
    await expect(runsH1).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const reference = await runsH1.boundingBox();
    if (!reference) throw new Error('the Runs h1 has no box');
    // The width follows the text ("Runs" against "Agent & settings"), so the size is the height and the font.
    const font = await runsH1.evaluate((el) => {
      const cs = getComputedStyle(el);
      return `${cs.fontSize} ${cs.fontWeight} ${cs.fontFamily}`;
    });
    await projectMenu(page).getByRole('link', { name: 'Agent & settings' }).click();
    const h1 = page.getByRole('heading', { level: 1 });
    const same = async () => {
      await expect(h1).toHaveCount(1);
      await expect(h1).toHaveText('Agent & settings');
      const b = await h1.boundingBox();
      if (!b) throw new Error('the h1 has no box');
      expect(Math.abs(b.x - reference.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(b.y - reference.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(b.height - reference.height)).toBeLessThanOrEqual(1);
      expect(
        await h1.evaluate((el) => {
          const cs = getComputedStyle(el);
          return `${cs.fontSize} ${cs.fontWeight} ${cs.fontFamily}`;
        }),
      ).toBe(font);
      const strip = await box(page.getByRole('tablist', { name: 'Agent and project settings' }));
      expect(strip.y).toBeGreaterThanOrEqual(b.y + b.height);
    };
    for (const name of TABS) {
      await tabButton(page, name).click();
      await same();
    }
    await tabButton(page, 'Agents').click();
    await page.getByRole('button', { name: 'Add agent' }).click();
    await same();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^Edit/ }).first().click();
    await same();
  });

  test('TC-10.5: the document title and the breadcrumb are the same on every tab and with either pane open', async ({
    page,
  }) => {
    await page.goto(AGENT);
    const title = 'Agent & settings · invoicer-api · Agent Desk';
    const crumb = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(page).toHaveTitle(title);
    await expect(crumb.locator('[aria-current="page"]')).toHaveText('Agent & settings');
    for (const name of TABS.slice(1)) {
      await tabButton(page, name).click();
      await expect(page).toHaveTitle(title);
      await expect(crumb.locator('[aria-current="page"]')).toHaveText('Agent & settings');
    }
    await tabButton(page, 'Agents').click();
    await page.getByRole('button', { name: 'Add agent' }).click();
    await expect(page).toHaveTitle(title);
    await expect(crumb.locator('[aria-current="page"]')).toHaveText('Agent & settings');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^Edit/ }).first().click();
    await expect(page).toHaveTitle(title);
    await expect(crumb.locator('[aria-current="page"]')).toHaveText('Agent & settings');
  });
});

test.describe('BR-6: the side menu and the page fit', () => {
  for (const height of [420, 240]) {
    test(`TC-6.4: at 1280x${height} Agent & settings and Routing rules do not scroll as a page when the menu scrolls`, async ({
      page,
    }) => {
      await seedAgents(page, 'manyAgents');
      await seedLists(page, { rules: 45 });
      await page.setViewportSize({ width: 1280, height });
      for (const [url, h1] of [
        [deskUrl('agent'), 'Agent & settings'],
        [deskUrl('rules'), 'Routing rules'],
      ] as const) {
        await page.goto(url);
        const heading = page.getByRole('heading', { level: 1, name: h1 });
        await expect(heading).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const fits = () => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
        expect(await fits()).toBe(0);
        const before = await heading.boundingBox();
        const menu = projectMenu(page);
        const scrolled = await menu.evaluate((el) => {
          const scrolls = (n: HTMLElement) => ['auto', 'scroll'].includes(getComputedStyle(n).overflowY);
          const area = [el as HTMLElement, ...Array.from(el.querySelectorAll<HTMLElement>('*'))].find(
            (n) => scrolls(n) && n.scrollHeight > n.clientHeight,
          );
          if (!area) return -1;
          area.scrollTo(0, 5000);
          return area.scrollTop;
        });
        expect(scrolled).toBeGreaterThan(0);
        expect(await page.evaluate(() => window.scrollY)).toBe(0);
        expect(await fits()).toBe(0);
        expect(await heading.boundingBox()).toEqual(before);
        // The page's own scroll area keeps at least 120 px.
        const area = page.getByRole('main').locator('[role="region"], [role="tabpanel"]').first();
        expect((await box(area)).height).toBeGreaterThanOrEqual(120);
      }
    });
  }
});

test.describe('Review Focus 3: long names do not widen the page', () => {
  test('with long org and project names the menu and the document stay within their width at 1440', async ({
    page,
  }) => {
    await seedShell(page, 'longNames');
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const url of [runsUrl(), deskUrl('rules'), deskUrl('agent')]) {
      await page.goto(url);
      await expect(projectMenu(page)).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const widths = await page.evaluate(() => {
        const menu = document.querySelector('nav[aria-label="Project menu"]') as HTMLElement;
        const doc = document.documentElement;
        return { menu: menu.scrollWidth - menu.clientWidth, doc: doc.scrollWidth - doc.clientWidth };
      });
      expect(widths.menu).toBeLessThanOrEqual(1);
      expect(widths.doc).toBeLessThanOrEqual(1);
    }
  });
});
