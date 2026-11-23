import { expect, test, type Locator, type Page } from '@playwright/test';
import type { MockLists } from '../../src/mocks/msw/e2eLists';
import type { PlatformScenario } from '../../src/mocks/msw/platformScenarios';
import { ORG, SESSION_MOCK_NOW, seedLists, seedPlatform } from './mock';

/*
 * The Platform admins page (spec 2026-11-23-platform-admin-dashboard-design.md "E2E requirements": TC-4.1 to TC-4.3,
 * TC-5.1, TC-5.3, TC-6.1, TC-7.1, TC-9.1 to TC-9.4, TC-10.1, TC-11.1, TC-14.1, TC-15.1, TC-16.1 to TC-16.3, TC-17.1).
 *
 * Every test seeds the case's platform scenario (mock.ts `seedPlatform`) before its first goto, with a clock fixed at
 * SESSION_MOCK_NOW. The default list (platformAdminOrgs) is Dev Admin, Pat and a seeded entry with no account, added
 * 12 Nov. `lastAdmin` and `lastAdminPage1` list the signed-in user (alice@example.com) among 44 seeded entries with
 * no account, three pages of 20; the signed-in user is on page 2 in `lastAdmin` and on page 1 in `lastAdminPage1`.
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

const ADMINS = '/platform/admins';

async function open(
  page: Page,
  scenario: PlatformScenario = 'platformAdminOrgs',
  opts: { path?: string; lists?: MockLists } = {},
): Promise<void> {
  await page.clock.install({ time: new Date(SESSION_MOCK_NOW) });
  await seedPlatform(page, scenario);
  if (opts.lists) await seedLists(page, opts.lists);
  await page.goto(opts.path ?? ADMINS);
}

const heading = (page: Page): Locator => page.getByRole('heading', { name: 'Platform admins', level: 1 });
const bodyRows = (page: Page): Locator => page.locator('tbody tr');
const rowOf = (page: Page, text: string): Locator => bodyRows(page).filter({ hasText: text });
const loading = (page: Page): Locator => page.getByRole('status', { name: 'Loading' });
const revokeOf = (page: Page, email: string): Locator =>
  page.getByRole('button', { name: `Revoke platform access for ${email}` });
const nav = (page: Page): Locator => page.getByRole('navigation', { name: 'Pagination' });
const addDialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Add platform admin' });
const emailField = (page: Page): Locator => addDialog(page).getByLabel('Email');

async function loaded(page: Page): Promise<void> {
  await expect(heading(page)).toBeVisible();
  await expect(bodyRows(page).first()).toBeVisible();
}

test.describe('BR-4: loading, empty and failing list', () => {
  test('TC-4.1: skeleton rows show while the admins list is pending, then the table', async ({ page }) => {
    await open(page, 'platformAdminOrgs', { lists: { hold: [{ route: 'platform.listAdmins', ms: 3000 }] } });

    await expect(loading(page)).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByText('No platform admins')).toHaveCount(0);

    await loaded(page);
    await expect(loading(page)).toHaveCount(0);
    await expect(page.getByRole('table')).toBeVisible();
  });

  test('TC-4.2: an empty admins list shows "No platform admins"', async ({ page }) => {
    await open(page, 'platformEmpty');
    await expect(page.getByText('No platform admins', { exact: true })).toBeVisible();
    await expect(bodyRows(page)).toHaveCount(0);
  });

  test('TC-4.3: a failing admins list shows the problem, the request id and Retry, and Retry shows the list', async ({
    page,
  }) => {
    // Three failures cover the first load and Query's two retries; the next request succeeds.
    await open(page, 'platformAdminOrgs', { lists: { fail: [{ route: 'platform.listAdmins', times: 3 }] } });

    await expect(page.getByText('Internal server error')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Request ID: \S+/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();

    await page.getByRole('button', { name: 'Retry' }).click();

    await loaded(page);
    await expect(bodyRows(page)).toHaveCount(3);
  });
});

test.describe('BR-5: the admins table', () => {
  test('TC-5.1: the heading, the columns and one row per admin', async ({ page }) => {
    await open(page);
    await loaded(page);

    await expect(page.getByRole('columnheader')).toHaveText([
      'Name',
      'Email',
      'Handle',
      'Added',
      'Added by',
      'Actions',
    ]);
    await expect(bodyRows(page)).toHaveCount(3);
    await expect(rowOf(page, 'admin@dev.local').getByRole('cell')).toHaveText([
      'Dev Admin',
      'admin@dev.local',
      'dev-admin',
      '12 Nov',
      '—',
      'Revoke',
    ]);
    await expect(rowOf(page, 'pat@example.com').getByRole('cell')).toHaveText([
      'Pat',
      'pat@example.com',
      'pat',
      '12 Nov',
      'Dev Admin',
      'Revoke',
    ]);
  });

  test('TC-5.3: page 1 shows the page-size rows, the next page control opens page 2 with ?page=2', async ({ page }) => {
    await open(page, 'lastAdminPage1');
    await loaded(page);
    await expect(bodyRows(page)).toHaveCount(20);
    await expect(rowOf(page, 'pending19@example.com')).toBeVisible();
    await expect(rowOf(page, 'pending20@example.com')).toHaveCount(0);

    await nav(page).getByRole('button', { name: 'Next', exact: true }).click();

    await expect(page).toHaveURL(/[?&]page=2(&|$)/);
    await expect(rowOf(page, 'pending20@example.com')).toBeVisible();
    await expect(bodyRows(page)).toHaveCount(20);
    await expect(rowOf(page, 'pending19@example.com')).toHaveCount(0);
  });
});

test.describe('BR-6: the signed-in admin is tagged "You"', () => {
  test('TC-6.1: the signed-in admin row shows "You" after the name, another row does not', async ({ page }) => {
    await open(page, 'lastAdminPage1');
    await loaded(page);

    const own = rowOf(page, 'alice@example.com');
    await expect(own.getByRole('cell').first()).toContainText('Alice');
    await expect(own.getByText('You', { exact: true })).toBeVisible();
    await expect(rowOf(page, 'pending01@example.com').getByText('You', { exact: true })).toHaveCount(0);
  });
});

test.describe('BR-7: an entry with no account yet', () => {
  test('TC-7.1: the seeded row shows "Not signed in yet" and dashes, the normal row its values', async ({ page }) => {
    await open(page);
    await loaded(page);

    await expect(rowOf(page, 'seeded@example.com').getByRole('cell')).toHaveText([
      'Not signed in yet',
      'seeded@example.com',
      '—',
      '12 Nov',
      '—',
      'Revoke',
    ]);
    await expect(rowOf(page, 'pat@example.com').getByRole('cell')).toHaveText([
      'Pat',
      'pat@example.com',
      'pat',
      '12 Nov',
      'Dev Admin',
      'Revoke',
    ]);
  });
});

/** An email of exactly `length` characters in a valid shape (local 64, labels of at most 63). */
function emailOfLength(length: number): string {
  const tail = length - 64 - 1 - 63 - 1 - 63 - 1;
  const email = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(tail)}`;
  if (email.length !== length) throw new Error(`built ${email.length} characters, wanted ${length}`);
  return email;
}

/** The Email field is marked invalid and described by a visible, non-empty message. */
async function expectEmailError(page: Page): Promise<void> {
  await expect(emailField(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(emailField(page)).not.toHaveAccessibleDescription('');
}

async function openAdd(page: Page, scenario: PlatformScenario = 'platformAdminOrgs'): Promise<void> {
  await open(page, scenario);
  await loaded(page);
  await page.getByRole('button', { name: 'Add platform admin' }).click();
  await expect(addDialog(page)).toBeVisible();
}

test.describe('BR-9: the Email field of the Add dialog', () => {
  test('TC-9.1: an empty email shows an error at the Email field and adds nothing', async ({ page }) => {
    await openAdd(page);

    await addDialog(page).getByRole('button', { name: 'Add', exact: true }).click();

    await expectEmailError(page);
    await expect(addDialog(page)).toBeVisible();
    await expect(bodyRows(page)).toHaveCount(3);
  });

  test('TC-9.2: "not-an-email" shows an error at the Email field and adds nothing', async ({ page }) => {
    await openAdd(page);
    await emailField(page).fill('not-an-email');

    await addDialog(page).getByRole('button', { name: 'Add', exact: true }).click();

    await expectEmailError(page);
    await expect(addDialog(page)).toBeVisible();
    await expect(bodyRows(page)).toHaveCount(3);
  });

  test('TC-9.3: a 254-character email shows no length error', async ({ page }) => {
    await openAdd(page);
    await emailField(page).fill(emailOfLength(254));

    await addDialog(page).getByRole('button', { name: 'Add', exact: true }).click();

    // The request is sent: the mock answers that no account has this email, which ends the submit.
    await expect(addDialog(page).getByText('No account has this email yet.')).toBeVisible();
    await expect(addDialog(page).getByText('Use 254 characters or fewer.')).toHaveCount(0);
    await expect(addDialog(page).getByText('Enter a valid email address.')).toHaveCount(0);
  });

  test('TC-9.4: a 255-character email shows an error at the Email field and adds nothing', async ({ page }) => {
    await openAdd(page);
    await emailField(page).fill(emailOfLength(255));

    await addDialog(page).getByRole('button', { name: 'Add', exact: true }).click();

    await expectEmailError(page);
    await expect(addDialog(page)).toBeVisible();
    await expect(bodyRows(page)).toHaveCount(3);
  });
});

test.describe('BR-10: an email with no account', () => {
  test('TC-10.1: "No account has this email yet." shows under Email, the input and list stay', async ({ page }) => {
    await openAdd(page);
    await emailField(page).fill('nobody@example.test');

    await addDialog(page).getByRole('button', { name: 'Add', exact: true }).click();

    await expect(addDialog(page).getByText('No account has this email yet.', { exact: true })).toBeVisible();
    await expect(addDialog(page)).toBeVisible();
    await expect(emailField(page)).toHaveValue('nobody@example.test');
    await expect(bodyRows(page)).toHaveCount(3);
  });
});

test.describe('BR-11: an email that is not verified', () => {
  test('TC-11.1: "This email is not verified yet." shows under Email, the dialog stays, nothing is added', async ({
    page,
  }) => {
    await openAdd(page, 'unverifiedAccount');
    await emailField(page).fill('unverified@example.test');

    await addDialog(page).getByRole('button', { name: 'Add', exact: true }).click();

    await expect(addDialog(page).getByText('This email is not verified yet.', { exact: true })).toBeVisible();
    await expect(addDialog(page)).toBeVisible();
    await expect(bodyRows(page)).toHaveCount(3);
    await expect(rowOf(page, 'unverified@example.test')).toHaveCount(0);
  });
});

test.describe('BR-14: cancelling a revoke', () => {
  test('TC-14.1: Cancel closes the dialog, keeps the row and shows no toast', async ({ page }) => {
    await open(page);
    await loaded(page);

    await revokeOf(page, 'pat@example.com').click();
    const dialog = page.getByRole('dialog', { name: 'Revoke platform access for Pat?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await expect(dialog).toHaveCount(0);
    await expect(rowOf(page, 'pat@example.com')).toBeVisible();
    await expect(bodyRows(page)).toHaveCount(3);
    await expect(page.getByRole('status').filter({ hasText: 'Platform admin revoked' })).toHaveCount(0);
  });
});

test.describe('BR-15: revoking your own platform access with another working admin', () => {
  test('TC-15.1: the own-access dialog, then home, no "Platform admin" entry and a forbidden /platform/admins', async ({
    page,
  }) => {
    await open(page, 'ownAdminRow');
    await loaded(page);
    const own = rowOf(page, 'You');
    await expect(own).toHaveCount(1);

    await revokeOf(page, 'alice@example.com').click();

    const dialog = page.getByRole('dialog', { name: 'Revoke your own platform access?' });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText('You lose access right away and go to the home page.', { exact: true }),
    ).toBeVisible();

    await dialog.getByRole('button', { name: 'Revoke', exact: true }).click();

    // Home: `/` hands over to the active org's projects, so the browser has left /platform for the org.
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/projects`));
    await page.getByRole('button', { name: /^(Switch organization|Organization menu)/ }).click();
    const orgs = page.getByRole('dialog', { name: 'Organizations' });
    await expect(orgs).toBeVisible();
    await expect(orgs.getByText('Platform admin')).toHaveCount(0);

    // Typing the address: the mock store reseeds on a page load, so the path is entered through the router history.
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      window.history.pushState({}, '', '/platform/admins');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.getByText("You don't have access", { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Platform admins' })).toHaveCount(0);
  });
});

