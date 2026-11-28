import { createRequire } from 'node:module';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { agentListId, ids } from '../../src/mocks/dto/ids';
import { MARKER } from '../../src/mocks/msw/shellScenarios';
import type { PlatformScenario } from '../../src/mocks/msw/platformScenarios';
import type { TenantAdminScenario } from '../../src/mocks/msw/tenantAdminScenarios';
import {
  IDLE_RUN,
  INVOICER_API,
  NO_CREDENTIAL_RUN,
  ORG,
  OTHER_PROJECT,
  PAUSED_RUN,
  SESSION_MOCK_NOW,
  SIDE_MENU_NAME,
  TRANSCRIPT_TIMED_OUT_RUN,
  chooseAction,
  answerRequest,
  holdReads,
  release,
  runHeader,
  setRead,
  seedAgents,
  seedLists,
  seedPlatform,
  seedProjectSpace,
  seedShell,
  seedTenantAdmin,
  startSignedOut,
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

test.describe('BR-30: the old needs-you address', () => {
  const needsYouUrl = (project = P1) => `/o/${ORG}/p/${project}/needs-you`;

  test('TC-30.1: an org member sees "Page not found" with the project menu, the address stays and no needs-you list shows', async ({
    page,
  }) => {
    await page.goto(needsYouUrl());
    await expect(page.getByRole('main').getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(projectMenu(page)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/p/${P1}/needs-you$`));
    await expect(page.getByText('No runs need you right now.')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^Open run \d+ in Agent Desk$/ })).toHaveCount(0);
  });

  test('TC-30.2: a person with no access to the project sees "Page not found" with the org menu and no project name', async ({
    page,
  }) => {
    await seedProjectSpace(page, { role: 'projectAdmin' });
    await page.goto(needsYouUrl(P2));
    await expect(page.getByRole('main').getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(orgMenu(page)).toBeVisible();
    await expect(projectMenu(page)).toHaveCount(0);
    await expect(page.getByText('invoicer-web')).toHaveCount(0);
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

test('TC-44.3: a skill open on Skills, with no repository file URL, has no History control', async ({ page }) => {
  await page.route(`**/api/projects/${P1}`, async (route) => {
    const response = await route.fetch();
    const project = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...project, skillFileBaseUrl: null } });
  });
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

test.describe('BR-29, BR-82: the bare project URL and the bare /desk URL', () => {
  const bareUrl = (project = P1) => `/o/${ORG}/p/${project}`;
  const bareDesk = (project = P1) => `${bareUrl(project)}/desk`;
  const runsH1 = (page: Page): Locator => page.getByRole('heading', { name: 'Runs', level: 1 });
  const notFound = (page: Page): Locator => page.getByRole('heading', { name: 'Page not found' });

  test('TC-29.1: the bare project URL opens that project Runs page', async ({ page }) => {
    await seedProjectSpace(page, { role: 'viewer' });
    await page.goto(bareUrl());
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/p/${P1}/runs$`));
    await expect(runsH1(page)).toBeVisible();
  });

  test('TC-29.2: an admin of P1 only opening P2 sees Page not found without P2 named', async ({ page }) => {
    await seedProjectSpace(page, { role: 'projectAdmin' });
    await page.goto(bareUrl(P2));
    await expect(notFound(page)).toBeVisible();
    await expect(page.getByText('invoicer-web')).toHaveCount(0);
  });

  test('TC-29.3: a well-formed project id that does not exist shows Page not found', async ({ page }) => {
    await seedProjectSpace(page, { role: 'member' });
    await page.goto(bareUrl('0badc0de-0000-4000-8000-00000000abcd'));
    await expect(notFound(page)).toBeVisible();
  });

  for (const role of ['owner', 'admin', 'projectAdmin', 'member', 'viewer'] as const) {
    test(`TC-82.1: a ${role} opening /desk lands on Runs with no forbidden state`, async ({ page }) => {
      await seedProjectSpace(page, { role });
      await page.goto(bareDesk());
      await expect(page).toHaveURL(new RegExp(`/o/${ORG}/p/${P1}/runs$`));
      await expect(runsH1(page)).toBeVisible();
      await expect(page.getByRole('heading', { name: "You don't have access" })).toHaveCount(0);
    });
  }

  test('TC-82.2: Back after the /desk redirect returns to the earlier page and stays', async ({ page }) => {
    await seedProjectSpace(page, { role: 'owner' });
    for (const url of [bareDesk(), `${bareDesk()}/`]) {
      await page.goto(`/o/${ORG}/projects`);
      await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
      await page.goto(url);
      await expect(runsH1(page)).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`/o/${ORG}/projects$`));
      await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
      await expect(runsH1(page)).toHaveCount(0);
    }
  });

  test('TC-82.3: an admin of P1 only opening P2 /desk sees Page not found and the org menu', async ({ page }) => {
    await seedProjectSpace(page, { role: 'projectAdmin' });
    await page.goto(bareDesk(P2));
    await expect(notFound(page)).toBeVisible();
    await expect(page.getByText('invoicer-web')).toHaveCount(0);
    await expect(orgMenu(page)).toBeVisible();
    await expect(projectMenu(page)).toHaveCount(0);
  });

  test('TC-82.4: another org project /desk under either slug shows Page not found, not named', async ({ page }) => {
    await seedShell(page, 'foreignOrg');
    for (const org of [ORG, 'zephyr-foreign']) {
      await page.goto(`/o/${org}/p/a0000000-0000-4000-8000-000000000006/desk`);
      await expect(notFound(page)).toBeVisible();
      await expect(page.getByText('zephyr-secret-ledger')).toHaveCount(0);
    }
  });

  test('TC-82.5: unknown project and /desk/nope are not found; /desk/rules opens Routing rules', async ({ page }) => {
    await seedProjectSpace(page, { role: 'owner' });
    await page.goto(bareDesk('0badc0de-0000-4000-8000-00000000abcd'));
    await expect(notFound(page)).toBeVisible();
    await page.goto(deskUrl('rules'));
    await expect(page.getByRole('heading', { name: 'Routing rules', level: 1 })).toBeVisible();
    await expect(runsH1(page)).toHaveCount(0);
    await page.goto(deskUrl('nope'));
    await expect(notFound(page)).toBeVisible();
  });

  test('TC-82.6: /desk/agent?tab=limits keeps its search, opens Limits and not Runs', async ({ page }) => {
    await seedProjectSpace(page, { role: 'owner' });
    await page.goto(`${deskUrl('agent')}?tab=limits`);
    await expect(page.getByRole('heading', { name: 'Agent & settings', level: 1 })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Limits', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/\/desk\/agent\?tab=limits$/);
    await expect(runsH1(page)).toHaveCount(0);
  });
});

/*
 * BR-48 to BR-52, BR-54, BR-68: the project switcher keeps the page and drops drafts. Switching is client-side (the
 * mock store lives in the page), so no case reloads between the two projects.
 */
