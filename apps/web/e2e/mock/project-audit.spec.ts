import { expect, test, type Locator, type Page } from '@playwright/test';
import { AUDIT_MOCK_NOW } from '../../src/mocks/dto/audit';
import type { ProjectSpaceRole, ProjectSpaceScenario } from '../../src/mocks/msw/projectSpaceScenarios';
import { INVOICER_API, ORG, seedProjectSpace } from './mock';

/*
 * Project admin space: the project Settings → Audit log page (access, entries, states, invitation entries per viewer).
 * Cases come from the spec docs/superpowers/specs/2026-11-23-rbac-project-admin-space-design.md (E2E requirements,
 * BR-2, BR-16, BR-19, BR-20, BR-27).
 *
 * Every test seeds its role and scenario before the first goto and fixes the clock at AUDIT_MOCK_NOW. P is
 * invoicer-api. The default audit of P comes from src/mocks/dto/audit.ts (projectAuditFixtures); a project admin of P
 * only gets the invitation entries redacted by the mock the way the API does (email only when every listed project is
 * visible, only visible projects named). The page-size-20 rows of `auditPaged` are "Member 25" (newest) down to "Member 1".
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

const P = INVOICER_API;
const AUDIT = `/o/${ORG}/p/${P}/desk/audit`;
const ORG_AUDIT = `/o/${ORG}/settings/audit`;

async function open(page: Page, role: ProjectSpaceRole, scenario?: ProjectSpaceScenario): Promise<void> {
  await seedProjectSpace(page, scenario === undefined ? { role } : { role, scenario });
  await page.clock.setFixedTime(new Date(AUDIT_MOCK_NOW));
  await page.goto(AUDIT);
}

const heading = (page: Page): Locator => page.getByRole('heading', { name: 'Audit log', level: 1 });
const rows = (page: Page): Locator => page.locator('tbody tr');
const rowOf = (page: Page, text: string): Locator => page.getByRole('row').filter({ hasText: text });
const nav = (page: Page): Locator => page.getByRole('navigation', { name: 'Pagination' });
const forbidden = (page: Page): Locator => page.getByRole('heading', { name: "You don't have access" });
/** The What cell of each row `row` matches (a plain nth(2) would pick one cell across all matched rows). */
const whatOf = (row: Locator): Locator => row.locator('td:nth-child(3)');

/** The loaded page: the heading and at least one entry row. */
async function loaded(page: Page): Promise<void> {
  await expect(heading(page)).toBeVisible();
  await expect(rows(page).first()).toBeVisible();
}

/** The ISO times of the shown rows, in screen order. */
const times = (page: Page): Promise<string[]> =>
  rows(page).evaluateAll((trs) => trs.map((tr) => tr.querySelector('time')?.getAttribute('datetime') ?? ''));

/** Records every API request path the page sends from now on. */
function watchRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith('/api/')) seen.push(url.pathname);
  });
  return seen;
}

test.describe('BR-2: member and viewer get Forbidden on Audit log', () => {
  for (const [tc, role] of [
    ['TC-2.2', 'viewer'],
    ['TC-2.4', 'member'],
  ] as const) {
    test(`${tc}: a ${role} typing the Audit log URL sees Forbidden and no entries`, async ({ page }) => {
      await seedProjectSpace(page, { role });
      const seen = watchRequests(page);
      await page.goto(AUDIT);
      await expect(forbidden(page)).toBeVisible();
      await expect(page.getByRole('table')).toHaveCount(0);
      await expect(page.getByText('Mira Chen')).toHaveCount(0);
      await expect(page.getByText('Kim Hale')).toHaveCount(0);
      expect(seen.filter((p) => p === `/api/projects/${P}/audit`)).toEqual([]);
    });
  }
});

test.describe('control for the request watcher', () => {
  test('the watcher records the audit request of a project admin who may open the log', async ({ page }) => {
    await seedProjectSpace(page, { role: 'projectAdmin' });
    const seen = watchRequests(page);
    await page.goto(AUDIT);
    await loaded(page);
    expect(seen.filter((p) => p === `/api/projects/${P}/audit`).length).toBeGreaterThan(0);
  });
});

