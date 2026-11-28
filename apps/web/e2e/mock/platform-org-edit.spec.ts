import { expect, test, type Locator, type Page } from '@playwright/test';
import type { PlatformScenario } from '../../src/mocks/msw/platformScenarios';
import { SESSION_MOCK_NOW, seedPlatform } from './mock';

/*
 * Edit organization on the platform org detail (spec 2026-11-23-platform-admin-dashboard-design.md "E2E requirements":
 * TC-52.3, TC-53.1, TC-53.2, TC-54.1 to TC-54.4, TC-55.1 to TC-55.5, TC-56.1, TC-57.1 to TC-57.3, TC-59.1, TC-62.1).
 *
 * Every test seeds the case's platform scenario (mock.ts `seedPlatform`) before its first goto, with a clock fixed at
 * SESSION_MOCK_NOW; the mock store reseeds on every page load, so each test stays in the app after it (clicks, no second
 * goto). `platformOrgEdit` lists "Acme" (slug `acme`) and "Beta" (slug `beta`), both active; `platformOrgEditSuspended`
 * is the same with Acme suspended.
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

const ACME = 'b9100000-0000-4000-8000-000000000001';
const BETA = 'b9100000-0000-4000-8000-000000000002';
const FORMAT_ERROR = 'Use lowercase letters, numbers and dashes, with no dash at the start or end.';
const UPDATED = 'Organization updated';

async function open(page: Page, scenario: PlatformScenario, path: string): Promise<void> {
  await page.clock.install({ time: new Date(SESSION_MOCK_NOW) });
  await seedPlatform(page, scenario);
  await page.goto(path);
}

const dialog = (page: Page, name: string): Locator => page.getByRole('dialog', { name });
const editDialog = (page: Page): Locator => dialog(page, 'Edit organization');
const confirmDialog = (page: Page): Locator => dialog(page, 'Change the organization URL?');
const nameInput = (d: Locator): Locator => d.getByRole('textbox', { name: /^Name/ });
const slugInput = (d: Locator): Locator => d.getByRole('textbox', { name: /^URL/ });
const save = (d: Locator): Locator => d.getByRole('button', { name: 'Save', exact: true });
const toast = (page: Page, text: string): Locator => page.getByRole('status').filter({ hasText: text });
/** The title block of the detail header: the name, its slug and status. */
const header = (page: Page): Locator => page.getByRole('heading', { level: 1 }).locator('xpath=..');
const banner = (page: Page): Locator => page.getByText('This organization is suspended', { exact: true });

/** Open the detail of an org and its Edit dialog. */
async function openEdit(page: Page, id: string, name: string, scenario: PlatformScenario = 'platformOrgEdit') {
  await open(page, scenario, `/platform/orgs/${id}`);
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Edit organization' }).click();
  const d = editDialog(page);
  await expect(d).toBeVisible();
  return d;
}

async function directoryRow(page: Page, name: string): Promise<Locator> {
  await page
    .getByRole('navigation', { name: 'Platform menu' })
    .getByRole('link', { name: /Organizations/ })
    .click();
  const row = page.locator('tbody tr').filter({ hasText: name }).first();
  await expect(row).toBeVisible();
  return row;
}