test.describe('The project switcher', () => {
  const switchButton = (page: Page): Locator => page.getByRole('button', { name: /^Switch project, currently/ });
  const popover = (page: Page): Locator => page.getByRole('dialog', { name: 'Projects' });
  const openSwitcher = async (page: Page): Promise<Locator> => {
    await switchButton(page).click();
    await expect(popover(page)).toBeVisible();
    return popover(page);
  };
  const switchTo = async (page: Page, name: string): Promise<void> => {
    const menu = await openSwitcher(page);
    await menu.getByRole('link', { name: new RegExp(name) }).click();
  };
  const agentUrl = (project: string) => new RegExp(`/o/${ORG}/p/${project}/desk/agent$`);
  const agentsTabSelected = (page: Page): Locator => page.getByRole('tab', { name: 'Agents', exact: true });
  const forbidden = (page: Page): Locator => page.getByText("You don't have access");
  const linkNames = async (menu: Locator): Promise<(string | undefined)[]> =>
    (await menu.getByRole('link').allInnerTexts()).map((t) => t.replace(/\s*\d+ needs you\s*$/, '').trim());

  test.describe('the list (BR-48, BR-49)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('TC-48.1: the title, the projects with the current one checked, "1 needs you" and "All projects"', async ({
      page,
    }) => {
      await seedLists(page, { runs: { total: 3 }, needsYou: 1 });
      await page.goto(runsUrl(P1));
      const menu = await openSwitcher(page);
      await expect(menu.getByText('Switch project', { exact: true })).toBeVisible();
      await expect(menu.getByRole('link', { name: /invoicer-api/ })).toHaveAttribute('aria-current', /.+/);
      await expect(menu.getByRole('link', { name: /invoicer-web/ })).not.toHaveAttribute('aria-current', /.+/);
      await expect(menu.getByRole('link', { name: /invoicer-api/ })).toContainText('1 needs you');
      await expect(menu.getByRole('link', { name: 'All projects' })).toBeVisible();
    });

    test('TC-48.2: a person who sees only some projects sees only those, and no other name or count', async ({
      page,
    }) => {
      await seedShell(page, 'adminP1ViewerP2');
      await page.goto(runsUrl(P1));
      const menu = await openSwitcher(page);
      await expect.poll(() => linkNames(menu)).toEqual(['invoicer-api', 'invoicer-web', 'All projects']);
      for (const hidden of ['docs-site', 'billing-jobs', 'storefront', 'Acme']) {
        await expect(menu.getByText(hidden)).toHaveCount(0);
      }
    });

    test('TC-48.3: a project with no run needing a person shows no count', async ({ page }) => {
      await page.goto(runsUrl(P1));
      const menu = await openSwitcher(page);
      const row = menu.getByRole('link', { name: /invoicer-web/ });
      await expect(row).toBeVisible();
      await expect(row).not.toContainText('needs you');
      await expect(row).not.toContainText('0');
    });

    for (const role of ['owner', 'admin'] as const) {
      test(`TC-49.1: an org ${role} sees "New project" and it opens the wizard`, async ({ page }) => {
        await seedProjectSpace(page, { role });
        await page.goto(runsUrl(P1));
        const menu = await openSwitcher(page);
        await menu.getByRole('link', { name: 'New project' }).click();
        await expect(page).toHaveURL(new RegExp(`/o/${ORG}/projects/new/`));
      });
    }

    for (const role of ['member', 'viewer', 'projectAdmin'] as const) {
      test(`TC-49.2: a ${role} sees the list and "All projects" but no "New project"`, async ({ page }) => {
        await seedProjectSpace(page, { role });
        await page.goto(runsUrl(P1));
        const menu = await openSwitcher(page);
        await expect(menu.getByRole('link', { name: /invoicer-api/ })).toBeVisible();
        await expect(menu.getByRole('link', { name: 'All projects' })).toBeVisible();
        await expect(menu.getByRole('link', { name: 'New project' })).toHaveCount(0);
      });
    }
  });

  test.describe('All projects (BR-50)', () => {
    test('TC-50.1: an org member on Runs picks "All projects" and the Projects page opens', async ({ page }) => {
      await seedProjectSpace(page, { role: 'member' });
      await page.goto(runsUrl(P1));
      const menu = await openSwitcher(page);
      await menu.getByRole('link', { name: 'All projects' }).click();
      await expect(page).toHaveURL(new RegExp(`/o/${ORG}/projects$`));
    });

    test('TC-50.2: an org owner on Routing rules picks "All projects" and the Projects page opens', async ({
      page,
    }) => {
      await seedProjectSpace(page, { role: 'owner' });
      await page.goto(deskUrl('rules'));
      const menu = await openSwitcher(page);
      await menu.getByRole('link', { name: 'All projects' }).click();
      await expect(page).toHaveURL(new RegExp(`/o/${ORG}/projects$`));
    });
  });

  test.describe('the same page of the other project (BR-51)', () => {
    test('TC-51.1: from Skills with a skill in the address, P2 Skills opens with none of P1 query', async ({
      page,
    }) => {
      await seedProjectSpace(page, { role: 'owner' });
      await page.goto(`${deskUrl('skills')}?skill=code-review`);
      await expect(page).toHaveURL(/skill=code-review/);
      await switchTo(page, 'invoicer-web');
      await expect(page).toHaveURL(new RegExp(`/o/${ORG}/p/${P2}/desk/skills$`));
      await expect(page.getByRole('heading', { name: 'Skills', level: 1 })).toBeVisible();
    });

    test('TC-51.2: an admin of P1 and viewer of P2 on P1 Routing rules lands on P2 Runs, with no forbidden state', async ({
      page,
    }) => {
      await seedShell(page, 'adminP1ViewerP2');
      await page.goto(deskUrl('rules'));
      await expect(page.getByRole('heading', { name: 'Routing rules', level: 1 })).toBeVisible();
      await switchTo(page, 'invoicer-web');
      await expect(page).toHaveURL(new RegExp(`/o/${ORG}/p/${P2}/runs$`));
      await expect(page.getByRole('heading', { name: 'Runs', level: 1 })).toBeVisible();
      await expect(forbidden(page)).toHaveCount(0);
    });

    test('TC-51.3: from Runs with a filter in the address, P2 Runs opens without P1 query', async ({ page }) => {
      await seedProjectSpace(page, { role: 'member' });
      await page.goto(`${runsUrl(P1)}?filter=ended`);
      await expect(page).toHaveURL(/filter=ended/);
      await switchTo(page, 'invoicer-web');
      await expect(page).toHaveURL(new RegExp(`/o/${ORG}/p/${P2}/runs(\\?.*)?$`));
      await expect(page).not.toHaveURL(/filter=ended/);
      await expect(page.getByRole('heading', { name: 'Runs', level: 1 })).toBeVisible();
    });

    test('TC-51.4: from the project Members page, P2 Members opens', async ({ page }) => {
      await seedProjectSpace(page, { role: 'owner' });
      await page.goto(deskUrl('members'));
      await expect(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible();
      await switchTo(page, 'invoicer-web');
      await expect(page).toHaveURL(new RegExp(`/o/${ORG}/p/${P2}/desk/members$`));
      await expect(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible();
    });

    test('TC-51.5: from GitHub connection, Limits and Danger zone, P2 opens on the Agents tab with no tab in the address', async ({
      page,
    }) => {
      await page.goto(deskUrl('agent'));
      for (const tab of ['GitHub connection', 'Limits', 'Danger zone']) {
        await page
          .getByRole('tablist', { name: 'Agent and project settings' })
          .getByRole('tab', { name: tab, exact: true })
          .click();
        await expect(page).toHaveURL(/tab=/);
        await switchTo(page, 'invoicer-web');
        await expect(page).toHaveURL(agentUrl(P2));
        await expect(agentsTabSelected(page)).toHaveAttribute('aria-selected', 'true');
        await switchTo(page, 'invoicer-api');
        await expect(page).toHaveURL(agentUrl(P1));
      }
    });

    test('TC-51.6: from the second page of Agents with an edit pane open, P2 opens on the first page with no pane', async ({
      page,
    }) => {
      await seedAgents(page, 'manyAgents');
      await page.goto(`${deskUrl('agent')}?page=2`);
      await page.getByRole('button', { name: /^Edit/ }).first().click();
      await expect(page).toHaveURL(/agent=[0-9a-f-]{36}/);
      await expect(page).toHaveURL(/page=2/);
      await switchTo(page, 'invoicer-web');
      await expect(page).toHaveURL(agentUrl(P2));
      await expect(agentsTabSelected(page)).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('heading', { level: 2, name: 'Edit agent' })).toHaveCount(0);
    });

    test('TC-51.7: an admin of P1 and viewer of P2 on an Agent & settings tab lands on P2 Runs, with no forbidden state', async ({
      page,
    }) => {
      await seedShell(page, 'adminP1ViewerP2');
      await page.goto(`${deskUrl('agent')}?tab=limits`);
      await expect(page.getByRole('tab', { name: 'Limits', exact: true })).toHaveAttribute('aria-selected', 'true');
      await switchTo(page, 'invoicer-web');
      await expect(page).toHaveURL(new RegExp(`/o/${ORG}/p/${P2}/runs$`));
      await expect(page.getByRole('heading', { name: 'Runs', level: 1 })).toBeVisible();
      await expect(forbidden(page)).toHaveCount(0);
    });
  });

  test.describe('loading, error and empty (BR-54)', () => {
    test('TC-54.1: while the list is held the loading state shows and "All projects" is still offered', async ({
      page,
    }) => {
      await answerRequest(page, { method: 'GET', path: '^/api/projects$', times: 1, hold: true });
      await page.goto(runsUrl(P1));
      const menu = await openSwitcher(page);
      await expect(menu.getByRole('status')).toHaveText('Loading projects');
      await expect(menu.getByRole('link', { name: 'All projects' })).toBeVisible();
    });

    test('TC-54.2: a failed list shows "Could not load your projects." with Retry and the footer; Retry shows the projects', async ({
      page,
    }) => {
      await holdReads(page, { projectList: 'fail' });
      await seedProjectSpace(page, { role: 'owner' });
      await page.goto(runsUrl(P1));
      const menu = await openSwitcher(page);
      await expect(menu.getByText('Could not load your projects.')).toBeVisible({ timeout: 15_000 });
      await expect(menu.getByRole('link', { name: 'All projects' })).toBeVisible();
      await expect(menu.getByRole('link', { name: 'New project' })).toBeVisible();
      await setRead(page, 'projectList');
      await menu.getByRole('button', { name: 'Retry' }).click();
      await expect(menu.getByRole('link', { name: /invoicer-web/ })).toBeVisible();
    });

    test('TC-54.3: an empty list shows "No projects yet." with the footer links', async ({ page }) => {
      await page.addInitScript(() => {
        const original = window.fetch.bind(window);
        window.fetch = async (input, init) => {
          const req = input instanceof Request ? input : undefined;
          const method = (init?.method ?? req?.method ?? 'GET').toUpperCase();
          const url = new URL(req ? req.url : String(input), window.location.href);
          if (method === 'GET' && url.pathname === '/api/projects') {
            return new Response(JSON.stringify({ items: [], page: 1, pageSize: 100, total: 0 }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }
          return original(input, init);
        };
      });
      await seedProjectSpace(page, { role: 'owner' });
      await page.goto(runsUrl(P1));
      const menu = await openSwitcher(page);
      await expect(menu.getByText('No projects yet.')).toBeVisible();
      await expect(menu.getByRole('link', { name: 'All projects' })).toBeVisible();
      await expect(menu.getByRole('link', { name: 'New project' })).toBeVisible();
    });
  });

  test.describe('drafts do not cross projects (BR-68)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });
    const P1_SCRIPT = 'echo "setup of invoicer-api"';
    const P2_SCRIPT = 'echo "setup of invoicer-web"';
    const MARKER = 'P1-UNSAVED-MARKER';

    test('TC-68.1, TC-68.5: an unsaved setup line stays on P1 only; back on P1 the saved script shows and nothing is asked', async ({
      page,
    }) => {
      let asked = 0;
      page.on('dialog', () => (asked += 1));
      await seedShell(page, 'distinctProjects');
      await page.goto(deskUrl('setup'));
      const editor = page.getByRole('textbox', { name: 'Setup script' });
      await expect(editor).toHaveValue(P1_SCRIPT);
      await editor.click();
      await page.keyboard.press('Control+End');
      await page.keyboard.type(`\n${MARKER}`);
      await expect(editor).toHaveValue(`${P1_SCRIPT}\n${MARKER}`);

      await switchTo(page, 'invoicer-web');
      await expect(page).toHaveURL(new RegExp(`/o/${ORG}/p/${P2}/desk/setup$`));
      await expect(editor).toHaveValue(P2_SCRIPT);
      await expect(page.getByText(MARKER)).toHaveCount(0);
      await expect(page.getByText('Unsaved changes')).toHaveCount(0);

      await switchTo(page, 'invoicer-api');
      await expect(editor).toHaveValue(P1_SCRIPT);
      await expect(page.getByText('Unsaved changes')).toHaveCount(0);
      expect(asked).toBe(0);
    });

    test('TC-68.2: unsaved skill edits on P1 do not show on P2, which has its own saved text', async ({ page }) => {
      await seedShell(page, 'distinctProjects');
      await page.goto(`${deskUrl('skills')}?skill=shared-skill`);
      const source = page.getByLabel('SKILL.md source');
      await expect(source).toHaveValue(/Text of the skill in invoicer-api/);
      await source.pressSequentially('\nP1-SKILL-DRAFT');
      await expect(page.getByText('Unsaved changes')).toBeVisible();
      await switchTo(page, 'invoicer-web');
      await expect(page).toHaveURL(new RegExp(`/o/${ORG}/p/${P2}/desk/skills$`));
      await expect(source).toHaveValue(/Different text of the skill in invoicer-web/);
      await expect(source).not.toHaveValue(/P1-SKILL-DRAFT/);
      await expect(page.getByText('Unsaved changes')).toHaveCount(0);
    });

    test('TC-68.3: Back to P2 Members shows no dialog and nothing prefilled', async ({ page }) => {
      await seedProjectSpace(page, { role: 'owner' });
      await page.goto(deskUrl('members', P2));
      await expect(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible();
      await switchTo(page, 'invoicer-api');
      await expect(page).toHaveURL(new RegExp(`/o/${ORG}/p/${P1}/desk/members$`));
      await page.getByRole('button', { name: 'Add member' }).first().click();
      const dialog = page.getByRole('dialog', { name: /Add member to/ });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('combobox').fill('ben');
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`/o/${ORG}/p/${P2}/desk/members$`));
      await expect(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByRole('combobox')).toHaveCount(0);
    });

    test('TC-68.4: an unsaved trigger pick on P1 is gone on P2, which shows only its saved trigger choice', async ({
      page,
    }) => {
      // P1's trigger save never answers, so the pick stays unsaved.
      await answerRequest(page, { method: 'PATCH', path: `^/api/projects/${P1}$`, times: 1, hold: true });
      await seedShell(page, 'distinctProjects');
      await page.goto(`${deskUrl('agent')}?tab=github`);
      await expect(page.getByRole('radio', { name: 'Webhook' })).toBeChecked();
      await page.getByRole('radio', { name: 'Polling' }).click();
      await expect(page.getByRole('radio', { name: 'Polling' })).toBeChecked();
      await expect(page.getByRole('radio', { name: '5 min', exact: true })).toBeChecked();

      await switchTo(page, 'invoicer-web');
      await expect(page).toHaveURL(agentUrl(P2));
      await expect(agentsTabSelected(page)).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('heading', { level: 2, name: /Add agent|Edit agent/ })).toHaveCount(0);
      await page.getByRole('tab', { name: 'GitHub connection', exact: true }).click();
      await expect(page.getByRole('radio', { name: 'Polling' })).toBeChecked();
      await expect(page.getByRole('radio', { name: '30 min', exact: true })).toBeChecked();
      await expect(page.getByRole('radio', { name: '5 min', exact: true })).not.toBeChecked();
    });

    test('TC-68.6: a token typed in the add pane on P1 is gone on P2 and shows nowhere', async ({ page }) => {
      await seedShell(page, 'distinctProjects');
      await page.goto(deskUrl('agent'));
      await page.getByRole('button', { name: 'Add agent' }).click();
      await page.getByRole('radio', { name: 'Claude Code' }).click();
      await page.getByRole('textbox', { name: 'Subscription token' }).fill('sk-fake-canary-0068');
      await expect(page.getByRole('textbox', { name: 'Subscription token' })).toHaveValue('sk-fake-canary-0068');

      await switchTo(page, 'invoicer-web');
      await expect(page).toHaveURL(agentUrl(P2));
      await expect(agentsTabSelected(page)).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('heading', { level: 2, name: 'Add agent' })).toHaveCount(0);
      await page.getByRole('button', { name: 'Add agent' }).click();
      await page.getByRole('radio', { name: 'Claude Code' }).click();
      await expect(page.getByRole('textbox', { name: 'Subscription token' })).toHaveValue('');
      expect(await page.content()).not.toContain('sk-fake-canary-0068');
    });

    test('TC-68.7: an unsaved name on a P1 edit pane is gone on P2, whose Edit pane shows P2 saved values', async ({
      page,
    }) => {
      await seedShell(page, 'distinctProjects');
      await page.goto(`${deskUrl('agent')}?agent=${ids.agent.invoicerApi}`);
      await expect(page.getByRole('heading', { level: 2, name: 'Edit agent' })).toBeVisible();
      await page.getByRole('textbox', { name: 'Name', exact: true }).fill('P1 unsaved name');

      await switchTo(page, 'invoicer-web');
      await expect(page).toHaveURL(agentUrl(P2));
      await expect(page.getByRole('heading', { level: 2, name: 'Edit agent' })).toHaveCount(0);
      await page.getByRole('button', { name: 'Edit Claude - invoicer-web' }).click();
      await expect(page.getByRole('heading', { level: 2, name: 'Edit agent' })).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Claude - invoicer-web');
      await expect(page.getByText('P1 unsaved name')).toHaveCount(0);
    });

    test('TC-68.8: an unsaved Limits value on P1 is gone on P2, whose Limits tab shows P2 saved values', async ({
      page,
    }) => {
      await seedShell(page, 'distinctProjects');
      await page.goto(`${deskUrl('agent')}?tab=limits`);
      const timeout = page.getByRole('textbox', { name: 'Run time limit' });
      await expect(timeout).toHaveValue('24');
      await timeout.fill('5');
      await switchTo(page, 'invoicer-web');
      await expect(page).toHaveURL(agentUrl(P2));
      await expect(agentsTabSelected(page)).toHaveAttribute('aria-selected', 'true');
      await page.getByRole('tab', { name: 'Limits', exact: true }).click();
      await expect(timeout).toHaveValue('2');
    });

    test('TC-68.9: an unsaved agent pick in the rule pane of P1 is gone on P2, whose pane offers only P2 agents', async ({
      page,
    }) => {
      await seedShell(page, 'distinctProjects');
      await page.goto(`${deskUrl('rules')}?rule=new`);
      const select = page.getByRole('combobox', { name: 'With agent' });
      await expect(select.locator('option')).toHaveCount(3);
      await select.selectOption({ label: 'Codex - invoicer-api' });
      await expect(select).toHaveValue(agentListId(900));

      await switchTo(page, 'invoicer-web');
      await expect(page).toHaveURL(new RegExp(`/o/${ORG}/p/${P2}/desk/rules$`));
      await expect(page.getByRole('complementary')).toHaveCount(0);
      await page.getByRole('button', { name: 'New rule' }).click();
      await expect(page.getByRole('complementary', { name: 'New rule' })).toBeVisible();
      await expect(select.locator('option')).toHaveText([
        'Project default (Claude - invoicer-web)',
        'Claude - invoicer-web',
      ]);
      await expect(select).toHaveValue('');
    });

    test('TC-68.10: Back and Forward over the switch show no delete dialog and no P1 agent on P2', async ({ page }) => {
      await seedShell(page, 'distinctProjects');
      await page.goto(deskUrl('agent', P2));
      await expect(page.getByText('Claude - invoicer-web', { exact: true })).toBeVisible();
      await switchTo(page, 'invoicer-api');
      await expect(page).toHaveURL(agentUrl(P1));
      await page.getByRole('button', { name: 'Actions for Codex - invoicer-api', exact: true }).click();
      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Delete agent Codex - invoicer-api?' })).toBeVisible();

      await page.goBack();
      await expect(page).toHaveURL(agentUrl(P2));
      await expect(agentsTabSelected(page)).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByText('Codex - invoicer-api')).toHaveCount(0);

      await page.goForward();
      await expect(page).toHaveURL(agentUrl(P1));
      await expect(agentsTabSelected(page)).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByText('Codex - invoicer-api', { exact: true })).toBeVisible();
    });
  });

  test('Review Focus 4: P2 then P3 chosen before the project read is released shows only P3', async ({ page }) => {
    await seedShell(page, 'distinctProjects');
    await page.goto(runsUrl(P1));
    await expect(page.getByRole('heading', { name: 'Runs', level: 1 })).toBeVisible();
    // Open the list once (so it is cached), then hold the project read and switch twice before it is released.
    await openSwitcher(page);
    await expect(popover(page).getByRole('link', { name: /docs-site/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await setRead(page, 'projectDetail', 'hold');
    await switchTo(page, 'invoicer-web');
    await switchTo(page, 'docs-site');
    await release(page, 'projectDetail');
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/p/${ids.project.docsSite}/runs$`));
    await expect(switchButton(page)).toHaveAccessibleName(/currently docs-site/);
    await expect(page.getByText('invoicer-web')).toHaveCount(0);
    await expect(page.getByText('invoicer-api')).toHaveCount(0);
    // P3's own repository line shows; P2's owner (harbor-labs, as P1's) and repository name are nowhere.
    await expect(projectMenu(page).getByRole('region', { name: 'Repository' })).toContainText('kim-hale');
    await expect(page.getByText('harbor-labs')).toHaveCount(0);
  });
});

/*
 * The run page on the shell (spec 2026-11-25-sidebar-navigation-shell-design.md "E2E requirements": TC-7.3, TC-23.2,
 * TC-38.x to TC-42.x, TC-44.1, TC-52.1, the run page step of TC-24.1 and Review Focus 5). The local halves are in
 * e2e/local (Task 44). TC-41.4 follows the connection links on the Runs page, where the project's connection problem
 * is shown, as MA TC-60.1 and TC-60.2 do.
 */
const runUrl = (n: number, project = P1) => `/o/${ORG}/p/${project}/runs/${n}`;
const RUN_ACTION = /^(Finish run|Finish|Stop session|Cancel run|Resume|Close session)$/;
const expandButton = (page: Page): Locator => page.getByRole('button', { name: 'Expand menu' });
const collapseButton = (page: Page): Locator => page.getByRole('button', { name: 'Collapse menu' });
const runsItem = (page: Page): Locator => projectMenu(page).getByRole('link', { name: /^Runs/ });

/** A client-side navigation: the app's router follows the address and the page (and the mock store) stays loaded. */
async function goClient(page: Page, path: string): Promise<void> {
  await page.evaluate((to) => {
    window.history.pushState({}, '', to);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await expect(page).toHaveURL(new RegExp(`${path.replace(/[?.]/g, '\\$&')}$`));
}

/** Opens a Runs page that lists run `n` (20 a page, newest first, 121 runs seeded) and presses the run's row link. */
async function openRunFromList(page: Page, n: number): Promise<void> {
  const listPage = Math.ceil((121 - n + 1) / 20);
  await page.goto(`${runsUrl()}?page=${listPage}`);
  await page.getByRole('link', { name: `Run ${n}`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/runs/${n}$`));
  await expect(page.getByRole('heading', { level: 1, name: `Run ${n}` })).toBeVisible();
}
/** Back to Runs through the "Runs" crumb of the top bar (a click, so the page and its shell state stay loaded). */
async function backToRuns(page: Page): Promise<void> {
  await page
    .getByRole('banner')
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('link', { name: 'Runs', exact: true })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible();
}

test.describe('BR-38: the run page starts collapsed', () => {
  for (const width of [1024, 1440]) {
    test(`TC-38.1: at ${width} wide, opening a run from Runs shows a thin strip with Expand menu and no menu links`, async ({
      page,
    }) => {
      await seedProjectSpace(page, { role: 'member' });
      await page.setViewportSize({ width, height: 900 });
      await openRunFromList(page, IDLE_RUN);
      await expect(expandButton(page)).toBeVisible();
      await expect(projectMenu(page).getByRole('link')).toHaveCount(0);
    });
  }

  test('TC-38.2: pressing Expand menu on the run page shows the full project menu', async ({ page }) => {
    await seedProjectSpace(page, { role: 'owner' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(runUrl(IDLE_RUN));
    await expandButton(page).click();
    await expect
      .poll(() => menuLabels(projectMenu(page)))
      .toEqual(['All projects', 'Runs', ...CONFIGURE, ...ACCESS, 'Open repository']);
  });

  test('TC-38.3: after expanding on a run page and going back to Runs, each run opens collapsed', async ({ page }) => {
    await seedProjectSpace(page, { role: 'owner' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(runUrl(IDLE_RUN));
    await expandButton(page).click();
    await expect(collapseButton(page)).toBeVisible();
    await goClient(page, runsUrl());
    await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible();
    await goClient(page, runUrl(IDLE_RUN));
    await expect(expandButton(page)).toBeVisible();
    await goClient(page, runUrl(64));
    await expect(page.getByRole('heading', { level: 1, name: 'Run 64' })).toBeVisible();
    await expect(expandButton(page)).toBeVisible();
  });

  test('TC-38.4: a direct address of a run page at 1440 wide is collapsed from the start', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(runUrl(IDLE_RUN));
    await expect(page.getByRole('heading', { level: 1, name: `Run ${IDLE_RUN}` })).toBeVisible();
    await expect(expandButton(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(collapseButton(page)).toHaveCount(0);
  });
});

test.describe('BR-39: collapse and expand', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  /** Collapse then expand the menu on the current page: a strip with only the button, then the same items and current mark. */
  async function roundTrip(page: Page, menu: Locator): Promise<void> {
    const labels = await menu.getByRole('link').allTextContents();
    expect(labels.length).toBeGreaterThan(0);
    const current = await menu.locator('[aria-current]').allTextContents();
    await collapseButton(page).click();
    await expect(expandButton(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(expandButton(page)).toBeFocused();
    await expect(menu.getByRole('link')).toHaveCount(0);
    await expandButton(page).click();
    await expect(collapseButton(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.getByRole('link')).toHaveText(labels);
    await expect(menu.locator('[aria-current]')).toHaveText(current);
  }

  test('TC-39.1: on org Members the menu goes to a strip and back with the same items and current mark', async ({
    page,
  }) => {
    await page.goto(`/o/${ORG}/settings/members`);
    await expect(orgMenu(page).getByRole('link', { name: 'Members', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await roundTrip(page, orgMenu(page));
  });

  test('TC-39.2: on platform Organizations and on a platform org page each goes to the strip and back', async ({
    page,
  }) => {
    await openPlatform(page, 'platformAdminOrgs', ORGS);
    await expect(platformMenu(page).getByRole('link', { name: 'Organizations', exact: true })).toBeVisible();
    await roundTrip(page, platformMenu(page));
    await goClient(page, ORG_BASE);
    const orgPageMenu = page.getByRole('navigation', { name: /^Platform org menu$|^Platform menu$/ });
    await expect(orgPageMenu.getByRole('link', { name: 'Members' })).toBeVisible();
    await roundTrip(page, orgPageMenu);
  });

  test('TC-39.3: on a project Desk page the menu goes to the strip and back (the /invitations half waits for Task 24)', async ({
    page,
  }) => {
    await page.goto(deskUrl('rules'));
    await expect(projectMenu(page).getByRole('link', { name: 'Routing rules' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await roundTrip(page, projectMenu(page));
  });

  // The mock terminal socket is not observable from the page, so the e2e proves "no reconnect" by the same terminal
  // element, its output and a steady Live label; the connection count (one FakeWebSocket) is proved at the lowest layer,
  // detail.route.test.tsx "BR-39", and in the local half (Task 44).
  test('TC-39.4: on a live run, expanding then collapsing keeps the terminal and its output and shows no reconnect (the socket count: detail.route.test.tsx)', async ({
    page,
  }) => {
    await page.goto(runUrl(IDLE_RUN));
    const terminal = page.getByRole('group', { name: 'Claude Code terminal' });
    await expect(terminal).toContainText('agent-desk fake terminal');
    await expect(page.getByText('Live', { exact: true })).toBeVisible();
    await terminal.evaluate((el) => el.setAttribute('data-keep', 'same'));
    const trouble = page.getByText(/Connecting|Reconnecting|Connection to the terminal lost/);
    await expandButton(page).click();
    await expect(collapseButton(page)).toBeVisible();
    await expect(trouble).toHaveCount(0);
    await collapseButton(page).click();
    await expect(expandButton(page)).toBeVisible();
    await expect(trouble).toHaveCount(0);
    await expect(terminal).toHaveAttribute('data-keep', 'same');
    await expect(terminal).toContainText('agent-desk fake terminal');
    await expect(page.getByText('Live', { exact: true })).toBeVisible();
  });
});

test.describe('BR-40: the collapse choice lasts until a reload', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('TC-40.1: collapsed on org Projects, it stays collapsed on Members, a project page and Routing rules', async ({
    page,
  }) => {
    await page.goto(`/o/${ORG}/projects`);
    await collapseButton(page).click();
    for (const path of [`/o/${ORG}/settings/members`, runsUrl(), deskUrl('rules')]) {
      await goClient(page, path);
      await expect(expandButton(page)).toBeVisible();
      await expect(collapseButton(page)).toHaveCount(0);
    }
  });

  test('TC-40.2: expanded after being collapsed, it stays expanded on two other non-run pages', async ({ page }) => {
    await page.goto(`/o/${ORG}/projects`);
    await collapseButton(page).click();
    await expandButton(page).click();
    for (const path of [`/o/${ORG}/settings/members`, deskUrl('rules')]) {
      await goClient(page, path);
      await expect(collapseButton(page)).toBeVisible();
      await expect(expandButton(page)).toHaveCount(0);
    }
  });

  test('TC-40.3: a run page starts collapsed and, left untouched, Runs has the menu expanded', async ({ page }) => {
    await openRunFromList(page, IDLE_RUN);
    await expect(expandButton(page)).toBeVisible();
    await backToRuns(page);
    await expect(collapseButton(page)).toBeVisible();
  });

  test('TC-40.4: collapsed on Runs, expanding on a run page does not change Runs, which stays collapsed', async ({
    page,
  }) => {
    await page.goto(`${runsUrl()}?page=${Math.ceil((121 - IDLE_RUN + 1) / 20)}`);
    await collapseButton(page).click();
    await page.getByRole('link', { name: `Run ${IDLE_RUN}`, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: `Run ${IDLE_RUN}` })).toBeVisible();
    await expandButton(page).click();
    await expect(collapseButton(page)).toBeVisible();
    await backToRuns(page);
    await expect(expandButton(page)).toBeVisible();
  });

  test('TC-40.5: collapsed on a non-run page, a reload starts it expanded', async ({ page }) => {
    await page.goto(runsUrl());
    await collapseButton(page).click();
    await expect(expandButton(page)).toBeVisible();
    await page.reload();
    await expect(collapseButton(page)).toBeVisible();
  });
});

test.describe('BR-41: the run page header', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('TC-41.1: the page header holds Run N, status, command, ticket, elapsed time and the actions; the top bar none of them', async ({
    page,
  }) => {
    await seedProjectSpace(page, { role: 'owner' });
    await page.goto(runUrl(IDLE_RUN));
    const header = runHeader(page);
    await expect(header.getByRole('heading', { level: 1, name: `Run ${IDLE_RUN}` })).toBeVisible();
    await expect(header.getByText('Needs you', { exact: true })).toBeVisible();
    await expect(header.getByText(/^\/?code-review$/)).toBeVisible();
    await expect(header.getByText(/issue #\d+|PR #\d+/i)).toBeVisible();
    await expect(header.getByText(/\d+:\d{2}/)).toBeVisible();
    await expect(header.getByRole('button', { name: 'Stop session' })).toBeVisible();
    await expect(header.getByRole('button', { name: 'Cancel run' })).toBeVisible();

    const bar = page.getByRole('banner');
    const crumbs = bar.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(crumbs.getByRole('link', { name: 'Runs', exact: true })).toHaveAttribute('href', runsUrl());
    await expect(crumbs.getByText(`Run ${IDLE_RUN}`)).toHaveAttribute('aria-current', 'page');
    await expect(bar.getByRole('link', { name: /Agent Desk/ })).toBeVisible();
    await expect(bar.getByRole('button', { name: /^Switch project, currently/ })).toBeVisible();
    await expect(bar.getByRole('button', { name: /^Notifications/ })).toBeVisible();
    await expect(bar.getByRole('button', { name: /^Account menu for / })).toBeVisible();
    await expect(bar.getByText('Needs you', { exact: true })).toHaveCount(0);
    await expect(bar.getByRole('button', { name: RUN_ACTION })).toHaveCount(0);
  });

  test('TC-41.2: a paused run shows its status and ticket action in the header, none in the top bar', async ({
    page,
  }) => {
    await page.goto(runUrl(PAUSED_RUN));
    const header = runHeader(page);
    await expect(header.getByText('Paused', { exact: true })).toBeVisible();
    await expect(header.getByRole('link', { name: /^View (PR|issue)$/ })).toBeVisible();
    const bar = page.getByRole('banner');
    await expect(bar.getByText('Paused', { exact: true })).toHaveCount(0);
    await expect(bar.getByRole('link', { name: /^View (PR|issue)$/ })).toHaveCount(0);
  });

  test('TC-41.3: the page still shows the name of the run agent', async ({ page }) => {
    await page.goto(runUrl(IDLE_RUN));
    const panel = page.getByRole('complementary', { name: 'Run context' });
    // The Agent row holds the agent name and its model in one element: "Claude opus".
    await expect(panel.getByText('Agent', { exact: true }).locator('xpath=following-sibling::*[1]')).toHaveText(
      /^Claude\s+opus$/,
    );
  });

  test('TC-41.4: "Connection details" and "Switch to polling" open the GitHub connection tab', async ({ page }) => {
    const docsRuns = `/o/${ORG}/p/${ids.project.docsSite}/runs?filter=ignored`;
    await page.goto(docsRuns);
    await page.getByRole('link', { name: 'Connection details' }).click();
    await expect(page).toHaveURL(/\/desk\/agent\?tab=github$/);
    await expect(page.getByRole('tab', { name: 'GitHub connection', selected: true })).toBeVisible();
    await page.goto(docsRuns);
    await page.getByRole('link', { name: 'Switch to polling' }).click();
    await expect(page).toHaveURL(/\/desk\/agent\?tab=github$/);
    await expect(page.getByRole('tab', { name: 'GitHub connection', selected: true })).toBeVisible();
  });

  test('TC-41.5: "Change time limit" on a timed-out run opens the Limits tab', async ({ page }) => {
    await page.goto(runUrl(TRANSCRIPT_TIMED_OUT_RUN));
    await page.getByRole('link', { name: 'Change time limit' }).click();
    await expect(page).toHaveURL(/\/desk\/agent\?tab=limits$/);
    await expect(page.getByRole('tab', { name: 'Limits', selected: true })).toBeVisible();
  });

  test('TC-41.6: "Replace credential" opens the Agents tab with that run agent pane', async ({ page }) => {
    await seedAgents(page, 'perAgentModels');
    await page.goto(runUrl(NO_CREDENTIAL_RUN));
    await page.getByRole('link', { name: 'Replace credential' }).click();
    await expect(page).toHaveURL(new RegExp(`/desk/agent\\?agent=${agentListId(1)}$`));
    await expect(page.getByRole('tab', { name: 'Agents', selected: true })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Edit agent' })).toBeVisible();
  });
});

test.describe('BR-42: run actions by permission', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  const anyAction = (page: Page): Locator => page.getByRole('button', { name: RUN_ACTION });

  test('TC-42.1: a viewer sees status and ticket in the header and no run action anywhere on the page', async ({
    page,
  }) => {
    await seedProjectSpace(page, { role: 'viewer' });
    await page.goto(runUrl(IDLE_RUN));
    const header = runHeader(page);
    await expect(header.getByText('Needs you', { exact: true })).toBeVisible();
    await expect(header.getByText(/issue #\d+|PR #\d+/i)).toBeVisible();
    await expect(anyAction(page)).toHaveCount(0);
  });

  test('TC-42.2: a member sees no run action on a live run owned by someone else', async ({ page }) => {
    await seedShell(page, 'memberOthersRuns');
    await page.goto(runUrl(IDLE_RUN));
    await expect(runHeader(page).getByText('Needs you', { exact: true })).toBeVisible();
    await expect(anyAction(page)).toHaveCount(0);
  });

  test('TC-42.3: a member sees the allowed actions in the header on their own live run', async ({ page }) => {
    await seedShell(page, 'memberOwnsRuns');
    await page.goto(runUrl(IDLE_RUN));
    const header = runHeader(page);
    await expect(header.getByRole('button', { name: 'Stop session' })).toBeVisible();
    await expect(header.getByRole('button', { name: 'Cancel run' })).toBeVisible();
  });

  test("TC-42.4: an org admin sees the allowed actions on someone else's live run", async ({ page }) => {
    await seedProjectSpace(page, { role: 'admin' });
    await page.goto(runUrl(IDLE_RUN));
    const header = runHeader(page);
    await expect(header.getByRole('button', { name: 'Stop session' })).toBeVisible();
    await expect(header.getByRole('button', { name: 'Cancel run' })).toBeVisible();
  });

  test('TC-42.5: a viewer, then a member on another run, see no Resume or Finish on a paused run', async ({ page }) => {
    await seedProjectSpace(page, { role: 'viewer' });
    await page.goto(runUrl(PAUSED_RUN));
    await expect(runHeader(page).getByText('Paused', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^(Resume|Finish)$/ })).toHaveCount(0);
    await seedShell(page, 'memberOthersRuns');
    await page.goto(runUrl(PAUSED_RUN));
    await expect(runHeader(page).getByText('Paused', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^(Resume|Finish)$/ })).toHaveCount(0);
  });
});

test.describe('BR-44 on the run page', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('TC-44.1: a live run and a paused run have no "Full screen" control', async ({ page }) => {
    await page.goto(runUrl(IDLE_RUN));
    await expect(runHeader(page).getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText(/full screen/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /full screen/i })).toHaveCount(0);
    await goClient(page, runUrl(PAUSED_RUN));
    await expect(runHeader(page).getByText('Paused', { exact: true })).toBeVisible();
    await expect(page.getByText(/full screen/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /full screen/i })).toHaveCount(0);
  });
});

test.describe('BR-7, BR-23 and BR-24 on the run page', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('TC-7.3: expanded on a run page, Runs is current as the parent and no other item is', async ({ page }) => {
    await page.goto(runUrl(IDLE_RUN));
    await expandButton(page).click();
    await expect(runsItem(page)).toHaveAttribute('aria-current', 'true');
    await expect(projectMenu(page).locator('[aria-current]')).toHaveCount(1);
  });

  test('TC-23.2: a member, then a viewer, on a run page and expanded see "All projects", Runs and the repository block only', async ({
    page,
  }) => {
    for (const role of ['member', 'viewer'] as const) {
      await seedProjectSpace(page, { role });
      await page.goto(runUrl(IDLE_RUN));
      await expandButton(page).click();
      const menu = projectMenu(page);
      await expect(menu.getByRole('region', { name: 'Repository' })).toBeVisible();
      await expect.poll(() => menuLabels(menu)).toEqual(['All projects', 'Runs', 'Open repository']);
      await expect(menu.getByText('Configure', { exact: true })).toHaveCount(0);
      await expect(menu.getByText('Access', { exact: true })).toHaveCount(0);
    }
  });

  test('TC-24.1 step 3: admin of P1 and viewer of P2 on a P2 run page, expanded, sees Runs and the repository only', async ({
    page,
  }) => {
    await seedShell(page, 'adminP1ViewerP2');
    await page.goto(runsUrl(P1));
    await goClient(page, runUrl(19, P2));
    await expect(page.getByRole('heading', { level: 1, name: 'Run 19' })).toBeVisible();
    await expandButton(page).click();
    const menu = projectMenu(page);
    await expect(menu.getByRole('link', { name: /^Runs/ })).toBeVisible();
    await expect.poll(() => menuLabels(menu)).toEqual(['All projects', 'Runs', 'Open repository']);
    await expect(menu.getByText('Configure', { exact: true })).toHaveCount(0);
    await expect(menu.getByText('Access', { exact: true })).toHaveCount(0);
  });
});

test('TC-52.1: picking P2 in the project switcher on a P1 run page opens the P2 Runs page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(runUrl(IDLE_RUN));
  await expect(page.getByRole('heading', { level: 1, name: `Run ${IDLE_RUN}` })).toBeVisible();
  await page.getByRole('button', { name: /^Switch project, currently/ }).click();
  await page
    .getByRole('dialog', { name: 'Projects' })
    .getByRole('link', { name: /invoicer-web/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/o/${ORG}/p/${P2}/runs$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible();
});

test('Review Focus 5: the Cancel run confirm survives a resize across 1024, Keep running closes it, the terminal is unchanged', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(runUrl(IDLE_RUN));
  const terminal = page.getByRole('group', { name: 'Claude Code terminal' });
  await expect(terminal).toContainText('agent-desk fake terminal');
  await terminal.evaluate((el) => el.setAttribute('data-keep', 'same'));
  await runHeader(page).getByRole('button', { name: 'Cancel run' }).click();
  const confirm = page.getByRole('dialog', { name: `Cancel run ${IDLE_RUN}?` });
  await expect(confirm).toBeVisible();
  for (const width of [1023, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(confirm).toBeVisible();
  }
  await confirm.getByRole('button', { name: 'Keep running' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(terminal).toHaveAttribute('data-keep', 'same');
  await expect(terminal).toContainText('agent-desk fake terminal');
  await expect(page.getByText(/Connection to the terminal lost|Reconnecting/)).toHaveCount(0);
});

/*
 * One chrome and one header on every page (spec 2026-11-25-sidebar-navigation-shell-design.md "E2E requirements": TC-1.1,
 * TC-1.2, TC-2.1, TC-2.2, TC-3.1, TC-3.2, TC-6.1 to TC-6.3, TC-7.1, TC-7.2, TC-8.1 to TC-8.4, TC-10.1 to TC-10.4,
 * TC-14.1, TC-14.2, TC-43.1, TC-43.2). TC-6.4, TC-7.5, TC-7.6, TC-8.6 and TC-10.5 are above. The signed-in user is an
 * org owner who is also a platform admin (`platformAdminMemberOrg`), unless a case says otherwise.
 */
const PLATFORM_OWNER = 'platformAdminMemberOrg' as const;
const orgUrl = (path: string) => `/o/${ORG}/${path}`;
const bannerOf = (page: Page): Locator => page.getByRole('banner');
const anySideMenu = (page: Page): Locator => page.getByRole('navigation', { name: SIDE_MENU_NAME });

async function openAsPlatformOwner(page: Page, path: string, width = 1440, height = 900): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto(path);
}

test.describe('BR-1, BR-2, BR-3: the top bar, the sign-in page and the deeper scope', () => {
  const BAR_BUTTON = /^(Switch scope|Switch project|Notifications \(coming soon\)|Account menu for )/;

  /** The names of the banner's links outside the breadcrumb, and of all its buttons. */
  async function barControls(page: Page): Promise<{ links: string[]; buttons: string[]; tabs: number }> {
    const bar = bannerOf(page);
    const links = await bar
      .getByRole('link')
      .evaluateAll((els) =>
        els.filter((el) => !el.closest('nav[aria-label="Breadcrumb"]')).map((el) => el.textContent?.trim() ?? ''),
      );
    const buttons = await bar
      .getByRole('button')
      .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? el.textContent?.trim() ?? ''));
    return { links, buttons, tabs: await bar.getByRole('tab').count() };
  }

  test('TC-1.1: on org, project, run, platform and invitations pages the top bar holds only logo, switchers and breadcrumb, bell and account menu', async ({
    page,
  }) => {
    await seedPlatform(page, PLATFORM_OWNER);
    for (const path of [
      orgUrl('projects'),
      orgUrl('settings/members'),
      runsUrl(),
      runUrl(IDLE_RUN),
      '/platform/orgs',
      '/invitations',
    ]) {
      await openAsPlatformOwner(page, path);
      await expect(bannerOf(page).getByRole('button', { name: /^Account menu for / })).toBeVisible();
      const { links, buttons, tabs } = await barControls(page);
      expect(links, path).toHaveLength(1);
      expect(links[0], path).toMatch(/Agent Desk/);
      expect(tabs, path).toBe(0);
      for (const name of buttons) expect(name, path).toMatch(BAR_BUTTON);
      await expect(bannerOf(page).getByRole('button', { name: 'Notifications (coming soon)' })).toBeVisible();
    }
  });

  test('TC-1.2: on Routing rules and platform Organizations the top bar has no section link, tab, run action or repository button, and the side menu is present', async ({
    page,
  }) => {
    await seedPlatform(page, PLATFORM_OWNER);
    const SECTION =
      /^(Projects|Org settings|Project settings|Desk|Organizations|Platform admins|Audit log|Open repository)$/;
    for (const [path, menu] of [
      [deskUrl('rules'), 'Project menu'],
      ['/platform/orgs', 'Platform menu'],
    ] as const) {
      await openAsPlatformOwner(page, path);
      await expect(page.getByRole('navigation', { name: menu })).toBeVisible();
      const { links, buttons, tabs } = await barControls(page);
      expect(tabs, path).toBe(0);
      for (const name of [...links.slice(1), ...buttons]) expect(name, path).not.toMatch(SECTION);
      for (const name of buttons) expect(name, path).not.toMatch(RUN_ACTION);
      await expect(bannerOf(page).getByRole('link', { name: /repository/i })).toHaveCount(0);
    }
  });

  test('TC-2.1: signed out, /sign-in shows the "Sign in with GitHub" button', async ({ page }) => {
    await startSignedOut(page);
    await page.goto('/sign-in');
    await expect(page.getByRole('link', { name: 'Sign in with GitHub' })).toBeVisible();
  });

  test('TC-2.2: signed out, /sign-in has no top bar, side menu or menu button at 1440 and at 390', async ({ page }) => {
    await startSignedOut(page);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/sign-in');
      await expect(page.getByRole('link', { name: 'Sign in with GitHub' })).toBeVisible();
      await expect(bannerOf(page)).toHaveCount(0);
      await expect(page.getByRole('navigation')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^(Open|Expand|Collapse) menu$/ })).toHaveCount(0);
    }
  });

  test('TC-3.1: from org Projects into a project only the Project menu shows, with no org menu items', async ({
    page,
  }) => {
    await seedTenantAdmin(page, 'twoOwners');
    await openAsPlatformOwner(page, orgUrl('projects'));
    await expect(anySideMenu(page)).toHaveCount(1);
    await expect(orgMenu(page)).toBeVisible();
    await page.getByRole('main').getByRole('link', { name: 'invoicer-api', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/p/${P1}/`));
    await expect(projectMenu(page)).toBeVisible();
    await expect(anySideMenu(page)).toHaveCount(1);
    await expect(orgMenu(page)).toHaveCount(0);
    await expect(page.getByText('Settings', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Invitations', exact: true })).toHaveCount(0);
  });

  test('TC-3.2: from platform Organizations into one organization the one-org menu replaces the Platform menu', async ({
    page,
  }) => {
    await seedPlatform(page, 'platformAdminOrgs');
    await openAsPlatformOwner(page, ORGS);
    await expect(anySideMenu(page)).toHaveCount(1);
    await expect(platformMenu(page).getByRole('link')).toHaveText(['Organizations', 'Platform admins', 'Audit log']);
    await page.getByRole('main').getByRole('link', { name: 'Acme', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${ORG_BASE}$`));
    const menu = platformMenu(page);
    await expect(menu.getByRole('link', { name: /Organizations/ })).toBeVisible();
    await expect(menu.getByText('Acme', { exact: true })).toBeVisible();
    await expect(itemsOf(menu)).toHaveText(['Overview', 'Projects', 'Members', 'Invitations']);
    await expect(menu.getByRole('link', { name: 'Platform admins' })).toHaveCount(0);
    await expect(anySideMenu(page)).toHaveCount(1);
  });
});

test.describe('BR-6: the side menu stays in place', () => {
  /** The side menu's box, and how far the page scrolled. */
  async function scrollToEnd(page: Page, menu: Locator) {
    const before = await box(menu);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const scrolled = await page.evaluate(() => window.scrollY);
    return { before, after: await box(menu), scrolled };
  }

  for (const width of [1024, 1440]) {
    test(`TC-6.${width === 1024 ? 1 : 2}: at ${width} wide the menu keeps its place and full height while a long page scrolls`, async ({
      page,
    }) => {
      await seedTenantAdmin(page, 'membersPaged');
      await page.setViewportSize({ width, height: 700 });
      await page.goto(orgUrl('settings/members'));
      await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
      const menu = orgMenu(page);
      await expect(menu).toBeVisible();
      const barBottom = (await box(bannerOf(page))).y + (await box(bannerOf(page))).height;
      const { before, after, scrolled } = await scrollToEnd(page, menu);
      expect(scrolled).toBeGreaterThan(0);
      expect(after.y).toBe(before.y);
      expect(Math.abs(after.y - barBottom)).toBeLessThanOrEqual(1);
      expect(Math.abs(after.y + after.height - 700)).toBeLessThanOrEqual(1);
    });
  }

  test('TC-6.3: at 1280x360 the project menu scrolls on its own to the repository block while the page does not move', async ({
    page,
  }) => {
    await seedProjectSpace(page, { role: 'owner' });
    await page.setViewportSize({ width: 1280, height: 360 });
    await page.goto(runsUrl());
    const menu = projectMenu(page);
    await expect(menu.getByRole('link', { name: 'Runs' })).toBeVisible();
    const heading = page.getByRole('heading', { level: 1, name: 'Runs' });
    const before = await box(heading);
    const open = menu.getByRole('link', { name: 'Open repository' });
    await open.scrollIntoViewIfNeeded();
    await expect(open).toBeInViewport();
    await expect(menu.getByRole('region', { name: 'Repository' })).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await box(heading)).toEqual(before);
  });
});

test.describe('BR-7: the current item', () => {
  test('TC-7.1: on org Projects, Members, Invitations, Audit log and General exactly the matching item is current', async ({
    page,
  }) => {
    await seedTenantAdmin(page, 'twoOwners');
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const [name, path] of [
      ['Projects', 'projects'],
      ['Members', 'settings/members'],
      ['Invitations', 'settings/invitations'],
      ['Audit log', 'settings/audit'],
      ['General', 'settings/general'],
    ] as const) {
      await page.goto(orgUrl(path));
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
      await expect(orgMenu(page).locator('[aria-current]')).toHaveCount(1);
      await expect(orgMenu(page).getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'page');
    }
  });

  test('TC-7.2: on each project page exactly the matching project menu item is current', async ({ page }) => {
    await seedProjectSpace(page, { role: 'owner' });
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const [name, path] of [
      ['Runs', 'runs'],
      ['Routing rules', 'desk/rules'],
      ['Skills', 'desk/skills'],
      ['Workspace setup', 'desk/setup'],
      ['Agent & settings', 'desk/agent'],
      ['Members', 'desk/members'],
      ['Audit log', 'desk/audit'],
    ] as const) {
      await page.goto(`/o/${ORG}/p/${P1}/${path}`);
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
      const menu = projectMenu(page);
      await expect(menu.locator('[aria-current]')).toHaveCount(1);
      await expect(menu.getByRole('link', { name: new RegExp(`^${name.replace(/[&]/g, '\\$&')}`) })).toHaveAttribute(
        'aria-current',
        'page',
      );
    }
  });
});

test.describe('BR-8: one page header', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  /** Waits for the one h1 and returns its offset in main and its font size. */
  async function metrics(page: Page, name: string) {
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText(name);
    await page.evaluate(() => document.fonts.ready);
    const main = await box(page.getByRole('main'));
    const b = await box(h1);
    const fontSize = await h1.evaluate((el) => getComputedStyle(el).fontSize);
    return { x: b.x - main.x, y: b.y - main.y, fontSize };
  }

  test('TC-8.1: ten loaded side-menu pages each have one h1 at the same offset and size', async ({ page }) => {
    await seedPlatform(page, PLATFORM_OWNER);
    const pages = [
      [orgUrl('projects'), 'Projects'],
      [orgUrl('settings/members'), 'Members'],
      [runsUrl(), 'Runs'],
      [deskUrl('rules'), 'Routing rules'],
      [deskUrl('skills'), 'Skills'],
      [deskUrl('setup'), 'Workspace setup'],
      [deskUrl('agent'), 'Agent & settings'],
      [runUrl(IDLE_RUN), `Run ${IDLE_RUN}`],
      [ORGS, 'Organizations'],
      [ORG_BASE, 'Acme'],
    ] as const;
    const seen: Array<{ path: string; x: number; y: number; fontSize: string }> = [];
    for (const [path, name] of pages) {
      await page.goto(path);
      seen.push({ path, ...(await metrics(page, name)) });
    }
    const [first, ...rest] = seen;
    if (!first) throw new Error('no page measured');
    for (const s of rest) {
      expect(Math.abs(s.x - first.x), s.path).toBeLessThanOrEqual(1);
      expect(Math.abs(s.y - first.y), s.path).toBeLessThanOrEqual(1);
      expect(s.fontSize, s.path).toBe(first.fontSize);
    }
  });

  test('TC-8.2: Skills has "New skill" and Workspace setup has "Test setup" on the right of the h1', async ({
    page,
  }) => {
    await seedProjectSpace(page, { role: 'owner' });
    for (const [path, title, action] of [
      [deskUrl('skills'), 'Skills', 'New skill'],
      [deskUrl('setup'), 'Workspace setup', 'Test setup'],
    ] as const) {
      await page.goto(path);
      const h1 = page.getByRole('heading', { level: 1, name: title });
      await expect(h1).toBeVisible();
      const control = page.getByRole('main').getByText(action, { exact: true }).first();
      await expect(control).toBeVisible();
      const [h, a] = [await box(h1), await box(control)];
      expect(a.x).toBeGreaterThanOrEqual(h.x + h.width);
      expect(a.y).toBeLessThan(h.y + h.height);
      expect(a.y + a.height).toBeGreaterThan(h.y);
    }
  });

  test('TC-8.3: a wizard step has exactly one h1 of the same size as on other pages', async ({ page }) => {
    await seedTenantAdmin(page, 'twoOwners');
    await page.goto(orgUrl('projects'));
    const standard = await metrics(page, 'Projects');
    await page.goto(orgUrl('projects/new/repo'));
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toHaveCount(1);
    await expect(h1).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(await h1.evaluate((el) => getComputedStyle(el).fontSize)).toBe(standard.fontSize);
  });

  test('TC-8.4 (a): a forbidden page has exactly one h1, its title', async ({ page }) => {
    await seedProjectSpace(page, { role: 'member' });
    await page.goto(deskUrl('skills'));
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1, name: "You don't have access" })).toBeVisible();
  });

  test('TC-8.4 (b): an unknown address has exactly one h1, "Page not found"', async ({ page }) => {
    await page.goto(orgUrl('this-address-does-not-exist'));
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  });

  test('TC-8.4 (c): a crashing page has exactly one h1, "Something went wrong"', async ({ page }) => {
    await holdReads(page, { rules: 'crash' });
    await seedProjectSpace(page, { role: 'owner' });
    await page.goto(deskUrl('rules'));
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1, name: 'Something went wrong' })).toBeVisible();
  });
});

