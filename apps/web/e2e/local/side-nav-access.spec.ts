import { randomBytes } from 'node:crypto';
import { ProjectDto } from '@agentdesk/contracts';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import {
  API,
  acceptViaApi,
  createOrg,
  grantPlatformAdmin,
  inviteAndSignIn,
  inviteViaApi,
  ok,
  platformAdminContext,
  revokePlatformAdmin,
  suspendOrg,
} from './helpers';
import { buildCast, disposeCast, disposeSecondOrg, secondOrg, type Actor, type Cast } from './rbac-cast';

/*
 * Local end-to-end for the organization and platform side menus by role, on the real API (spec "E2E requirements":
 * BR-12, BR-13, BR-16 to BR-21, BR-31, BR-32, BR-34; the mock halves are in e2e/mock/side-nav.spec.ts and
 * side-nav-states.spec.ts). The cast is the spec's: O owner, D admin on the org, A admin on P1, B member on P1 and P2,
 * C member on P1, V viewer on the org. Every case only reads (or is refused), so one cast, one second org Y and one
 * platform admin browser serve every case of a worker, built in `beforeAll` and disposed in `afterAll`. Orgs cannot be
 * deleted, so every org a case makes has a random slug.
 */

test.describe.configure({ timeout: 300_000 });

const FIRST = { timeout: 30_000 };
const FULL_ORG_MENU = ['Projects', 'Members', 'Invitations', 'Audit log', 'General'];

let cast: Cast;
let castBuilt: Cast | undefined;
let second: Awaited<ReturnType<typeof secondOrg>> | undefined;
let secondNames: { org: string; project: string; repo: string };
let p2Names: { project: string; repo: string };
/** N: a member of the whole org (not scoped to projects), for the cases that say "an org member". */
let orgMember: Actor;
let adminCtx: BrowserContext | undefined;
let adminPage: Page;
const grantedAdmins: string[] = [];
const extraContexts: BrowserContext[] = [];

