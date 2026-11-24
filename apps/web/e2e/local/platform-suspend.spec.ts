import { randomBytes } from 'node:crypto';
import {
  AuditEntryDto,
  ORG_HEADER,
  ORG_SUSPENDED_PROBLEM_TYPE,
  PlatformOrgDetailDto,
  pageOf,
} from '@agentdesk/contracts';
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import {
  API,
  PLATFORM_ADMIN_HANDLE,
  acceptViaApi,
  asPlatformAdmin,
  createOrg,
  freshUser,
  inviteAndSignIn,
  inviteViaApi,
  ok,
  platformAdminContext,
  platformOrgIdBySlug,
  reactivateOrg,
  signInAndCreateProject,
  suspendOrg,
} from './helpers';

/*
 * Local end-to-end for suspending an organization (spec 2026-11-23-platform-admin-dashboard-design.md "E2E requirements":
 * TC-32.2, TC-34.2, TC-37.4, TC-38.1 to TC-38.4, TC-42.1, TC-43.2, TC-51.2). "admin" is `admin@dev.local`, seeded by the
 * local stack start; its own org is never suspended. Every case makes fresh `e2e-<rand>` orgs (orgs cannot be deleted),
 * finds its rows by searching the fresh slug, and registers every org it suspends so `afterEach` reactivates it, errors
 * swallowed. No shared org is ever suspended.
 */

test.describe.configure({ timeout: 300_000 });

const ORGS = '/platform/orgs';

let pa: APIRequestContext;
const toClose: BrowserContext[] = [];
const toDispose: APIRequestContext[] = [];
const toReactivate: string[] = [];

test.beforeAll(async ({ request: probe }) => {
  const ready = await probe.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
  pa = await asPlatformAdmin();
});

test.afterEach(async () => {
  for (const id of toReactivate.splice(0)) await reactivateOrg(pa, id, 'e2e cleanup').catch(() => null);
  for (const api of toDispose.splice(0)) await api.dispose().catch(() => null);
  for (const ctx of toClose.splice(0)) await ctx.close().catch(() => null);
});

test.afterAll(async () => {
  await pa?.dispose().catch(() => null);
});

const tagOf = (): string => randomBytes(4).toString('hex');
const bodyRows = (page: Page): Locator => page.locator('tbody tr');
const suspendedTitle = (page: Page): Locator =>
  page.getByRole('heading', { name: 'This organization is suspended', level: 1 });
const header = (page: Page): Locator => page.getByRole('heading', { level: 1 }).locator('xpath=..');

/** Suspends `orgId` and registers it for the `afterEach` reactivation. */
async function suspend(orgId: string, reason: string): Promise<void> {
  toReactivate.push(orgId);
  await suspendOrg(pa, orgId, reason);
}

async function adminPage(browser: Parameters<typeof platformAdminContext>[0]): Promise<Page> {
  const context = await platformAdminContext(browser);
  toClose.push(context);
  return context.newPage();
}