test.describe('BR-16: project Audit log', () => {
  test('TC-16.1: heading, intro, columns and the entries newest first with time, actor, action and target', async ({
    page,
  }) => {
    await seedProjectSpace(page, { role: 'projectAdmin' });
    await page.clock.setFixedTime(new Date(AUDIT_MOCK_NOW));
    await page.goto(`/o/${ORG}/p/${P}/desk/agent`);
    await page.getByRole('navigation', { name: 'Project menu' }).getByRole('link', { name: 'Audit log' }).click();
    await loaded(page);
    await expect(page.getByText('Changes to this project, newest first.')).toBeVisible();
    await expect(page.getByRole('columnheader')).toHaveText(['When', 'Who', 'What']);

    const iso = await times(page);
    expect(iso.length).toBeGreaterThan(1);
    expect(iso).toEqual([...iso].sort().reverse());

    const first = rows(page).first();
    await expect(first.getByRole('cell').nth(0)).toContainText('3 min ago');
    await expect(first.locator('time')).toHaveAttribute('title', '22 Nov 2026, 10:57');
    await expect(first.getByRole('cell').nth(1)).toHaveText('Lee Park');
    await expect(whatOf(first)).toHaveText('Lee Park added Mira Chen to this project as Member');
    await expect(whatOf(rowOf(page, 'Cleo Martin').first())).toHaveText(
      "Lee Park changed Cleo Martin's project role from Member to Admin",
    );
    await expect(whatOf(rowOf(page, 'Dana Wu'))).toHaveText('Lee Park removed Dana Wu from this project (was Viewer)');
  });

  test('TC-16.2: page 2 shows older entries than page 1, none repeated, and the pager reflects the page', async ({
    page,
  }) => {
    await open(page, 'projectAdmin', 'auditPaged');
    await loaded(page);
    await expect(rows(page)).toHaveCount(20);
    await expect(nav(page).locator('p')).toHaveText('Showing 1–20 of 25');
    const firstPage = await times(page);
    const firstWhats = await rows(page).evaluateAll((trs) => trs.map((tr) => tr.textContent ?? ''));

    await nav(page).getByRole('button', { name: 'Next', exact: true }).click();
    await expect(nav(page).locator('p')).toHaveText('Showing 21–25 of 25');
    await expect(rows(page)).toHaveCount(5);
    const secondPage = await times(page);
    const secondWhats = await rows(page).evaluateAll((trs) => trs.map((tr) => tr.textContent ?? ''));

    expect(Math.max(...secondPage.map((t) => Date.parse(t)))).toBeLessThan(
      Math.min(...firstPage.map((t) => Date.parse(t))),
    );
    for (const text of secondWhats) expect(firstWhats).not.toContain(text);
    for (const n of [5, 4, 3, 2, 1]) await expect(rowOf(page, `changed Member ${n}'s project role`)).toBeVisible();
    await expect(rowOf(page, "changed Member 25's project role")).toHaveCount(0);
  });

  test('TC-16.3: an entry whose actor was deleted shows "Deleted user" in Who', async ({ page }) => {
    await open(page, 'projectAdmin');
    await loaded(page);
    const row = rowOf(page, 'Deleted user');
    await expect(row).toHaveCount(1);
    await expect(row.getByRole('cell').nth(1)).toHaveText('Deleted user');
    await expect(whatOf(row)).toContainText("changed Cleo Martin's project role from Viewer to Member");
    // positive control: an entry of a live actor shows the name and not the tag
    await expect(rowOf(page, 'Mira Chen').first().getByRole('cell').nth(1)).toHaveText('Lee Park');
  });
});

test.describe('BR-19: Audit never shows other projects or orgs', () => {
  test('TC-19.1: every entry belongs to P; no entry of another project or of the org alone shows', async ({ page }) => {
    await open(page, 'projectAdmin');
    await loaded(page);
    // invoicer-web's own entries (the fixture of the other project) never show
    await expect(page.getByText('Ben Okafor')).toHaveCount(0);
    await expect(page.getByText('eli@contractor.io')).toHaveCount(0);
    await expect(page.getByText('invoicer-web')).toHaveCount(0);
    // the org's own entries (the org Audit log fixture) never show
    await expect(page.getByText('Harbor Labs')).toHaveCount(0);
    await expect(page.getByText('POST orgs.create')).toHaveCount(0);
    await expect(page.getByText('Pat Platform')).toHaveCount(0);
    await expect(page.getByText('from the organization')).toHaveCount(0);
    // positive control: P's own entries are there
    await expect(rowOf(page, 'Cleo Martin').first()).toBeVisible();
    await expect(whatOf(rowOf(page, 'PUT desk.agent.put'))).toBeVisible();
  });
});

