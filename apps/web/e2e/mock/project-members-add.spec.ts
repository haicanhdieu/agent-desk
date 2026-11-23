import { expect, test, type Locator, type Page } from '@playwright/test';
import { INVOICER_API, ORG, seedProjectSpace } from './mock';

/*
 * Project admin space: the Add member dialog and its Person picker. Cases come from the spec
 * docs/superpowers/specs/2026-11-23-rbac-project-admin-space-design.md (E2E requirements, BR-6, BR-7, BR-12).
 *
 * Every test seeds its role and scenario before the first goto (the mock store reseeds on each page load). The org is
 * Alice; P is invoicer-api. Without a scenario the picker offers 8 eligible people (Person 04 is the first with a
 * handle after the two named for LIKE wildcards); `pickerMany` offers 45.
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

const P = INVOICER_API;
const membersUrl = `/o/${ORG}/p/${P}/desk/members`;
const dialog = (page: Page) => page.getByRole('dialog', { name: /^Add member to/ });
const combobox = (page: Page) => dialog(page).getByRole('combobox', { name: 'Person' });
const options = (page: Page) => page.getByRole('option');
const roleGroup = (page: Page) => dialog(page).getByRole('radiogroup', { name: 'Role' });
const rowOf = (page: Page, name: string): Locator => page.getByRole('row').filter({ hasText: name });

async function openAdd(page: Page): Promise<void> {
  await page.goto(membersUrl);
  await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
  await page.getByRole('button', { name: 'Add member' }).first().click();
  await expect(dialog(page)).toBeVisible();
}

/** Opens the Person list and picks the option whose name contains `name`. */
async function pickPerson(page: Page, name: string): Promise<void> {
  await combobox(page).click();
  await options(page).filter({ hasText: name }).first().click();
}

/** Records the page and search text of every picker read (`members.list`) the page sends from now on. */
function watchPicker(page: Page): { page: string | null; q: string | null }[] {
  const seen: { page: string | null; q: string | null }[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (req.method() === 'GET' && /^\/api\/orgs\/[^/]+\/members$/.test(url.pathname)) {
      seen.push({ page: url.searchParams.get('page'), q: url.searchParams.get('q') });
    }
  });
  return seen;
}

/** The scrollable box around the picker's list. */
const scrollToEnd = (page: Page) =>
  page.getByRole('listbox', { name: 'People' }).evaluate((list) => {
    const box = list.parentElement;
    if (box) box.scrollTop = box.scrollHeight;
  });

test.describe('BR-6: Owner is never offered', () => {
  test('TC-6.1: the Role group offers Admin, Member and Viewer, none preselected, no Owner', async ({ page }) => {
    await seedProjectSpace(page, { role: 'projectAdmin' });
    await openAdd(page);
    const cards = roleGroup(page).getByRole('radio');
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toHaveAccessibleName(/^Admin/);
    await expect(cards.nth(1)).toHaveAccessibleName(/^Member/);
    await expect(cards.nth(2)).toHaveAccessibleName(/^Viewer/);
    for (const card of await cards.all()) await expect(card).not.toBeChecked();
    await expect(roleGroup(page).getByRole('radio', { name: /^Owner/ })).toHaveCount(0);
  });
});

