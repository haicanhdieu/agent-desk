import { randomBytes } from 'node:crypto';
import { PlatformInvitationDto, PlatformMemberDto, ProjectDto, pageOf } from '@agentdesk/contracts';
import { expect, test, type APIRequestContext, type BrowserContext, type Locator, type Page } from '@playwright/test';
import {
  API,
  asPlatformAdmin,
  createOrg,
  inviteAndSignIn,
  ok,
  platformAdminContext,
  platformOrgIdBySlug,
  revoke,
  signInAndCreateProject,
} from './helpers';

/*
 * Local end-to-end for the platform org detail tabs (spec 2026-11-23-platform-admin-dashboard-design.md "E2E
 * requirements": TC-24.3, TC-25.2, TC-27.4, TC-28.3, TC-30.4). Every case makes a fresh `e2e-<rand>` org (orgs cannot be
 * deleted) and fresh users; assignments a case adds are removed and invitations it leaves pending are revoked in
 * `afterEach`, errors swallowed. TC-27.4 goes through the real API and guard: the member's own session is the proof.
 */

test.describe.configure({ timeout: 300_000 });

const ORGS = '/platform/orgs';

let pa: APIRequestContext;
const toClose: BrowserContext[] = [];
/** Cleanups run (newest first) after each case. */
const cleanups: (() => Promise<unknown>)[] = [];

test.beforeAll(async ({ request: probe }) => {
  const ready = await probe.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
  pa = await asPlatformAdmin();
});

test.afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup().catch(() => null);
  for (const ctx of toClose.splice(0)) await ctx.close().catch(() => null);
});

test.afterAll(async () => {
  await pa?.dispose().catch(() => null);
});

const tagOf = (): string => randomBytes(4).toString('hex');
const bodyRows = (page: Page): Locator => page.locator('tbody tr');
const rowOf = (page: Page, text: string): Locator => bodyRows(page).filter({ hasText: text });
const sideMenu = (page: Page): Locator => page.getByRole('navigation', { name: 'Platform admin' });
const tabHeading = (page: Page, name: string): Locator => page.getByRole('heading', { name, level: 2 });

async function freshOrg(): Promise<{ id: string; name: string; slug: string }> {
  const slug = `e2e-${tagOf()}`;
  const name = `E2E ${slug}`;
  const org = await createOrg(pa, name, slug);
  return { id: org.id, name, slug };
}

async function adminPage(browser: Parameters<typeof platformAdminContext>[0]): Promise<Page> {
  const context = await platformAdminContext(browser);
  toClose.push(context);
  return context.newPage();
}

test.describe('BR-24: org detail from the directory', () => {
  test('TC-24.3: open the org from the directory, press Members: the detail shows the owner', async ({
    browser,
    page,
  }) => {
    const org = await freshOrg();
    await inviteAndSignIn(page, pa, org.id, org.slug, 'owner', { type: 'org' });
    const ownerEmail = `${org.slug}@dev.local`;
    const mine = await adminPage(browser);

    await mine.goto(ORGS);
    await expect(mine.getByRole('heading', { name: 'Organizations', level: 1 })).toBeVisible();
    await mine.getByRole('searchbox', { name: 'Search organizations' }).fill(org.slug);
    await mine.getByRole('link', { name: org.name, exact: true }).click();
    await expect(mine).toHaveURL(new RegExp(`${ORGS}/${org.id}$`));
    await expect(mine.getByRole('heading', { name: org.name, level: 1 })).toBeVisible();
    await sideMenu(mine).getByRole('link', { name: 'Members', exact: true }).click();

    await expect(tabHeading(mine, 'Members')).toBeVisible();
    await expect(bodyRows(mine)).toHaveCount(1);
    await expect(rowOf(mine, ownerEmail)).toHaveCount(1);
    await expect(rowOf(mine, ownerEmail).getByRole('cell').nth(2)).toHaveText('Owner (organization)');
  });
});

test.describe('BR-25: Projects show id and name only', () => {
  test('TC-25.2: the one project shows with its id and name and no other column', async ({ browser, page }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const orgId = await platformOrgIdBySlug(pa, handle);
    // The name is read from the owner's own project list, not from the platform route under test.
    const projects = pageOf(ProjectDto).parse(await ok(await page.request.get('/api/projects'), 200, 'projects'));
    expect(projects.items.map((p) => p.id)).toEqual([projectId]);
    const name = projects.items[0]?.name ?? '';
    expect(name).not.toBe('');
    const mine = await adminPage(browser);

    await mine.goto(`${ORGS}/${orgId}/projects`);

    await expect(tabHeading(mine, 'Projects')).toBeVisible();
    await expect(mine.getByRole('columnheader')).toHaveText(['Id', 'Name']);
    await expect(bodyRows(mine)).toHaveCount(1);
    await expect(bodyRows(mine).first().getByRole('cell')).toHaveText([projectId, name]);
  });
});

