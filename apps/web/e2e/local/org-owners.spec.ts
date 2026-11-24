import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { MemberDto, ProjectDto, pageOf } from '@agentdesk/contracts';
import { API, grant, inviteAndSignIn, ok, type RoleKey } from './helpers';
import { REPO_P1, installFake, roleIdsOf, type Actor } from './rbac-cast';
import { withScope, type Org, type Scope } from './onboarding-scope';

/*
 * Local end-to-end for owners on the org Members page (spec 2026-11-22-org-tenant-admin-design.md "E2E requirements":
 * TC-5.3, TC-8.4, TC-36.1, TC-40.1, TC-40.2, TC-41.1 to TC-41.3, TC-42.1, TC-42.2): the real API's last-owner answer,
 * a concurrent removal, a demoted admin, giving the owner role, and an owner changing or removing another owner.
 *
 * The cast differs per case (owners O and B, a third member, an admin), so each test builds only the people it needs
 * with `join`, instead of the shared cast. Every test builds its own org with random `e2e-<rand>` handles, one browser
 * context per person, and closes every context it opened. The Givens use the API; the Steps go through the UI.
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
  projectName: string;
  roleIds: Record<RoleKey, string>;
}

async function withWorld(browser: Browser, body: (w: World) => Promise<void>): Promise<void> {
  await withScope(async (scope) => {
    const org = await scope.org('w');
    const roleIds = await roleIdsOf(scope.pa, org.id);
    const o = await join(scope, browser, org, 'o', 'owner');
    const connectionId = await installFake(o);
    const project = ProjectDto.parse(
      await ok(
        await o.api.post('/api/projects', { data: { connectionId, repoPath: REPO_P1, triggerMode: 'webhook' } }),
        201,
        'create project',
      ),
    );
    await body({ scope, browser, org, o, projectId: project.id, projectName: project.name, roleIds });
  });
}

/** Invites `<who>-<tag>@dev.local` into `org` with a built-in role (the whole org), signs them in on a new context. */
async function join(scope: Scope, browser: Browser, org: Org, who: string, roleKey: RoleKey): Promise<Actor> {
  const ctx = await scope.person(browser);
  const page = await ctx.newPage();
  const handle = scope.handle(who);
  const { userId } = await inviteAndSignIn(page, scope.pa, org.id, handle, roleKey, { type: 'org' });
  return { handle, userId, ctx, page, api: ctx.request };
}

async function membersOf(w: World): Promise<MemberDto[]> {
  return pageOf(MemberDto).parse(
    await ok(await w.o.api.get(`/api/orgs/${w.org.id}/members?pageSize=100`), 200, 'member list'),
  ).items;
}

async function nameOf(w: World, userId: string): Promise<string> {
  const member = (await membersOf(w)).find((m) => m.userId === userId);
  expect(member, `user ${userId} is a member of the org`).toBeTruthy();
  return member?.name ?? '';
}

/** A Given: O sets a member's org role through the API (O may also be the target). */
async function setRole(w: World, userId: string, roleId: string | null): Promise<void> {
  await ok(
    await w.o.api.put(`/api/orgs/${w.org.id}/members/${userId}/role`, { data: { roleId } }),
    200,
    'change member role',
  );
}

/** A Given: `actor` (another owner) sets a member's org role through the API. Nobody can change their own role (403). */
async function setRoleAs(w: World, actor: Actor, userId: string, roleId: string | null): Promise<void> {
  await ok(
    await actor.api.put(`/api/orgs/${w.org.id}/members/${userId}/role`, { data: { roleId } }),
    200,
    'change member role',
  );
}

const membersUrl = (w: World): string => `/o/${w.org.slug}/settings/members`;
const projectsUrl = (w: World): string => `/o/${w.org.slug}/projects`;

const rowOf = (page: Page, text: string): Locator => page.locator('tbody tr').filter({ hasText: text });
/** One chip per grant, as scope and role: `Organization · Admin`, `<project> · Member`. */
const accessOf = (row: Locator): Locator => row.getByRole('listitem');
const menuButton = (page: Page, name: string): Locator => page.getByRole('button', { name: `Actions for ${name}` });
const roleDialog = (page: Page, name: string): Locator =>
  page.getByRole('dialog', { name: `Change access for ${name}` });
const card = (scope: Locator, role: string): Locator => scope.getByRole('radio', { name: new RegExp(`^${role}`) });
const toastOf = (page: Page, title: string): Locator =>
  page.getByRole('status').or(page.getByRole('alert')).filter({ hasText: title });
const settingsTab = (page: Page): Locator =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings', exact: true });
const OWNER_NOTE = 'Owners can change or remove every member, including other owners.';

async function openMembers(page: Page, w: World): Promise<void> {
  await page.goto(membersUrl(w));
  await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
  await expect(page.locator('tbody tr').first()).toBeVisible();
}

