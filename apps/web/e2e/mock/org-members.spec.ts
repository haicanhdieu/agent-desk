import { expect, test, type Locator, type Page } from '@playwright/test';
import type { TenantAdminScenario } from '../../src/mocks/msw/tenantAdminScenarios';
import { ORG, seedTenantAdmin } from './mock';

/*
 * The org Members page: paging, role cards per caller, last owner, row menus, stale rows, and the loading and error
 * states (spec 2026-11-22-org-tenant-admin-design.md "E2E requirements": TC-1.4, TC-4.1 to TC-4.3, TC-5.1, TC-5.2,
 * TC-8.1 to TC-8.3, TC-9.1 to TC-9.3, TC-24.1, TC-24.2).
 *
 * Every test seeds the case's mock scenario (mock.ts `seedTenantAdmin`) before its first goto. The roster comes from
 * src/mocks/dto/access.ts: Alice Doe (the signed-in user), Priya Raman (owner), Ben Okafor (admin), Cleo Martin
 * (member), Eli Ford (no org role).
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

const MEMBERS = `/o/${ORG}/settings/members`;
const ORG_NAME = 'Alice';

async function open(page: Page, scenario: TenantAdminScenario): Promise<void> {
  await seedTenantAdmin(page, scenario);
  await page.goto(MEMBERS);
}

const heading = (page: Page): Locator => page.getByRole('heading', { name: 'Members', level: 1 });
const rowOf = (page: Page, name: string): Locator => page.getByRole('row').filter({ hasText: name });
const menuButton = (page: Page, name: string): Locator => page.getByRole('button', { name: `Actions for ${name}` });
const dialog = (page: Page, name: string): Locator => page.getByRole('dialog', { name: `Change role for ${name}` });
const card = (scope: Locator, role: string): Locator => scope.getByRole('radio', { name: new RegExp(`^${role}`) });
const nav = (page: Page): Locator => page.getByRole('navigation', { name: 'Pagination' });

/** The loaded page. */
async function loaded(page: Page): Promise<void> {
  await expect(heading(page)).toBeVisible();
  await expect(page.getByRole('row').nth(1)).toBeVisible();
}

/** Opens the "Actions for" menu of a member and returns nothing; the menu items are read through `page`. */
async function openMenu(page: Page, name: string): Promise<void> {
  await menuButton(page, name).click();
}

const changeRole = (page: Page): Locator => page.getByRole('button', { name: 'Change role', exact: true });
const removeItem = (page: Page): Locator => page.getByRole('button', { name: 'Remove from organization' });

test('TC-1.4: 25 members page by 20 and the rest, with the full pagination control', async ({ page }) => {
  await open(page, 'membersPaged');
  await loaded(page);
  await expect(menuButton(page, 'Alice Doe')).toBeVisible();
  // the header row is one of the rows
  await expect(page.locator('tbody tr')).toHaveCount(20);
  await expect(rowOf(page, 'Member 19')).toBeVisible();
  await expect(rowOf(page, 'Member 20')).toHaveCount(0);
  await expect(nav(page).locator('p')).toHaveText('Showing 1–20 of 25');
  await expect(nav(page).getByRole('button', { name: 'Page 2', exact: true })).toBeVisible();
  await expect(nav(page).getByRole('button', { name: 'Previous', exact: true })).toBeVisible();
  await expect(nav(page).getByRole('button', { name: 'Page 1', exact: true })).toBeVisible();
  await expect(nav(page).getByLabel('Go to page')).toBeVisible();
  const size = nav(page).getByLabel('Rows per page');
  await expect(size.locator('option')).toHaveText(['20', '50', '100']);

  await nav(page).getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(5);
  for (const n of [20, 21, 22, 23, 24]) await expect(rowOf(page, `Member ${n}`)).toBeVisible();
  await expect(rowOf(page, 'Member 19')).toHaveCount(0);
  await expect(nav(page).locator('p')).toHaveText('Showing 21–25 of 25');
});

test('TC-4.1: an admin sees Admin, Member, Viewer and No role cards and no Owner card', async ({ page }) => {
  await open(page, 'admin');
  await loaded(page);
  await openMenu(page, 'Cleo Martin');
  await changeRole(page).click();
  const d = dialog(page, 'Cleo Martin');
  await expect(d).toBeVisible();
  await expect(d.getByRole('radio')).toHaveCount(4);
  for (const role of ['Admin', 'Member', 'Viewer', 'No role']) await expect(card(d, role)).toBeVisible();
  await expect(card(d, 'Owner')).toHaveCount(0);
});

test("TC-4.2: an admin's view of an owner row offers no Change role and no Remove", async ({ page }) => {
  await open(page, 'admin');
  await loaded(page);
  await expect(rowOf(page, 'Priya Raman')).toBeVisible();
  await expect(menuButton(page, 'Priya Raman')).toHaveCount(0);
  // the owner row has no menu and no button at all, so it cannot offer Change role or Remove from organization
  await expect(rowOf(page, 'Priya Raman').getByRole('button')).toHaveCount(0);
  // positive control: the same admin's menu on a member row does offer both
  await openMenu(page, 'Cleo Martin');
  await expect(changeRole(page)).toBeVisible();
  await expect(removeItem(page)).toBeVisible();
});

test('TC-4.3: an owner sees the Owner card with Admin, Member, Viewer and No role', async ({ page }) => {
  await open(page, 'twoOwners');
  await loaded(page);
  await openMenu(page, 'Cleo Martin');
  await changeRole(page).click();
  const d = dialog(page, 'Cleo Martin');
  await expect(d).toBeVisible();
  await expect(d.getByRole('radio')).toHaveCount(5);
  for (const role of ['Owner', 'Admin', 'Member', 'Viewer', 'No role']) await expect(card(d, role)).toBeVisible();
});

