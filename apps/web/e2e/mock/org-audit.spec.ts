import { expect, test, type Locator, type Page } from '@playwright/test';
import { AUDIT_MOCK_NOW } from '../../src/mocks/dto/audit';
import type { TenantAdminScenario } from '../../src/mocks/msw/tenantAdminScenarios';
import { ORG, seedTenantAdmin } from './mock';

/*
 * The org Audit log page: paging, deleted and platform-admin actors, text-only rendering, the raw key of a generic
 * entry with its relative and exact time, and the loading, error and empty states (spec
 * 2026-11-22-org-tenant-admin-design.md "E2E requirements": TC-20.3 to TC-20.7, TC-24.3 to TC-24.5, TC-43.1).
 *
 * Every test seeds the case's mock scenario (mock.ts `seedTenantAdmin`) and fixes the clock at AUDIT_MOCK_NOW before its
 * first goto, so relative times hold. The default audit entries come from src/mocks/dto/audit.ts; `twoOwners` seeds them
 * unchanged. The page-size-20 rows of `auditPaged` are "Member 25" (newest) down to "Member 1" (oldest).
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

const AUDIT = `/o/${ORG}/settings/audit`;

async function open(page: Page, scenario: TenantAdminScenario): Promise<void> {
  await seedTenantAdmin(page, scenario);
  await page.clock.setFixedTime(new Date(AUDIT_MOCK_NOW));
  await page.goto(AUDIT);
}

const heading = (page: Page): Locator => page.getByRole('heading', { name: 'Audit log', level: 1 });
const rowOf = (page: Page, text: string): Locator => page.getByRole('row').filter({ hasText: text });
const nav = (page: Page): Locator => page.getByRole('navigation', { name: 'Pagination' });
const loading = (page: Page): Locator => page.getByRole('status', { name: 'Loading' });

/** The loaded page: the heading and at least one entry row. */
async function loaded(page: Page): Promise<void> {
  await expect(heading(page)).toBeVisible();
  await expect(page.locator('tbody tr').first()).toBeVisible();
}

test('TC-20.3: 25 entries page by 20 newest, then the 5 oldest, with "Showing 21–25 of 25"', async ({ page }) => {
  await open(page, 'auditPaged');
  await loaded(page);
  await expect(page.getByRole('columnheader')).toHaveText(['When', 'Who', 'What']);
  await expect(page.locator('tbody tr')).toHaveCount(20);
  await expect(rowOf(page, 'Member 25')).toBeVisible();
  await expect(rowOf(page, 'Member 6')).toBeVisible();
  // hasText is a substring match: "Member 5" is safe here (page 1 holds Member 6 to 25, none contains it), but "Member 1"
  // would also match Member 10 to 19, so the page-2 loop below uses the full phrase "changed Member n's role".
  await expect(rowOf(page, 'Member 5')).toHaveCount(0);
  await expect(nav(page).locator('p')).toHaveText('Showing 1–20 of 25');

  await nav(page).getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(5);
  for (const n of [5, 4, 3, 2, 1]) await expect(rowOf(page, `changed Member ${n}'s role`)).toBeVisible();
  await expect(rowOf(page, 'Member 25')).toHaveCount(0);
  await expect(rowOf(page, 'Member 6')).toHaveCount(0);
  await expect(nav(page).locator('p')).toHaveText('Showing 21–25 of 25');
});

test('TC-20.4: an entry whose actor was deleted shows the "Deleted user" tag', async ({ page }) => {
  await open(page, 'twoOwners');
  await loaded(page);
  const row = rowOf(page, 'Deleted user');
  await expect(row).toHaveCount(1);
  await expect(row.getByRole('cell').nth(1)).toHaveText('Deleted user');
  await expect(row).toContainText("changed Cleo Martin's role from Viewer to Member");
  // positive control: an entry of a live actor shows the name and not the tag
  await expect(rowOf(page, 'Ben Okafor').getByRole('cell').nth(1)).toHaveText('Alice Doe');
});

