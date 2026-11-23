import { expect, test, type Locator, type Page } from '@playwright/test';
import { INVOICER_API, ORG, seedProjectSpace } from './mock';

/*
 * Project admin space: Invite people, Change role and Remove on the project Settings → Members page. Cases come from
 * the spec docs/superpowers/specs/2026-11-23-rbac-project-admin-space-design.md (E2E requirements, BR-6, BR-12, BR-13).
 *
 * Every test seeds its role and scenario before the first goto (the mock store reseeds on each page load). The org is
 * Alice; P is invoicer-api. P's people are Lee Park (Admin), Cleo Martin (Member), Dana Wu (Viewer) and others.
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

const P = INVOICER_API;
const membersUrl = `/o/${ORG}/p/${P}/desk/members`;
const rowOf = (page: Page, name: string): Locator => page.getByRole('row').filter({ hasText: name });
const heading = (page: Page) => page.getByRole('heading', { level: 1, name: 'Members' });

async function openMembers(page: Page): Promise<void> {
  await page.goto(membersUrl);
  await expect(heading(page)).toBeVisible();
  await expect(rowOf(page, 'Cleo Martin')).toBeVisible();
}

async function openChangeRole(page: Page, name: string): Promise<Locator> {
  await rowOf(page, name)
    .getByRole('button', { name: `Actions for ${name}` })
    .click();
  await page.getByRole('button', { name: 'Change role' }).click();
  const dialog = page.getByRole('dialog', { name: `Change role for ${name}` });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openRemove(page: Page, name: string): Promise<Locator> {
  await rowOf(page, name)
    .getByRole('button', { name: `Actions for ${name}` })
    .click();
  await page.getByRole('button', { name: 'Remove from project' }).click();
  const dialog = page.getByRole('dialog', { name: /^Remove .+ from .+\?$/ });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openInvite(page: Page): Promise<Locator> {
  await openMembers(page);
  await page.getByRole('button', { name: 'Invite people' }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite people' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('option', { name: 'Member' })).toBeAttached();
  return dialog;
}

/** The other rows keep their roles. */
async function expectOthersUnchanged(page: Page): Promise<void> {
  await expect(rowOf(page, 'Lee Park')).toContainText('Admin');
  await expect(rowOf(page, 'Dana Wu')).toContainText('Viewer');
}

test.describe('BR-6: Owner is never offered in Change role', () => {
  test('TC-6.2: Change role offers Admin, Member and Viewer, the current one preselected, no Owner, no "No role"', async ({
    page,
  }) => {
    await seedProjectSpace(page, { role: 'projectAdmin' });
    await openMembers(page);
    const dialog = await openChangeRole(page, 'Cleo Martin');
    const cards = dialog.getByRole('radio');
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toHaveAccessibleName(/^Admin/);
    await expect(cards.nth(1)).toHaveAccessibleName(/^Member/);
    await expect(cards.nth(2)).toHaveAccessibleName(/^Viewer/);
    await expect(cards.nth(1)).toBeChecked();
    await expect(cards.nth(0)).not.toBeChecked();
    await expect(cards.nth(2)).not.toBeChecked();
    await expect(dialog.getByRole('radio', { name: /^Owner/ })).toHaveCount(0);
    await expect(dialog.getByText('No role')).toHaveCount(0);
  });
});

test.describe('BR-12: person gone or role changed meanwhile (Change role, Remove)', () => {
  test('TC-12.3: Change role on a person whose role was removed closes the dialog, toasts, refetches', async ({
    page,
  }) => {
    await seedProjectSpace(page, { role: 'projectAdmin', scenario: 'roleRemovedMeanwhile' });
    await openMembers(page);
    const dialog = await openChangeRole(page, 'Cleo Martin');
    await dialog.getByRole('radio', { name: /^Viewer/ }).click();
    await dialog.getByRole('button', { name: 'Save role' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Member is no longer on this project')).toBeVisible();
    // The list refetched: the person is gone, no other row changed.
    await expect(rowOf(page, 'Cleo Martin')).toHaveCount(0);
    await expectOthersUnchanged(page);
  });

  test('TC-12.4: Remove on a person whose role was removed toasts the error and refetches', async ({ page }) => {
    await seedProjectSpace(page, { role: 'projectAdmin', scenario: 'roleRemovedMeanwhile' });
    await openMembers(page);
    const dialog = await openRemove(page, 'Cleo Martin');
    await dialog.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('Member is no longer on this project')).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(rowOf(page, 'Cleo Martin')).toHaveCount(0);
    await expectOthersUnchanged(page);
  });

  test('TC-12.5: Change role without a scenario succeeds with "Role changed" and shows the saved role', async ({
    page,
  }) => {
    await seedProjectSpace(page, { role: 'projectAdmin' });
    await openMembers(page);
    const dialog = await openChangeRole(page, 'Cleo Martin');
    await dialog.getByRole('radio', { name: /^Viewer/ }).click();
    await dialog.getByRole('button', { name: 'Save role' }).click();
    await expect(page.getByText('Role changed')).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(rowOf(page, 'Cleo Martin')).toContainText('Viewer');
    await expect(rowOf(page, 'Cleo Martin')).not.toContainText('Member');
    await expect(page.getByText('Member is no longer on this project')).toHaveCount(0);
    await expectOthersUnchanged(page);
  });
});

test.describe('BR-13: Invite people from Members', () => {
  test('TC-13.1: the dialog opens with Email empty, three roles and this project as the only project', async ({
    page,
  }) => {
    await seedProjectSpace(page, { role: 'projectAdmin' });
    const dialog = await openInvite(page);
    await expect(dialog.getByRole('textbox', { name: 'Email' })).toHaveValue('');
    const select = dialog.getByRole('combobox', { name: 'Role' });
    await expect(select).toHaveValue('');
    // The placeholder "Choose a role" is the selected, hidden option; the listed options are the three roles.
    await expect(select.locator('option:checked')).toHaveText('Choose a role');
    await expect(select.getByRole('option')).toHaveText(['Admin', 'Member', 'Viewer']);
    await expect(dialog.getByText('Some projects')).toBeVisible();
    await expect(dialog.getByRole('radio', { name: 'Whole organization' })).toHaveCount(0);
    const boxes = dialog.getByRole('checkbox');
    await expect(boxes).toHaveCount(1);
    await expect(boxes.first()).toBeChecked();
    await expect(boxes.first()).toHaveAccessibleName('invoicer-api');
  });

  test('TC-13.2: Create invitation shows the copy link and Done closes the dialog back on Members', async ({
    page,
  }) => {
    await seedProjectSpace(page, { role: 'projectAdmin' });
    const dialog = await openInvite(page);
    await dialog.getByRole('textbox', { name: 'Email' }).fill('new.person@dev.local');
    await dialog.getByRole('combobox', { name: 'Role' }).selectOption({ label: 'Member' });
    await dialog.getByRole('button', { name: 'Create invitation' }).click();
    const created = page.getByRole('dialog', { name: 'Invitation created' });
    await expect(created).toBeVisible();
    await expect(created.getByTitle(/\/invitations\/.+/)).toBeVisible();
    await created.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(heading(page)).toBeVisible();
  });

  test('TC-13.3: closing the dialog without creating leaves Members unchanged', async ({ page }) => {
    await seedProjectSpace(page, { role: 'projectAdmin' });
    const dialog = await openInvite(page);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(heading(page)).toBeVisible();
    await expect(rowOf(page, 'Cleo Martin')).toContainText('Member');
    await expectOthersUnchanged(page);
    await expect(page.getByRole('dialog', { name: 'Invitation created' })).toHaveCount(0);
  });
});
