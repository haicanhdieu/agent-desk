import { randomBytes, randomUUID } from 'node:crypto';
import {
  ORG_HEADER,
  ORG_SUSPENDED_PROBLEM_TYPE,
  PlatformOrgDetailDto,
  PlatformOrgDto,
  pageOf,
} from '@agentdesk/contracts';
import { expect, request, test, type APIRequestContext, type BrowserContext } from '@playwright/test';
import {
  API,
  asPlatformAdmin,
  createOrg,
  freshUser,
  inviteAndSignIn,
  ok,
  platformAdminContext,
  platformOrgIdBySlug,
  reactivateOrg,
  signInAndCreateProject,
  suspendOrg,
} from './helpers';

/*
 * Local end-to-end for "a platform admin who is not a member gets no tenant data" (spec "E2E requirements": TC-23.1,
 * TC-23.2; BR-36 below: TC-36.1 to TC-36.4). The org is a fresh `e2e-<rand>` org made by `signInAndCreateProject` (an owner and one project); the
 * signed-in platform admin (`admin@dev.local`, never changed) is not a member of it. Orgs cannot be deleted.
 */

test.describe.configure({ timeout: 300_000 });

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

test.describe('BR-23: a non-member platform admin gets no org data', () => {
  test('TC-23.1: /o/<slug>/projects shows no project, member or org data, the same as for any non-member', async ({
    browser,
    page,
  }) => {
    const { handle } = await signInAndCreateProject(page);
    const context = await platformAdminContext(browser);
    toClose.push(context);
    const mine = await context.newPage();

    await mine.goto(`/o/${handle}/projects`);
    await expect(mine.locator('main, body').first()).toBeVisible();
    await mine.waitForLoadState('networkidle');
    const shown = await mine.locator('body').innerText();
    for (const secret of [`E2E ${handle}`, `${handle}@dev.local`, 'dev/demo']) {
      expect(shown, `the page shows ${secret}`).not.toContain(secret);
    }
    await expect(mine.getByRole('heading', { name: 'Projects', level: 1 })).toHaveCount(0);
    await expect(mine.getByRole('heading', { name: 'Page not found' })).toBeVisible();

    // The refusal is the one any non-member gets: the page of a slug that does not exist reads the same.
    const unknown = `e2e-none-${handle}`;
    await mine.goto(`/o/${unknown}/projects`);
    await expect(mine.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await mine.waitForLoadState('networkidle');
    const unknownShown = await mine.locator('body').innerText();
    expect(shown.split(handle).join('<slug>')).toBe(unknownShown.split(unknown).join('<slug>'));
  });

  test('TC-23.2: GET /api/orgs/<org id> with the org pinned is 403 and carries no org data', async ({ page }) => {
    const { handle } = await signInAndCreateProject(page);
    const orgs = pageOf(PlatformOrgDto).parse(
      await (await pa.get('/api/platform/orgs?pageSize=100&q=' + encodeURIComponent(handle))).json(),
    );
    const org = orgs.items.find((o) => o.slug === handle);
    expect(org, `org ${handle} is not in the platform directory`).toBeTruthy();
    const orgId = org?.id ?? '';

    const res = await pa.get(`/api/orgs/${orgId}`, { headers: { 'x-org-id': orgId } });
    const text = await res.text();
    expect(res.status(), text).toBe(403);
    for (const secret of [handle, `E2E ${handle}`, `${handle}@dev.local`]) {
      expect(text, `the 403 carries ${secret}`).not.toContain(secret);
    }
  });
});

/*
 * BR-36 (spec "E2E requirements": TC-36.1 to TC-36.4): only a platform admin suspends or reactivates. Every org is a
 * fresh `e2e-<rand>` org; the one case that suspends (TC-36.2) reactivates it in `afterEach`, errors swallowed.
 */
const toReactivate: string[] = [];

test.afterEach(async () => {
  for (const id of toReactivate.splice(0)) await reactivateOrg(pa, id, 'e2e cleanup').catch(() => null);
});

async function statusOf(orgId: string): Promise<string> {
  return PlatformOrgDetailDto.parse(await ok(await pa.get(`/api/platform/orgs/${orgId}`), 200, 'platform org')).status;
}

test.describe('BR-36: who can suspend or reactivate', () => {
  test('TC-36.1: the owner of an org gets 403 on POST suspend and the org stays active', async ({ page }) => {
    const { handle } = await signInAndCreateProject(page);
    const orgId = await platformOrgIdBySlug(pa, handle);

    const res = await page.request.post(`/api/platform/orgs/${orgId}/suspend`, { data: { reason: 'x' } });
    expect(res.status(), await res.text()).toBe(403);

    expect(await statusOf(orgId)).toBe('active');
    // Its pages still open for the owner.
    await page.goto(`/o/${handle}/projects`);
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'This organization is suspended', level: 1 })).toHaveCount(0);
    await ok(
      await page.request.get(`/api/orgs/${orgId}/projects`, { headers: { [ORG_HEADER]: orgId } }),
      200,
      'projects',
    );
  });

  test('TC-36.2: a member of a suspended org gets 403 on POST reactivate and the org stays suspended', async ({
    page,
  }) => {
    const handle = `e2e-${randomBytes(4).toString('hex')}`;
    const org = await createOrg(pa, `E2E ${handle}`, handle);
    toReactivate.push(org.id);
    await inviteAndSignIn(page, pa, org.id, handle, 'member', { type: 'org' });
    await suspendOrg(pa, org.id, 'e2e member refusal');
    expect(await statusOf(org.id)).toBe('suspended');

    const res = await page.request.post(`/api/platform/orgs/${org.id}/reactivate`, { data: { reason: 'x' } });
    const text = await res.text();
    expect(res.status(), text).toBe(403);
    // The member's active org is the suspended one, so the refusal must come from the platform-admin check
    // (it runs before any org check), not from the org-suspended guard.
    expect(text).not.toContain(ORG_SUSPENDED_PROBLEM_TYPE);
    expect(text).not.toContain('This organization is suspended');

    expect(await statusOf(org.id)).toBe('suspended');
  });

  test('TC-36.3: a user in no org gets the same 403 on POST suspend for an unknown id as for a real org id', async () => {
    const handle = `e2e-${randomBytes(4).toString('hex')}`;
    const org = await createOrg(pa, `E2E ${handle}`, handle);
    const user = await freshUser(pa, org.id);
    try {
      const unknown = await user.api.post(`/api/platform/orgs/${randomUUID()}/suspend`, { data: { reason: 'x' } });
      const unknownText = await unknown.text();
      expect(unknown.status(), unknownText).toBe(403);
      const real = await user.api.post(`/api/platform/orgs/${org.id}/suspend`, { data: { reason: 'x' } });
      const realText = await real.text();
      expect(real.status(), realText).toBe(403);
      // No 404 and no wording that tells a real id from an unknown one.
      expect((JSON.parse(unknownText) as { title?: string }).title).toBe(
        (JSON.parse(realText) as { title?: string }).title,
      );
      expect(await statusOf(org.id)).toBe('active');
    } finally {
      await user.api.dispose().catch(() => null);
    }
  });

  test('TC-36.4: a signed-out POST suspend is 401 and the org stays active', async () => {
    const handle = `e2e-${randomBytes(4).toString('hex')}`;
    const org = await createOrg(pa, `E2E ${handle}`, handle);
    const anon = await request.newContext({ baseURL: API });
    try {
      const res = await anon.post(`/api/platform/orgs/${org.id}/suspend`);
      expect(res.status(), await res.text()).toBe(401);
    } finally {
      await anon.dispose().catch(() => null);
    }
    expect(await statusOf(org.id)).toBe('active');
  });
});