test.describe('BR-7: the Person picker and the field errors', () => {
  test('TC-7.1: the first request has no search text; only people without a role on P are offered', async ({
    page,
  }) => {
    await seedProjectSpace(page, { role: 'projectAdmin' });
    const seen = watchPicker(page);
    await openAdd(page);
    await combobox(page).focus();
    await expect(options(page).filter({ hasText: 'Person 04' })).toBeVisible();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.q).toBeNull();
    // Each option shows name and handle.
    await expect(options(page)).toHaveCount(8);
    for (const option of await options(page).all()) {
      // Person 03 is the one fixture person without a handle.
      const text = (await option.textContent()) ?? '';
      if (!text.startsWith('Person 03')) expect(text).toMatch(/person\d+$/);
    }
    // People who already hold a role on P are absent.
    for (const name of ['Lee Park', 'Cleo Martin', 'Dana Wu', 'Ben Okafor', 'Noor Haddad']) {
      await expect(options(page).filter({ hasText: name })).toHaveCount(0);
    }
  });

  test('TC-7.2: typing a name, then a handle in other letter case, narrows the list; Searching… shows', async ({
    page,
  }) => {
    await seedProjectSpace(page, { role: 'projectAdmin' });
    await openAdd(page);
    await combobox(page).focus();
    await expect(options(page).filter({ hasText: 'Person 04' })).toBeVisible();

    await combobox(page).fill('Person 04');
    await expect(dialog(page).getByRole('status')).toHaveText('Searching…');
    await expect(options(page)).toHaveCount(1);
    await expect(options(page).first()).toContainText('Person 04');

    await combobox(page).fill('');
    await combobox(page).fill('PERSON5');
    await expect(dialog(page).getByRole('status')).toHaveText('Searching…');
    await expect(options(page)).toHaveCount(1);
    await expect(options(page).first()).toContainText('Person 05');
    await expect(options(page).first()).toContainText('person5');
  });

  test('TC-7.3: a text no eligible person matches shows No member matches', async ({ page }) => {
    await seedProjectSpace(page, { role: 'projectAdmin' });
    await openAdd(page);
    await combobox(page).fill('zzz-nobody');
    await expect(dialog(page).getByText('No member matches "zzz-nobody".')).toBeVisible();
    await expect(options(page)).toHaveCount(0);
  });

  test('TC-7.4: when everyone already has a role on P the picker says so', async ({ page }) => {
    await seedProjectSpace(page, { role: 'projectAdmin' });
    // Setup through the product: give each of the 8 eligible people a role on P, so no one is left to offer.
    await openAdd(page);
    for (let i = 0; i < 8; i += 1) {
      await combobox(page).click();
      await options(page).first().click();
      await roleGroup(page)
        .getByRole('radio', { name: /^Viewer/ })
        .check({ force: true });
      await dialog(page).getByRole('button', { name: 'Add member' }).click();
      await expect(dialog(page)).toHaveCount(0);
      await page.getByRole('button', { name: 'Add member' }).first().click();
      await expect(dialog(page)).toBeVisible();
    }
    await combobox(page).click();
    await expect(dialog(page).getByText('Everyone in Alice already has a role here.')).toBeVisible();
    await expect(options(page)).toHaveCount(0);
  });

  test('TC-7.5: scrolling to the end loads the next pages; the DOM holds fewer options than loaded', async ({
    page,
  }) => {
    await seedProjectSpace(page, { role: 'projectAdmin', scenario: 'pickerMany' });
    const seen = watchPicker(page);
    await openAdd(page);
    await combobox(page).click();
    await expect(options(page).first()).toBeVisible();
    expect(seen.map((r) => r.page)).not.toContain('2');

    await scrollToEnd(page);
    await expect.poll(() => seen.map((r) => r.page)).toContain('2');
    // More options appear: page 2 is rendered and announced before the next scroll.
    await expect(dialog(page).getByRole('status')).toHaveText('20 more people loaded');
    expect(seen.map((r) => r.page)).not.toContain('3');

    await scrollToEnd(page);
    await expect.poll(() => seen.map((r) => r.page)).toContain('3');
    // 45 people are loaded in total: the last page holds 5.
    await expect(dialog(page).getByRole('status')).toHaveText('5 more people loaded');
    await expect(options(page).first()).toHaveAttribute('aria-setsize', '45');
    const rendered = await page.locator('[role="option"][aria-setsize]').count();
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(45);
    for (const option of await page.locator('[role="option"][aria-setsize]').all()) {
      await expect(option).toHaveAttribute('aria-setsize', '45');
    }
  });

  test('TC-7.6: Load more people by keyboard loads the next page, announces it and keeps the list usable', async ({
    page,
  }) => {
    await seedProjectSpace(page, { role: 'projectAdmin', scenario: 'pickerMany' });
    await openAdd(page);
    await combobox(page).click();
    await expect(options(page).first()).toBeVisible();
    // End goes to the last person, ArrowDown to the "Load more people" option.
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowDown');
    await expect(options(page).filter({ hasText: 'Load more people' })).toHaveAttribute('data-active', 'true');
    await page.keyboard.press('Enter');
    await expect(dialog(page).getByRole('status')).toHaveText('20 more people loaded');
    // The list stays usable: ArrowDown moves on and Enter picks that person.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(combobox(page)).toHaveValue(/\(person\d+\)$|^Person \d+$/);
  });

  test('TC-7.7: typing % and then _ matches only the people holding that literal character', async ({ page }) => {
    await seedProjectSpace(page, { role: 'projectAdmin', scenario: 'pickerMany' });
    await openAdd(page);
    await combobox(page).fill('%');
    await expect(options(page)).toHaveCount(1);
    await expect(options(page).first()).toContainText('100% Reliable Rae');
    await combobox(page).fill('_');
    await expect(options(page)).toHaveCount(1);
    await expect(options(page).first()).toContainText('Under_score Uma');
  });

  test('TC-7.8: pasting 101 characters keeps 100', async ({ page }) => {
    await seedProjectSpace(page, { role: 'projectAdmin' });
    await openAdd(page);
    await combobox(page).fill('a'.repeat(101));
    await expect(combobox(page)).toHaveValue('a'.repeat(100));
  });

  test('TC-7.9: an empty submit shows both field errors, adds nothing and keeps the dialog open', async ({ page }) => {
    await seedProjectSpace(page, { role: 'projectAdmin' });
    await openAdd(page);
    await dialog(page).getByRole('button', { name: 'Add member' }).click();
    await expect(dialog(page).getByText('Choose a person.')).toBeVisible();
    await expect(dialog(page).getByText('Choose a role.')).toBeVisible();
    await expect(dialog(page)).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator('tbody tr')).toHaveCount(6);
  });

  test('TC-7.10: a person without a role shows only Choose a role and keeps the person picked', async ({ page }) => {
    await seedProjectSpace(page, { role: 'projectAdmin' });
    await openAdd(page);
    await pickPerson(page, 'Person 04');
    await dialog(page).getByRole('button', { name: 'Add member' }).click();
    await expect(dialog(page).getByText('Choose a role.')).toBeVisible();
    await expect(dialog(page).getByText('Choose a person.')).toHaveCount(0);
    await expect(combobox(page)).toHaveValue('Person 04 (person4)');
  });

  test('TC-7.11: a role without a person shows only Choose a person and keeps the role picked', async ({ page }) => {
    await seedProjectSpace(page, { role: 'projectAdmin' });
    await openAdd(page);
    await roleGroup(page)
      .getByRole('radio', { name: /^Viewer/ })
      .check({ force: true });
    await dialog(page).getByRole('button', { name: 'Add member' }).click();
    await expect(dialog(page).getByText('Choose a person.')).toBeVisible();
    await expect(dialog(page).getByText('Choose a role.')).toHaveCount(0);
    await expect(roleGroup(page).getByRole('radio', { name: /^Viewer/ })).toBeChecked();
  });
});

