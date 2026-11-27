import { expect, test, type Locator, type Page } from '@playwright/test';
import type { MockLists } from '../../src/mocks/msw/e2eLists';
import type { PlatformScenario } from '../../src/mocks/msw/platformScenarios';
import { SESSION_MOCK_NOW, seedLists, seedPlatform } from './mock';

/*
 * The org detail tabs of the platform area (spec 2026-11-23-platform-admin-dashboard-design.md "E2E requirements":
 * TC-4.10, TC-24.1, TC-24.2, TC-25.1, TC-25.3, TC-26.1, TC-27.1 to TC-27.3, TC-28.1, TC-28.2, TC-29.1, TC-29.2,
 * TC-30.1 to TC-30.3, TC-31.1 to TC-31.4).
 *
 * Every test seeds the case's platform scenario (mock.ts `seedPlatform`) before its first goto, with a clock fixed at
 * SESSION_MOCK_NOW; the mock store reseeds on every page load, so a test that changes data stays in the app after it
 * (clicks, no second goto). The directory org "Acme" (src/mocks/dto/platform.ts) is the org of every case:
 *  - `platformAdminOrgs`: 25 projects (Alpha first), four members (Alice Acme: Owner (organization) and Member (Alpha);
 *    Bob Builder: Admin; Cara Idle: none; "noname": no name, Viewer), and two invitations (pending@example.test pending,
 *    revoked@example.test revoked).
 *  - `platformOrgFewProjects`: the same members with two projects, Alpha and Project 02; no invitations.
 *  - `platformOrgTabsEmpty`: no projects, members or invitations.
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

const ORGS = '/platform/orgs';
const ACME = 'b8000000-0000-4000-8000-000000000001';
const ALICE_ORG = 'b6000000-0000-4000-8000-000000000001';
const DETAIL = `${ORGS}/${ACME}`;
const PENDING = 'pending@example.test';
const REVOKED = 'revoked@example.test';

async function open(
  page: Page,
  scenario: PlatformScenario = 'platformAdminOrgs',
  opts: { path?: string; lists?: MockLists } = {},
): Promise<void> {
  await page.clock.install({ time: new Date(SESSION_MOCK_NOW) });
  await seedPlatform(page, scenario);
  if (opts.lists) await seedLists(page, opts.lists);
  await page.goto(opts.path ?? DETAIL);
}

const sideMenu = (page: Page): Locator => page.getByRole('navigation', { name: 'Platform menu' });
const bodyRows = (page: Page): Locator => page.locator('tbody tr');
const rowOf = (page: Page, text: string): Locator => bodyRows(page).filter({ hasText: text });
const loading = (page: Page): Locator => page.getByRole('status', { name: 'Loading', exact: true });
const tabHeading = (page: Page, name: string): Locator => page.getByRole('heading', { name, level: 2 });
const toast = (page: Page, text: string): Locator => page.getByRole('status').filter({ hasText: text });
const pagination = (page: Page): Locator => page.getByRole('navigation', { name: 'Pagination' });

type Tab = 'Projects' | 'Members' | 'Invitations';
const TABS: Tab[] = ['Projects', 'Members', 'Invitations'];
const PATHS: Record<Tab, string> = {
  Projects: `${DETAIL}/projects`,
  Members: `${DETAIL}/members`,
  Invitations: `${DETAIL}/invitations`,
};
const LIST_ROUTES: Record<Tab, string> = {
  Projects: 'platform.listProjects',
  Members: 'platform.listMembers',
  Invitations: 'platform.listInvitations',
};
const EMPTY_TITLES: Record<Tab, string> = {
  Projects: 'No projects',
  Members: 'No members',
  Invitations: 'No invitations',
};

async function openTab(page: Page, tab: Tab, scenario: PlatformScenario = 'platformAdminOrgs'): Promise<void> {
  await open(page, scenario, { path: PATHS[tab] });
  await expect(tabHeading(page, tab)).toBeVisible();
}

test.describe('BR-4: loading, empty and failing org detail tabs', () => {
  for (const tab of TABS) {
    test(`TC-4.10: the ${tab} tab shows a skeleton while loading, then its rows`, async ({ page }) => {
      await open(page, 'platformAdminOrgs', {
        path: PATHS[tab],
        lists: { hold: [{ route: LIST_ROUTES[tab], ms: 3000 }] },
      });

      await expect(loading(page)).toBeVisible();
      await expect(page.getByRole('table')).toHaveCount(0);
      await expect(page.getByText(EMPTY_TITLES[tab], { exact: true })).toHaveCount(0);

      await expect(tabHeading(page, tab)).toBeVisible();
      await expect(loading(page)).toHaveCount(0);
      await expect(bodyRows(page).first()).toBeVisible();
    });

    test(`TC-4.10: the ${tab} tab with no rows shows "${EMPTY_TITLES[tab]}"`, async ({ page }) => {
      await open(page, 'platformOrgTabsEmpty', { path: PATHS[tab] });

      await expect(page.getByText(EMPTY_TITLES[tab], { exact: true })).toBeVisible();
      await expect(bodyRows(page)).toHaveCount(0);
    });

    test(`TC-4.10: a failing ${tab} tab shows the error and Retry, and Retry reloads the tab`, async ({ page }) => {
      // Three failures cover the first load and Query's two retries; the next request succeeds.
      await open(page, 'platformAdminOrgs', {
        path: PATHS[tab],
        lists: { fail: [{ route: LIST_ROUTES[tab], times: 3 }] },
      });

      await expect(page.getByText('Internal server error')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
      await expect(bodyRows(page)).toHaveCount(0);

      await page.getByRole('button', { name: 'Retry' }).click();

      await expect(tabHeading(page, tab)).toBeVisible();
      await expect(page.getByText('Internal server error')).toHaveCount(0);
      await expect(bodyRows(page).first()).toBeVisible();
    });
  }
});

test.describe('BR-24: org detail from the directory', () => {
  test('TC-24.1: the detail opens with the name, /o/<slug>, status, the Overview facts and the side menu group', async ({
    page,
  }) => {
    await open(page, 'platformAdminOrgs', { path: ORGS });
    await expect(bodyRows(page).first()).toBeVisible();

    await page.getByRole('link', { name: 'Acme', exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`/platform/orgs/${ACME}$`));
    const h1 = page.getByRole('heading', { name: 'Acme', level: 1 });
    await expect(h1).toBeVisible();
    const header = h1.locator('xpath=..');
    await expect(header).toContainText('/o/acme');
    await expect(header).toContainText('Active');

    await expect(tabHeading(page, 'Overview')).toBeVisible();
    await expect(page.getByRole('term')).toHaveText([
      'Slug',
      'Owner',
      'Members',
      'Projects',
      'Last activity',
      'Created',
      'Status',
    ]);
    await expect(page.getByRole('definition')).toHaveText([
      '/o/acme',
      'Alice Acme',
      '4',
      '3',
      '3 hours ago',
      /^1 Sept? 2026$/,
      'Active',
    ]);

    // The side menu group "Acme" lists Overview, Projects, Members, Invitations.
    await expect(sideMenu(page).getByText('Acme', { exact: true })).toBeVisible();
    await expect(sideMenu(page).getByRole('link', { name: /^(Overview|Projects|Members|Invitations)$/ })).toHaveText([
      'Overview',
      'Projects',
      'Members',
      'Invitations',
    ]);
  });

  test('TC-24.2: Projects, Members and Invitations in the side menu open their sections', async ({ page }) => {
    await open(page);
    await expect(page.getByRole('heading', { name: 'Acme', level: 1 })).toBeVisible();

    for (const tab of TABS) {
      await sideMenu(page).getByRole('link', { name: tab, exact: true }).click();
      await expect(tabHeading(page, tab)).toBeVisible();
    }
  });
});

test.describe('BR-25: Projects show id and name only', () => {
  test('TC-25.1: columns Name and Id only; each row has the id and name as plain text, no link, no actions', async ({
    page,
  }) => {
    await openTab(page, 'Projects', 'platformOrgFewProjects');

    await expect(page.getByRole('columnheader')).toHaveText(['Name', 'Id']);
    await expect(bodyRows(page)).toHaveCount(2);
    await expect(bodyRows(page).nth(0).getByRole('cell')).toHaveText(['Alpha', 'b8100000-0000-4000-8000-000000000001']);
    await expect(bodyRows(page).nth(1).getByRole('cell')).toHaveText([
      'Project 02',
      'b8100000-0000-4000-8000-000000000002',
    ]);
    await expect(page.locator('tbody').getByRole('link')).toHaveCount(0);
    await expect(page.locator('tbody').getByRole('button')).toHaveCount(0);
  });

  test('TC-25.3: page 2 holds ?page=2 and the remaining rows; Members keeps its own page', async ({ page }) => {
    await openTab(page, 'Projects');
    await expect(bodyRows(page)).toHaveCount(20);

    await pagination(page).getByRole('button', { name: 'Next', exact: true }).click();

    await expect(page).toHaveURL(/[?&]page=2(&|$)/);
    await expect(bodyRows(page)).toHaveCount(5);
    await expect(bodyRows(page).first()).toContainText('Project 21');

    await sideMenu(page).getByRole('link', { name: 'Members', exact: true }).click();

    await expect(tabHeading(page, 'Members')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/platform/orgs/${ACME}/members$`));
    await expect(bodyRows(page)).toHaveCount(4);
  });
});

test.describe('BR-26: Members tab content', () => {
  test('TC-26.1: columns, roles with scopes, "—" for none, the handle alone, and the platform note', async ({
    page,
  }) => {
    await openTab(page, 'Members');

    await expect(page.getByRole('columnheader')).toHaveText(['Name', 'Email', 'Roles', 'Actions']);
    await expect(
      page.getByText('Platform view: names and emails only. Tickets, runs and secrets are never shown here.', {
        exact: true,
      }),
    ).toBeVisible();

    // Owner on the whole org and Member on project "Alpha"; the handle shows under the name.
    const alice = rowOf(page, 'alice@example.com');
    await expect(alice.getByRole('cell').nth(0)).toHaveText(/^Alice Acme\s*alice$/);
    await expect(alice.getByRole('cell').nth(2)).toHaveText('Owner (organization), Member (Alpha)');
    // No assignment: a dash.
    await expect(rowOf(page, 'cara@example.com').getByRole('cell').nth(2)).toHaveText('—');
    // No name: the handle alone.
    await expect(rowOf(page, 'noname@example.com').getByRole('cell').nth(0)).toHaveText('noname');
  });
});

test.describe('BR-27: add an assignment', () => {
  const rowActions = (page: Page, name: string): Locator => page.getByRole('button', { name: `Actions for ${name}` });
  const addDialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Add assignment' });
  const roleSelect = (d: Locator): Locator => d.getByLabel('Role');
  const choices = (select: Locator): Promise<string[]> =>
    select.locator('option:not([disabled])').evaluateAll((os) => os.map((o) => o.textContent ?? ''));

  /** The case's Given and steps: Members, the row menu of a member with no assignment, "Add assignment". */
  async function openAdd(page: Page): Promise<Locator> {
    await openTab(page, 'Members', 'platformOrgFewProjects');
    await rowActions(page, 'Cara Idle').click();
    await page.getByRole('button', { name: 'Add assignment' }).click();
    const d = addDialog(page);
    await expect(d).toBeVisible();
    await expect(roleSelect(d).locator('option:not([disabled])').first()).toBeAttached();
    return d;
  }

  test('TC-27.1: the dialog has Access "Whole organization" selected and Role offers Owner, Admin, Member, Viewer', async ({
    page,
  }) => {
    const d = await openAdd(page);

    await expect(d.getByRole('radio', { name: 'Whole organization' })).toBeChecked();
    expect(await choices(roleSelect(d))).toEqual(['Owner', 'Admin', 'Member', 'Viewer']);
  });

  test('TC-27.2: "One project" shows a Project select with the org\'s projects and Role without Owner', async ({
    page,
  }) => {
    const d = await openAdd(page);

    await d.getByRole('radio', { name: 'One project' }).check();

    await expect(d.getByLabel('Project', { exact: true })).toBeVisible();
    expect(await choices(d.getByLabel('Project', { exact: true }))).toEqual(['Alpha', 'Project 02']);
    expect(await choices(roleSelect(d))).toEqual(['Admin', 'Member', 'Viewer']);
  });

  test('TC-27.3: Owner on the whole organization is added: the toast shows and the member now has "Owner (organization)"', async ({
    page,
  }) => {
    const d = await openAdd(page);
    await expect(rowOf(page, 'cara@example.com').getByRole('cell').nth(2)).toHaveText('—');

    await roleSelect(d).selectOption({ label: 'Owner' });
    await d.getByRole('radio', { name: 'Whole organization' }).check();
    await d.getByRole('button', { name: 'Add assignment' }).click();

    await expect(toast(page, 'Assignment added')).toBeVisible();
    await expect(d).toHaveCount(0);
    await expect(rowOf(page, 'cara@example.com').getByRole('cell').nth(2)).toContainText('Owner (organization)');
  });
});

