import { expect, test, type Locator, type Page } from '@playwright/test';
import type { MockLists } from '../../src/mocks/msw/e2eLists';
import type { PlatformScenario } from '../../src/mocks/msw/platformScenarios';
import { SESSION_MOCK_NOW, seedLists, seedPlatform } from './mock';

/*
 * The Organizations directory (spec 2026-11-23-platform-admin-dashboard-design.md "E2E requirements": TC-4.4 to TC-4.6,
 * TC-18.1, TC-18.3, TC-19.1, TC-20.1 to TC-20.5, TC-21.1, TC-22.1 to TC-22.4).
 *
 * Every test seeds the case's platform scenario (mock.ts `seedPlatform`) before its first goto, with a clock fixed at
 * SESSION_MOCK_NOW. `platformAdminOrgs` lists six orgs, newest first: Quiet Works (no run, owner Quinn Quiet), Ownerless
 * Co (no owner), Beta (slug `beta-labs`, owner Bea Tester), Acme (slug `acme`, owner Alice Acme), Orbit Systems
 * (suspended) and a long-named one. `manyOrgs` lists 45 orgs "Many Org 01" (oldest) to "Many Org 45" (newest), three
 * pages of 20. Search is debounced, so URL and rows are asserted with web-first assertions, never a sleep.
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

const ORGS = '/platform/orgs';

async function open(
  page: Page,
  scenario: PlatformScenario = 'platformAdminOrgs',
  opts: { path?: string; lists?: MockLists } = {},
): Promise<void> {
  await page.clock.install({ time: new Date(SESSION_MOCK_NOW) });
  await seedPlatform(page, scenario);
  if (opts.lists) await seedLists(page, opts.lists);
  await page.goto(opts.path ?? ORGS);
}

const heading = (page: Page): Locator => page.getByRole('heading', { name: 'Organizations', level: 1 });
const bodyRows = (page: Page): Locator => page.locator('tbody tr');
const rowOf = (page: Page, text: string): Locator => bodyRows(page).filter({ hasText: text });
const loading = (page: Page): Locator => page.getByRole('status', { name: 'Loading' });
const nav = (page: Page): Locator => page.getByRole('navigation', { name: 'Pagination' });
const searchBox = (page: Page): Locator => page.getByLabel('Search organizations');
const statusSelect = (page: Page): Locator => page.getByRole('combobox', { name: 'Status' });

async function loaded(page: Page): Promise<void> {
  await expect(heading(page)).toBeVisible();
  await expect(bodyRows(page).first()).toBeVisible();
}

test.describe('BR-4: loading, empty and failing directory', () => {
  test('TC-4.4: skeleton rows show while the organizations list is pending, then the table', async ({ page }) => {
    await open(page, 'platformAdminOrgs', { lists: { hold: [{ route: 'platform.listOrgs', ms: 3000 }] } });

    await expect(loading(page)).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByText('No organizations yet')).toHaveCount(0);

    await loaded(page);
    await expect(loading(page)).toHaveCount(0);
    await expect(page.getByRole('table')).toBeVisible();
  });

  test('TC-4.5: no organizations shows "No organizations yet" with "Create one to invite its first owner."', async ({
    page,
  }) => {
    await open(page, 'platformEmpty');

    await expect(page.getByText('No organizations yet', { exact: true })).toBeVisible();
    await expect(page.getByText('Create one to invite its first owner.', { exact: true })).toBeVisible();
    await expect(bodyRows(page)).toHaveCount(0);
  });

  test('TC-4.6: a failing list shows the problem, the request id and Retry, and Retry shows the list', async ({
    page,
  }) => {
    // Three failures cover the first load and Query's two retries; the next request succeeds.
    await open(page, 'platformAdminOrgs', { lists: { fail: [{ route: 'platform.listOrgs', times: 3 }] } });

    await expect(page.getByText('Internal server error')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Request ID: \S+/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();

    await page.getByRole('button', { name: 'Retry' }).click();

    await loaded(page);
    await expect(bodyRows(page)).toHaveCount(6);
  });
});

test.describe('BR-18: the organizations list', () => {
  test('TC-18.1: the columns, the name link with its /o/<slug>, and the newest org first', async ({ page }) => {
    await open(page);
    await loaded(page);

    await expect(page.getByRole('columnheader')).toHaveText([
      'Organization',
      'Owner',
      'Members',
      'Projects',
      'Last activity',
      'Status',
      'Created',
    ]);
    const acme = rowOf(page, 'Acme').first();
    await expect(acme.getByRole('link', { name: 'Acme', exact: true })).toHaveAttribute(
      'href',
      /^\/platform\/orgs\/[^/]+$/,
    );
    await expect(acme.getByText('/o/acme', { exact: true })).toBeVisible();
    await expect(bodyRows(page)).toHaveCount(6);
    // Newest first: created 25 Oct, 20 Oct, 15 Sep, 1 Sep, 10 Aug, 4 Jul.
    await expect(bodyRows(page)).toContainText([
      'Quiet Works',
      'Ownerless Co',
      'Beta',
      'Acme',
      'Orbit Systems',
      'The International Association',
    ]);
  });

  test('TC-18.3: page 2 shows the next, older orgs and the URL holds ?page=2', async ({ page }) => {
    await open(page, 'manyOrgs');
    await loaded(page);
    await expect(bodyRows(page)).toHaveCount(20);
    await expect(bodyRows(page).first()).toContainText('Many Org 45');
    await expect(bodyRows(page).last()).toContainText('Many Org 26');

    await nav(page).getByRole('button', { name: 'Next', exact: true }).click();

    await expect(page).toHaveURL(/[?&]page=2(&|$)/);
    await expect(bodyRows(page).first()).toContainText('Many Org 25');
    await expect(bodyRows(page)).toHaveCount(20);
    await expect(bodyRows(page).last()).toContainText('Many Org 06');
  });
});

test.describe('BR-19: owner and last activity cells', () => {
  test('TC-19.1: "No owner yet", the first owner only, "No activity yet" and a relative time', async ({ page }) => {
    await open(page);
    await loaded(page);

    const ownerless = rowOf(page, 'Ownerless Co');
    await expect(ownerless.getByText('No owner yet', { exact: true })).toBeVisible();

    // Beta has two owners in the real data: the directory shows exactly one, the one made owner first.
    const beta = rowOf(page, 'Beta');
    await expect(beta.getByText('Bea Tester', { exact: true })).toBeVisible();
    await expect(beta.getByText('No owner yet')).toHaveCount(0);
    const acme = rowOf(page, 'Acme');
    await expect(acme.getByText('Alice Acme', { exact: true })).toBeVisible();

    const quiet = rowOf(page, 'Quiet Works');
    await expect(quiet.getByText('No activity yet', { exact: true })).toBeVisible();
    // Acme has a run three hours before the fixed clock: exactly that relative time, not the empty text.
    await expect(acme.getByText('No activity yet')).toHaveCount(0);
    const cells = acme.locator('td');
    await expect(cells.nth(4)).toHaveText('3 hours ago');
  });
});

test.describe('BR-20: search and status filter', () => {
  test('TC-20.1: typing ACME lists only Acme (case-insensitive) and the URL holds q', async ({ page }) => {
    await open(page);
    await loaded(page);

    await searchBox(page).fill('ACME');

    await expect(page).toHaveURL(/[?&]q=ACME(&|$)/);
    await expect(bodyRows(page)).toHaveCount(1);
    await expect(bodyRows(page).first()).toContainText('Acme');
  });

  test('TC-20.2: typing part of a slug lists only the org with that slug', async ({ page }) => {
    await open(page);
    await loaded(page);

    await searchBox(page).fill('labs');

    await expect(page).toHaveURL(/[?&]q=labs(&|$)/);
    await expect(bodyRows(page)).toHaveCount(1);
    await expect(bodyRows(page).first()).toContainText('Beta');
  });

  test('TC-20.3: choosing "Suspended" lists only suspended orgs and the URL holds status', async ({ page }) => {
    await open(page);
    await loaded(page);

    await statusSelect(page).selectOption('suspended');

    await expect(page).toHaveURL(/[?&]status=suspended(&|$)/);
    await expect(bodyRows(page)).toHaveCount(1);
    await expect(bodyRows(page).first()).toContainText('Orbit Systems');
    await expect(bodyRows(page).first()).toContainText('Suspended');
  });

  test('TC-20.4: no match shows "No organizations match" with "Clear filters", which restores all orgs', async ({
    page,
  }) => {
    await open(page);
    await loaded(page);

    await searchBox(page).fill('zzz-no-match');

    await expect(page.getByText('No organizations match', { exact: true })).toBeVisible();
    await expect(bodyRows(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Clear filters' })).toBeVisible();

    await page.getByRole('button', { name: 'Clear filters' }).click();

    await expect(bodyRows(page)).toHaveCount(6);
    await expect(page.getByText('No organizations match')).toHaveCount(0);
    await expect(searchBox(page)).toHaveValue('');
    await expect(statusSelect(page)).toHaveValue('all');
    await expect(page).not.toHaveURL(/[?&](q|status)=/);
  });

  test('TC-20.5: a search typed on page 2 sends the list back to page 1', async ({ page }) => {
    await open(page, 'manyOrgs', { path: `${ORGS}?page=2` });
    await expect(bodyRows(page).first()).toContainText('Many Org 25');
    await expect(page).toHaveURL(/[?&]page=2(&|$)/);

    // Every org matches "many", so a second page still exists and only the reset can explain page 1.
    await searchBox(page).fill('many');

    await expect(page).toHaveURL(/[?&]q=many(&|$)/);
    await expect(page).not.toHaveURL(/[?&]page=/);
    await expect(bodyRows(page).first()).toContainText('Many Org 45');
    await expect(bodyRows(page)).toHaveCount(20);
  });
});

const nameInput = (page: Page): Locator => page.getByRole('textbox', { name: /^Name/ });
const slugInput = (page: Page): Locator => page.getByRole('textbox', { name: /^URL/ });
const emailInput = (page: Page): Locator => page.getByRole('textbox', { name: /^First owner email/ });
const submit = (page: Page): Locator => page.getByRole('button', { name: 'Create organization' });
const orgMenuButton = (page: Page): Locator =>
  page.getByRole('button', { name: /^(Switch organization|Organization menu)/ });

/** Counts the org-create POSTs this page sends. Call before the first goto. */
function logOrgCreates(page: Page): () => number {
  let count = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/api\/platform\/orgs$/.test(new URL(request.url()).pathname)) count += 1;
  });
  return () => count;
}

