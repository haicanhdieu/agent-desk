import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { AuditEntryDto, MemberDto, OrgDto, ProjectDto, pageOf } from '@agentdesk/contracts';
import { API, inviteAndSignIn, inviteViaApi, ok, type InviteScope, type RoleKey } from './helpers';
import { REPO_P1, REPO_P2, installFake, roleIdsOf, type Actor } from './rbac-cast';
import { withScope, type Org, type Scope } from './onboarding-scope';

/*
 * Local end-to-end for reaching Settings, General and the API refusals (spec 2026-11-22-org-tenant-admin-design.md
 * "E2E requirements": TC-2.4, TC-2.5, TC-13.9, TC-14.1, TC-14.2, TC-16.3, TC-16.4, TC-18.1 to TC-18.8).
 *
 * Every test builds its own org with random `e2e-<rand>` handles and only the people it needs, one browser context per
 * person, and closes every context it opened. The Givens use the API; the Steps go through the UI, except BR-18, whose
 * steps are the raw requests of each person's request context. A refusal is judged by its exact status and by reading
 * the org back as the owner afterwards.
 */

test.describe.configure({ timeout: 300_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`scripts/runner-stack.sh up\``).toBe(true);
});

/** One org with its owner O and a project P1. */
interface World {
  scope: Scope;
  browser: Browser;
  org: Org;
  o: Actor;
  projectId: string;
  connectionId: string;
  roleIds: Record<RoleKey, string>;
}

async function withWorld(browser: Browser, body: (w: World) => Promise<void>): Promise<void> {
  await withScope(async (scope) => {
    const org = await scope.org('w');
    const roleIds = await roleIdsOf(scope.pa, org.id);
    const o = await join(scope, browser, org, 'o', 'owner');
    const connectionId = await installFake(o);
    const project = await createProject(o, connectionId, REPO_P1);
    await body({ scope, browser, org, o, projectId: project.id, connectionId, roleIds });
  });
}

async function createProject(o: Actor, connectionId: string, repoPath: string): Promise<ProjectDto> {
  return ProjectDto.parse(
    await ok(
      await o.api.post('/api/projects', { data: { connectionId, repoPath, triggerMode: 'webhook' } }),
      201,
      `create project ${repoPath}`,
    ),
  );
}

/** Invites `<who>-<tag>@dev.local` into `org` with a built-in role and scope, signs them in on a new context. */
async function join(
  scope: Scope,
  browser: Browser,
  org: Org,
  who: string,
  roleKey: RoleKey,
  access: InviteScope = { type: 'org' },
): Promise<Actor> {
  const ctx = await scope.person(browser);
  const page = await ctx.newPage();
  const handle = scope.handle(who);
  const { userId } = await inviteAndSignIn(page, scope.pa, org.id, handle, roleKey, access);
  return { handle, userId, ctx, page, api: ctx.request };
}

async function membersOf(w: World): Promise<MemberDto[]> {
  return pageOf(MemberDto).parse(
    await ok(await w.o.api.get(`/api/orgs/${w.org.id}/members?pageSize=100`), 200, 'member list'),
  ).items;
}

const roleKeysOf = async (w: World, userId: string): Promise<string[] | undefined> =>
  (await membersOf(w)).find((m) => m.userId === userId)?.assignments.map((a) => a.role.key);

/** The org as the owner reads it: the General form's Name and URL after a reload. */
async function orgAsOwnerSees(w: World): Promise<{ name: string; slug: string }> {
  const page = w.o.page;
  await page.goto(generalUrl(w.org.slug));
  await expect(h1(page, 'General')).toBeVisible();
  await expect(nameInput(page)).toHaveValue(/.+/);
  return { name: await nameInput(page).inputValue(), slug: await slugInput(page).inputValue() };
}

const generalUrl = (slug: string): string => `/o/${slug}/settings/general`;
const projectsUrl = (slug: string): string => `/o/${slug}/projects`;
const membersUrl = (slug: string): string => `/o/${slug}/settings/members`;
const mainNav = (page: Page): Locator => page.getByRole('navigation', { name: 'Main' });
const settingsTab = (page: Page): Locator => mainNav(page).getByRole('link', { name: 'Settings', exact: true });
const sideMenu = (page: Page): Locator => page.getByRole('navigation', { name: 'Organization settings' });
const crumb = (page: Page, name: string): Locator => page.getByRole('button', { name: `Organization menu, ${name}` });
const orgMenu = (page: Page): Locator => page.getByRole('dialog', { name: 'Organizations' });
const h1 = (page: Page, name: string): Locator => page.getByRole('heading', { level: 1, name });
const nameInput = (page: Page): Locator => page.getByLabel('Name', { exact: true });
const slugInput = (page: Page): Locator => page.getByLabel('URL', { exact: true });
const toastOf = (page: Page, title: string): Locator =>
  page.getByRole('status').or(page.getByRole('alert')).filter({ hasText: title });