/** Opens the directory and searches the fresh `slug`. */
async function searchDirectory(page: Page, slug: string): Promise<void> {
  await page.goto(ORGS);
  await expect(page.getByRole('heading', { name: 'Organizations', level: 1 })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search organizations' }).fill(slug);
}

/** The directory row of `slug` (searched) shows `status` in its Status cell. */
async function expectRowStatus(page: Page, slug: string, status: 'Active' | 'Suspended'): Promise<void> {
  await searchDirectory(page, slug);
  const row = bodyRows(page).filter({ hasText: `/o/${slug}` });
  await expect(row).toHaveCount(1);
  await expect(row.locator('td').nth(5)).toHaveText(status);
}

/** The platform detail page of the org shows `status` in its header. */
async function expectDetailStatus(
  page: Page,
  orgId: string,
  name: string,
  status: 'Active' | 'Suspended',
): Promise<void> {
  await page.goto(`${ORGS}/${orgId}`);
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  await expect(header(page).getByText(status, { exact: true })).toBeVisible();
  await expect(header(page).getByText(status === 'Active' ? 'Suspended' : 'Active', { exact: true })).toHaveCount(0);
}

/** The refusal of a suspended org: 403, problem type `org-suspended`, and nothing of the reason or the org's data. */
async function expectSuspendedRefusal(res: APIResponse, forbidden: string[]): Promise<void> {
  const text = await res.text();
  expect(res.status(), text).toBe(403);
  const body = JSON.parse(text) as { type?: string; title?: string; detail?: string };
  expect(body.type, text).toMatch(new RegExp(`(^|[:/])${ORG_SUSPENDED_PROBLEM_TYPE}$`));
  expect(body.title, text).toBe('Forbidden');
  expect(body.detail, text).toBe('This organization is suspended.');
  for (const secret of forbidden) expect(text, `the refusal carries ${secret}`).not.toContain(secret);
}

interface World {
  handle: string;
  orgId: string;
  projectId: string;
  /** The owner's page (signed in, on the fixture context). */
  owner: Page;
  reason: string;
}

/** A fresh org with its owner and one project, over the API and the fake board (not yet suspended). */
async function newWorld(page: Page): Promise<World> {
  const { handle, projectId } = await signInAndCreateProject(page);
  const orgId = await platformOrgIdBySlug(pa, handle);
  return { handle, orgId, projectId, owner: page, reason: `Billing hold ${tagOf()}` };
}

test.describe('BR-32: suspend an active organization', () => {
  test('TC-32.2: a fresh org suspended with a reason shows "Suspended" on its detail and in the directory row', async ({
    browser,
  }) => {
    const handle = `e2e-${tagOf()}`;
    const name = `E2E ${handle}`;
    const org = await createOrg(pa, name, handle);
    await suspend(org.id, `Billing hold ${tagOf()}`);

    const mine = await adminPage(browser);
    await expectRowStatus(mine, handle, 'Suspended');
    await expectDetailStatus(mine, org.id, name, 'Suspended');
  });
});

test.describe('BR-34: reactivate a suspended organization', () => {
  test('TC-34.2: a fresh suspended org reactivated with a reason shows "Active" on its detail and in the directory row', async ({
    browser,
  }) => {
    const handle = `e2e-${tagOf()}`;
    const name = `E2E ${handle}`;
    const org = await createOrg(pa, name, handle);
    await suspend(org.id, 'Billing hold');
    await reactivateOrg(pa, org.id, 'Paid');

    const mine = await adminPage(browser);
    await expectRowStatus(mine, handle, 'Active');
    await expectDetailStatus(mine, org.id, name, 'Active');
  });
});

test.describe('BR-37: what a member of a suspended org sees', () => {
  test('TC-37.4: the owner of a suspended org sees "This organization is suspended" and opens their other org from the org menu', async ({
    page,
  }) => {
    const tag = tagOf();
    const aSlug = `e2e-a-${tag}`;
    const bSlug = `e2e-b-${tag}`;
    const a = await createOrg(pa, `E2E A ${tag}`, aSlug);
    const b = await createOrg(pa, `E2E B ${tag}`, bSlug);
    // The owner joins A first (the session starts there), then accepts the invitation to B.
    const owner = `e2e-o-${tag}`;
    await inviteAndSignIn(page, pa, a.id, owner, 'owner', { type: 'org' });
    const second = await inviteViaApi(pa, b.id, `${owner}@dev.local`, 'owner', { type: 'org' });
    await acceptViaApi(page, second.id);
    await suspend(a.id, 'Billing hold');

    // Step 1: the suspended org's page.
    await page.goto(`/o/${aSlug}/projects`);
    await expect(suspendedTitle(page)).toBeVisible();
    await expect(
      page.getByText(`You can't open E2E A ${tag} right now. Contact your Agent Desk administrator.`, { exact: true }),
    ).toBeVisible();

    // Step 2: the org menu offers the other org and opens its pages.
    await page.getByRole('button', { name: /^Switch scope/ }).click();
    const menu = page.getByRole('dialog', { name: 'Scope' });
    await expect(menu).toBeVisible();
    await menu
      .getByRole('group', { name: 'Switch organization' })
      .getByRole('link', { name: new RegExp(`E2E B ${tag}`) })
      .click();
    await expect(page).toHaveURL(new RegExp(`/o/${bSlug}/projects$`));
    await expect(page.getByRole('button', { name: `Switch scope, currently organization E2E B ${tag}` })).toBeVisible();
    await expect(suspendedTitle(page)).toHaveCount(0);
  });
});

test.describe('BR-38: the API refuses a suspended org', () => {
  test('TC-38.1: the owner of a suspended org gets 403 org-suspended on GET projects, with no project data and no reason', async ({
    page,
  }) => {
    const w = await newWorld(page);
    await suspend(w.orgId, w.reason);

    const res = await w.owner.request.get(`/api/orgs/${w.orgId}/projects`, { headers: { [ORG_HEADER]: w.orgId } });
    await expectSuspendedRefusal(res, [w.reason, w.projectId, 'dev/demo']);
  });

  test('TC-38.2: a member of a suspended org gets 403 org-suspended on GET /api/me/access', async ({
    browser,
    page,
  }) => {
    const w = await newWorld(page);
    const context = await browser.newContext();
    toClose.push(context);
    const memberPage = await context.newPage();
    await inviteAndSignIn(memberPage, pa, w.orgId, `e2e-m-${tagOf()}`, 'member', { type: 'org' });
    await suspend(w.orgId, w.reason);

    const res = await memberPage.request.get('/api/me/access', { headers: { [ORG_HEADER]: w.orgId } });
    await expectSuspendedRefusal(res, [w.reason]);
  });

  test('TC-38.3: admin@dev.local gets 200 and the detail of a suspended org from the platform route', async ({
    page,
  }) => {
    const w = await newWorld(page);
    await suspend(w.orgId, w.reason);

    const detail = PlatformOrgDetailDto.parse(
      await ok(await pa.get(`/api/platform/orgs/${w.orgId}`), 200, 'platform org detail'),
    );
    expect(detail.id).toBe(w.orgId);
    expect(detail.slug).toBe(w.handle);
    expect(detail.status).toBe('suspended');
    expect(detail.suspendedAt).not.toBeNull();
    expect(detail.suspension?.reason).toBe(w.reason);
  });

  test('TC-38.4: a non-member gets 403 on GET projects of an org that is not suspended, without the org-suspended type', async ({
    page,
  }) => {
    const w = await newWorld(page);
    const user = await freshUser(pa, w.orgId);
    toDispose.push(user.api);

    // Spec step: GET /api/orgs/<org id>/projects. The user has no active org (an invitation is not accepted, and
    // set-active on an org one is not in is refused), so the session guard answers 403 "No active organization".
    // The membership branch (a non-member of the ACTIVE org) cannot be reached from the local stack; the API int test
    // apps/api/test/org-suspended.int.test.ts ("answers a non-member the plain 403 and never the suspension") covers it.
    const res = await user.api.get(`/api/orgs/${w.orgId}/projects`);
    const text = await res.text();
    expect(res.status(), text).toBe(403);
    expect(text).not.toContain(ORG_SUSPENDED_PROBLEM_TYPE);
    expect(text).not.toContain('This organization is suspended');
    expect(text).not.toContain(w.projectId);

    // Naming the org in the header is the org-mismatch refusal (409): still not the suspension, and no project data.
    const named = await user.api.get(`/api/orgs/${w.orgId}/projects`, { headers: { [ORG_HEADER]: w.orgId } });
    const namedText = await named.text();
    expect(named.status(), namedText).toBe(409);
    expect((JSON.parse(namedText) as { type?: string }).type, namedText).toMatch(/(^|[:/])org-mismatch$/);
    expect(namedText).not.toContain(ORG_SUSPENDED_PROBLEM_TYPE);
    expect(namedText).not.toContain(w.projectId);
  });
});

test.describe('BR-42: reactivating opens the org again', () => {
  test('TC-42.1: after the org is reactivated its owner reloads and its pages open again', async ({ page }) => {
    const w = await newWorld(page);
    await suspend(w.orgId, w.reason);
    await page.goto(`/o/${w.handle}/projects`);
    await expect(suspendedTitle(page)).toBeVisible();

    await reactivateOrg(pa, w.orgId, 'Paid');
    await page.reload();

    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
    await expect(suspendedTitle(page)).toHaveCount(0);
  });
});

test.describe('BR-43: the org audit log of a suspension', () => {
  test('TC-43.2: the owner sees the suspended and reactivated rows tagged "Platform admin" and with no reason', async ({
    page,
  }) => {
    const w = await newWorld(page);
    await suspend(w.orgId, w.reason);
    await reactivateOrg(pa, w.orgId, `Paid ${w.reason}`);

    await page.goto(`/o/${w.handle}/settings/audit`);
    await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();
    for (const sentence of ['suspended the organization', 'reactivated the organization']) {
      const row = bodyRows(page).filter({
        has: page.locator('td:nth-child(3)', { hasText: new RegExp(`^\\s*${sentence}\\s*$`) }),
      });
      await expect(row).toHaveCount(1);
      await expect(row.locator('td:nth-child(2)').getByText('Platform admin', { exact: true })).toBeVisible();
      await expect(row).not.toContainText(w.reason);
      await expect(row).not.toContainText(/reason/i);
    }
    // The audit API carries no reason either.
    const entries = pageOf(AuditEntryDto).parse(
      await ok(await page.request.get(`/api/orgs/${w.orgId}/audit?pageSize=100`), 200, 'audit list'),
    ).items;
    expect(JSON.stringify(entries)).not.toContain(w.reason);
  });
});

test.describe('BR-51: a platform admin who is an owner of a suspended org', () => {
  test('TC-51.2: after the org is suspended /platform/orgs opens, the org menu keeps "Platform admin", and /o/<slug>/projects shows "This organization is suspended"', async ({
    browser,
  }) => {
    const handle = `e2e-${tagOf()}`;
    const org = await createOrg(pa, `E2E ${handle}`, handle);
    // admin@dev.local joins this fresh org as its owner (its own org is never touched).
    const invite = await inviteViaApi(pa, org.id, `${PLATFORM_ADMIN_HANDLE}@dev.local`, 'owner', { type: 'org' });
    await ok(await pa.post(`/api/me/invitations/${invite.id}/accept`), 200, 'accept invitation');

    // Given: the fresh org is the admin's ACTIVE org (opening its pages sets it; a new session would start in the
    // oldest membership), so once it is suspended every org route of this session is refused.
    const mine = await adminPage(browser);
    await mine.goto(`/o/${handle}/projects`);
    await expect(mine.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
    await ok(await mine.request.get('/api/me/access', { headers: { [ORG_HEADER]: org.id } }), 200, 'access, active');

    // Step 1: suspend. The session's active org is now the refused one.
    await suspend(org.id, 'Billing hold');
    await expectSuspendedRefusal(await mine.request.get('/api/me/access', { headers: { [ORG_HEADER]: org.id } }), [
      'Billing hold',
    ]);

    // Step 2: /platform/orgs still opens, as the platform routes are not org routes.
    await mine.goto(ORGS);
    await expect(mine.getByRole('heading', { name: 'Organizations', level: 1 })).toBeVisible();

    // The suspended org's page shows the message, and its org menu still offers "Platform admin".
    await mine.goto(`/o/${handle}/projects`);
    await expect(suspendedTitle(mine)).toBeVisible();
    await mine.getByRole('button', { name: /^Switch scope/ }).click();
    const menu = mine.getByRole('dialog', { name: 'Scope' });
    await expect(menu).toBeVisible();
    await menu.getByRole('link', { name: 'Platform admin' }).click();
    await expect(mine).toHaveURL(/\/platform(\/|$)/);
    await expect(mine.getByRole('heading', { name: 'Organizations', level: 1 })).toBeVisible();
  });
});