test.describe('BR-28: remove an assignment', () => {
  const alice = (page: Page): Locator => rowOf(page, 'alice@example.com');
  const roles = (page: Page): Locator => alice(page).getByRole('cell').nth(2);

  /** The case's Given and first two steps: a member with two assignments, the row menu, "Remove Member (Alpha)". */
  async function pressRemove(page: Page): Promise<Locator> {
    await openTab(page, 'Members');
    await expect(roles(page)).toHaveText('Owner (organization), Member (Alpha)');
    await page.getByRole('button', { name: 'Actions for Alice Acme' }).click();
    await page.getByRole('button', { name: 'Remove Member (Alpha)' }).click();
    const confirm = page.getByRole('dialog', { name: 'Remove Member (Alpha) from Alice Acme?' });
    await expect(confirm).toBeVisible();
    return confirm;
  }

  test('TC-28.1: confirming shows the toast, the assignment leaves the Roles cell and the other stays', async ({
    page,
  }) => {
    const confirm = await pressRemove(page);

    await confirm.getByRole('button', { name: 'Remove', exact: true }).click();

    await expect(toast(page, 'Assignment removed')).toBeVisible();
    await expect(confirm).toHaveCount(0);
    await expect(roles(page)).toHaveText('Owner (organization)');
  });

  test('TC-28.2: Cancel keeps the assignment', async ({ page }) => {
    const confirm = await pressRemove(page);

    await confirm.getByRole('button', { name: 'Cancel' }).click();

    await expect(confirm).toHaveCount(0);
    await expect(toast(page, 'Assignment removed')).toHaveCount(0);
    await expect(roles(page)).toHaveText('Owner (organization), Member (Alpha)');
  });
});