test.beforeAll(async ({ browser, request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
  castBuilt = await buildCast(browser);
  cast = castBuilt;
  second = await secondOrg(browser, cast.pa);
  const y = ProjectDto.parse(await ok(await second.owner.api.get(`/api/projects/${second.project}`), 200, 'Y project'));
  secondNames = { org: `RBAC Y ${second.slug.replace('rbac-y-', '')}`, project: y.name, repo: y.repoPath };
  const p2 = ProjectDto.parse(await ok(await cast.o.api.get(`/api/projects/${cast.p2}`), 200, 'P2'));
  p2Names = { project: p2.name, repo: p2.repoPath };
  const memberCtx = await browser.newContext();
  extraContexts.push(memberCtx);
  const memberPage = await memberCtx.newPage();
  const handle = `rbac-n-${randomBytes(3).toString('hex')}`;
  const { userId } = await inviteAndSignIn(memberPage, cast.pa, cast.orgId, handle, 'member', { type: 'org' });
  orgMember = { handle, userId, ctx: memberCtx, page: memberPage, api: memberCtx.request };
  adminCtx = await platformAdminContext(browser);
  adminPage = await adminCtx.newPage();
});

test.afterAll(async () => {
  for (const id of grantedAdmins.splice(0)) await revokePlatformAdmin(cast.pa, id).catch(() => null);
  for (const ctx of extraContexts.splice(0)) await ctx.close().catch(() => null);
  await adminCtx?.close().catch(() => null);
  adminCtx = undefined;
  if (second) await disposeSecondOrg(second);
  second = undefined;
  const done = castBuilt;
  castBuilt = undefined;
  if (done) await disposeCast(done);
});

const orgName = (): string => `RBAC ${cast.slug.replace('rbac-', '')}`;
const orgUrl = (path: string): string => `/o/${cast.slug}/${path}`;
const projectUrl = (project: string, path: string): string => `/o/${cast.slug}/p/${project}/${path}`;

const bar = (page: Page): Locator => page.getByRole('banner').first();
const orgMenu = (page: Page): Locator => page.getByRole('navigation', { name: 'Organization menu' });
const projectMenu = (page: Page): Locator => page.getByRole('navigation', { name: 'Project menu' });
const platformMenu = (page: Page): Locator => page.getByRole('navigation', { name: 'Platform menu' });
const anyMenu = (page: Page): Locator => page.getByRole('navigation', { name: /menu$/ });
const current = (menu: Locator): Locator => menu.locator('[aria-current="page"]');
const settingsHeading = (page: Page): Locator => orgMenu(page).getByText('Settings', { exact: true });
const notFound = (page: Page): Locator => page.getByRole('main').getByRole('heading', { name: 'Page not found' });
const noAccess = (page: Page): Locator =>
  page.getByRole('main').getByRole('heading', { name: "You don't have access" });
const projectsHeading = (page: Page): Locator => page.getByRole('heading', { name: 'Projects', level: 1 });

/** Nothing of `texts` is on the page: not in the visible text (bar, menu, crumbs, content) and not in the title. */
async function appearsNowhere(page: Page, ...texts: string[]): Promise<void> {
  for (const text of texts) {
    await expect(page.locator('body')).not.toContainText(text);
    expect(await page.title()).not.toContain(text);
  }
}

async function openOrgAs(who: Actor, path = 'projects'): Promise<Page> {
  await who.page.goto(orgUrl(path));
  return who.page;
}

test.describe('BR-12: error pages keep the shell', () => {
  test('TC-12.1: a member on Routing rules sees "You don\'t have access" in the main with the project menu and no current item', async () => {
    const page = cast.b.page;
    await page.goto(projectUrl(cast.p1, 'desk/rules'));

    await expect(noAccess(page)).toBeVisible(FIRST);
    await expect(bar(page)).toBeVisible();
    await expect(bar(page).getByText(orgName(), { exact: true })).toBeVisible();
    await expect(bar(page).getByRole('button', { name: /^Switch project, currently/ })).toBeVisible();
    const menu = projectMenu(page);
    await expect(menu.getByRole('link', { name: 'Runs' })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Open repository' })).toBeVisible();
    await expect(menu).toContainText('demo');
    await expect(current(menu)).toHaveCount(0);
  });

  test('TC-12.2: a project admin of P1 on P2\'s Runs address sees "Page not found" with the org menu and no current item', async () => {
    const page = cast.a.page;
    await page.goto(projectUrl(cast.p2, 'runs'));

    await expect(notFound(page)).toBeVisible(FIRST);
    const menu = orgMenu(page);
    await expect(menu).toBeVisible();
    await expect(current(menu)).toHaveCount(0);
    await expect(projectMenu(page)).toHaveCount(0);
    await expect(bar(page).getByText(orgName(), { exact: true })).toBeVisible();
  });

  test('TC-12.3: a non-member org slug shows "Page not found" with no menu and the switcher reading "Organization"', async ({
    browser,
  }) => {
    // A person of two orgs (the cast's and Y) who is not a member of a third org.
    const ctx = await browser.newContext();
    extraContexts.push(ctx);
    const page = await ctx.newPage();
    const handle = `rbac-two-${randomBytes(3).toString('hex')}`;
    await inviteAndSignIn(page, cast.pa, cast.orgId, handle, 'viewer', { type: 'org' });
    const invitation = await inviteViaApi(cast.pa, second?.orgId ?? '', `${handle}@dev.local`, 'viewer', {
      type: 'org',
    });
    await acceptViaApi(page, invitation.id);
    const otherSlug = `rbac-z-${randomBytes(3).toString('hex')}`;
    await createOrg(cast.pa, `RBAC Z ${otherSlug}`, otherSlug);

    await page.goto(`/o/${otherSlug}/projects`);

    await expect(notFound(page)).toBeVisible(FIRST);
    await expect(anyMenu(page)).toHaveCount(0);
    await expect(bar(page)).toBeVisible();
    await expect(bar(page).getByRole('button', { name: /^Switch scope/ })).toHaveText(/Organization/);
    await expect(orgMenu(page)).toHaveCount(0);
  });

  test('TC-12.5: a person who is not a platform admin on /platform/orgs sees the forbidden message with no menu', async () => {
    const page = cast.o.page;
    await page.goto('/platform/orgs');

    await expect(page.getByRole('main').getByText('This area is for platform admins.', { exact: true })).toBeVisible(
      FIRST,
    );
    await expect(anyMenu(page)).toHaveCount(0);
    await expect(bar(page)).toBeVisible();
    await expect(bar(page).getByText(orgName(), { exact: true })).toBeVisible();
  });
});

test.describe('BR-13: an inaccessible name appears nowhere', () => {
  test("TC-13.1: org Y's name and its project's name appear nowhere on its Projects and Runs addresses", async () => {
    const page = cast.b.page;
    const y = second;
    if (!y) throw new Error('the second org is not built');

    await page.goto(`/o/${y.slug}/projects`);
    await expect(notFound(page)).toBeVisible(FIRST);
    await appearsNowhere(page, secondNames.org, secondNames.project, secondNames.repo);

    await page.goto(`/o/${y.slug}/p/${y.project}/runs`);
    await expect(notFound(page)).toBeVisible(FIRST);
    await appearsNowhere(page, secondNames.org, secondNames.project, secondNames.repo);
  });

  test("TC-13.2: P2's name and repository appear nowhere for an admin of P1 only, on its Runs and Routing rules addresses", async () => {
    const page = cast.a.page;

    await page.goto(projectUrl(cast.p2, 'runs'));
    await expect(notFound(page)).toBeVisible(FIRST);
    await appearsNowhere(page, p2Names.project, p2Names.repo);

    await page.goto(projectUrl(cast.p2, 'desk/rules'));
    await expect(notFound(page)).toBeVisible(FIRST);
    await appearsNowhere(page, p2Names.project, p2Names.repo);
  });

  test("TC-13.3: org Y's project id under org A's slug is Not found and names nothing of org Y", async () => {
    const page = cast.b.page;
    const y = second;
    if (!y) throw new Error('the second org is not built');

    await page.goto(projectUrl(y.project, 'runs'));

    await expect(notFound(page)).toBeVisible(FIRST);
    await appearsNowhere(page, secondNames.org, secondNames.project, secondNames.repo);
  });
});

test.describe('BR-16: "Go to projects"', () => {
  test('TC-16.1: from a non-member org\'s address "Go to projects" opens the active org\'s Projects', async () => {
    const page = cast.b.page;
    const y = second;
    if (!y) throw new Error('the second org is not built');
    await page.goto(`/o/${y.slug}/projects`);
    await expect(notFound(page)).toBeVisible(FIRST);

    await page.getByRole('link', { name: 'Go to projects' }).click();

    await expect(projectsHeading(page)).toBeVisible(FIRST);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toHaveCount(0);
    expect(page.url()).not.toContain(y.slug);
  });
});

test.describe('BR-17: owner and admin org menu', () => {
  test('TC-17.1: an owner, then an org admin, see Projects and a Settings group of Members, Invitations, Audit log, General', async () => {
    for (const who of [cast.o, cast.d]) {
      const page = await openOrgAs(who);
      await expect(projectsHeading(page)).toBeVisible(FIRST);
      await expect(orgMenu(page).getByRole('link')).toHaveText(FULL_ORG_MENU);
      await expect(settingsHeading(page)).toBeVisible();
    }
  });

  test('TC-17.2: an org admin opens Members, Invitations, Audit log, General and Projects, each in one click with that item current', async () => {
    const page = await openOrgAs(cast.d);
    await expect(orgMenu(page).getByRole('link', { name: 'Projects', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
      FIRST,
    );
    for (const [name, path] of [
      ['Members', 'settings/members'],
      ['Invitations', 'settings/invitations'],
      ['Audit log', 'settings/audit'],
      ['General', 'settings/general'],
      ['Projects', 'projects'],
    ] as const) {
      await orgMenu(page).getByRole('link', { name, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/o/${cast.slug}/${path}$`));
      await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible(FIRST);
      await expect(orgMenu(page).getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(orgMenu(page).locator('[aria-current]')).toHaveCount(1);
      await expect(orgMenu(page).getByRole('link')).toHaveText(FULL_ORG_MENU);
    }
  });
});

test.describe('BR-18: member and viewer org menu', () => {
  test('TC-18.1: a member, then an org viewer, see Projects only: no Settings heading or Settings pages', async () => {
    for (const who of [orgMember, cast.v]) {
      const page = await openOrgAs(who);
      await expect(projectsHeading(page)).toBeVisible(FIRST);
      await expect(orgMenu(page).getByRole('link')).toHaveText(['Projects']);
      await expect(settingsHeading(page)).toHaveCount(0);
      for (const name of ['Members', 'Invitations', 'Audit log', 'General']) {
        await expect(orgMenu(page).getByRole('link', { name, exact: true })).toHaveCount(0);
      }
    }
  });
});

test.describe('BR-19: project-only admin org menu', () => {
  test('TC-19.1: an admin of one project sees Projects and Invitations under Settings, and Invitations opens', async () => {
    const page = await openOrgAs(cast.a);
    await expect(projectsHeading(page)).toBeVisible(FIRST);
    await expect(orgMenu(page).getByRole('link')).toHaveText(['Projects', 'Invitations']);
    await expect(settingsHeading(page)).toBeVisible();
    for (const name of ['Members', 'Audit log', 'General']) {
      await expect(orgMenu(page).getByRole('link', { name, exact: true })).toHaveCount(0);
    }

    await orgMenu(page).getByRole('link', { name: 'Invitations', exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`/o/${cast.slug}/settings/invitations$`));
    await expect(page.getByRole('heading', { name: 'Invitations', level: 1 })).toBeVisible(FIRST);
  });
});

test.describe('BR-20: "Manage in Platform"', () => {
  test('TC-20.1: a platform admin on org Members presses "Manage in Platform", the last item, and the org opens in the platform area', async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    extraContexts.push(ctx);
    const page = await ctx.newPage();
    const handle = `rbac-pa-${randomBytes(3).toString('hex')}`;
    await inviteAndSignIn(page, cast.pa, cast.orgId, handle, 'admin', { type: 'org' });
    const { entry } = await grantPlatformAdmin(cast.pa, `${handle}@dev.local`);
    grantedAdmins.push(entry.id);

    await page.goto(orgUrl('settings/members'));
    const manage = orgMenu(page).getByRole('link', { name: 'Manage in Platform' });
    await expect(manage).toBeVisible(FIRST);
    await expect(orgMenu(page).getByRole('link').last()).toHaveText('Manage in Platform');
    await manage.click();

    await expect(page).toHaveURL(new RegExp(`/platform/orgs/${cast.orgId}$`));
    const menu = platformMenu(page);
    await expect(menu.getByText(orgName(), { exact: true })).toBeVisible(FIRST);
    await expect(menu.getByRole('link', { name: /^(Overview|Projects|Members|Invitations)$/ })).toHaveText([
      'Overview',
      'Projects',
      'Members',
      'Invitations',
    ]);
  });

  test('TC-20.2: an org owner who is not a platform admin sees the org menu on Projects and each Settings page, never "Manage in Platform"', async () => {
    const page = cast.o.page;
    for (const path of ['projects', 'settings/members', 'settings/invitations', 'settings/audit', 'settings/general']) {
      await page.goto(orgUrl(path));
      await expect(orgMenu(page).getByRole('link')).toHaveText(FULL_ORG_MENU, FIRST);
      await expect(page.getByRole('link', { name: 'Manage in Platform' })).toHaveCount(0);
    }
  });
});

test.describe('BR-21: /o/<org>/settings redirect order', () => {
  test('TC-21.1: an owner, then an org admin, open /settings and land on Members', async () => {
    for (const who of [cast.o, cast.d]) {
      const page = await openOrgAs(who, 'settings');
      await expect(page).toHaveURL(new RegExp(`/o/${cast.slug}/settings/members$`), FIRST);
      await expect(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible(FIRST);
    }
  });

  test('TC-21.2: an admin of one project opens /settings and lands on Invitations', async () => {
    const page = await openOrgAs(cast.a, 'settings');
    await expect(page).toHaveURL(new RegExp(`/o/${cast.slug}/settings/invitations$`), FIRST);
    await expect(page.getByRole('heading', { name: 'Invitations', level: 1 })).toBeVisible(FIRST);
  });

  test('TC-21.5: a member opens /settings and sees "You don\'t have access" with the org menu holding Projects only', async () => {
    const page = await openOrgAs(orgMember, 'settings');
    await expect(noAccess(page)).toBeVisible(FIRST);
    await expect(orgMenu(page).getByRole('link')).toHaveText(['Projects']);
    await expect(settingsHeading(page)).toHaveCount(0);
  });
});

test.describe('BR-31: the platform menu', () => {
  test('TC-31.1: Organizations, Platform admins and Audit log each mark only the matching item current', async () => {
    const page = adminPage;
    await page.goto('/platform/orgs');
    const menu = platformMenu(page);
    const links = ['Organizations', 'Platform admins', 'Audit log'];
    for (const [i, name] of links.entries()) {
      if (i > 0) {
        await menu.getByRole('link', { name, exact: true }).click();
        await expect(page).toHaveURL(i === 1 ? /\/platform\/admins$/ : /\/platform\/audit$/);
      }
      await expect(menu.getByRole('link')).toHaveText(links, FIRST);
      for (const other of links) {
        const link = menu.getByRole('link', { name: other, exact: true });
        if (other === name) await expect(link).toHaveAttribute('aria-current', 'page');
        else await expect(link).not.toHaveAttribute('aria-current', 'page');
      }
    }
  });

  test('TC-31.3: an org owner who is not a platform admin sees no platform menu or item on an org page or /platform/admins', async () => {
    const page = cast.o.page;
    await page.goto(orgUrl('projects'));
    await expect(projectsHeading(page)).toBeVisible(FIRST);
    await expect(platformMenu(page)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Platform admins' })).toHaveCount(0);

    await page.goto('/platform/admins');
    await expect(page.getByRole('main').getByText('This area is for platform admins.', { exact: true })).toBeVisible(
      FIRST,
    );
    await expect(platformMenu(page)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Platform admins' })).toHaveCount(0);
  });
});

test.describe('BR-32: the platform org menu', () => {
  const itemsOf = (menu: Locator): Locator =>
    menu.getByRole('link', { name: /^(Overview|Projects|Members|Invitations)$/ });

  test('TC-32.1: an active org shows "← Organizations", the name with "Active" and the four items, each current on its page', async () => {
    const page = adminPage;
    const base = `/platform/orgs/${cast.orgId}`;
    await page.goto(base);
    const menu = platformMenu(page);
    await expect(menu.getByRole('link', { name: /Organizations/ })).toHaveAttribute('href', '/platform/orgs', FIRST);
    await expect(menu.getByText(orgName(), { exact: true })).toBeVisible();
    await expect(menu.getByText('Active', { exact: true })).toBeVisible();
    await expect(itemsOf(menu)).toHaveText(['Overview', 'Projects', 'Members', 'Invitations']);
    await expect(menu.getByRole('link', { name: 'Overview', exact: true })).toHaveAttribute('aria-current', 'page');

    for (const [name, path] of [
      ['Projects', 'projects'],
      ['Members', 'members'],
      ['Invitations', 'invitations'],
    ] as const) {
      await menu.getByRole('link', { name, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${base}/${path}$`));
      await expect(page.getByRole('heading', { name, level: 2 })).toBeVisible(FIRST);
      await expect(menu.getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(menu.getByRole('link', { name: 'Overview', exact: true })).not.toHaveAttribute(
        'aria-current',
        'page',
      );
    }
  });

  test('TC-32.2: a suspended org shows its name with "Suspended" and the same four items', async () => {
    const slug = `rbac-s-${randomBytes(3).toString('hex')}`;
    const name = `RBAC S ${slug}`;
    const org = await createOrg(cast.pa, name, slug);
    await suspendOrg(cast.pa, org.id);

    const page = adminPage;
    await page.goto(`/platform/orgs/${org.id}`);

    const menu = platformMenu(page);
    await expect(menu.getByText(name, { exact: true })).toBeVisible(FIRST);
    await expect(menu.getByText('Suspended', { exact: true })).toBeVisible();
    await expect(menu.getByText('Active', { exact: true })).toHaveCount(0);
    await expect(itemsOf(menu)).toHaveText(['Overview', 'Projects', 'Members', 'Invitations']);
  });
});

test.describe('BR-34: who may open the platform pages', () => {
  test('TC-34.1: an org owner who is not a platform admin sees the forbidden state, no side menu and no platform data', async () => {
    const page = cast.o.page;
    const y = second;
    if (!y) throw new Error('the second org is not built');
    for (const path of [
      '/platform/orgs',
      '/platform/admins',
      '/platform/audit',
      `/platform/orgs/${cast.orgId}/members`,
    ]) {
      await page.goto(path);
      await expect(page.getByRole('main').getByText('This area is for platform admins.', { exact: true })).toBeVisible(
        FIRST,
      );
      await expect(
        page.getByRole('navigation', { name: /^(Organization menu|Project menu|Platform menu)$/ }),
      ).toHaveCount(0);
      // No other org's name, no platform admin, no audit event or member of the platform lists.
      await appearsNowhere(page, secondNames.org, 'admin@dev.local', `${cast.v.handle}@dev.local`);
      await expect(page.locator('tbody tr')).toHaveCount(0);
    }
  });

  test('TC-34.2: a platform admin sees the directory and the Platform menu', async () => {
    const page = adminPage;
    await page.goto('/platform/orgs');
    await expect(page.getByRole('heading', { name: 'Organizations', level: 1 })).toBeVisible(FIRST);
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await expect(platformMenu(page)).toBeVisible();
  });
});
