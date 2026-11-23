import { expect, test, type Locator, type Page } from '@playwright/test';
import type { TenantAdminScenario } from '../../src/mocks/msw/tenantAdminScenarios';
import { ORG, seedTenantAdmin } from './mock';

/*
 * Reaching Settings, the no-access state and the General form (spec 2026-11-22-org-tenant-admin-design.md "E2E
 * requirements": TC-2.1 to TC-2.3, TC-13.1 to TC-13.8, TC-15.1 to TC-15.4, TC-16.1, TC-16.2, TC-17.1 to TC-17.6).
 *
 * Every test seeds the case's mock scenario (mock.ts `seedTenantAdmin`) before its first goto. A later `page.goto`
 * reloads the page and reseeds the mock store, but the scenario stays in sessionStorage, so the same caller returns.
 * "Nothing is sent" is read on the wire: `page.on('request')` records every PATCH to the org update; the count is
 * taken after the page showed its answer.
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

const PROJECTS = `/o/${ORG}/projects`;
const GENERAL = `/o/${ORG}/settings/general`;
const MEMBERS = `/o/${ORG}/settings/members`;
const AUDIT = `/o/${ORG}/settings/audit`;
const ORG_UPDATE = new RegExp(`/api/orgs/[^/]+$`);

async function open(page: Page, scenario: TenantAdminScenario, path: string): Promise<void> {
  await seedTenantAdmin(page, scenario);
  await page.goto(path);
}

const mainNav = (page: Page): Locator => page.getByRole('navigation', { name: 'Main' });
const tab = (page: Page, name: string): Locator => mainNav(page).getByRole('link', { name, exact: true });
const sideMenu = (page: Page): Locator => page.getByRole('navigation', { name: 'Organization settings' });
const crumb = (page: Page, name: string): Locator => page.getByRole('button', { name: `Organization menu, ${name}` });
const h1 = (page: Page, name: string): Locator => page.getByRole('heading', { name, level: 1 });
/** A heading of any level: the no-access state of a route error is not an h1 (the spec gives the text only). */
const anyHeading = (page: Page, name: string): Locator => page.getByRole('heading', { name });

const FULL_MENU = ['Organization', 'General', 'Members', 'Invitations', 'Audit log'];

/** The no-access state: heading and hint, with no form. */
async function expectNoAccess(page: Page): Promise<void> {
  await expect(anyHeading(page, "You don't have access")).toBeVisible();
  await expect(page.getByText('Ask an owner of this organization to give you access.')).toBeVisible();
}