test.describe('BR-10: no old crumbs; the document title', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('TC-10.1: no "Org settings", "Project settings" or "Desk" crumb, tab or menu heading; the menu headings are the new ones', async ({
    page,
  }) => {
    await seedProjectSpace(page, { role: 'owner' });
    const OLD = /^(Org settings|Project settings|Desk)$/;
    const pages = [
      ...['settings/members', 'settings/invitations', 'settings/audit', 'settings/general'].map(
        (p) => [orgUrl(p), 'Organization menu', ['Settings']] as const,
      ),
      ...['desk/rules', 'desk/skills', 'desk/setup', 'desk/agent', 'desk/members', 'desk/audit'].map(
        (p) => [`/o/${ORG}/p/${P1}/${p}`, 'Project menu', ['Configure', 'Access']] as const,
      ),
    ];
    for (const [path, menuName, headings] of pages) {
      await page.goto(path);
      const menu = page.getByRole('navigation', { name: menuName });
      await expect(menu).toBeVisible();
      for (const h of headings) await expect(menu.getByText(h, { exact: true })).toBeVisible();
      await expect(bannerOf(page).getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
      for (const role of ['link', 'tab', 'button', 'heading'] as const) {
        await expect(page.getByRole(role, { name: OLD }), `${role} on ${path}`).toHaveCount(0);
      }
      await expect(bannerOf(page).getByText(OLD)).toHaveCount(0);
      await expect(menu.getByText(OLD)).toHaveCount(0);
    }
  });

  test('TC-10.2: the titles are "Members · Alice · Agent Desk" and "Routing rules · invoicer-api · Agent Desk"', async ({
    page,
  }) => {
    await seedProjectSpace(page, { role: 'owner' });
    await page.goto(orgUrl('settings/members'));
    await expect(page).toHaveTitle('Members · Alice · Agent Desk');
    await page.goto(deskUrl('rules'));
    await expect(page).toHaveTitle('Routing rules · invoicer-api · Agent Desk');
  });

  test('TC-10.3: the title of run 62 holds none of the ticket marker text, which shows as plain text', async ({
    page,
  }) => {
    await seedShell(page, 'markerTicket');
    await page.goto(runUrl(IDLE_RUN));
    const header = runHeader(page);
    await expect(header.getByRole('heading', { level: 1, name: `Run ${IDLE_RUN}` })).toBeVisible();
    await expect(page).toHaveTitle(`Run ${IDLE_RUN} · invoicer-api · Agent Desk`);
    expect(await page.title()).not.toContain(MARKER);
    await expect(header.getByText(MARKER)).toBeVisible();
    await expect(page.locator('main img[src="x"]')).toHaveCount(0);
    await expect(page.locator('main b', { hasText: 'bold' })).toHaveCount(0);
  });

  test('TC-10.4: the platform titles are "Organizations · Platform · Agent Desk" and "Members · Platform · Agent Desk"', async ({
    page,
  }) => {
    await seedPlatform(page, 'platformAdminOrgs');
    await page.goto(ORGS);
    await expect(page).toHaveTitle('Organizations · Platform · Agent Desk');
    await page.goto(`${ORG_BASE}/members`);
    await expect(page.getByRole('heading', { name: 'Members', level: 2 })).toBeVisible();
    await expect(page).toHaveTitle('Members · Platform · Agent Desk');
  });
});

