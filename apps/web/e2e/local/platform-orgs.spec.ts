import { randomBytes } from 'node:crypto';
import { PlatformMemberDto, PlatformOrgDto, pageOf } from '@agentdesk/contracts';
import { expect, test, type APIRequestContext, type BrowserContext, type Locator, type Page } from '@playwright/test';
import {
  API,
  asPlatformAdmin,
  createOrg,
  inviteAndSignIn,
  ok,
  platformAdminContext,
  signInAndCreateProject,
} from './helpers';

/*
 * Local end-to-end for the platform Organizations directory (spec "E2E requirements": TC-18.2, TC-19.2, TC-20.6,
 * TC-21.2). "admin" is `admin@dev.local`, seeded by the local stack start, and is never changed. Every case makes
 * fresh `e2e-<rand>` orgs (orgs cannot be deleted) and finds its rows by searching the fresh slug, never by position
 * or by a global count.
 */

test.describe.configure({ timeout: 300_000 });

const ORGS = '/platform/orgs';

let pa: APIRequestContext;
const toClose: BrowserContext[] = [];

test.beforeAll(async ({ request: probe }) => {
  const ready = await probe.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
  pa = await asPlatformAdmin();
});

test.afterEach(async () => {
  for (const ctx of toClose.splice(0)) await ctx.close().catch(() => null);
});

test.afterAll(async () => {
  await pa?.dispose().catch(() => null);
});

const tagOf = (): string => randomBytes(4).toString('hex');
const bodyRows = (page: Page): Locator => page.locator('tbody tr');

async function adminPage(browser: Parameters<typeof platformAdminContext>[0]): Promise<Page> {
  const context = await platformAdminContext(browser);
  toClose.push(context);
  return context.newPage();
}

/** Opens the directory and searches `term` (a fresh slug or a prefix of fresh slugs). */
async function searchDirectory(page: Page, term: string): Promise<void> {
  await page.goto(ORGS);
  await expect(page.getByRole('heading', { name: 'Organizations', level: 1 })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search organizations' }).fill(term);
}

/** The display name of the org's member with `email`, as the platform members list gives it. */
async function memberName(orgId: string, email: string): Promise<string> {
  const members = pageOf(PlatformMemberDto).parse(
    await ok(await pa.get(`/api/platform/orgs/${orgId}/members?pageSize=100`), 200, 'platform members'),
  );
  const member = members.items.find((m) => m.email === email);
  expect(member, `${email} is not a member of org ${orgId}`).toBeTruthy();
  return member?.name ?? '';
}

test.describe('BR-18: the directory columns', () => {
  test('TC-18.2: a fresh org with an owner and a project is the newest row with its owner, Members, Projects 1 and Active', async ({
    browser,
    page,
  }) => {
    // An org created by the platform admin, its owner invited and accepted, and one project set up by that owner.
    const { handle } = await signInAndCreateProject(page);
    const mine = await adminPage(browser);
    await searchDirectory(mine, handle);
    const row = bodyRows(mine).filter({ hasText: `/o/${handle}` });
    await expect(row).toHaveCount(1);
    const cells = row.first().locator('td');
    const orgs = pageOf(PlatformOrgDto).parse(
      await ok(await pa.get(`/api/platform/orgs?pageSize=100&q=${encodeURIComponent(handle)}`), 200, 'platform orgs'),
    );
    const orgId = orgs.items.find((o) => o.slug === handle)?.id;
    expect(orgId, `org ${handle} is not in the platform directory`).toBeTruthy();
    await expect(cells.nth(1)).toHaveText(await memberName(orgId ?? '', `${handle}@dev.local`));
    await expect(cells.nth(2)).toHaveText('1');
    await expect(cells.nth(3)).toHaveText('1');
    await expect(cells.nth(5)).toHaveText('Active');

    // Newest first: an org created after it, whose slug also contains the searched handle, is listed above it.
    const later = await createOrg(pa, `E2E later ${handle}`, `${handle}-later`);
    await searchDirectory(mine, handle);
    await expect(bodyRows(mine)).toHaveCount(2);
    await expect(bodyRows(mine).first()).toContainText(`/o/${handle}-later`);
    await expect(bodyRows(mine).nth(1)).toContainText(`/o/${handle}`);
    expect(later.slug).toBe(`${handle}-later`);
  });
});

test.describe('BR-19: owner and last activity', () => {
  test('TC-19.2: an org with one owner and no run shows the owner name and "No activity yet"', async ({
    browser,
    page,
  }) => {
    const handle = `e2e-${tagOf()}`;
    const org = await createOrg(pa, `E2E ${handle}`, handle);
    await inviteAndSignIn(page, pa, org.id, handle, 'owner', { type: 'org' });
    const ownerName = await memberName(org.id, `${handle}@dev.local`);

    const mine = await adminPage(browser);
    await searchDirectory(mine, handle);
    const row = bodyRows(mine).filter({ hasText: `/o/${handle}` });
    await expect(row).toHaveCount(1);
    await expect(row.locator('td').nth(1)).toHaveText(ownerName);
    await expect(row.locator('td').nth(4)).toHaveText('No activity yet');
  });
});

test.describe('BR-20: search', () => {
  test('TC-20.6: typing a fresh slug in "Search organizations" shows exactly that org', async ({ browser }) => {
    const handle = `e2e-${tagOf()}`;
    // A second org whose name and slug share nothing with the handle (the search matches name or slug).
    const other = tagOf();
    await createOrg(pa, `E2E unrelated ${other}`, `e2e-unrelated-${other}`);
    await createOrg(pa, `E2E ${handle}`, handle);

    const mine = await adminPage(browser);
    await searchDirectory(mine, handle);
    await expect(bodyRows(mine)).toHaveCount(1);
    await expect(bodyRows(mine).first()).toContainText(`/o/${handle}`);
  });
});

test.describe('BR-21: creating an organization from the directory', () => {
  test('TC-21.2: "Create organization" with a unique name and slug lists the org with "No owner yet"', async ({
    browser,
  }) => {
    const handle = `e2e-${tagOf()}`;
    const mine = await adminPage(browser);
    await mine.goto(ORGS);
    await expect(mine.getByRole('heading', { name: 'Organizations', level: 1 })).toBeVisible();
    await mine.getByRole('link', { name: 'Create organization' }).click();

    await expect(mine.getByRole('heading', { name: 'Create an organization', level: 1 })).toBeVisible();
    await mine.getByLabel('Name', { exact: true }).fill(`E2E ${handle}`);
    await mine.getByLabel('URL', { exact: true }).fill(handle);
    // The form also asks for the first owner's email; the invitation it makes is not an owner assignment yet.
    await mine.getByLabel('First owner email').fill(`${handle}@dev.local`);
    await mine.getByRole('button', { name: 'Create organization' }).click();
    await expect(mine.getByRole('heading', { name: 'Organization created' })).toBeVisible();

    await searchDirectory(mine, handle);
    const row = bodyRows(mine).filter({ hasText: `/o/${handle}` });
    await expect(row).toHaveCount(1);
    await expect(row.locator('td').nth(1)).toHaveText('No owner yet');
  });
});