test.describe('BR-29: invitations list and filter', () => {
  const chip = (page: Page, name: string): Locator =>
    page.getByRole('group', { name: 'Filter by status' }).getByRole('button', { name, exact: true });

  test('TC-29.1: only the pending invitation shows, the filter reads Pending, with the seven columns', async ({
    page,
  }) => {
    await openTab(page, 'Invitations');

    await expect(page.getByRole('columnheader')).toHaveText([
      'Email',
      'Role',
      'Access',
      'Status',
      'Expires',
      'Invited by',
      'Actions',
    ]);
    await expect(bodyRows(page)).toHaveCount(1);
    await expect(bodyRows(page).first()).toContainText(PENDING);
    await expect(bodyRows(page).first()).toContainText('Pending');
    await expect(page.getByText(REVOKED)).toHaveCount(0);
    await expect(chip(page, 'Pending')).toHaveAttribute('aria-pressed', 'true');
    await expect(chip(page, 'Revoked')).toHaveAttribute('aria-pressed', 'false');
  });

  test('TC-29.2: "Revoked" shows only the revoked invitation and "All" shows both', async ({ page }) => {
    await openTab(page, 'Invitations');

    await chip(page, 'Revoked').click();

    await expect(bodyRows(page)).toHaveCount(1);
    await expect(bodyRows(page).first()).toContainText(REVOKED);
    await expect(page.getByText(PENDING)).toHaveCount(0);

    await chip(page, 'All').click();

    await expect(bodyRows(page)).toHaveCount(2);
    await expect(rowOf(page, PENDING)).toHaveCount(1);
    await expect(rowOf(page, REVOKED)).toHaveCount(1);
  });
});