test.describe('BR-14: landmarks and menu names', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  async function landmarks(page: Page, menuName: string): Promise<void> {
    await expect(bannerOf(page)).toHaveCount(1);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: SIDE_MENU_NAME })).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: menuName })).toHaveCount(1);
  }

  test('TC-14.1: org Projects, project Runs and a platform page each have one banner, one named side navigation and one main, and axe reports no landmark violation', async ({
    page,
  }) => {
    await seedPlatform(page, PLATFORM_OWNER);
    const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
    for (const [path, menu] of [
      [orgUrl('projects'), 'Organization menu'],
      [runsUrl(), 'Project menu'],
      [ORGS, 'Platform menu'],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await landmarks(page, menu);
      await page.addScriptTag({ path: axePath });
      const violations = await page.evaluate(async () => {
        interface Axe {
          getRules(): Array<{ ruleId: string }>;
          run(
            ctx: Document,
            opts: { runOnly: { type: 'rule'; values: string[] } },
          ): Promise<{ violations: Array<{ id: string }> }>;
        }
        const axe = (window as unknown as { axe: Axe }).axe;
        const values = axe
          .getRules()
          .map((r) => r.ruleId)
          .filter((id) => id === 'region' || id.startsWith('landmark-'));
        const result = await axe.run(document, { runOnly: { type: 'rule', values } });
        return result.violations.map((v) => v.id);
      });
      expect(violations, path).toEqual([]);
    }
  });

  test('TC-14.2: the Configure, Access and Settings groups are lists labelled by their headings', async ({ page }) => {
    await seedProjectSpace(page, { role: 'owner' });
    await page.goto(runsUrl());
    for (const group of ['Configure', 'Access']) {
      await expect(projectMenu(page).getByRole('list', { name: group })).toBeVisible();
    }
    await page.goto(orgUrl('settings/members'));
    await expect(orgMenu(page).getByRole('list', { name: 'Settings' })).toBeVisible();
  });
});

