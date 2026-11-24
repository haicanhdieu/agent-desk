import { expect, test, type Locator, type Page } from '@playwright/test';
import type { TenantAdminScenario } from '../../src/mocks/msw/tenantAdminScenarios';
import { ORG, seedTenantAdmin } from './mock';

/*
 * The org Members page, access by scope (issue #259): every grant of a member as a chip (`Organization · Admin`,
 * `<project> · Member`), and the Change access dialog that edits the org role and the project grants. Roster from
 * src/mocks/dto/access.ts: Alice Doe (the signed-in user), Priya Raman (owner), Ben Okafor (admin), Cleo Martin (Member
 * with Admin on invoicer-api and Member on invoicer-web), Eli Ford (no org role, Viewer on docs-site).
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

const MEMBERS = `/o/${ORG}/settings/members`;

async function open(page: Page, scenario: TenantAdminScenario): Promise<void> {
  await seedTenantAdmin(page, scenario);
  await page.goto(MEMBERS);
}

const rowOf = (page: Page, name: string): Locator => page.getByRole('row').filter({ hasText: name });
const chips = (page: Page, name: string): Locator => rowOf(page, name).getByRole('listitem');
const dialog = (page: Page, name: string): Locator => page.getByRole('dialog', { name: `Change access for ${name}` });
const projectRow = (d: Locator, project: string): Locator => d.getByRole('listitem', { name: project });

async function openChangeAccess(page: Page, name: string): Promise<Locator> {
  await page.getByRole('button', { name: `Actions for ${name}` }).click();
  await page.getByRole('button', { name: 'Change access', exact: true }).click();
  const d = dialog(page, name);
  await expect(d).toBeVisible();
  return d;
}

test('AC-1: the list shows every grant with its scope, and No role when there is no org grant', async ({ page }) => {
  await open(page, 'twoOwners');
  await expect(page.getByRole('columnheader')).toHaveText(['Name', 'Access', 'Actions']);
  await expect(chips(page, 'Cleo Martin')).toHaveText([
    'Organization · Member',
    'invoicer-api · Admin',
    'invoicer-web · Member',
  ]);
  await expect(chips(page, 'Eli Ford')).toHaveText(['No role', 'docs-site · Viewer']);
  await expect(chips(page, 'Priya Raman')).toHaveText(['Organization · Owner']);
  // no chip is cut off: each one is fully inside the table cell
  for (const chip of await chips(page, 'Cleo Martin').all()) await expect(chip).toBeInViewport();
});

test('AC-2: Change access shows the org role, each project grant and Add project; Save is off until something changed', async ({
  page,
}) => {
  await open(page, 'twoOwners');
  const d = await openChangeAccess(page, 'Cleo Martin');
  await expect(d.getByRole('radio', { name: /^Member/ })).toBeChecked();
  await expect(projectRow(d, 'invoicer-api').getByRole('combobox', { name: 'Role in invoicer-api' })).toHaveValue(/.+/);
  await expect(projectRow(d, 'invoicer-web')).toBeVisible();
  const projectRoles = d.getByRole('combobox', { name: 'Role in the project to add' }).getByRole('option');
  await expect(projectRoles).toHaveText(['Admin', 'Member', 'Viewer']); // never Owner on a project
  const save = d.getByRole('button', { name: 'Save access' });
  await expect(save).toBeDisabled();
  await projectRow(d, 'invoicer-web').getByRole('button', { name: 'Remove access to invoicer-web' }).click();
  await expect(save).toBeEnabled();
});

test('AC-2 and AC-8: changing, adding and removing project grants saves them and the list shows the result', async ({
  page,
}) => {
  await open(page, 'twoOwners');
  const d = await openChangeAccess(page, 'Cleo Martin');
  await projectRow(d, 'invoicer-web')
    .getByRole('combobox', { name: 'Role in invoicer-web' })
    .selectOption({ label: 'Viewer' });
  await projectRow(d, 'invoicer-api').getByRole('button', { name: 'Remove access to invoicer-api' }).click();
  await d.getByRole('combobox', { name: 'Project to add' }).selectOption({ label: 'docs-site' });
  await d.getByRole('combobox', { name: 'Role in the project to add' }).selectOption({ label: 'Admin' });
  await d.getByRole('button', { name: 'Add project' }).click();
  await expect(projectRow(d, 'docs-site')).toBeVisible();
  await d.getByRole('button', { name: 'Save access' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Access changed' })).toBeVisible();
  await expect(d).toHaveCount(0);
  await expect(chips(page, 'Cleo Martin')).toHaveText([
    'Organization · Member',
    'docs-site · Admin',
    'invoicer-web · Viewer',
  ]);
});

test('AC-3: an org admin may change project grants too, and has no actions on an owner row', async ({ page }) => {
  await open(page, 'admin');
  await expect(page.getByRole('button', { name: 'Actions for Priya Raman' })).toHaveCount(0);
  const d = await openChangeAccess(page, 'Cleo Martin');
  await expect(d.getByRole('radio', { name: /^Owner/ })).toHaveCount(0); // an admin never grants Owner
  await projectRow(d, 'invoicer-web').getByRole('button', { name: 'Remove access to invoicer-web' }).click();
  await d.getByRole('button', { name: 'Save access' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Access changed' })).toBeVisible();
  await expect(chips(page, 'Cleo Martin')).toHaveText(['Organization · Member', 'invoicer-api · Admin']);
});

for (const scenario of ['member', 'viewer'] as const) {
  test(`AC-4: a ${scenario} sees no Members page, so no Change access`, async ({ page }) => {
    await open(page, scenario);
    await expect(page.getByText("You don't have access")).toBeVisible();
    await expect(page.getByRole('button', { name: /^Actions for / })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Change access', exact: true })).toHaveCount(0);
  });
}