test('TC-20.5: an entry made by a platform admin shows the name with the "Platform admin" tag', async ({ page }) => {
  await open(page, 'twoOwners');
  await loaded(page);
  const who = rowOf(page, 'Pat Platform').getByRole('cell').nth(1);
  await expect(who).toContainText('Pat Platform');
  await expect(who.getByText('Platform admin', { exact: true })).toBeVisible();
  // positive control: an ordinary member's entry has no tag
  await expect(rowOf(page, 'Ben Okafor').getByText('Platform admin')).toHaveCount(0);
  await expect(page.getByText('Platform admin', { exact: true })).toHaveCount(1);
});

test('TC-20.6: HTML in an entry shows literally as text and nothing is parsed as markup', async ({ page }) => {
  await open(page, 'twoOwners');
  await loaded(page);
  const label = `<b>${'long-invitee-'.repeat(8)}</b>@example.com`;
  const what = rowOf(page, 'long-invitee-').getByRole('cell').nth(2);
  await expect(what).toContainText(`invited ${label} as Member`);
  // the sentence emphasises the actor and the invitee; the invitee's text is the whole literal label, so no tag was parsed
  await expect(what.locator('b')).toHaveText(['Priya Raman', label]);
  await expect(what.locator('b')).toHaveCount(2);
  await expect(what.locator('b b')).toHaveCount(0);
});

test('TC-20.7: a generic request entry shows its raw key in mono; When reads "2 min ago" with the exact date', async ({
  page,
}) => {
  await open(page, 'twoOwners');
  await loaded(page);
  const generic = rowOf(page, 'POST orgs.create');
  await expect(generic.locator('.mono')).toHaveText('POST orgs.create');
  await expect(generic.locator('.mono')).toHaveCSS('font-family', /IBM Plex Mono/);

  const when = rowOf(page, 'from Admin to Member').getByRole('cell').first();
  await expect(when).toContainText('2 min ago');
  await expect(when.locator('time')).toHaveAttribute('title', '22 Nov 2026, 10:58');
});

test('TC-24.3: a skeleton shows until the slow Audit list arrives', async ({ page }) => {
  await open(page, 'auditSlow');
  await expect(loading(page)).toBeVisible();
  await expect(heading(page)).toHaveCount(0);
  await loaded(page);
  await expect(loading(page)).toHaveCount(0);
  await expect(rowOf(page, 'from Admin to Member')).toBeVisible();
});

test('TC-24.4: an Audit error shows the message and request id, and Retry shows the list', async ({ page }) => {
  await open(page, 'auditError');
  await expect(page.getByText('Internal server error')).toBeVisible();
  await expect(page.getByText(/Request ID: \S+/)).toBeVisible();
  await expect(heading(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry' }).click();
  await loaded(page);
  await expect(page.getByText('Internal server error')).toHaveCount(0);
});

test('TC-24.5: an org with no entries shows "No activity yet"', async ({ page }) => {
  await open(page, 'auditEmpty');
  await expect(heading(page)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No activity yet' })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(0);
});

test('TC-43.1: platform suspend and reactivate entries show each tagged "Platform admin" and with no reason text', async ({
  page,
}) => {
  await open(page, 'auditPlatformSuspend');
  await loaded(page);
  await expect(page.locator('tbody tr')).toHaveCount(2);
  for (const sentence of ['suspended the organization', 'reactivated the organization']) {
    const row = rowOf(page, sentence);
    await expect(row).toHaveCount(1);
    const who = row.getByRole('cell').nth(1);
    await expect(who).toContainText('Pat Platform');
    await expect(who.getByText('Platform admin', { exact: true })).toBeVisible();
    await expect(row).not.toContainText(/reason/i);
  }
  await expect(page.getByText('Platform admin', { exact: true })).toHaveCount(2);
});