async function openCreateForm(page: Page): Promise<void> {
  await open(page);
  await loaded(page);
  await page.getByRole('main').getByRole('link', { name: 'Create organization' }).click();
  await expect(page).toHaveURL(/\/orgs\/new$/);
  await expect(page.getByRole('heading', { name: 'Create an organization', level: 1 })).toBeVisible();
}

/** The form needs a first owner email too; the case's name and slug are typed as given (the URL fills from the name until edited). */
async function fill(page: Page, v: { name: string; slug: string }): Promise<void> {
  await nameInput(page).fill(v.name);
  await slugInput(page).fill(v.slug);
  await emailInput(page).fill('owner@example.com');
  await expect(nameInput(page)).toHaveValue(v.name);
  await expect(slugInput(page)).toHaveValue(v.slug);
}

async function backToDirectory(page: Page): Promise<void> {
  await orgMenuButton(page).click();
  await page
    .getByRole('dialog', { name: 'Organizations' })
    .getByRole('link', { name: 'Platform admin', exact: true })
    .click();
  await expect(page).toHaveURL(/\/platform\/orgs$/);
  await expect(heading(page)).toBeVisible();
  await expect(bodyRows(page).first()).toBeVisible();
}

test.describe('BR-21: create an organization from the directory', () => {
  test('TC-21.1: "Create organization" opens the create form; the new org is listed with "No owner yet"', async ({
    page,
  }) => {
    await openCreateForm(page);
    await fill(page, { name: 'Gamma Co', slug: 'gamma-co' });

    await submit(page).click();
    await expect(page.getByRole('heading', { name: 'Organization created' })).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(orgMenuButton(page)).toBeVisible();
    await backToDirectory(page);

    const gamma = rowOf(page, 'Gamma Co');
    await expect(gamma).toHaveCount(1);
    await expect(gamma.getByText('/o/gamma-co', { exact: true })).toBeVisible();
    await expect(gamma.getByText('No owner yet', { exact: true })).toBeVisible();
  });
});