test.describe('BR-27: add an assignment', () => {
  test("TC-27.4: Owner added through the dialog shows in Members and the member's next request is allowed owner-only settings", async ({
    browser,
    page,
  }) => {
    const org = await freshOrg();
    const { userId } = await inviteAndSignIn(page, pa, org.id, org.slug, 'member', { type: 'org' });
    const email = `${org.slug}@dev.local`;
    // Given: no owner role yet, so an owner-only settings page is refused for this member.
    await page.goto(`/o/${org.slug}/settings/general`);
    await expect(page.getByText("You don't have access")).toBeVisible();
    cleanups.push(async () => {
      const members = pageOf(PlatformMemberDto).parse(
        await ok(await pa.get(`/api/platform/orgs/${org.id}/members?pageSize=100`), 200, 'members'),
      );
      for (const a of members.items.find((m) => m.userId === userId)?.assignments ?? []) {
        if (a.role.key === 'owner') await revoke(pa, org.id, a.id);
      }
    });

    const mine = await adminPage(browser);
    await mine.goto(`${ORGS}/${org.id}/members`);
    await expect(tabHeading(mine, 'Members')).toBeVisible();
    const row = rowOf(mine, email);
    await row.getByRole('button', { name: /^Actions for / }).click();
    await mine.getByRole('button', { name: 'Add assignment' }).click();
    const dialog = mine.getByRole('dialog', { name: 'Add assignment' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Role').locator('option:not([disabled])').first()).toBeAttached();
    await dialog.getByLabel('Role').selectOption({ label: 'Owner' });
    await dialog.getByRole('radio', { name: 'Whole organization' }).check();
    await dialog.getByRole('button', { name: 'Add assignment' }).click();
    await expect(dialog).toHaveCount(0);

    await expect(rowOf(mine, email).getByRole('cell').nth(2)).toContainText('Owner (organization)');

    // The member's next request, in their own session, follows the new assignment.
    await page.goto(`/o/${org.slug}/settings/general`);
    await expect(page.getByRole('heading', { name: 'General', level: 1 })).toBeVisible();
    await expect(page.getByText("You don't have access")).toHaveCount(0);
  });
});

test.describe('BR-28: remove an assignment', () => {
  test('TC-28.3: removing the only Owner assignment succeeds and the directory shows "No owner yet"', async ({
    browser,
    page,
  }) => {
    const org = await freshOrg();
    await inviteAndSignIn(page, pa, org.id, org.slug, 'owner', { type: 'org' });
    const email = `${org.slug}@dev.local`;
    const mine = await adminPage(browser);
    await mine.goto(`${ORGS}/${org.id}/members`);
    await expect(tabHeading(mine, 'Members')).toBeVisible();
    await expect(rowOf(mine, email).getByRole('cell').nth(2)).toHaveText('Owner (organization)');

    await rowOf(mine, email)
      .getByRole('button', { name: /^Actions for / })
      .click();
    await mine.getByRole('button', { name: 'Remove Owner (organization)' }).click();
    const confirm = mine.getByRole('dialog', { name: /^Remove Owner \(organization\) from / });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Remove', exact: true }).click();

    // No refusal: the toast shows, the dialog closes and the assignment is gone.
    await expect(mine.getByRole('status').filter({ hasText: 'Assignment removed' })).toBeVisible();
    await expect(confirm).toHaveCount(0);
    await expect(rowOf(mine, email).getByRole('cell').nth(2)).toHaveText('—');

    await mine.goto(ORGS);
    await mine.getByRole('searchbox', { name: 'Search organizations' }).fill(org.slug);
    const row = rowOf(mine, `/o/${org.slug}`);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('No owner yet');
  });
});

test.describe('BR-30: create and revoke an invitation', () => {
  test('TC-30.4: an Owner invitation shows pending after step 1 and leaves the pending list after revoke', async ({
    browser,
  }) => {
    const org = await freshOrg();
    const email = `e2e-${tagOf()}@dev.local`;
    cleanups.push(async () => {
      const res = await pa.get(`/api/platform/orgs/${org.id}/invitations?status=pending&pageSize=100`);
      const body = pageOf(PlatformInvitationDto).parse(await res.json());
      for (const inv of body.items.filter((i) => i.email === email)) {
        await pa.delete(`/api/platform/orgs/${org.id}/invitations/${inv.id}`);
      }
    });
    const mine = await adminPage(browser);
    await mine.goto(`${ORGS}/${org.id}/invitations`);
    await expect(tabHeading(mine, 'Invitations')).toBeVisible();

    await mine.getByRole('button', { name: 'Invite people' }).first().click();
    const dialog = mine.getByRole('dialog', { name: 'Invite people' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Role').locator('option:not([disabled])').first()).toBeAttached();
    await dialog.getByLabel('Email').fill(email);
    await dialog.getByLabel('Role').selectOption({ label: 'Owner' });
    await dialog.getByRole('radio', { name: 'Whole organization' }).check();
    await dialog.getByRole('button', { name: 'Create invitation' }).click();
    const link = mine.getByRole('dialog', { name: 'Invitation link' });
    await expect(link).toBeVisible();
    await link.getByRole('button', { name: 'Done' }).click();
    await expect(link).toHaveCount(0);

    await expect(rowOf(mine, email)).toHaveCount(1);
    await expect(rowOf(mine, email)).toContainText('Pending');
    await expect(rowOf(mine, email)).toContainText('Owner');

    await mine.getByRole('button', { name: `Actions for ${email}` }).click();
    await mine.getByRole('button', { name: /^revoke$/i }).click();
    const confirm = mine.getByRole('dialog', { name: `Revoke invitation for ${email}?` });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Revoke', exact: true }).click();

    await expect(confirm).toHaveCount(0);
    await expect(rowOf(mine, email)).toHaveCount(0);
    await expect(mine.getByText(email)).toHaveCount(0);
  });
});