test.describe('BR-30: create, resend, revoke an invitation', () => {
  const dialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Invite people' });
  const rowMenu = (page: Page, email: string): Locator => page.getByRole('button', { name: `Actions for ${email}` });

  test('TC-30.1: an Owner invitation to the whole organization shows as Pending after "Done"', async ({ page }) => {
    await openTab(page, 'Invitations');

    await page.getByRole('button', { name: 'Invite people' }).first().click();
    const d = dialog(page);
    await expect(d).toBeVisible();
    await expect(d.getByLabel('Role').locator('option:not([disabled])').first()).toBeAttached();
    await d.getByLabel('Email').fill('new@example.test');
    await d.getByLabel('Role').selectOption({ label: 'Owner' });
    await d.getByRole('radio', { name: 'Whole organization' }).check();
    await d.getByRole('button', { name: 'Create invitation' }).click();

    const link = page.getByRole('dialog', { name: 'Invitation link' });
    await expect(link).toBeVisible();
    await link.getByRole('button', { name: 'Done' }).click();
    await expect(link).toHaveCount(0);

    const row = rowOf(page, 'new@example.test');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Pending');
    await expect(row).toContainText('Owner');
  });

  test('TC-30.2: resend shows the row resending, then a refreshed expiry, still pending', async ({ page }) => {
    await open(page, 'platformAdminOrgs', {
      path: PATHS.Invitations,
      lists: { hold: [{ route: 'platform.resendInvitation', ms: 2000 }] },
    });
    const row = rowOf(page, PENDING);
    await expect(row).toContainText(/Expires in \d+ hours/);

    await rowMenu(page, PENDING).click();
    await page.getByRole('button', { name: /resend/i }).click();

    // While the request is in flight the row's actions are unavailable.
    await expect(rowMenu(page, PENDING)).toBeDisabled();
    await expect(row).toContainText(/Expires in \d+ hours/);

    await expect(rowMenu(page, PENDING)).toBeEnabled({ timeout: 10_000 });
    await expect(row).toContainText('Expires in 2 days');
    await expect(row).toContainText('Pending');
  });

  test('TC-30.3: revoking with confirm leaves the pending list and "Revoked" shows it', async ({ page }) => {
    await openTab(page, 'Invitations');

    await rowMenu(page, PENDING).click();
    await page.getByRole('button', { name: /^revoke$/i }).click();
    const confirm = page.getByRole('dialog', { name: `Revoke invitation for ${PENDING}?` });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Revoke', exact: true }).click();

    await expect(confirm).toHaveCount(0);
    await expect(page.getByText(PENDING)).toHaveCount(0);
    await expect(bodyRows(page)).toHaveCount(0);

    await page
      .getByRole('group', { name: 'Filter by status' })
      .getByRole('button', { name: 'Revoked', exact: true })
      .click();

    await expect(rowOf(page, PENDING)).toHaveCount(1);
    await expect(rowOf(page, PENDING)).toContainText('Revoked');
  });
});