test.describe('BR-52: a person who is not a platform admin', () => {
  test('TC-52.3: an owner without the platform role sees "You don\'t have access" and no Edit control', async ({
    page,
  }) => {
    await open(page, 'ownerNoPlatform', `/platform/orgs/${ACME}`);

    await expect(page.getByText("You don't have access", { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit organization' })).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe('BR-53: a valid edit', () => {
  test('TC-53.1: a name change saves with no URL confirm, stays on the detail and shows in the header and directory', async ({
    page,
  }) => {
    const d = await openEdit(page, ACME, 'Acme');
    await expect(nameInput(d)).toHaveValue('Acme');
    await expect(slugInput(d)).toHaveValue('acme');
    await expect(save(d)).toBeDisabled();

    await nameInput(d).fill('Acme Inc');
    await expect(save(d)).toBeEnabled();
    await save(d).click();

    await expect(confirmDialog(page)).toHaveCount(0);
    await expect(toast(page, UPDATED)).toBeVisible();
    await expect(d).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/platform/orgs/${ACME}$`));
    await expect(page.getByRole('heading', { name: 'Acme Inc', level: 1 })).toBeVisible();

    const row = await directoryRow(page, 'Acme Inc');
    await expect(row.getByText('Acme Inc', { exact: true })).toBeVisible();
  });

  test('TC-53.2: a URL change saves after the confirm and shows in the header, Overview and directory', async ({
    page,
  }) => {
    const d = await openEdit(page, ACME, 'Acme');

    await slugInput(d).fill('acme-inc');
    await save(d).click();
    await confirmDialog(page).getByRole('button', { name: 'Change URL' }).click();

    await expect(toast(page, UPDATED)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/platform/orgs/${ACME}$`));
    await expect(header(page).getByText('/o/acme-inc', { exact: true })).toBeVisible();
    await expect(page.getByText('/o/acme-inc', { exact: true })).toHaveCount(2);

    const row = await directoryRow(page, 'Acme');
    await expect(row.getByText('/o/acme-inc', { exact: true })).toBeVisible();
  });
});

test.describe('BR-54: the name', () => {
  test('TC-54.1: an empty name shows "Enter a name." at Name, focuses it and changes nothing', async ({ page }) => {
    const d = await openEdit(page, ACME, 'Acme');

    await nameInput(d).fill('');
    await save(d).click();

    await expect(d.getByText('Enter a name.', { exact: true })).toBeVisible();
    await expect(nameInput(d)).toHaveAttribute('aria-invalid', 'true');
    await expect(nameInput(d)).toBeFocused();
    await expect(toast(page, UPDATED)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Acme', level: 1 })).toBeVisible();
  });

  test('TC-54.2: a name of only spaces shows "Enter a name." at Name', async ({ page }) => {
    const d = await openEdit(page, ACME, 'Acme');

    await nameInput(d).fill('     ');
    await save(d).click();

    await expect(d.getByText('Enter a name.', { exact: true })).toBeVisible();
    await expect(toast(page, UPDATED)).toHaveCount(0);
  });

  test('TC-54.3: a 100-character name saves with the toast "Organization updated"', async ({ page }) => {
    const d = await openEdit(page, ACME, 'Acme');

    await nameInput(d).fill('n'.repeat(100));
    await save(d).click();

    await expect(toast(page, UPDATED)).toBeVisible();
    await expect(d).toHaveCount(0);
  });

  test('TC-54.4: a 101-character name shows "Use 100 characters or fewer." at Name and changes nothing', async ({
    page,
  }) => {
    const d = await openEdit(page, ACME, 'Acme');

    await nameInput(d).fill('n'.repeat(101));
    await save(d).click();

    await expect(d.getByText('Use 100 characters or fewer.', { exact: true })).toBeVisible();
    await expect(nameInput(d)).toHaveAttribute('aria-invalid', 'true');
    await expect(toast(page, UPDATED)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Acme', level: 1 })).toBeVisible();
  });
});

test.describe('BR-55: the URL format', () => {
  test('TC-55.1: an upper-case URL shows the format error at URL and changes nothing', async ({ page }) => {
    const d = await openEdit(page, ACME, 'Acme');

    await slugInput(d).fill('Acme');
    await save(d).click();

    await expect(d.getByText(FORMAT_ERROR, { exact: true })).toBeVisible();
    await expect(slugInput(d)).toHaveAttribute('aria-invalid', 'true');
    await expect(confirmDialog(page)).toHaveCount(0);
    await expect(toast(page, UPDATED)).toHaveCount(0);
  });

  test('TC-55.2: a leading dash, a trailing dash and an underscore each show the same error', async ({ page }) => {
    const d = await openEdit(page, ACME, 'Acme');

    for (const value of ['-acme', 'acme-', 'ac_me']) {
      await slugInput(d).fill(value);
      await save(d).click();
      await expect(d.getByText(FORMAT_ERROR, { exact: true })).toBeVisible();
      await expect(slugInput(d)).toHaveAttribute('aria-invalid', 'true');
      await expect(confirmDialog(page)).toHaveCount(0);
    }
    await expect(toast(page, UPDATED)).toHaveCount(0);
  });

  test('TC-55.3: an empty URL shows the format error at URL', async ({ page }) => {
    const d = await openEdit(page, ACME, 'Acme');

    await slugInput(d).fill('');
    await save(d).click();

    await expect(d.getByText(FORMAT_ERROR, { exact: true })).toBeVisible();
    await expect(toast(page, UPDATED)).toHaveCount(0);
  });

  test('TC-55.4: a 63-character URL saves after the confirm', async ({ page }) => {
    const d = await openEdit(page, ACME, 'Acme');
    const slug = 's'.repeat(63);

    await slugInput(d).fill(slug);
    await save(d).click();
    await confirmDialog(page).getByRole('button', { name: 'Change URL' }).click();

    await expect(toast(page, UPDATED)).toBeVisible();
    await expect(header(page).getByText(`/o/${slug}`, { exact: true })).toBeVisible();
  });

  test('TC-55.5: a 64-character URL shows the format error at URL and changes nothing', async ({ page }) => {
    const d = await openEdit(page, ACME, 'Acme');

    await slugInput(d).fill('s'.repeat(64));
    await save(d).click();

    await expect(d.getByText(FORMAT_ERROR, { exact: true })).toBeVisible();
    await expect(confirmDialog(page)).toHaveCount(0);
    await expect(toast(page, UPDATED)).toHaveCount(0);
    await expect(header(page).getByText('/o/acme', { exact: true })).toBeVisible();
  });
});

test.describe('BR-56: a taken URL', () => {
  test('TC-56.1: Beta to the URL "acme" shows "This URL is taken. Try another." at URL and keeps the input', async ({
    page,
  }) => {
    const d = await openEdit(page, BETA, 'Beta');

    await slugInput(d).fill('acme');
    await save(d).click();
    await confirmDialog(page).getByRole('button', { name: 'Change URL' }).click();

    await expect(editDialog(page).getByText('This URL is taken. Try another.', { exact: true })).toBeVisible();
    await expect(slugInput(editDialog(page))).toHaveValue('acme');
    await expect(toast(page, UPDATED)).toHaveCount(0);
    await editDialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(header(page).getByText('/o/beta', { exact: true })).toBeVisible();
  });
});

test.describe('BR-57: the URL change confirm', () => {
  test('TC-57.1: a changed URL asks first, naming the old and the new URL', async ({ page }) => {
    const d = await openEdit(page, ACME, 'Acme');

    await slugInput(d).fill('acme-inc');
    await save(d).click();

    const c = confirmDialog(page);
    await expect(c).toBeVisible();
    await expect(c.locator('p')).toHaveText(
      '/o/acme becomes /o/acme-inc. Links that use /o/acme will show "not found". Share the new link with its members.',
    );
    await expect(c.getByRole('button', { name: 'Change URL' })).toBeVisible();
  });

  test('TC-57.2: Cancel returns to the edit dialog with the input kept; nothing is saved', async ({ page }) => {
    const d = await openEdit(page, ACME, 'Acme');
    await slugInput(d).fill('acme-inc');
    await save(d).click();
    await confirmDialog(page).getByRole('button', { name: 'Cancel' }).click();

    await expect(confirmDialog(page)).toHaveCount(0);
    await expect(editDialog(page)).toBeVisible();
    await expect(slugInput(editDialog(page))).toHaveValue('acme-inc');
    await expect(toast(page, UPDATED)).toHaveCount(0);

    await editDialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(editDialog(page)).toHaveCount(0);
    await expect(header(page).getByText('/o/acme', { exact: true })).toBeVisible();
    const row = await directoryRow(page, 'Acme');
    await expect(row.getByText('/o/acme', { exact: true })).toBeVisible();
  });

  test('TC-57.3: a name-only change shows no confirm', async ({ page }) => {
    const d = await openEdit(page, ACME, 'Acme');

    await nameInput(d).fill('Acme Two');
    await save(d).click();

    await expect(toast(page, UPDATED)).toBeVisible();
    await expect(confirmDialog(page)).toHaveCount(0);
  });
});

test.describe('BR-59: equal values', () => {
  test('TC-59.1: typing a character into Name and deleting it leaves Save disabled and sends no PATCH', async ({
    page,
  }) => {
    const patches: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'PATCH') patches.push(request.url());
    });
    const d = await openEdit(page, ACME, 'Acme');

    await nameInput(d).pressSequentially('x');
    await expect(save(d)).toBeEnabled();
    await nameInput(d).press('Backspace');

    await expect(nameInput(d)).toHaveValue('Acme');
    await expect(save(d)).toBeDisabled();
    expect(patches).toEqual([]);
  });
});

test.describe('BR-62: an edit on a suspended org', () => {
  test('TC-62.1: the new name shows in the header and the org stays Suspended with its banner', async ({ page }) => {
    const d = await openEdit(page, ACME, 'Acme', 'platformOrgEditSuspended');
    await expect(header(page).getByText('Suspended', { exact: true })).toBeVisible();

    await nameInput(d).fill('Acme Renamed');
    await save(d).click();

    await expect(toast(page, UPDATED)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Acme Renamed', level: 1 })).toBeVisible();
    await expect(header(page).getByText('Suspended', { exact: true })).toBeVisible();
    await expect(banner(page)).toBeVisible();
  });
});