const rowOf = (page: Page, text: string): Locator => page.getByRole('row').filter({ hasText: text });
const STATUS = 3;

/** The Projects page, loaded (its heading and the Settings-less or Settings top bar are settled). */
async function openProjects(page: Page, slug: string): Promise<void> {
  await page.goto(projectsUrl(slug));
  await expect(h1(page, 'Projects')).toBeVisible();
}

/** Opens the org menu and checks it lists Projects (the positive control for "no Settings item"). */
async function openOrgMenu(page: Page, orgName: string): Promise<Locator> {
  await crumb(page, orgName).click();
  const menu = orgMenu(page);
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Projects' })).toBeVisible();
  return menu;
}

test('TC-2.4: member B and viewer V see no Settings tab or item, and the typed members URL shows no access', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const people = [
      await join(w.scope, browser, w.org, 'b', 'member'),
      await join(w.scope, browser, w.org, 'v', 'viewer'),
    ];
    // Control: the owner does have the Settings tab, so a missing tab below is not a page that never rendered it.
    await openProjects(w.o.page, w.org.slug);
    await expect(settingsTab(w.o.page)).toBeVisible();

    for (const who of people) {
      const page = who.page;
      await openProjects(page, w.org.slug);
      await expect(mainNav(page).getByRole('link', { name: 'Projects', exact: true })).toBeVisible();
      await expect(settingsTab(page)).toHaveCount(0);
      const menu = await openOrgMenu(page, w.org.name);
      await expect(menu.getByRole('link', { name: 'Settings' })).toHaveCount(0);
      await page.keyboard.press('Escape');

      await page.goto(membersUrl(w.org.slug));
      await expect(page.getByRole('heading', { name: "You don't have access" })).toBeVisible();
      await expect(page.getByText('Ask an owner of this organization to give you access.')).toBeVisible();
      await expect(sideMenu(page)).toHaveCount(0);
      await expect(page.locator('tbody tr')).toHaveCount(0);
    }
  });
});

test('TC-2.5: project admin P1A presses Settings: Invitations opens with only Invitations in the menu and only the P1 invitation', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const p2 = await createProject(w.o, w.connectionId, REPO_P2);
    const p1a = await join(w.scope, browser, w.org, 'p1a', 'admin', { type: 'project', projectIds: [w.projectId] });
    const onP1 = w.scope.email('inv-p1');
    const onP2 = w.scope.email('inv-p2');
    await inviteViaApi(w.o.api, w.org.id, onP1, 'member', { type: 'project', projectIds: [w.projectId] }, 'tenant');
    await inviteViaApi(w.o.api, w.org.id, onP2, 'member', { type: 'project', projectIds: [p2.id] }, 'tenant');

    const page = p1a.page;
    await openProjects(page, w.org.slug);
    await settingsTab(page).click();
    await expect(page).toHaveURL(new RegExp(`/o/${w.org.slug}/settings/invitations$`));
    await expect(h1(page, 'Invitations')).toBeVisible();
    await expect(sideMenu(page).getByRole('link')).toHaveText(['Invitations']);
    await expect(sideMenu(page).getByRole('link', { name: 'Invitations' })).toHaveAttribute('aria-current', 'page');
    await expect(rowOf(page, onP1)).toHaveCount(1);
    await expect(cell(rowOf(page, onP1), STATUS)).toHaveText('Pending');
    await expect(rowOf(page, onP2)).toHaveCount(0);
    await expect(page.locator('tbody tr')).toHaveCount(1);
  });
});

const cell = (row: Locator, index: number): Locator => row.getByRole('cell').nth(index);