test.describe('BR-43: the disabled bell', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  const PAGES = [orgUrl('projects'), runsUrl(), runUrl(IDLE_RUN), '/platform/orgs', '/invitations'];

  test('TC-43.1: on an org, project, run, platform and invitations page the bell is disabled, named "coming soon", unfocusable and inert', async ({
    page,
  }) => {
    await seedPlatform(page, PLATFORM_OWNER);
    for (const path of PAGES) {
      await page.goto(path);
      const bell = bannerOf(page).getByRole('button', { name: 'Notifications (coming soon)', exact: true });
      await expect(bell, path).toBeVisible();
      await expect(bell, path).toBeDisabled();
      await expect(bell, path).toHaveAttribute('title', 'Notifications (coming soon)');
      // Tab through the page from the top until focus reaches the account menu: the bell is never on the way.
      const account = bannerOf(page).getByRole('button', { name: /^Account menu for / });
      await page.locator('body').click({ position: { x: 0, y: 0 } });
      for (let i = 0; i < 40; i += 1) {
        await page.keyboard.press('Tab');
        await expect(bell, path).not.toBeFocused();
        if (await account.evaluate((el) => el === document.activeElement)) break;
      }
      await expect(account, path).toBeFocused();
      const url = page.url();
      await bell.click({ force: true });
      expect(page.url()).toBe(url);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByRole('menu')).toHaveCount(0);
    }
  });

  test('TC-43.2: "Notifications on" appears nowhere on those pages', async ({ page }) => {
    await seedPlatform(page, PLATFORM_OWNER);
    for (const path of PAGES) {
      await page.goto(path);
      await expect(bannerOf(page).getByRole('button', { name: /^Account menu for / })).toBeVisible();
      await expect(page.getByText('Notifications on')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Notifications on/ })).toHaveCount(0);
      await expect(page.locator('[title*="Notifications on"], [aria-label*="Notifications on"]')).toHaveCount(0);
    }
  });
});