test.describe('BR-31: invitation email validation', () => {
  const dialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Invite people' });
  const emailInput = (page: Page): Locator => dialog(page).getByLabel('Email');

  /** A valid-shaped email of exactly `length` characters (local part 64, labels up to 63, ending in ".dev"). */
  function emailOfLength(length: number): string {
    const local = 'a'.repeat(64);
    let rest = length - local.length - 1 - 3;
    let domain = '';
    while (rest > 0) {
      const part = rest <= 64 ? rest : rest - 64 === 1 ? 63 : 64;
      domain += `${'b'.repeat(part - 1)}.`;
      rest -= part;
    }
    const email = `${local}@${domain}dev`;
    if (email.length !== length) throw new Error(`built ${email.length} characters, wanted ${length}`);
    return email;
  }

  /** The case's Given: the Invite people dialog is open on the org's Invitations (one pending row). */
  async function openDialog(page: Page): Promise<void> {
    await openTab(page, 'Invitations');
    await expect(bodyRows(page)).toHaveCount(1);
    await page.getByRole('button', { name: 'Invite people' }).first().click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByLabel('Role').locator('option:not([disabled])').first()).toBeAttached();
  }

  const submit = (page: Page) => dialog(page).getByRole('button', { name: 'Create invitation' }).click();

  /** An error shows at Email (Q1: the spec gives no wording) and nothing was created. */
  async function expectErrorAtEmailAndNothingCreated(page: Page, email: string): Promise<void> {
    await expect(emailInput(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(emailInput(page)).toHaveAccessibleDescription(/\S/);
    await expect(page.getByRole('dialog', { name: 'Invitation link' })).toHaveCount(0);
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(bodyRows(page)).toHaveCount(1);
    await page
      .getByRole('group', { name: 'Filter by status' })
      .getByRole('button', { name: 'All', exact: true })
      .click();
    await expect(bodyRows(page)).toHaveCount(2);
    await expect(page.getByText(email, { exact: true })).toHaveCount(0);
  }

  test('TC-31.1: "not-an-email" shows an error at Email and creates nothing', async ({ page }) => {
    await openDialog(page);

    await emailInput(page).fill('not-an-email');
    await submit(page);

    await expectErrorAtEmailAndNothingCreated(page, 'not-an-email');
  });

  test('TC-31.2: a 255-character email shows an error at Email and creates nothing', async ({ page }) => {
    const email = emailOfLength(255);
    await openDialog(page);

    await emailInput(page).fill(email);
    await expect(emailInput(page)).toHaveValue(email);
    await submit(page);

    await expectErrorAtEmailAndNothingCreated(page, email);
  });

  test('TC-31.3: a valid 254-character email shows no error at Email and the invitation is created', async ({
    page,
  }) => {
    const email = emailOfLength(254);
    await openDialog(page);

    await emailInput(page).fill(email);
    await expect(emailInput(page)).toHaveValue(email);
    // The role and access are the dialog's other required answers.
    await dialog(page).getByLabel('Role').selectOption({ label: 'Member' });
    await dialog(page).getByRole('radio', { name: 'Whole organization' }).check();
    // Checked while the form is still mounted: an invalid Email would show here, before the link dialog replaces it.
    await emailInput(page).blur();
    await expect(emailInput(page)).toBeVisible();
    await expect(emailInput(page)).not.toHaveAttribute('aria-invalid', 'true');
    await expect(dialog(page).locator('[aria-invalid="true"]')).toHaveCount(0);
    await submit(page);

    const link = page.getByRole('dialog', { name: 'Invitation link' });
    await expect(link).toBeVisible();
    await link.getByRole('button', { name: 'Done' }).click();
    await expect(rowOf(page, email)).toHaveCount(1);
    await expect(rowOf(page, email)).toContainText('Pending');
  });

  test('TC-31.4: an empty Email shows an error at Email and creates nothing', async ({ page }) => {
    await openDialog(page);

    await submit(page);

    await expectErrorAtEmailAndNothingCreated(page, 'new@example.test');
  });
});

test.describe('Open organization', () => {
  test('"Open organization" on a member org lands on /o/<slug>/projects', async ({ page }) => {
    await open(page, 'platformAdminMemberOrg', { path: `${ORGS}/${ALICE_ORG}` });
    await page.getByRole('button', { name: 'More actions' }).click();
    const link = page.getByRole('menuitem', { name: 'Open organization' });
    await expect(link).toHaveAttribute('href', '/o/alice/projects');
    await link.click();
    await expect(page).toHaveURL(/\/o\/alice\/projects$/);
  });

  test('a non-member org has no "Open organization"', async ({ page }) => {
    await open(page);
    await expect(page.getByRole('heading', { name: 'Acme', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'More actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Open organization' })).toHaveCount(0);
  });
});

test.describe('Header actions', () => {
  test('Edit organization and More actions are the only header buttons; the rest sits in the menu', async ({
    page,
  }) => {
    await open(page);
    await expect(page.getByRole('heading', { name: 'Acme', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Suspend organization' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'View audit log' })).toHaveCount(0);

    const trigger = page.getByRole('button', { name: 'More actions' });
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('menuitem')).toHaveText(['Suspend organization', 'View audit log']);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});