/** The Settings area with its full side menu, `current` active. */
async function expectFullSideMenu(page: Page, current: string): Promise<void> {
  await expect(sideMenu(page)).toBeVisible();
  await expect(sideMenu(page).locator('> *')).toHaveText(FULL_MENU);
  await expect(sideMenu(page).getByRole('link')).toHaveText(['General', 'Members', 'Invitations', 'Audit log']);
  await expect(sideMenu(page).getByRole('link', { name: current, exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(sideMenu(page).locator('[aria-current]')).toHaveCount(1);
}

/** Counts the org update PATCHes this page sends. Call before the first goto. */
function logUpdates(page: Page): { sent: () => number; statuses: () => number[] } {
  let sent = 0;
  const statuses: number[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && ORG_UPDATE.test(new URL(request.url()).pathname)) sent += 1;
  });
  page.on('response', (response) => {
    if (response.request().method() === 'PATCH' && ORG_UPDATE.test(new URL(response.url()).pathname))
      statuses.push(response.status());
  });
  return { sent: () => sent, statuses: () => statuses };
}

async function openGeneral(page: Page): Promise<{ sent: () => number; statuses: () => number[] }> {
  const log = logUpdates(page);
  await open(page, 'twoOwners', GENERAL);
  await expect(h1(page, 'General')).toBeVisible();
  await expect(nameInput(page)).toHaveValue('Alice');
  return log;
}

const nameInput = (page: Page): Locator => page.getByLabel('Name', { exact: true });
const slugInput = (page: Page): Locator => page.getByLabel('URL', { exact: true });
const save = (page: Page): Locator => page.getByRole('button', { name: 'Save', exact: true });
const confirmDialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Change the organization URL?' });

const NAME_EMPTY = 'Enter a name.';
const NAME_LONG = 'Use 100 characters or fewer.';
const SLUG_FORMAT = 'Use lowercase letters, numbers and dashes, with no dash at the start or end.';
const SLUG_TAKEN = 'This URL is taken. Try another.';

/** The caller of the no-access cases: the Projects page shows no Settings, and the typed settings URLs say no access. */
async function expectNoSettingsFor(page: Page, scenario: TenantAdminScenario): Promise<void> {
  await open(page, scenario, PROJECTS);
  await expect(h1(page, 'Projects')).toBeVisible();
  await expect(mainNav(page).getByRole('link')).toHaveText(['Projects']);
  await expect(tab(page, 'Settings')).toHaveCount(0);
  await crumb(page, 'Alice').click();
  const menu = page.getByRole('dialog', { name: 'Organizations' });
  await expect(menu.getByRole('link', { name: 'Projects' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  for (const url of [GENERAL, MEMBERS, AUDIT]) {
    await page.goto(url);
    await expectNoAccess(page);
    await expect(sideMenu(page)).toHaveCount(0);
    await expect(tab(page, 'Projects')).toBeVisible();
    await expect(tab(page, 'Settings')).toHaveCount(0);
    await expect(nameInput(page)).toHaveCount(0);
  }
}

test.describe('BR-2: roles without admin access', () => {
  test('TC-2.1: a member sees no Settings tab or item and the no-access state on the three URLs', async ({ page }) => {
    await expectNoSettingsFor(page, 'member');
  });

  test('TC-2.2: a viewer sees no Settings tab or item and the no-access state on the three URLs', async ({ page }) => {
    await expectNoSettingsFor(page, 'viewer');
  });

  test('TC-2.3: a project admin reaches Invitations only; the other three URLs show no-access inside the layout', async ({
    page,
  }) => {
    await open(page, 'projectAdmin', PROJECTS);
    await expect(h1(page, 'Projects')).toBeVisible();
    await tab(page, 'Settings').click();
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/settings/invitations$`));
    await expect(h1(page, 'Invitations')).toBeVisible();
    await expect(sideMenu(page).locator('> *')).toHaveText(['Organization', 'Invitations']);
    await expect(sideMenu(page).getByRole('link')).toHaveText(['Invitations']);
    await expect(sideMenu(page).getByRole('link', { name: 'Invitations' })).toHaveAttribute('aria-current', 'page');
    for (const url of [MEMBERS, GENERAL, AUDIT]) {
      await page.goto(url);
      await expectNoAccess(page);
      await expect(sideMenu(page)).toBeVisible();
      await expect(sideMenu(page).getByRole('link')).toHaveText(['Invitations']);
      await expect(nameInput(page)).toHaveCount(0);
    }
  });
});

test.describe('BR-13: reaching Settings and the old invitations link', () => {
  test('TC-13.1: the owner pressing the Settings tab lands on General with the full side menu', async ({ page }) => {
    await open(page, 'twoOwners', PROJECTS);
    await expect(tab(page, 'Projects')).toHaveAttribute('aria-current', 'page');
    await tab(page, 'Settings').click();
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/settings/general$`));
    await expect(h1(page, 'General')).toBeVisible();
    await expect(tab(page, 'Settings')).toHaveAttribute('aria-current', 'page');
    await expect(tab(page, 'Projects')).not.toHaveAttribute('aria-current', 'page');
    await expectFullSideMenu(page, 'General');
  });

  test('TC-13.2: the admin pressing the Settings tab lands on General with the full side menu', async ({ page }) => {
    await open(page, 'admin', PROJECTS);
    await expect(tab(page, 'Projects')).toHaveAttribute('aria-current', 'page');
    await tab(page, 'Settings').click();
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/settings/general$`));
    await expect(h1(page, 'General')).toBeVisible();
    await expect(tab(page, 'Settings')).toHaveAttribute('aria-current', 'page');
    await expectFullSideMenu(page, 'General');
  });

  test('TC-13.3: the project admin pressing the Settings tab lands on Invitations with only Invitations', async ({
    page,
  }) => {
    await open(page, 'projectAdmin', PROJECTS);
    await tab(page, 'Settings').click();
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/settings/invitations$`));
    await expect(h1(page, 'Invitations')).toBeVisible();
    await expect(tab(page, 'Settings')).toHaveAttribute('aria-current', 'page');
    await expect(sideMenu(page).getByRole('link')).toHaveText(['Invitations']);
    await expect(sideMenu(page).getByRole('link', { name: 'Invitations' })).toHaveAttribute('aria-current', 'page');
    await expect(sideMenu(page).getByRole('link', { name: 'General' })).toHaveCount(0);
  });

  test('TC-13.4: the owner on My invitations opens Settings from the org menu and lands on General', async ({
    page,
  }) => {
    await open(page, 'twoOwners', '/invitations');
    await expect(page).toHaveURL(/\/invitations$/);
    await expect(tab(page, 'Settings')).toBeVisible();
    await expect(mainNav(page).locator('[aria-current]')).toHaveCount(0);
    await crumb(page, 'Alice').click();
    await page.getByRole('dialog', { name: 'Organizations' }).getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/settings/general$`));
    await expect(h1(page, 'General')).toBeVisible();
    await expectFullSideMenu(page, 'General');
  });

  test('TC-13.5: Back after the Projects tab shows General again', async ({ page }) => {
    await open(page, 'twoOwners', GENERAL);
    await expect(h1(page, 'General')).toBeVisible();
    await tab(page, 'Projects').click();
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/projects$`));
    await expect(h1(page, 'Projects')).toBeVisible();
    await expect(sideMenu(page)).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/settings/general$`));
    await expect(h1(page, 'General')).toBeVisible();
    await expectFullSideMenu(page, 'General');
    await expect(tab(page, 'Settings')).toHaveAttribute('aria-current', 'page');
  });

  test('TC-13.6: /o/alice/settings lands on General', async ({ page }) => {
    await open(page, 'twoOwners', `/o/${ORG}/settings`);
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/settings/general$`));
    await expect(h1(page, 'General')).toBeVisible();
    await expectFullSideMenu(page, 'General');
  });

  test('TC-13.7: the old invitations link lands on the Invitations tab with filter and page kept', async ({ page }) => {
    await open(page, 'invitationsManyAccepted', `/o/${ORG}/invitations?status=accepted&page=2`);
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/settings/invitations\\?(?=.*status=accepted)(?=.*page=2)`));
    await expect(h1(page, 'Invitations')).toBeVisible();
    await expectFullSideMenu(page, 'Invitations');
    const chips = page.getByRole('group', { name: 'Filter by status' });
    await expect(chips.getByRole('button', { name: 'Accepted', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(chips.getByRole('button', { name: 'Pending', exact: true })).toHaveAttribute('aria-pressed', 'false');
    // the list loaded for page 2 (26 accepted rows: the 25 seeded and the default one), so the page was not clamped away
    const pager = page.getByRole('navigation', { name: 'Pagination' });
    await expect(pager.locator('p')).toHaveText('Showing 21–26 of 26');
    await expect(pager.getByRole('button', { name: 'Page 2', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page).toHaveURL(/[?&]status=accepted(&|$)/);
    await expect(page).toHaveURL(/[?&]page=2(&|$)/);
  });

  test('TC-13.8: Invitations in the side menu shows the Invitations list inside the layout', async ({ page }) => {
    await open(page, 'twoOwners', GENERAL);
    await expect(h1(page, 'General')).toBeVisible();
    await sideMenu(page).getByRole('link', { name: 'Invitations', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/settings/invitations$`));
    await expect(h1(page, 'Invitations')).toBeVisible();
    await expectFullSideMenu(page, 'Invitations');
    const chips = page.getByRole('group', { name: 'Filter by status' });
    await expect(chips.getByRole('button', { name: 'Pending', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(chips.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('button', { name: 'Invite people' }).first()).toBeVisible();
  });
});