async function reloadMembers(page: Page): Promise<void> {
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
  await expect(page.locator('tbody tr').first()).toBeVisible();
}

/** Opens "Actions for <name>" on the page's Members list, then the menu item. */
async function pickMenuItem(
  page: Page,
  name: string,
  item: 'Change access' | 'Remove from organization',
): Promise<void> {
  await menuButton(page, name).click();
  await page.getByRole('button', { name: item, exact: true }).click();
}

/** Changes `name`'s role through the menu, the dialog and "Save access"; ends after the "Role changed" toast. */
async function changeRoleThroughUi(page: Page, name: string, role: string): Promise<void> {
  await pickMenuItem(page, name, 'Change access');
  const dialog = roleDialog(page, name);
  await expect(dialog).toBeVisible();
  await card(dialog, role).check();
  await dialog.getByRole('button', { name: 'Save access' }).click();
  await expect(toastOf(page, 'Role changed')).toBeVisible();
  await expect(dialog).toHaveCount(0);
}

/** Removes `name` through the menu and the confirm; ends after the toast and the row are gone. */
async function removeThroughUi(page: Page, name: string, orgName: string, handle: string): Promise<void> {
  await pickMenuItem(page, name, 'Remove from organization');
  const dialog = page.getByRole('dialog', { name: `Remove ${name} from ${orgName}?` });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(toastOf(page, `${name} removed`)).toBeVisible();
  await expect(rowOf(page, handle)).toHaveCount(0);
}

/** The Given of the BR-40 flow: B joins as Member and becomes Owner (a second owner next to O). */
async function joinAsOwner(w: World, who: string): Promise<Actor> {
  const b = await join(w.scope, w.browser, w.org, who, 'member');
  await setRole(w, b.userId, w.roleIds.owner);
  return b;
}

test('TC-5.3: B, now the sole owner, has no menu on the own row; the real API refuses B’s own role change with 403 and B stays Owner', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const b = await joinAsOwner(w, 'b');
    // B (the other owner) steps O down to Admin, so B is the sole owner.
    await setRoleAs(w, b, w.o.userId, w.roleIds.admin);
    const name = await nameOf(w, b.userId);

    const page = b.page;
    await openMembers(page, w);
    await expect(accessOf(rowOf(page, b.handle)).first()).toHaveText('Organization · Owner');
    await expect(accessOf(rowOf(page, w.o.handle)).first()).toHaveText('Organization · Admin');
    // positive control: the page loaded B's rights, so the other row has actions and the own row has none
    await expect(menuButton(page, await nameOf(w, w.o.userId))).toBeVisible();
    await expect(menuButton(page, name)).toHaveCount(0);

    const put = await b.api.put(`/api/orgs/${w.org.id}/members/${b.userId}/role`, {
      data: { roleId: w.roleIds.admin },
    });
    expect(put.status(), 'PUT own role').toBe(403);
    await reloadMembers(page);
    await expect(accessOf(rowOf(page, b.handle)).first()).toHaveText('Organization · Owner');
    expect((await membersOf(w)).find((m) => m.userId === b.userId)?.assignments.map((a) => a.role.key)).toEqual([
      'owner',
    ]);
  });
});

test('TC-8.4: B removes C while O has C’s dialog open; O saves and sees "Member is no longer in the organization"', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const b = await joinAsOwner(w, 'b');
    const c = await join(w.scope, w.browser, w.org, 'c', 'member');
    const nameC = await nameOf(w, c.userId);

    const o = w.o.page;
    await openMembers(o, w);
    await pickMenuItem(o, nameC, 'Change access');
    const dialog = roleDialog(o, nameC);
    await expect(dialog).toBeVisible();
    await expect(rowOf(o, c.handle)).toHaveCount(1);

    // 1. B removes C and waits for the response (the toast and the row going are the response).
    await openMembers(b.page, w);
    await removeThroughUi(b.page, nameC, w.org.name, c.handle);

    // 2. O picks a role and presses "Save access".
    await card(dialog, 'Viewer').check();
    await dialog.getByRole('button', { name: 'Save access' }).click();
    await expect(toastOf(o, 'Member is no longer in the organization')).toBeVisible();
    await expect(toastOf(o, 'Role changed')).toHaveCount(0);
    await expect(rowOf(o, c.handle)).toHaveCount(0);
    // positive control: the list was refreshed, not emptied
    await expect(rowOf(o, w.o.handle)).toHaveCount(1);
    await expect(rowOf(o, b.handle)).toHaveCount(1);
  });
});