test('TC-5.1: the sole owner stepping down gets the warning and the last-owner banner', async ({ page }) => {
  await open(page, 'soleOwner');
  await loaded(page);
  await openMenu(page, 'Alice Doe');
  await changeRole(page).click();
  const d = dialog(page, 'Alice Doe');
  await expect(d).toBeVisible();
  await card(d, 'Admin').check();
  await expect(d.getByText(`You will lose owner rights in ${ORG_NAME}.`)).toBeVisible();
  await d.getByRole('button', { name: 'Save role' }).click();
  await expect(d.getByText('An organization needs at least one owner.')).toBeVisible();
  await expect(d).toBeVisible();
  await d.getByRole('button', { name: 'Cancel' }).click();
  await expect(d).toHaveCount(0);
  await expect(rowOf(page, 'Alice Doe')).toContainText('Owner');
});

test('TC-5.2: with two owners nothing is disabled in advance on either owner row', async ({ page }) => {
  await open(page, 'twoOwners');
  await loaded(page);
  await openMenu(page, 'Priya Raman');
  await expect(changeRole(page)).toBeEnabled();
  await expect(removeItem(page)).toBeEnabled();
  await page.keyboard.press('Escape');
  await openMenu(page, 'Alice Doe');
  await expect(changeRole(page)).toBeEnabled();
  await expect(removeItem(page)).toHaveCount(0);
});

test('TC-8.1: changing the role of a member removed meanwhile closes the dialog with an error toast', async ({
  page,
}) => {
  await open(page, 'memberRemovedMeanwhile');
  await loaded(page);
  await expect(rowOf(page, 'Cleo Martin')).toBeVisible();
  await openMenu(page, 'Cleo Martin');
  await changeRole(page).click();
  const d = dialog(page, 'Cleo Martin');
  await card(d, 'Viewer').check();
  await d.getByRole('button', { name: 'Save role' }).click();
  await expect(d).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: 'Member is no longer in the organization' })).toBeVisible();
  await expect(rowOf(page, 'Cleo Martin')).toHaveCount(0);
  await expect(rowOf(page, 'Ben Okafor')).toBeVisible();
});

test('TC-8.2: removing a member removed meanwhile shows the error toast and refreshes the list', async ({ page }) => {
  await open(page, 'memberRemovedMeanwhile');
  await loaded(page);
  await expect(rowOf(page, 'Cleo Martin')).toBeVisible();
  await openMenu(page, 'Cleo Martin');
  await removeItem(page).click();
  const confirm = page.getByRole('dialog', { name: `Remove Cleo Martin from ${ORG_NAME}?` });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Member is no longer in the organization' })).toBeVisible();
  await expect(confirm).toHaveCount(0);
  await expect(rowOf(page, 'Cleo Martin')).toHaveCount(0);
});

test('TC-8.3: a role changed meanwhile does not block the change: Role changed and the row shows Admin', async ({
  page,
}) => {
  await open(page, 'roleChangedMeanwhile');
  await loaded(page);
  // the Role cell only: the Project roles cell of this row already reads "(Admin)" and "(Member)"
  const roleCell = rowOf(page, 'Cleo Martin').getByRole('cell').nth(1);
  await expect(roleCell).toHaveText('Member');
  await openMenu(page, 'Cleo Martin');
  await changeRole(page).click();
  const d = dialog(page, 'Cleo Martin');
  await card(d, 'Admin').check();
  await d.getByRole('button', { name: 'Save role' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Role changed' })).toBeVisible();
  await expect(d).toHaveCount(0);
  await expect(roleCell).toHaveText('Admin');
  await expect(page.getByText('Member is no longer in the organization')).toHaveCount(0);
});

/** TC-9.1 and TC-9.2 share their steps and Expected; only the caller (the Given) differs. */
async function expectOwnRowMenu(page: Page, scenario: TenantAdminScenario): Promise<void> {
  await open(page, scenario);
  await loaded(page);
  await expect(rowOf(page, 'Alice Doe')).toContainText('You');
  await openMenu(page, 'Alice Doe');
  await expect(changeRole(page)).toBeVisible();
  await expect(removeItem(page)).toHaveCount(0);
}

test('TC-9.1: an owner (two owners) has Change role, no Remove and the You tag on the own row', async ({ page }) => {
  await expectOwnRowMenu(page, 'twoOwners');
});

test('TC-9.2: an admin has Change role, no Remove and the You tag on the own row', async ({ page }) => {
  await expectOwnRowMenu(page, 'admin');
});

test("TC-9.3: an owner sees Change role and Remove on another member's row", async ({ page }) => {
  await open(page, 'twoOwners');
  await loaded(page);
  await openMenu(page, 'Cleo Martin');
  await expect(changeRole(page)).toBeVisible();
  await expect(removeItem(page)).toBeVisible();
});

test('TC-24.1: a skeleton shows until the slow Members list arrives', async ({ page }) => {
  await open(page, 'membersSlow');
  await expect(page.getByRole('status', { name: 'Loading' })).toBeVisible();
  await expect(heading(page)).toHaveCount(0);
  await loaded(page);
  await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0);
  await expect(rowOf(page, 'Alice Doe')).toBeVisible();
});

test('TC-24.2: a Members error shows the message and request id, and Retry shows the list', async ({ page }) => {
  await open(page, 'membersError');
  await expect(page.getByText('Internal server error')).toBeVisible();
  await expect(page.getByText(/Request ID: \S+/)).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).click();
  await loaded(page);
  await expect(rowOf(page, 'Alice Doe')).toBeVisible();
});