test.describe('BR-12: a person gone or changed while the dialog is open', () => {
  test('TC-12.1: a person who left the org gives a field error, a refreshed picker and no new row', async ({
    page,
  }) => {
    await seedProjectSpace(page, { role: 'projectAdmin', scenario: 'goneFromOrg' });
    const seen = watchPicker(page);
    await openAdd(page);
    await pickPerson(page, 'Reliable Rae');
    await roleGroup(page)
      .getByRole('radio', { name: /^Member/ })
      .check({ force: true });
    const reads = seen.length;
    await dialog(page).getByRole('button', { name: 'Add member' }).click();
    // The error belongs to the Person field, not to a banner or the Role group.
    await expect(combobox(page)).toHaveAccessibleDescription(/This person is no longer in the organization\./);
    await expect(combobox(page)).toHaveAttribute('aria-invalid', 'true');
    await expect.poll(() => seen.length).toBeGreaterThan(reads);
    await combobox(page).click();
    await expect(options(page).filter({ hasText: 'Person 04' })).toBeVisible();
    await expect(options(page).filter({ hasText: 'Reliable Rae' })).toHaveCount(0);
    await expect(page.getByText(/added as/)).toHaveCount(0);
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(rowOf(page, 'Reliable Rae')).toHaveCount(0);
    await expect(page.locator('tbody tr')).toHaveCount(6);
  });

  test('TC-12.2: a person who got a role meanwhile gives the 409 banner, clears the person and keeps the role', async ({
    page,
  }) => {
    await seedProjectSpace(page, { role: 'projectAdmin', scenario: 'roleAddedMeanwhile' });
    const seen = watchPicker(page);
    await openAdd(page);
    await pickPerson(page, 'Reliable Rae');
    await roleGroup(page)
      .getByRole('radio', { name: /^Viewer/ })
      .check({ force: true });
    const reads = seen.length;
    await dialog(page).getByRole('button', { name: 'Add member' }).click();
    await expect(dialog(page).getByText('This person already has a role on this project.')).toBeVisible();
    await expect(dialog(page).getByText('Use Change role to change it.')).toBeVisible();
    await expect(combobox(page)).toHaveValue('');
    await expect(roleGroup(page).getByRole('radio', { name: /^Viewer/ })).toBeChecked();
    await expect(dialog(page)).toBeVisible();
    await expect.poll(() => seen.length).toBeGreaterThan(reads);
    await combobox(page).click();
    await expect(options(page).filter({ hasText: 'Reliable Rae' })).toHaveCount(0);
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    // The list shows the role the other person gave, once; nothing of ours was written.
    await expect(rowOf(page, 'Reliable Rae')).toHaveCount(1);
    await expect(rowOf(page, 'Reliable Rae')).toContainText('Member');
    await expect(rowOf(page, 'Reliable Rae')).not.toContainText('Viewer');
  });
});