test.describe('BR-15: org name validation', () => {
  test('TC-15.1: an empty name shows "Enter a name." on Save, keeps the input empty and sends nothing', async ({
    page,
  }) => {
    const log = await openGeneral(page);
    await nameInput(page).fill('');
    await save(page).click();
    await expect(page.getByText(NAME_EMPTY, { exact: true })).toBeVisible();
    await expect(nameInput(page)).toHaveAccessibleDescription(NAME_EMPTY);
    await expect(nameInput(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(nameInput(page)).toBeFocused();
    await expect(nameInput(page)).toHaveValue('');
    await expect(crumb(page, 'Alice')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Organization updated' })).toHaveCount(0);
    expect(log.sent()).toBe(0);
  });

  test('TC-15.2: 101 characters show "Use 100 characters or fewer.", keep the input and send nothing', async ({
    page,
  }) => {
    const log = await openGeneral(page);
    const long = 'a'.repeat(101);
    await nameInput(page).fill(long);
    await save(page).click();
    await expect(page.getByText(NAME_LONG, { exact: true })).toBeVisible();
    await expect(nameInput(page)).toHaveAccessibleDescription(NAME_LONG);
    await expect(nameInput(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(nameInput(page)).toBeFocused();
    await expect(nameInput(page)).toHaveValue(long);
    await expect(crumb(page, 'Alice')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Organization updated' })).toHaveCount(0);
    expect(log.sent()).toBe(0);
  });

  test('TC-15.3: 100 characters save: toast "Organization updated" and the crumb shows the name', async ({ page }) => {
    const log = await openGeneral(page);
    const max = 'a'.repeat(100);
    await nameInput(page).fill(max);
    await save(page).click();
    await expect(page.getByRole('status').filter({ hasText: 'Organization updated' })).toBeVisible();
    await expect(crumb(page, max)).toBeVisible();
    await expect(page.getByText(NAME_LONG, { exact: true })).toHaveCount(0);
    await expect(nameInput(page)).toHaveValue(max);
    expect(log.sent()).toBe(1);
    expect(log.statuses()).toEqual([200]);
  });

  test('TC-15.4: 1 character saves: toast "Organization updated" and the crumb shows it', async ({ page }) => {
    const log = await openGeneral(page);
    await nameInput(page).fill('a');
    await save(page).click();
    await expect(page.getByRole('status').filter({ hasText: 'Organization updated' })).toBeVisible();
    await expect(crumb(page, 'a')).toBeVisible();
    await expect(nameInput(page)).toHaveValue('a');
    expect(log.sent()).toBe(1);
    expect(log.statuses()).toEqual([200]);
  });
});

test.describe('BR-16: changing the slug', () => {
  async function askToChange(page: Page): Promise<{ sent: () => number; statuses: () => number[] }> {
    const log = await openGeneral(page);
    await expect(slugInput(page)).toHaveValue(ORG);
    await slugInput(page).fill('acme');
    await save(page).click();
    await expect(confirmDialog(page)).toBeVisible();
    return log;
  }

  test('TC-16.1: Save with a new URL asks first, with the warning text and the Cancel and Change URL buttons', async ({
    page,
  }) => {
    const log = await askToChange(page);
    const d = confirmDialog(page);
    await expect(d.getByText('Links that use')).toHaveText(
      '/o/alice becomes /o/acme. Links that use /o/alice will show "not found". Share the new link with your members.',
    );
    await expect(d.getByRole('button')).toHaveText(['Cancel', 'Change URL']);
    await expect(page.getByText('Links that use the old URL will show "not found".')).toBeVisible();
    await expect(slugInput(page)).toHaveAccessibleDescription(/Links that use the old URL will show "not found"\./);
    // nothing is saved before the confirmation
    expect(log.sent()).toBe(0);
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/settings/general$`));
  });

  test('TC-16.2: Cancel closes the dialog and the page stays on /o/alice/settings/general', async ({ page }) => {
    const log = await askToChange(page);
    await confirmDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(confirmDialog(page)).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/settings/general$`));
    await expect(h1(page, 'General')).toBeVisible();
    await expect(crumb(page, 'Alice')).toBeVisible();
    expect(log.sent()).toBe(0);
  });
});

test.describe('BR-17: slug validation', () => {
  /** Fills the URL, presses Save and expects the slug format error with the input kept and nothing sent. */
  async function expectRejected(page: Page, log: { sent: () => number }, value: string, focused = true): Promise<void> {
    await slugInput(page).fill(value);
    await save(page).click();
    await expect(page.getByText(SLUG_FORMAT, { exact: true })).toBeVisible();
    await expect(slugInput(page)).toHaveAccessibleDescription(new RegExp(SLUG_FORMAT));
    await expect(slugInput(page)).toHaveAttribute('aria-invalid', 'true');
    // the form moves focus to the field when its error first appears; an unchanged message does not move it again
    if (focused) await expect(slugInput(page)).toBeFocused();
    await expect(slugInput(page)).toHaveValue(value);
    await expect(confirmDialog(page)).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/settings/general$`));
    expect(log.sent()).toBe(0);
  }

  test('TC-17.1: uppercase "Acme" shows the slug format error, keeps the input and does not change the slug', async ({
    page,
  }) => {
    const log = await openGeneral(page);
    await expectRejected(page, log, 'Acme');
  });

  test('TC-17.2: -acme, acme-, my_org and "my org" each show the same slug format error', async ({ page }) => {
    const log = await openGeneral(page);
    for (const [i, value] of ['-acme', 'acme-', 'my_org', 'my org'].entries()) {
      await test.step(value, async () => {
        await expectRejected(page, log, value, i === 0);
      });
    }
  });

  test('TC-17.3: 64 characters show a URL field error and nothing changes', async ({ page }) => {
    const log = await openGeneral(page);
    await expectRejected(page, log, 'a'.repeat(64));
  });

  test('TC-17.4: 63 characters save after Change URL and the page moves to the new URL', async ({ page }) => {
    const log = await openGeneral(page);
    const max = 'a'.repeat(63);
    await slugInput(page).fill(max);
    await save(page).click();
    await expect(confirmDialog(page)).toBeVisible();
    await confirmDialog(page).getByRole('button', { name: 'Change URL', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${max}/settings/general$`));
    await expect(h1(page, 'General')).toBeVisible();
    await expect(slugInput(page)).toHaveValue(max);
    await expect(page.getByText(SLUG_FORMAT, { exact: true })).toHaveCount(0);
    expect(log.sent()).toBe(1);
    expect(log.statuses()).toEqual([200]);
  });

  test('TC-17.5: an empty URL shows a field error on Save and nothing changes', async ({ page }) => {
    const log = await openGeneral(page);
    await expectRejected(page, log, '');
  });

  test('TC-17.6: the taken slug shows "This URL is taken. Try another." and the page stays on the old URL', async ({
    page,
  }) => {
    const log = await openGeneral(page);
    await slugInput(page).fill('taken');
    await save(page).click();
    await expect(confirmDialog(page)).toBeVisible();
    await confirmDialog(page).getByRole('button', { name: 'Change URL', exact: true }).click();
    await expect(page.getByText(SLUG_TAKEN, { exact: true })).toBeVisible();
    await expect(slugInput(page)).toHaveAccessibleDescription(new RegExp(SLUG_TAKEN));
    await expect(slugInput(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(slugInput(page)).toHaveValue('taken');
    await expect(confirmDialog(page)).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/settings/general$`));
    await expect(crumb(page, 'Alice')).toBeVisible();
    expect(log.sent()).toBe(1);
    expect(log.statuses()).toEqual([409]);
  });
});