test.describe('BR-20: Audit loading, error, empty', () => {
  test('TC-20.1: the skeleton with the status label "Loading" shows until the entries arrive', async ({ page }) => {
    await open(page, 'projectAdmin', 'auditSlow');
    await expect(page.getByRole('status', { name: 'Loading' })).toBeVisible();
    await expect(heading(page)).toHaveCount(0);
    await loaded(page);
    await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0);
  });

  test('TC-20.2: the error banner shows the message and request id, and Retry shows the entries', async ({ page }) => {
    await open(page, 'projectAdmin', 'auditError');
    await expect(page.getByText('Internal server error')).toBeVisible();
    await expect(page.getByText(/Request ID: \S+/)).toBeVisible();
    await expect(heading(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Retry' }).click();
    await loaded(page);
    await expect(page.getByText('Internal server error')).toHaveCount(0);
  });

  test('TC-20.3: a project with no entries shows "No activity yet" and no rows', async ({ page }) => {
    await open(page, 'projectAdmin', 'auditEmpty');
    await expect(heading(page)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No activity yet' })).toBeVisible();
    await expect(rows(page)).toHaveCount(0);
  });
});

test.describe('BR-27: invitation entries per viewer', () => {
  test('TC-27.1: an invitation created for P only reads "<actor> invited <email> as <Role> to <P>" with the email', async ({
    page,
  }) => {
    await open(page, 'projectAdmin');
    await loaded(page);
    const created = rowOf(page, 'invited noor.ali@contractor.io');
    await expect(created).toHaveCount(1);
    await expect(whatOf(created)).toHaveText('Kim Hale invited noor.ali@contractor.io as Viewer to invoicer-api');
  });

  test('TC-27.2: an invitation listing P and another project shows no email and no name of the other project to a project admin of P only', async ({
    page,
  }) => {
    await open(page, 'projectAdmin');
    await loaded(page);
    // the fixture's invitations listing P and invoicer-web (with an email) and P and four more projects
    await expect(whatOf(rowOf(page, 'invited someone as Viewer to invoicer-api'))).toHaveText([
      'Kim Hale invited someone as Viewer to invoicer-api',
      'Kim Hale invited someone as Viewer to invoicer-api',
    ]);
    await expect(whatOf(rowOf(page, 'invited someone as Member to invoicer-api'))).toHaveText(
      'Kim Hale invited someone as Member to invoicer-api',
    );
    await expect(page.getByText('invoicer-web')).toHaveCount(0);
    for (const hidden of ['billing-jobs', 'docs-site', 'storefront', 'wide.access@contractor.io', 'markup.guest']) {
      await expect(page.getByText(hidden)).toHaveCount(0);
    }
  });

  test('TC-27.3: resent, revoked, accepted and declined invitations listing P read with the spec sentences', async ({
    page,
  }) => {
    await open(page, 'projectAdmin');
    await loaded(page);
    await expect(rowOf(page, 'resent the invitation for')).toHaveCount(1);
    await expect(whatOf(rowOf(page, 'resent the invitation for'))).toHaveText(
      'Kim Hale resent the invitation for noor.ali@contractor.io to invoicer-api',
    );
    await expect(whatOf(rowOf(page, 'revoked the invitation for'))).toHaveText(
      'Kim Hale revoked the invitation for noor.ali@contractor.io to invoicer-api',
    );
    await expect(whatOf(rowOf(page, 'accepted an invitation'))).toHaveText(
      'Mira Chen accepted an invitation as Member to invoicer-api',
    );
    await expect(whatOf(rowOf(page, 'declined an invitation'))).toHaveText(
      'Ari Kay declined an invitation to invoicer-api',
    );
  });

  test('TC-27.4: an expired invitation listing P with its email visible reads "The invitation for <email> to <P> expired"', async ({
    page,
  }) => {
    await open(page, 'projectAdmin');
    await loaded(page);
    await expect(whatOf(rowOf(page, 'The invitation for sam.reyes@contractor.io'))).toHaveText(
      'The invitation for sam.reyes@contractor.io to invoicer-api expired',
    );
  });

  test('TC-27.5: an expired invitation listing P and another project reads "An invitation to <P> expired" for a project admin of P only', async ({
    page,
  }) => {
    await open(page, 'projectAdmin');
    await loaded(page);
    await expect(whatOf(rowOf(page, 'An invitation to invoicer-api expired'))).toHaveText(
      'An invitation to invoicer-api expired',
    );
    await expect(page.getByText('invoicer-web')).toHaveCount(0);
  });

  test("TC-27.8: a project named with markup shows as plain text, on the org Audit log and on P's Audit log", async ({
    page,
  }) => {
    await open(page, 'owner');
    await loaded(page);
    const markup = '<i>markup-project</i>';
    const here = whatOf(rowOf(page, 'markup.guest@contractor.io'));
    await expect(here).toHaveText(`Kim Hale invited markup.guest@contractor.io as Admin to ${markup}, invoicer-api`);
    await expect(page.locator('tbody i')).toHaveCount(0);
    await expect(here.getByRole('link')).toHaveCount(0);

    await page.goto(ORG_AUDIT);
    await loaded(page);
    const there = whatOf(rowOf(page, 'markup.guest@contractor.io'));
    await expect(there).toHaveText(`Alice Doe invited markup.guest@contractor.io as Admin to ${markup}`);
    await expect(page.locator('tbody i')).toHaveCount(0);
    await expect(there.getByRole('link')).toHaveCount(0);
  });
});