test('TC-36.1: O demotes admin A to Member; A’s next change is refused with a Banner and the refresh shows no access', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const a = await join(w.scope, w.browser, w.org, 'a', 'admin');
    const m = await join(w.scope, w.browser, w.org, 'm', 'member');
    const nameM = await nameOf(w, m.userId);

    // Given: A has Members open, then O demotes A to Member.
    const page = a.page;
    // The page reads the role cards ahead when it loads: wait for that answer before the demotion.
    const cardsRead = page.waitForResponse(
      (r) => r.request().method() === 'GET' && new URL(r.url()).pathname === `/api/orgs/${w.org.id}/roles`,
    );
    await openMembers(page, w);
    expect((await cardsRead).status(), 'the role cards were read before the demotion').toBe(200);
    await expect(rowOf(page, m.handle)).toHaveCount(1);
    await ok(
      await w.o.api.put(`/api/orgs/${w.org.id}/members/${a.userId}/role`, { data: { roleId: w.roleIds.member } }),
      200,
      'demote A',
    );

    // 1. A opens Change role on a Member and presses "Save access".
    await pickMenuItem(page, nameM, 'Change access');
    const dialog = roleDialog(page, nameM);
    await expect(dialog).toBeVisible();
    await card(dialog, 'Viewer').check();
    await dialog.getByRole('button', { name: 'Save access' }).click();
    await expect(dialog.getByText("You don't have access")).toBeVisible();
    await expect(dialog.getByText(/^Request ID: \S+/)).toBeVisible();
    await expect(toastOf(page, 'Role changed')).toHaveCount(0);
    // nothing changes: the member is still a Member
    const after = (await membersOf(w)).find((x) => x.userId === m.userId);
    expect(after?.assignments.map((x) => x.role.key)).toEqual(['member']);

    // 2. A refreshes.
    await page.reload();
    await expect(page.getByText("You don't have access")).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(0);
  });
});

test('TC-40.1: O makes admin B an Owner: the Owner card shows its note, B is Owner after the reload and keeps the P1 role', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const b = await join(w.scope, w.browser, w.org, 'b', 'admin');
    await grant(w.scope.pa, w.org.id, b.userId, 'admin', { type: 'project', projectId: w.projectId });
    const name = await nameOf(w, b.userId);
    const p1Role = (await membersOf(w)).flatMap((x) => x.assignments).find((x) => x.scope.type === 'project');
    expect(p1Role, 'B holds the P1 role').toBeTruthy();

    const page = w.o.page;
    await openMembers(page, w);
    await expect(accessOf(rowOf(page, b.handle)).first()).toHaveText('Organization · Admin');
    await pickMenuItem(page, name, 'Change access');
    const dialog = roleDialog(page, name);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(OWNER_NOTE)).toHaveCount(0);
    await card(dialog, 'Owner').check();
    await expect(dialog.getByText(OWNER_NOTE)).toBeVisible();
    await dialog.getByRole('button', { name: 'Save access' }).click();
    await expect(toastOf(page, 'Role changed')).toBeVisible();

    await reloadMembers(page);
    const row = rowOf(page, b.handle);
    await expect(accessOf(row).first()).toHaveText('Organization · Owner');
    await expect(accessOf(row)).toHaveText(['Organization · Owner', `${w.projectName} · Admin`]);
    const mine = (await membersOf(w)).find((x) => x.userId === b.userId);
    expect(
      mine?.assignments.map((x) => [x.role.key, x.scope.type]).sort(),
      'B holds the owner role on the org and keeps the P1 role',
    ).toEqual([
      ['admin', 'project'],
      ['owner', 'org'],
    ]);
  });
});