test('TC-13.9: O presses Settings, then Invitations, invites a person as Member, and the invitation shows as pending', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const page = w.o.page;
    const email = w.scope.email('invitee');
    await openProjects(page, w.org.slug);
    await settingsTab(page).click();
    await expect(h1(page, 'General')).toBeVisible();
    await sideMenu(page).getByRole('link', { name: 'Invitations', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${w.org.slug}/settings/invitations$`));
    await expect(h1(page, 'Invitations')).toBeVisible();
    await expect(rowOf(page, email)).toHaveCount(0);

    await page.getByRole('button', { name: 'Invite people' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Invite people' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Email').fill(email);
    await dialog.getByLabel('Role').selectOption({ label: 'Member' });
    await dialog.getByRole('radio', { name: 'Whole organization' }).check();
    await dialog.getByRole('button', { name: 'Create invitation' }).click();
    const created = page.getByRole('dialog', { name: 'Invitation created' });
    await expect(created).toBeVisible();
    await created.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(created).toHaveCount(0);

    await expect(rowOf(page, email)).toHaveCount(1);
    await expect(cell(rowOf(page, email), STATUS)).toHaveText('Pending');
  });
});

/** O renames the org through General: types the name, presses Save, waits for the toast. */
async function renameThroughUi(page: Page, name: string): Promise<void> {
  await nameInput(page).fill(name);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(toastOf(page, 'Organization updated')).toBeVisible();
}

test('TC-14.1: O changes the Name on General and saves: the toast shows and after the reload the crumb and the org menu show the new name', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    await join(w.scope, browser, w.org, 'b', 'member');
    const renamed = `E2E Renamed ${w.scope.tag}`;
    const page = w.o.page;
    await page.goto(generalUrl(w.org.slug));
    await expect(h1(page, 'General')).toBeVisible();
    await expect(nameInput(page)).toHaveValue(w.org.name);
    await renameThroughUi(page, renamed);

    await page.reload();
    await expect(h1(page, 'General')).toBeVisible();
    await expect(nameInput(page)).toHaveValue(renamed);
    await expect(crumb(page, renamed)).toBeVisible();
    const menu = await openOrgMenu(page, renamed);
    await expect(menu.getByText(renamed, { exact: true })).toBeVisible();
    await expect(menu.getByText(w.org.name, { exact: true })).toHaveCount(0);
  });
});

test('TC-14.2: after the rename, B reloads an org page and the top bar and the org menu show the new name', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const b = await join(w.scope, browser, w.org, 'b', 'member');
    const renamed = `E2E Renamed ${w.scope.tag}`;
    await openProjects(b.page, w.org.slug);
    await expect(crumb(b.page, w.org.name)).toBeVisible();
    // Given: O saved the new name (the TC-14.1 save).
    OrgDto.parse(await ok(await w.o.api.patch(`/api/orgs/${w.org.id}`, { data: { name: renamed } }), 200, 'rename'));

    await b.page.reload();
    await expect(h1(b.page, 'Projects')).toBeVisible();
    await expect(crumb(b.page, renamed)).toBeVisible();
    const menu = await openOrgMenu(b.page, renamed);
    await expect(menu.getByText(renamed, { exact: true })).toBeVisible();
    await expect(menu.getByText(w.org.name, { exact: true })).toHaveCount(0);
  });
});

test('TC-16.3: O changes the URL to a fresh slug and confirms "Change URL": the page moves to the new General URL', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const fresh = `e2e-new-${w.scope.tag}`;
    const page = w.o.page;
    await page.goto(generalUrl(w.org.slug));
    await expect(h1(page, 'General')).toBeVisible();
    await expect(slugInput(page)).toHaveValue(w.org.slug);
    await slugInput(page).fill(fresh);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Change the organization URL?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Change URL', exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`/o/${fresh}/settings/general$`));
    await expect(h1(page, 'General')).toBeVisible();
    await expect(slugInput(page)).toHaveValue(fresh);
  });
});

test('TC-16.4: after the URL change, B finds the old link not found and the new link on the Projects page', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const b = await join(w.scope, browser, w.org, 'b', 'member');
    const fresh = `e2e-new-${w.scope.tag}`;
    // Control: before the change the old link works for B.
    await openProjects(b.page, w.org.slug);
    // Given: O changed the URL (the TC-16.3 save).
    OrgDto.parse(await ok(await w.o.api.patch(`/api/orgs/${w.org.id}`, { data: { slug: fresh } }), 200, 'new slug'));

    await b.page.goto(projectsUrl(w.org.slug));
    await expect(b.page.getByText('Page not found')).toBeVisible();
    await expect(h1(b.page, 'Projects')).toHaveCount(0);
    await b.page.goto(projectsUrl(fresh));
    await expect(h1(b.page, 'Projects')).toBeVisible();
    await expect(b.page.getByText('Page not found')).toHaveCount(0);
  });
});

// ---- BR-18: the API refuses other roles ----

/** The four requests of TC-18.1 to TC-18.3: each answered 403, then the owner reads everything unchanged. */
async function expectRefusedAndUnchanged(w: World, who: Actor, roleNameForLabel: string): Promise<void> {
  const target = await join(w.scope, w.browser, w.org, `t-${roleNameForLabel}`, 'member');
  const before = await orgAsOwnerSees(w);
  const targetRolesBefore = await roleKeysOf(w, target.userId);
  expect(targetRolesBefore).toEqual(['member']);
  const org = `/api/orgs/${w.org.id}`;

  const patch = await who.api.patch(org, { data: { name: 'x' } });
  expect(patch.status(), 'PATCH org').toBe(403);
  const put = await who.api.put(`${org}/members/${target.userId}/role`, { data: { roleId: w.roleIds.viewer } });
  expect(put.status(), 'PUT member role').toBe(403);
  const del = await who.api.delete(`${org}/members/${target.userId}`);
  expect(del.status(), 'DELETE member').toBe(403);
  const audit = await who.api.get(`${org}/audit`);
  expect(audit.status(), 'GET audit').toBe(403);

  // Nothing changed, read back as the owner.
  expect(await orgAsOwnerSees(w)).toEqual(before);
  expect(before.name).toBe(w.org.name);
  expect(await roleKeysOf(w, target.userId)).toEqual(['member']);
  expect((await membersOf(w)).some((m) => m.userId === target.userId)).toBe(true);
  // Positive control: the owner's own call to the same audit route is allowed, so the 403 above was the caller.
  pageOf(AuditEntryDto).parse(await ok(await w.o.api.get(`${org}/audit`), 200, 'owner audit'));
}

test('TC-18.1: member B gets 403 on PATCH org, PUT role, DELETE member and GET audit, and the owner sees nothing changed', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const b = await join(w.scope, browser, w.org, 'b', 'member');
    await expectRefusedAndUnchanged(w, b, 'b');
  });
});

test('TC-18.2: viewer V gets 403 on the four requests, and the owner sees nothing changed', async ({ browser }) => {
  await withWorld(browser, async (w) => {
    const v = await join(w.scope, browser, w.org, 'v', 'viewer');
    await expectRefusedAndUnchanged(w, v, 'v');
  });
});

test('TC-18.3: project admin P1A gets 403 on the four requests, and the owner sees nothing changed', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const p1a = await join(w.scope, browser, w.org, 'p1a', 'admin', { type: 'project', projectIds: [w.projectId] });
    await expectRefusedAndUnchanged(w, p1a, 'p1a');
  });
});

test('TC-18.4: org admin A gets 403 giving the Owner role to a Member, and the Member keeps their role', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const a = await join(w.scope, browser, w.org, 'a', 'admin');
    const m = await join(w.scope, browser, w.org, 'm', 'member');
    const res = await a.api.put(`/api/orgs/${w.org.id}/members/${m.userId}/role`, {
      data: { roleId: w.roleIds.owner },
    });
    expect(res.status()).toBe(403);
    expect(await roleKeysOf(w, m.userId)).toEqual(['member']);
    // The admin's own role is untouched too.
    expect(await roleKeysOf(w, a.userId)).toEqual(['admin']);
  });
});

test('TC-18.5: org admin A gets 403 giving owner O the Member role, and O is still Owner', async ({ browser }) => {
  await withWorld(browser, async (w) => {
    const a = await join(w.scope, browser, w.org, 'a', 'admin');
    const res = await a.api.put(`/api/orgs/${w.org.id}/members/${w.o.userId}/role`, {
      data: { roleId: w.roleIds.member },
    });
    expect(res.status()).toBe(403);
    expect(await roleKeysOf(w, w.o.userId)).toEqual(['owner']);
    expect(await roleKeysOf(w, a.userId)).toEqual(['admin']);
  });
});

test('TC-18.6: org admin A gets 403 removing owner O, and O is still a member', async ({ browser }) => {
  await withWorld(browser, async (w) => {
    const a = await join(w.scope, browser, w.org, 'a', 'admin');
    const res = await a.api.delete(`/api/orgs/${w.org.id}/members/${w.o.userId}`);
    expect(res.status()).toBe(403);
    expect((await membersOf(w)).some((m) => m.userId === w.o.userId)).toBe(true);
    expect(await roleKeysOf(w, w.o.userId)).toEqual(['owner']);
    expect(await roleKeysOf(w, a.userId)).toEqual(['admin']);
  });
});

test('TC-18.7: org admin A gives a Member the Viewer role: 200 and the Member now shows Viewer', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const a = await join(w.scope, browser, w.org, 'a', 'admin');
    const m = await join(w.scope, browser, w.org, 'm', 'member');
    expect(await roleKeysOf(w, m.userId)).toEqual(['member']);
    const res = await a.api.put(`/api/orgs/${w.org.id}/members/${m.userId}/role`, {
      data: { roleId: w.roleIds.viewer },
    });
    expect(res.status()).toBe(200);
    expect(await roleKeysOf(w, m.userId)).toEqual(['viewer']);
  });
});

test('TC-18.8: member B deleting a random uuid member gets 403, not 404', async ({ browser }) => {
  await withWorld(browser, async (w) => {
    const b = await join(w.scope, browser, w.org, 'b', 'member');
    const before = (await membersOf(w)).length;
    const res = await b.api.delete(`/api/orgs/${w.org.id}/members/${randomUUID()}`);
    expect(res.status()).toBe(403);
    expect((await membersOf(w)).length).toBe(before);
  });
});
