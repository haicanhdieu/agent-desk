import { expect, test, type Locator, type Page } from '@playwright/test';
import type { MockLists } from '../../src/mocks/msw/e2eLists';
import type { PlatformScenario } from '../../src/mocks/msw/platformScenarios';
import { SESSION_MOCK_NOW, seedLists, seedPlatform } from './mock';

/*
 * The platform Audit log (spec 2026-11-23-platform-admin-dashboard-design.md "E2E requirements": TC-4.7 to TC-4.9,
 * TC-45.1 to TC-45.4, TC-50.1 to TC-50.3).
 *
 * Every test seeds the case's platform scenario (mock.ts `seedPlatform`) before its first goto, with a clock fixed at
 * SESSION_MOCK_NOW. `platformAdminOrgs` serves the audit fixtures (src/mocks/dto/platform.ts): eleven entries, every
 * action once, newest first "revoked the invitation" (its org is gone) to "added ... as a platform admin"; Acme has six,
 * Orbit Systems the suspend and reactivate pair, one entry has a gone actor. `manyAudit` serves 25 entries that are all
 * "platform admin added", so page 2 has five and every other action has none. `platformEmpty` has no entries.
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

const AUDIT = '/platform/audit';
const ACME = 'b8000000-0000-4000-8000-000000000001';
const UNKNOWN = 'b8000000-0000-4000-8000-0000000000ff';

async function open(
  page: Page,
  scenario: PlatformScenario = 'platformAdminOrgs',
  opts: { path?: string; lists?: MockLists } = {},
): Promise<void> {
  await page.clock.install({ time: new Date(SESSION_MOCK_NOW) });
  await seedPlatform(page, scenario);
  if (opts.lists) await seedLists(page, opts.lists);
  await page.goto(opts.path ?? AUDIT);
}

const heading = (page: Page): Locator => page.getByRole('heading', { name: 'Audit log', level: 1 });
const bodyRows = (page: Page): Locator => page.locator('tbody tr');
const loading = (page: Page): Locator => page.getByRole('status', { name: 'Loading' });
const actionSelect = (page: Page): Locator => page.getByRole('combobox', { name: 'Action' });
const nav = (page: Page): Locator => page.getByRole('navigation', { name: 'Pagination' });

async function loaded(page: Page): Promise<void> {
  await expect(heading(page)).toBeVisible();
  await expect(bodyRows(page).first()).toBeVisible();
}

test.describe('BR-4: loading, empty and failing audit log', () => {
  test('TC-4.7: skeleton rows show while the audit list is pending, then the entries', async ({ page }) => {
    await open(page, 'platformAdminOrgs', { lists: { hold: [{ route: 'platform.listAudit', ms: 3000 }] } });

    await expect(loading(page)).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByText('No audit entries')).toHaveCount(0);

    await loaded(page);
    await expect(loading(page)).toHaveCount(0);
    await expect(bodyRows(page)).toHaveCount(11);
  });

  test('TC-4.8: an empty audit list shows "No audit entries"', async ({ page }) => {
    await open(page, 'platformEmpty');

    await expect(page.getByText('No audit entries', { exact: true })).toBeVisible();
    await expect(bodyRows(page)).toHaveCount(0);
  });

  test('TC-4.9: a failing audit list shows the error and Retry, and Retry shows the entries', async ({ page }) => {
    // Three failures cover the first load and Query's two retries; the next request succeeds.
    await open(page, 'platformAdminOrgs', { lists: { fail: [{ route: 'platform.listAudit', times: 3 }] } });

    await expect(page.getByText('Internal server error')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();

    await page.getByRole('button', { name: 'Retry' }).click();

    await loaded(page);
    await expect(bodyRows(page)).toHaveCount(11);
  });
});

test.describe('BR-45: the audit list and its Action filter', () => {
  test('TC-45.1: columns, newest first, the sentences, reasons only on suspend and reactivate, a gone actor', async ({
    page,
  }) => {
    await open(page);
    await loaded(page);

    await expect(page.getByRole('columnheader')).toHaveText(['When', 'Who', 'What']);
    await expect(bodyRows(page)).toHaveCount(11);
    await expect(bodyRows(page)).toContainText([
      'Dev Admin revoked the invitation for new@example.com to a deleted organization',
      'Dev Admin resent the invitation for new@example.com to Acme',
      'Dev Admin invited new@example.com to Acme as Admin',
      "Deleted user removed alice's Owner role in Acme",
      'Dev Admin gave alice the Owner role in Acme',
      'Dev Admin reactivated Orbit Systems',
      'Dev Admin suspended Orbit Systems',
      'Dev Admin changed the name of Acme from Acme Labs to Acme and the URL from /o/acme-labs to /o/acme',
      'Dev Admin created Acme',
      'Dev Admin revoked platform access for old@example.com',
      'Dev Admin added pat@example.com as a platform admin',
    ]);

    // Reasons: only the suspend and reactivate rows, muted, as typed.
    await expect(page.getByText(/^Reason:/)).toHaveText(['Reason: Invoice paid', 'Reason: Billing hold']);
    const reactivated = bodyRows(page).filter({ hasText: 'reactivated Orbit Systems' });
    await expect(reactivated).toContainText('Reason: Invoice paid');
    const suspended = bodyRows(page).filter({ hasText: 'suspended Orbit Systems' });
    await expect(suspended).toContainText('Reason: Billing hold');
    await expect(bodyRows(page).filter({ hasText: 'created Acme' })).not.toContainText('Reason:');
    // "Muted" is the --muted token, and differs from the colour of the sentence beside it.
    const tokens = await page.evaluate(() => {
      const probe = document.createElement('span');
      document.body.append(probe);
      probe.style.color = 'var(--muted)';
      probe.style.fontFamily = 'var(--mono)';
      const { color, fontFamily } = getComputedStyle(probe);
      probe.remove();
      return { muted: color, mono: fontFamily };
    });
    const sentenceColor = await reactivated
      .getByText(/^Dev Admin reactivated/)
      .evaluate((el) => getComputedStyle(el).color);
    expect(sentenceColor).not.toBe(tokens.muted);
    await expect(reactivated.getByText(/^Reason:/)).toHaveCSS('color', tokens.muted);
    await expect(suspended.getByText(/^Reason:/)).toHaveCSS('color', tokens.muted);

    // The edit row's URLs are mono; the gone actor reads "Deleted user".
    const edit = bodyRows(page).filter({ hasText: 'changed the name of Acme' });
    await expect(edit.getByText('/o/acme-labs', { exact: true })).toBeVisible();
    await expect(edit.getByText('/o/acme', { exact: true })).toBeVisible();
    for (const url of ['/o/acme-labs', '/o/acme']) {
      await expect(edit.getByText(url, { exact: true })).toHaveCSS('font-family', tokens.mono);
    }
    await expect(edit.getByText(/^Dev Admin changed the name/)).not.toHaveCSS('font-family', tokens.mono);
    await expect(bodyRows(page).filter({ hasText: 'Deleted user' })).toHaveCount(1);
  });

  test('TC-45.2: the Action select narrows to suspend entries (?action=) and "All actions" restores all', async ({
    page,
  }) => {
    await open(page);
    await loaded(page);

    await actionSelect(page).selectOption({ label: 'Organization suspended' });

    await expect(page).toHaveURL(/[?&]action=org\.suspended(&|$)/);
    await expect(bodyRows(page)).toHaveCount(1);
    await expect(bodyRows(page).first()).toContainText('Dev Admin suspended Orbit Systems');

    await actionSelect(page).selectOption({ label: 'All actions' });

    await expect(page).not.toHaveURL(/action=/);
    await expect(bodyRows(page)).toHaveCount(11);
  });

  test('TC-45.3: an action with no entries shows "No audit entries match" with "Clear filters"', async ({ page }) => {
    // `manyAudit` holds only "platform admin added" entries, so every other action is empty.
    await open(page, 'manyAudit');
    await loaded(page);

    await actionSelect(page).selectOption({ label: 'Organization suspended' });

    await expect(page.getByText('No audit entries match', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear filters' })).toBeVisible();
    await expect(bodyRows(page)).toHaveCount(0);

    await page.getByRole('button', { name: 'Clear filters' }).click();

    await expect(bodyRows(page)).toHaveCount(20);
  });

  test('TC-45.4: page 2 shows the older entries and the URL holds ?page=2', async ({ page }) => {
    await open(page, 'manyAudit');
    await loaded(page);
    await expect(bodyRows(page)).toHaveCount(20);
    await expect(bodyRows(page).first()).toContainText('admin25@example.com');
    await expect(bodyRows(page).last()).toContainText('admin06@example.com');

    await nav(page).getByRole('button', { name: 'Next', exact: true }).click();

    await expect(page).toHaveURL(/[?&]page=2(&|$)/);
    await expect(bodyRows(page)).toHaveCount(5);
    await expect(bodyRows(page).first()).toContainText('admin05@example.com');
    await expect(bodyRows(page).last()).toContainText('admin01@example.com');
  });
});

test.describe('BR-50: the audit log of one organization', () => {
  test('TC-50.1: "View audit log" opens ?org=<id> with the chip, only that org\'s entries and no org picker', async ({
    page,
  }) => {
    await open(page, 'platformAdminOrgs', { path: `/platform/orgs/${ACME}` });
    await expect(page.getByRole('heading', { name: 'Acme', level: 1 })).toBeVisible();

    await page.getByRole('link', { name: 'View audit log' }).click();

    await expect(page).toHaveURL(new RegExp(`/platform/audit\\?org=${ACME}$`));
    await expect(heading(page)).toBeVisible();
    await expect(page.getByText('Organization: Acme', { exact: true })).toBeVisible();
    // Acme's six entries; none of Orbit Systems', none without an org.
    await expect(bodyRows(page)).toHaveCount(6);
    await expect(bodyRows(page).filter({ hasText: 'Orbit Systems' })).toHaveCount(0);
    // The only select is the Action filter: no organization picker.
    await expect(page.getByRole('combobox')).toHaveCount(1);
    await expect(actionSelect(page)).toBeVisible();
  });

  test('TC-50.2: removing the chip drops org from the URL and shows all entries', async ({ page }) => {
    await open(page, 'platformAdminOrgs', { path: `${AUDIT}?org=${ACME}` });
    await expect(page.getByText('Organization: Acme', { exact: true })).toBeVisible();
    await expect(bodyRows(page)).toHaveCount(6);

    await page.getByRole('button', { name: 'Remove filter Organization: Acme' }).click();

    await expect(page.getByText('Organization: Acme')).toHaveCount(0);
    await expect(page).not.toHaveURL(/org=/);
    await expect(bodyRows(page)).toHaveCount(11);
  });

  test('TC-50.3: an unknown org id shows "Unknown organization" and an empty list', async ({ page }) => {
    await open(page, 'platformAdminOrgs', { path: `${AUDIT}?org=${UNKNOWN}` });

    await expect(page.getByText('Unknown organization', { exact: true })).toBeVisible();
    await expect(page.getByText('No audit entries match', { exact: true })).toBeVisible();
    await expect(bodyRows(page)).toHaveCount(0);
  });
});