test('TC-40.2: after B’s reload B sees the Owner card and Change role and Remove on O’s row', async ({ browser }) => {
  await withWorld(browser, async (w) => {
    const b = await join(w.scope, w.browser, w.org, 'b', 'admin');
    await grant(w.scope.pa, w.org.id, b.userId, 'admin', { type: 'project', projectId: w.projectId });
    const c = await join(w.scope, w.browser, w.org, 'c', 'member');
    const nameC = await nameOf(w, c.userId);
    const page = b.page;

    // Control: as an Admin, B has no Owner card and no actions on O's row.
    await openMembers(page, w);
    await pickMenuItem(page, nameC, 'Change access');
    const before = roleDialog(page, nameC);
    await expect(before).toBeVisible();
    await expect(card(before, 'Admin')).toBeVisible();
    await expect(card(before, 'Owner')).toHaveCount(0);
    await before.getByRole('button', { name: 'Cancel' }).click();
    await expect(menuButton(page, await nameOf(w, w.o.userId))).toHaveCount(0);

    // Given: O makes B an Owner (the TC-40.1 flow).
    await setRole(w, b.userId, w.roleIds.owner);

    // 1. In B's context reload.
    await reloadMembers(page);
    // 2. Open Members, B opens Change role on another member.
    await pickMenuItem(page, nameC, 'Change access');
    const dialog = roleDialog(page, nameC);
    await expect(dialog).toBeVisible();
    await expect(card(dialog, 'Owner')).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);

    // 3. Look at O's row.
    const nameO = await nameOf(w, w.o.userId);
    await menuButton(page, nameO).click();
    await expect(page.getByRole('button', { name: 'Change access', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove from organization', exact: true })).toBeVisible();
  });
});

test('TC-41.1: O demotes the other owner B to Member; B shows Member after the reload', async ({ browser }) => {
  await withWorld(browser, async (w) => {
    const b = await joinAsOwner(w, 'b');
    const name = await nameOf(w, b.userId);
    const page = w.o.page;
    await openMembers(page, w);
    await expect(accessOf(rowOf(page, b.handle)).first()).toHaveText('Organization · Owner');
    await changeRoleThroughUi(page, name, 'Member');
    await reloadMembers(page);
    await expect(accessOf(rowOf(page, b.handle)).first()).toHaveText('Organization · Member');
    await expect(accessOf(rowOf(page, w.o.handle)).first()).toHaveText('Organization · Owner');
  });
});

test('TC-41.2: O removes the other owner B; B is gone from the list and B’s next navigation is not found', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const b = await joinAsOwner(w, 'b');
    const name = await nameOf(w, b.userId);
    await openMembers(b.page, w);
    const page = w.o.page;
    await openMembers(page, w);
    await removeThroughUi(page, name, w.org.name, b.handle);

    await b.page.reload();
    await b.page.goto(membersUrl(w));
    await expect(b.page.getByText('Page not found')).toBeVisible();
    await reloadMembers(page);
    await expect(rowOf(page, b.handle)).toHaveCount(0);
    await expect(rowOf(page, w.o.handle)).toHaveCount(1);
    await b.page.goto(projectsUrl(w));
    await expect(b.page.getByText('Page not found')).toBeVisible();
  });
});

test('TC-41.3: with owners O, B and C, O demotes B to Member and removes C; both apply and O stays Owner', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const b = await joinAsOwner(w, 'b');
    const c = await joinAsOwner(w, 'c');
    const nameB = await nameOf(w, b.userId);
    const nameC = await nameOf(w, c.userId);
    const page = w.o.page;
    await openMembers(page, w);
    await expect(page.locator('tbody tr')).toHaveCount(3);

    await changeRoleThroughUi(page, nameB, 'Member');
    await removeThroughUi(page, nameC, w.org.name, c.handle);

    await reloadMembers(page);
    await expect(page.locator('tbody tr')).toHaveCount(2);
    await expect(accessOf(rowOf(page, b.handle)).first()).toHaveText('Organization · Member');
    await expect(rowOf(page, c.handle)).toHaveCount(0);
    await expect(accessOf(rowOf(page, w.o.handle)).first()).toHaveText('Organization · Owner');
  });
});

test('TC-42.1: B steps O down to Admin: after the reload O has no Owner card and no actions on the own row or on owner B', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const b = await joinAsOwner(w, 'b');
    const c = await join(w.scope, w.browser, w.org, 'c', 'member');
    const nameO = await nameOf(w, w.o.userId);
    const nameC = await nameOf(w, c.userId);
    await setRoleAs(w, b, w.o.userId, w.roleIds.admin);

    const page = w.o.page;
    await openMembers(page, w);
    await expect(accessOf(rowOf(page, w.o.handle)).first()).toHaveText('Organization · Admin');
    await expect(accessOf(rowOf(page, b.handle)).first()).toHaveText('Organization · Owner');
    // control: O still has actions on a Member row, so the page has finished loading its rights
    await expect(menuButton(page, nameC)).toBeVisible();
    await expect(menuButton(page, nameO)).toHaveCount(0);
    await expect(menuButton(page, await nameOf(w, b.userId))).toHaveCount(0);
    await pickMenuItem(page, nameC, 'Change access');
    const dialog = roleDialog(page, nameC);
    await expect(dialog).toBeVisible();
    await expect(card(dialog, 'Member')).toBeChecked();
    await expect(card(dialog, 'Owner')).toHaveCount(0);
  });
});

test('TC-42.2: B steps O down to Member: no Settings tab and the settings URL shows no access', async ({ browser }) => {
  await withWorld(browser, async (w) => {
    const b = await joinAsOwner(w, 'b');
    const page = w.o.page;
    await page.goto(projectsUrl(w));
    await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
    await expect(settingsTab(page)).toBeVisible();
    await setRoleAs(w, b, w.o.userId, w.roleIds.member);

    await page.goto(projectsUrl(w));
    await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
    await expect(settingsTab(page)).toHaveCount(0);
    await page.goto(membersUrl(w));
    await expect(page.getByText("You don't have access")).toBeVisible();
  });
});