test.describe('BR-16: the last working admin cannot be revoked', () => {
  const REASON = 'Grant the role to someone else first.';

  test('TC-16.1: on page 1 the last working admin has "Revoke" disabled with "Last admin"; seeded rows are enabled', async ({
    page,
  }) => {
    await open(page, 'lastAdminPage1');
    await loaded(page);

    const own = rowOf(page, 'alice@example.com');
    await expect(own.getByRole('button', { name: /^Revoke/ })).toBeDisabled();
    await expect(own.getByRole('button', { name: /^Revoke/ })).toHaveAttribute('title', REASON);
    await expect(own.getByText('Last admin', { exact: true })).toBeVisible();
    await expect(revokeOf(page, 'pending01@example.com')).toBeEnabled();
    await expect(page.getByText('Last admin', { exact: true })).toHaveCount(1);
  });

  test('TC-16.2: with the last working admin on page 2, its "Revoke" is disabled with "Last admin" there', async ({
    page,
  }) => {
    await open(page, 'lastAdmin', { path: `${ADMINS}?page=2` });
    await loaded(page);

    const own = rowOf(page, 'alice@example.com');
    await expect(own.getByRole('button', { name: /^Revoke/ })).toBeDisabled();
    await expect(own.getByText('Last admin', { exact: true })).toBeVisible();
  });

  test('TC-16.3: page 1 shows the disabled "Revoke" with the reason; page 2 rows have "Revoke" enabled', async ({
    page,
  }) => {
    await open(page, 'lastAdminPage1');
    await loaded(page);
    await expect(rowOf(page, 'alice@example.com').getByRole('button', { name: /^Revoke/ })).toBeDisabled();
    await expect(page.getByText('Last admin', { exact: true })).toBeVisible();

    await nav(page).getByRole('button', { name: 'Next', exact: true }).click();

    await expect(page).toHaveURL(/[?&]page=2(&|$)/);
    await expect(rowOf(page, 'pending20@example.com')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Revoke platform access/ })).toHaveCount(20);
    // `toBeEnabled` is a single-element assertion, so each of the 20 buttons is checked on its own.
    for (const revoke of await page.getByRole('button', { name: /^Revoke platform access/ }).all()) {
      await expect(revoke).toBeEnabled();
    }
    await expect(page.getByText('Last admin', { exact: true })).toHaveCount(0);
  });
});

test.describe('BR-17: a revoke the server refuses', () => {
  test('TC-17.1: a 409 shows a toast with the problem title and the list is fetched again', async ({ page }) => {
    let listRequests = 0;
    page.on('request', (request) => {
      if (request.method() === 'GET' && new URL(request.url()).pathname === '/api/platform/admins') listRequests += 1;
    });
    await open(page, 'revoke409');
    await loaded(page);
    const before = listRequests;

    await revokeOf(page, 'pat@example.com').click();
    await page
      .getByRole('dialog', { name: 'Revoke platform access for Pat?' })
      .getByRole('button', { name: 'Revoke', exact: true })
      .click();

    await expect(page.getByRole('alert').filter({ hasText: 'Last working platform admin' })).toBeVisible();
    await expect.poll(() => listRequests).toBeGreaterThan(before);
  });
});
