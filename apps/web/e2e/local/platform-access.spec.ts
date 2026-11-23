import { PlatformOrgDto, pageOf } from '@agentdesk/contracts';
import { expect, test, type APIRequestContext, type BrowserContext } from '@playwright/test';
import { API, asPlatformAdmin, platformAdminContext, signInAndCreateProject } from './helpers';

/*
 * Local end-to-end for "a platform admin who is not a member gets no tenant data" (spec "E2E requirements": TC-23.1,
 * TC-23.2). The org is a fresh `e2e-<rand>` org made by `signInAndCreateProject` (an owner and one project); the
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
