import { randomBytes, randomUUID } from 'node:crypto';
import {
  ORG_HEADER,
  ORG_SUSPENDED_PROBLEM_TYPE,
  PlatformOrgDetailDto,
  PlatformOrgDto,
  pageOf,
} from '@agentdesk/contracts';
import { expect, request, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import {
  API,
  asPlatformAdmin,
  createOrg,
  freshUser,
  grantPlatformAdmin,
  inviteAndSignIn,
  ok,
  platformAdminContext,
  platformAuditFor,
  platformOrgIdBySlug,
  reactivateOrg,
  revokePlatformAdmin,
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

  test('TC-23.2: GET /api/orgs/<org id>/checklist with the org pinned is 409 org-mismatch and carries no org data', async ({
    page,
  }) => {
    const { handle } = await signInAndCreateProject(page);
    const orgs = pageOf(PlatformOrgDto).parse(
      await (await pa.get('/api/platform/orgs?pageSize=100&q=' + encodeURIComponent(handle))).json(),
    );
    const org = orgs.items.find((o) => o.slug === handle);
    expect(org, `org ${handle} is not in the platform directory`).toBeTruthy();
    const orgId = org?.id ?? '';

    const res = await pa.get(`/api/orgs/${orgId}/checklist`, { headers: { 'x-org-id': orgId } });
    const text = await res.text();
    expect(res.status(), text).toBe(409);
    expect(JSON.parse(text)).toMatchObject({ type: 'org-mismatch' });
    for (const secret of [handle, `E2E ${handle}`, `${handle}@dev.local`]) {
      expect(text, `the 409 carries ${secret}`).not.toContain(secret);
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
    await ok(await page.request.get('/api/projects', { headers: { [ORG_HEADER]: orgId } }), 200, 'projects');
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

/*
 * BR-52 (spec "E2E requirements": TC-52.1, TC-52.2): only a platform admin edits an org. A fresh `e2e-<rand>` org, its
 * owner and a member; the name is read back from the platform route after each refusal.
 */
async function nameOf(orgId: string): Promise<string> {
  return PlatformOrgDetailDto.parse(await ok(await pa.get(`/api/platform/orgs/${orgId}`), 200, 'platform org')).name;
}

test.describe('BR-52: who can edit an organization', () => {
  test('TC-52.1: the owner and a member of an org get 403 on PATCH and the name is unchanged', async ({
    browser,
    page,
  }) => {
    const handle = `e2e-${randomBytes(4).toString('hex')}`;
    const name = `E2E ${handle}`;
    const org = await createOrg(pa, name, handle);
    await inviteAndSignIn(page, pa, org.id, handle, 'owner', { type: 'org' });
    const context = await browser.newContext();
    toClose.push(context);
    const memberPage = await context.newPage();
    await inviteAndSignIn(memberPage, pa, org.id, `${handle}-m`, 'member', { type: 'org' });

    for (const who of [page, memberPage]) {
      const res = await who.request.patch(`/api/platform/orgs/${org.id}`, { data: { name: 'Hacked' } });
      expect(res.status(), await res.text()).toBe(403);
    }
    expect(await nameOf(org.id)).toBe(name);
  });

  test('TC-52.2: the owner opening /platform/orgs/<org id> sees "You don\'t have access" and no Edit organization', async ({
    page,
  }) => {
    const handle = `e2e-${randomBytes(4).toString('hex')}`;
    const org = await createOrg(pa, `E2E ${handle}`, handle);
    await inviteAndSignIn(page, pa, org.id, handle, 'owner', { type: 'org' });

    await page.goto(`/platform/orgs/${org.id}`);
    await expect(page.getByRole('heading', { name: "You don't have access" })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit organization' })).toHaveCount(0);
  });
});

/*
 * BR-3 (TC-3.2): a fresh org with its owner, a member and a viewer, each signed in in a context of its own, none a
 * platform admin. BR-46 (TC-46.1 to TC-46.3): the owner of a fresh org that has platform entries (its creation entry
 * and a suspend and reactivate pair with a reason) cannot read the platform audit.
 */
test.describe('BR-3: a non-admin on a /platform URL', () => {
  for (const roleKey of ['owner', 'member', 'viewer'] as const) {
    test(`TC-3.2: the ${roleKey} sees "You don't have access" on /platform/orgs, /admins and /audit and no org, admin or audit data`, async ({
      page,
    }) => {
      const handle = `e2e-${randomBytes(4).toString('hex')}`;
      const org = await createOrg(pa, `E2E ${handle}`, handle);
      // Another org with a distinctive name and platform audit entries: none of it may show on the forbidden pages.
      const otherHandle = `e2e-other-${randomBytes(4).toString('hex')}`;
      const otherName = `E2E Other ${otherHandle}`;
      const other = await createOrg(pa, otherName, otherHandle);
      toReactivate.push(other.id);
      await suspendOrg(pa, other.id, 'e2e other');
      await reactivateOrg(pa, other.id, 'e2e other');
      await inviteAndSignIn(page, pa, org.id, `${handle}-${roleKey}`, roleKey, { type: 'org' });

      for (const path of ['/platform/orgs', '/platform/admins', '/platform/audit']) {
        await page.goto(path);
        const where = `${roleKey} on ${path}`;
        await expect(page.getByRole('heading', { name: "You don't have access" }), where).toBeVisible();
        await expect(page.locator('tbody tr'), where).toHaveCount(0);
        // Only the user's own org name may show (the top bar); nothing of the other org, the admin or the audit.
        const body = page.locator('body');
        for (const secret of [
          otherName,
          otherHandle,
          'admin@dev.local',
          'Organization suspended',
          'Organization reactivated',
        ]) {
          await expect(body, `${where} shows ${secret}`).not.toContainText(secret);
        }
      }
    });
  }
});

test.describe('BR-46: a non-admin cannot read the platform audit', () => {
  const reason = 'e2e platform-only reason';

  async function orgWithEntries(page: Page): Promise<{ id: string; slug: string; ownerApi: APIRequestContext }> {
    const slug = `e2e-${randomBytes(4).toString('hex')}`;
    const org = await createOrg(pa, `E2E ${slug}`, slug);
    toReactivate.push(org.id);
    await inviteAndSignIn(page, pa, org.id, slug, 'owner', { type: 'org' });
    await suspendOrg(pa, org.id, reason);
    await reactivateOrg(pa, org.id, reason);
    expect((await platformAuditFor(pa, org.id)).length, 'a platform entry exists for the org').toBeGreaterThan(0);
    return { id: org.id, slug, ownerApi: page.request };
  }

  test('TC-46.1: the owner gets 403 on GET /api/platform/audit and no entry', async ({ page }) => {
    const { ownerApi } = await orgWithEntries(page);

    const res = await ownerApi.get('/api/platform/audit');
    const text = await res.text();
    expect(res.status(), text).toBe(403);
    expect(text).not.toContain(reason);
    expect(text).not.toContain('org.suspended');
  });

  test('TC-46.2: GET /api/platform/audit?orgId=<unknown id> is 403, the same as for a real org id', async ({
    page,
  }) => {
    const { id, ownerApi } = await orgWithEntries(page);

    const unknown = await ownerApi.get(`/api/platform/audit?orgId=${randomUUID()}`);
    const unknownText = await unknown.text();
    expect(unknown.status(), unknownText).toBe(403);
    const real = await ownerApi.get(`/api/platform/audit?orgId=${id}`);
    const realText = await real.text();
    expect(real.status(), realText).toBe(403);
    expect((JSON.parse(unknownText) as { title?: string }).title).toBe(
      (JSON.parse(realText) as { title?: string }).title,
    );
    expect(realText).not.toContain(reason);
  });

  test("TC-46.3: the owner's Settings > Audit shows only tenant entries and no Reason text", async ({ page }) => {
    const { slug } = await orgWithEntries(page);

    await page.goto(`/o/${slug}/settings/audit`);
    await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    const shown = await page.locator('body').innerText();
    expect(shown).not.toContain('Reason');
    expect(shown).not.toContain(reason);
  });
});

/*
 * "Open organization" on the platform org page (spec 2026-11-24-admin-navigation-consistency): shown only for an org the
 * person belongs to; a platform admin who is not a member gets no link and no tenant page. The user is granted the platform
 * role for the test and loses it in `afterEach`.
 */
const grantedAdmins: string[] = [];

test.afterEach(async () => {
  for (const id of grantedAdmins.splice(0)) await revokePlatformAdmin(pa, id).catch(() => null);
});

test.describe('Open organization', () => {
  test('a dual-role user clicks "Open organization" and lands on the org with it active', async ({ page }) => {
    const { handle } = await signInAndCreateProject(page);
    const orgId = await platformOrgIdBySlug(pa, handle);
    const { entry } = await grantPlatformAdmin(pa, `${handle}@dev.local`);
    grantedAdmins.push(entry.id);

    await page.goto(`/platform/orgs/${orgId}`);
    await page.getByRole('link', { name: 'Open organization' }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${handle}/projects$`));
    await expect(
      page.getByRole('button', { name: `Switch scope, currently organization E2E ${handle}` }),
    ).toBeVisible();
  });

  test('a platform admin who is a member of org A sees no "Open organization" on org B and /o/<b-slug> stays not found', async ({
    page,
  }) => {
    const { handle } = await signInAndCreateProject(page);
    const { entry } = await grantPlatformAdmin(pa, `${handle}@dev.local`);
    grantedAdmins.push(entry.id);
    const slugB = `e2e-${randomBytes(4).toString('hex')}`;
    const orgB = await createOrg(pa, `E2E ${slugB}`, slugB);

    await page.goto(`/platform/orgs/${orgB.id}`);
    await expect(page.getByRole('heading', { name: `E2E ${slugB}`, level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open organization' })).toHaveCount(0);

    await page.goto(`/o/${slugB}/projects`);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  });
});