test.describe('BR-22: create organization errors', () => {
  /** An error shows at the field: marked invalid and described by a message. */
  async function expectFieldError(field: Locator): Promise<void> {
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(field).not.toHaveAccessibleDescription('');
  }

  test('TC-22.1: an empty name shows an error at the name field and creates nothing', async ({ page }) => {
    const creates = logOrgCreates(page);
    await openCreateForm(page);
    await slugInput(page).fill('gamma-co');
    await emailInput(page).fill('owner@example.com');

    await submit(page).click();

    await expect(page.getByText('Enter a name.', { exact: true })).toBeVisible();
    await expectFieldError(nameInput(page));
    expect(creates()).toBe(0);
    await expect(page.getByRole('heading', { name: 'Organization created' })).toHaveCount(0);
  });

  test('TC-22.2: a 101-character name shows an error at the name field and creates nothing', async ({ page }) => {
    const creates = logOrgCreates(page);
    await openCreateForm(page);
    await fill(page, { name: 'n'.repeat(101), slug: 'gamma-co' });

    await submit(page).click();

    await expect(page.getByText('Use 100 characters or fewer.', { exact: true })).toBeVisible();
    await expectFieldError(nameInput(page));
    expect(creates()).toBe(0);
    await expect(page.getByRole('heading', { name: 'Organization created' })).toHaveCount(0);
  });

  test('TC-22.3: the slug "Bad_Slug-" shows an error at the slug field and creates nothing', async ({ page }) => {
    const creates = logOrgCreates(page);
    await openCreateForm(page);
    await fill(page, { name: 'Gamma Co', slug: 'Bad_Slug-' });

    await submit(page).click();

    await expect(
      page.getByText('Use lowercase letters, numbers and dashes, with no dash at the start or end.', { exact: true }),
    ).toBeVisible();
    await expectFieldError(slugInput(page));
    expect(creates()).toBe(0);
    await expect(page.getByRole('heading', { name: 'Organization created' })).toHaveCount(0);
  });

  test('TC-22.4: a taken slug shows a "taken" error at the slug field and no second org is listed', async ({
    page,
  }) => {
    await openCreateForm(page);
    await fill(page, { name: 'Acme Two', slug: 'acme' });

    await submit(page).click();

    await expect(page.getByText('This URL is taken. Try another.', { exact: true })).toBeVisible();
    await expectFieldError(slugInput(page));
    await expect(page.getByRole('heading', { name: 'Organization created' })).toHaveCount(0);

    await backToDirectory(page);
    await expect(rowOf(page, '/o/acme')).toHaveCount(1);
    await expect(rowOf(page, 'Acme Two')).toHaveCount(0);
  });
});
