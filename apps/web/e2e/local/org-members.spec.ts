import { randomBytes, randomInt } from 'node:crypto';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { AccessDto, AgentDto, MemberDto, ProjectDto, RuleDto, pageOf } from '@agentdesk/contracts';
import {
  API,
  CommentResult,
  acceptViaApi,
  grant,
  inviteAndSignIn,
  inviteViaApi,
  ok,
  runOf,
  waitForStatus,
  type RoleKey,
} from './helpers';
import { REPO_P1, installFake, roleIdsOf, watchTerminal, type Actor } from './rbac-cast';
import { withScope, type Org, type Scope } from './onboarding-scope';

/*
 * Local end-to-end for the org Members page (spec 2026-11-22-org-tenant-admin-design.md "E2E requirements": TC-1.1 to
 * TC-1.3, TC-3.1 to TC-3.4, TC-6.1 to TC-6.4, TC-7.1, TC-7.2, TC-10.1): the list, changing a role, removing a member,
 * the removed member's terminal and runs, and re-inviting.
 *
 * Every test builds its own org with random `e2e-<rand>` handles (users and orgs cannot be deleted, so nothing is
 * reused), one browser context per person, and closes every context it opened; the runs a test starts are cancelled.
 * A person who is a member of an org by a dev-login handle `h` signs in as the verified email `h@dev.local`.
 *
 * The terminal cases need the stack's TERMINAL_REAUTH_MS short (docs/runbooks/tests-and-e2e.md): start it with
 * `TERMINAL_REAUTH_MS=1000` and run with `E2E_TERMINAL_REAUTH_MS=1000`. Unset, they wait one default interval (60 s).
 */

test.describe.configure({ timeout: 300_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`scripts/runner-stack.sh up\``).toBe(true);
});

/** One org with its owner O, a project P1 and the runs a test started. */
interface World {
  scope: Scope;
  browser: Browser;
  org: Org;
  o: Actor;
  projectId: string;
  projectName: string;
  roleIds: Record<RoleKey, string>;
  runs: string[];
}

/** Makes the world, runs `body`, then cancels the runs and closes every context. */
async function withWorld(browser: Browser, body: (w: World) => Promise<void>): Promise<void> {
  await withScope(async (scope) => {
    const org = await scope.org('m');
    const roleIds = await roleIdsOf(scope.pa, org.id);
    const o = await join(scope, browser, org, 'o', 'owner');
    const connectionId = await installFake(o);
    const project = await setUpProject(o, connectionId);
    const w: World = { scope, browser, org, o, projectId: project.id, projectName: project.name, roleIds, runs: [] };
    try {
      await body(w);
    } finally {
      for (const run of w.runs) await o.api.post(`/api/runs/${run}/cancel`).catch(() => null);
    }
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

/** A project on the fake repo with the agent credential and the prompt rule `/rbac-run`, made as the owner. */
async function setUpProject(o: Actor, connectionId: string): Promise<ProjectDto> {
  const project = ProjectDto.parse(
    await ok(
      await o.api.post('/api/projects', { data: { connectionId, repoPath: REPO_P1, triggerMode: 'webhook' } }),
      201,
      'create project',
    ),
  );
  const agent = AgentDto.parse(await ok(await o.api.get(`/api/projects/${project.id}/agent`), 200, 'agent'));
  await ok(
    await o.api.put(`/api/agents/${agent.id}/credential`, {
      data: { type: 'api_key', value: `sk-ant-e2e-${randomBytes(8).toString('hex')}` },
    }),
    200,
    'set credential',
  );
  RuleDto.parse(
    await ok(
      await o.api.post(`/api/projects/${project.id}/rules`, {
        data: {
          command: 'rbac-run',
          labelFilter: [],
          target: 'any',
          enabled: true,
          kind: 'prompt',
          prompt: 'Reply with one short sentence.',
        },
      }),
      201,
      'create rule',
    ),
  );
  return project;
}

/** Posts `/rbac-run` as `who` on a new pull request on the fake board and waits until the run it started is idle. */
async function startRun(w: World, who: Actor): Promise<{ id: string; number: number }> {
  const ticketNumber = randomInt(100_000, 1_000_000_000);
  await ok(
    await who.api.post('/dev/fake/tickets', {
      data: { repoPath: REPO_P1, number: ticketNumber, kind: 'pr', title: `members ${who.handle}` },
    }),
    201,
    'fake ticket',
  );
  const comment = CommentResult.parse(
    await ok(
      await who.api.post('/dev/fake/comments', {
        data: {
          repoPath: REPO_P1,
          ticketNumber,
          body: '/rbac-run',
          deliver: 'webhook',
          projectId: w.projectId,
          author: who.handle,
        },
      }),
      201,
      'fake comment',
    ),
  );
  expect(comment.runId, `comment outcome ${comment.outcome}`).toBeTruthy();
  const id = comment.runId ?? '';
  w.runs.push(id);
  await waitForStatus(who.page, id, 'idle', 90_000);
  return { id, number: (await runOf(who.page, id)).number };
}

/** The Given steps that need no UI: the member list as the owner sees it, a role set, a member removed. */
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

async function setRole(w: World, userId: string, roleId: string | null): Promise<void> {
  await ok(
    await w.o.api.put(`/api/orgs/${w.org.id}/members/${userId}/role`, { data: { roleId } }),
    200,
    'change member role',
  );
}

async function removeViaApi(w: World, userId: string): Promise<void> {
  await ok(await w.o.api.delete(`/api/orgs/${w.org.id}/members/${userId}`), 204, 'remove member');
}

const membersUrl = (w: World): string => `/o/${w.org.slug}/settings/members`;
const projectsUrl = (w: World): string => `/o/${w.org.slug}/projects`;
const runsUrl = (w: World): string => `/o/${w.org.slug}/p/${w.projectId}/runs`;

const rowOf = (page: Page, text: string): Locator => page.locator('tbody tr').filter({ hasText: text });
const cellOf = (row: Locator, index: number): Locator => row.getByRole('cell').nth(index);
/** One chip per grant, as scope and role: `Organization · Admin`, `<project> · Member`, or `No role` without an org grant. */
const accessOf = (row: Locator): Locator => row.getByRole('listitem');
const orgChip = (role: string): string => (role === 'No role' ? role : `Organization · ${role}`);
const menuButton = (page: Page, name: string): Locator => page.getByRole('button', { name: `Actions for ${name}` });
const roleDialog = (page: Page, name: string): Locator =>
  page.getByRole('dialog', { name: `Change access for ${name}` });
const card = (scope: Locator, role: string): Locator => scope.getByRole('radio', { name: new RegExp(`^${role}`) });
const okToast = (page: Page, title: string): Locator => page.getByRole('status').filter({ hasText: title });
const settingsTab = (page: Page): Locator =>
  page
    .getByRole('navigation', { name: 'Organization sections' })
    .getByRole('link', { name: 'Org settings', exact: true });

async function openMembers(page: Page, w: World): Promise<void> {
  await page.goto(membersUrl(w));
  await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
  await expect(page.locator('tbody tr').first()).toBeVisible();
}

/** O's page: the Members list, "Actions for <name>" open on `name`'s row, then the menu item. */
async function pickMenuItem(
  page: Page,
  name: string,
  item: 'Change access' | 'Remove from organization',
): Promise<void> {
  await menuButton(page, name).click();
  await page.getByRole('button', { name: item, exact: true }).click();
}

/** Confirms the "Remove <name> from <Org>?" dialog the menu opened. */
function removeDialog(page: Page, name: string, orgName: string): Locator {
  return page.getByRole('dialog', { name: `Remove ${name} from ${orgName}?` });
}

/** Removes `name` through the menu and the confirm; ends after the toast and the row are gone. */
async function removeThroughUi(page: Page, name: string, orgName: string, handle: string): Promise<void> {
  await pickMenuItem(page, name, 'Remove from organization');
  const dialog = removeDialog(page, name, orgName);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(okToast(page, `${name} removed`)).toBeVisible();
  await expect(rowOf(page, handle)).toHaveCount(0);
}

/** The reauth interval the stack was started with: the terminal close is awaited for one interval plus a margin. */
function reauthMs(): number {
  const configured = Number(process.env['E2E_TERMINAL_REAUTH_MS']);
  return Number.isInteger(configured) && configured > 0 ? configured : 60_000;
}

interface Cast {
  o: Actor;
  a: Actor;
  b: Actor;
  v: Actor;
  n: Actor;
}

/**
 * The spec's cast: O (Owner, signed in), A (Admin), B (Member, plus the project role "Admin" on P1), V (Viewer) and N
 * (no org role: a Viewer whose role O then removed through the role route). Only O, A and B keep their context open.
 */
async function givenCast(w: World): Promise<Cast> {
  const { scope, browser, org } = w;
  const a = await join(scope, browser, org, 'a', 'admin');
  const b = await join(scope, browser, org, 'b', 'member');
  await grant(scope.pa, org.id, b.userId, 'admin', { type: 'project', projectId: w.projectId });
  const v = await join(scope, browser, org, 'v', 'viewer');
  const n = await join(scope, browser, org, 'n', 'viewer');
  await setRole(w, n.userId, null);
  await v.ctx.close();
  await n.ctx.close();
  return { o: w.o, a, b, v, n };
}

/** TC-1.1 and TC-1.2 read the same table; `you` is the signed-in person whose row carries the "You" tag. */
async function expectCastTable(page: Page, w: World, cast: Cast, you: Actor): Promise<void> {
  await openMembers(page, w);
  await expect(page.getByRole('columnheader')).toHaveText(['Name', 'Access', 'Actions']);
  await expect(page.locator('tbody tr')).toHaveCount(5);
  const roles: [Actor, string][] = [
    [cast.o, 'Owner'],
    [cast.a, 'Admin'],
    [cast.b, 'Member'],
    [cast.v, 'Viewer'],
    [cast.n, 'No role'],
  ];
  for (const [who, role] of roles) {
    const row = rowOf(page, who.handle);
    await expect(row, `${who.handle} is listed once`).toHaveCount(1);
    const name = await nameOf(w, who.userId);
    await expect(cellOf(row, 0)).toContainText(name);
    await expect(cellOf(row, 0)).toContainText(who.handle);
    await expect(accessOf(row).first(), `${who.handle} has the role ${role}`).toHaveText(orgChip(role));
    // exactly one person carries the tag: the signed-in one
    await expect(row.getByText('You', { exact: true })).toHaveCount(who === you ? 1 : 0);
  }
  await expect(accessOf(rowOf(page, cast.b.handle))).toHaveText(['Organization · Member', `${w.projectName} · Admin`]);
  for (const who of [cast.o, cast.a, cast.v]) {
    await expect(accessOf(rowOf(page, who.handle))).toHaveCount(1);
  }
  await expect(accessOf(rowOf(page, cast.n.handle))).toHaveText(['No role']);
  await expect(page.getByText('@dev.local')).toHaveCount(0);
}

test('TC-1.1: the owner sees the five people with name, handle, role and project roles, the You tag and no email', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const cast = await givenCast(w);
    await expectCastTable(w.o.page, w, cast, w.o);
  });
});

test('TC-1.2: an org admin sees the same five people and roles as the owner', async ({ browser }) => {
  await withWorld(browser, async (w) => {
    const cast = await givenCast(w);
    await expectCastTable(cast.a.page, w, cast, cast.a);
  });
});

test('TC-1.3: with B made Owner the list shows both O and B as Owner', async ({ browser }) => {
  await withWorld(browser, async (w) => {
    const b = await join(w.scope, w.browser, w.org, 'b', 'member');
    await setRole(w, b.userId, w.roleIds.owner);
    await openMembers(w.o.page, w);
    await expect(w.o.page.locator('tbody tr')).toHaveCount(2);
    await expect(accessOf(rowOf(w.o.page, w.o.handle)).first()).toHaveText('Organization · Owner');
    await expect(accessOf(rowOf(w.o.page, b.handle)).first()).toHaveText('Organization · Owner');
  });
});

test('TC-3.1: O changes B from Member to Admin; B reloads and gets the Settings tab and the admin pages', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const b = await join(w.scope, w.browser, w.org, 'b', 'member');
    const name = await nameOf(w, b.userId);
    // Before: a Member has no Settings tab and a Members URL shows the no-access state.
    await b.page.goto(projectsUrl(w));
    await expect(b.page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
    await expect(settingsTab(b.page)).toHaveCount(0);
    await b.page.goto(membersUrl(w));
    await expect(b.page.getByText("You don't have access")).toBeVisible();
    await b.page.goto(projectsUrl(w));
    await expect(b.page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();

    const page = w.o.page;
    await openMembers(page, w);
    await pickMenuItem(page, name, 'Change access');
    const dialog = roleDialog(page, name);
    await expect(dialog).toBeVisible();
    await expect(card(dialog, 'Member')).toBeChecked();
    await card(dialog, 'Admin').check();
    await dialog.getByRole('button', { name: 'Save access' }).click();
    await expect(okToast(page, 'Role changed')).toBeVisible();
    await expect(dialog).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
    await expect(accessOf(rowOf(page, b.handle)).first()).toHaveText('Organization · Admin');

    await b.page.reload();
    await expect(b.page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
    await expect(settingsTab(b.page)).toBeVisible();
    for (const [path, heading] of [
      ['members', 'Members'],
      ['general', 'General'],
      ['invitations', 'Invitations'],
      ['audit', 'Audit log'],
    ]) {
      await b.page.goto(`/o/${w.org.slug}/settings/${path}`);
      await expect(b.page.getByRole('heading', { level: 1, name: heading }), `B opens ${path}`).toBeVisible();
    }
  });
});

test('TC-3.2: O changes B from Member to Viewer; B reloads the project page and has no run controls', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const b = await join(w.scope, w.browser, w.org, 'b', 'member');
    const name = await nameOf(w, b.userId);
    const run = await startRun(w, b);
    const runUrl = `${runsUrl(w)}/${run.number}`;
    // No UI control starts a run (runs start from a ticket comment, spec Q1), so "cannot start a run" is proved by the
    // run:create permission below plus the Finish run / Cancel run controls, not by a guessed button name.
    const runLink = b.page.locator(`a[href="${runUrl}"]`);

    // Before, as a Member: the project page offers "Finish run" on B's idle run, the run page "Cancel run", and the
    // access holds `run:create`.
    await b.page.goto(runsUrl(w));
    await expect(runLink.first()).toBeVisible();
    await expect(b.page.getByRole('button', { name: 'Finish run' })).toBeVisible();
    await b.page.goto(runUrl);
    await expect(b.page.getByRole('button', { name: 'Cancel run' })).toBeVisible();
    const before = AccessDto.parse(await ok(await b.api.get('/api/me/access'), 200, 'B access before'));
    expect(before.assignments.flatMap((a) => a.permissions.map((p) => p.permission))).toContain('run:create');

    const page = w.o.page;
    await openMembers(page, w);
    await pickMenuItem(page, name, 'Change access');
    const dialog = roleDialog(page, name);
    await card(dialog, 'Viewer').check();
    await dialog.getByRole('button', { name: 'Save access' }).click();
    await expect(okToast(page, 'Role changed')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
    await expect(accessOf(rowOf(page, b.handle)).first()).toHaveText('Organization · Viewer');

    await b.page.goto(runsUrl(w));
    await expect(runLink.first(), 'B still sees the run').toBeVisible();
    await expect(b.page.getByRole('button', { name: 'Finish run' })).toHaveCount(0);
    await b.page.goto(runUrl);
    await expect(b.page.getByText('Triggered by')).toBeVisible();
    await expect(b.page.getByRole('button', { name: 'Cancel run' })).toHaveCount(0);
    const after = AccessDto.parse(await ok(await b.api.get('/api/me/access'), 200, 'B access after'));
    const permissions = after.assignments.flatMap((a) => a.permissions.map((p) => p.permission));
    expect(permissions).toContain('run:read');
    expect(permissions).not.toContain('run:create');
  });
});

test('TC-3.3: O changes B to No role; B stays listed as "No role" with the P1 project role', async ({ browser }) => {
  await withWorld(browser, async (w) => {
    const b = await join(w.scope, w.browser, w.org, 'b', 'member');
    await grant(w.scope.pa, w.org.id, b.userId, 'admin', { type: 'project', projectId: w.projectId });
    const name = await nameOf(w, b.userId);

    const page = w.o.page;
    await openMembers(page, w);
    await expect(accessOf(rowOf(page, b.handle)).first()).toHaveText('Organization · Member');
    await pickMenuItem(page, name, 'Change access');
    const dialog = roleDialog(page, name);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Stays a member with no organization role. Project roles stay.')).toBeVisible();
    await card(dialog, 'No role').check();
    await dialog.getByRole('button', { name: 'Save access' }).click();
    await expect(okToast(page, 'Role changed')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
    const row = rowOf(page, b.handle);
    await expect(accessOf(row)).toHaveText(['No role', `${w.projectName} · Admin`]);
  });
});

test('TC-3.4: "Save access" is disabled while the choice is the current role and enabled once it differs', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const b = await join(w.scope, w.browser, w.org, 'b', 'member');
    const name = await nameOf(w, b.userId);
    const page = w.o.page;
    await openMembers(page, w);
    await pickMenuItem(page, name, 'Change access');
    const dialog = roleDialog(page, name);
    const save = dialog.getByRole('button', { name: 'Save access' });
    await expect(dialog).toBeVisible();
    await expect(card(dialog, 'Member')).toBeChecked();
    await expect(save).toBeDisabled();
    await card(dialog, 'Viewer').check();
    await expect(save).toBeEnabled();
    await card(dialog, 'Member').check();
    await expect(save).toBeDisabled();
  });
});

test('TC-6.1: O removes B after the confirm; the dialog reads as stated, the toast shows and B leaves the list', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const b = await join(w.scope, w.browser, w.org, 'b', 'member');
    const second = await w.scope.org('y');
    const invitation = await inviteViaApi(w.scope.pa, second.id, `${b.handle}@dev.local`, 'member', { type: 'org' });
    await acceptViaApi(b.page, invitation.id);
    const name = await nameOf(w, b.userId);

    const page = w.o.page;
    await openMembers(page, w);
    await expect(rowOf(page, b.handle)).toHaveCount(1);
    await pickMenuItem(page, name, 'Remove from organization');
    const dialog = removeDialog(page, name, w.org.name);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(`They lose access to every project in ${w.org.name}.`)).toBeVisible();
    await expect(dialog.getByRole('button')).toHaveText(['Cancel', 'Remove']);
    await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(okToast(page, `${name} removed`)).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await expect(rowOf(page, b.handle)).toHaveCount(0);
    // positive control: the others are still listed
    await expect(rowOf(page, w.o.handle)).toHaveCount(1);
  });
});

test('TC-6.2: after B is removed, B reloads: the removed org is not in the org menu and its link is not found', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const b = await join(w.scope, w.browser, w.org, 'b', 'member');
    const second = await w.scope.org('y');
    const invitation = await inviteViaApi(w.scope.pa, second.id, `${b.handle}@dev.local`, 'member', { type: 'org' });
    await acceptViaApi(b.page, invitation.id);
    await b.page.goto(projectsUrl(w));
    await expect(b.page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
    // Before: both orgs are in the menu.
    const menuButtonOf = b.page.getByRole('button', { name: /^Switch scope/ });
    await menuButtonOf.click();
    const menuBefore = b.page.getByRole('dialog', { name: 'Scope' });
    await expect(menuBefore).toContainText(w.org.name);
    await expect(menuBefore).toContainText(second.name);
    await b.page.keyboard.press('Escape');

    await removeViaApi(w, b.userId);

    await b.page.goto(`/o/${second.slug}/projects`);
    await expect(b.page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
    await b.page.reload();
    await expect(b.page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
    await menuButtonOf.click();
    const menu = b.page.getByRole('dialog', { name: 'Scope' });
    await expect(menu).toBeVisible();
    await expect(menu).toContainText(second.name);
    await expect(menu).not.toContainText(w.org.name);

    await b.page.goto(projectsUrl(w));
    await expect(b.page.getByText('Page not found')).toBeVisible();
  });
});

test('TC-6.3: Cancel closes the confirm and B is still listed after a reload', async ({ browser }) => {
  await withWorld(browser, async (w) => {
    const b = await join(w.scope, w.browser, w.org, 'b', 'member');
    const name = await nameOf(w, b.userId);
    const page = w.o.page;
    await openMembers(page, w);
    await pickMenuItem(page, name, 'Remove from organization');
    const dialog = removeDialog(page, name, w.org.name);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
    await expect(rowOf(page, b.handle)).toHaveCount(1);
    await expect(okToast(page, `${name} removed`)).toHaveCount(0);
  });
});

test('TC-6.4: an org admin removes a Member: the toast shows and B leaves the list', async ({ browser }) => {
  await withWorld(browser, async (w) => {
    const a = await join(w.scope, w.browser, w.org, 'a', 'admin');
    const b = await join(w.scope, w.browser, w.org, 'b', 'member');
    const name = await nameOf(w, b.userId);
    await openMembers(a.page, w);
    await expect(rowOf(a.page, b.handle)).toHaveCount(1);
    await removeThroughUi(a.page, name, w.org.name, b.handle);
    await expect(rowOf(a.page, a.handle)).toHaveCount(1);
    await expect(rowOf(a.page, w.o.handle)).toHaveCount(1);
  });
});

/** The Given of TC-7.1 and TC-7.2: B (Member) with a run of their own and its terminal attached in B's context. */
async function givenBTerminal(
  w: World,
): Promise<{ b: Actor; run: string; watch: Awaited<ReturnType<typeof watchTerminal>> }> {
  const b = await join(w.scope, w.browser, w.org, 'b', 'member');
  const run = await startRun(w, b);
  // The terminal helpers run `fetch` and `WebSocket` from a light same-origin page of B's context.
  await b.page.goto('/api/me/access');
  const watch = await watchTerminal(b, `/api/runs/${run.id}/terminal`);
  await watch.attached(30_000);
  return { b, run: run.id, watch };
}

test('TC-7.1: after O removes B, B’s open terminal closes within E2E_TERMINAL_REAUTH_MS', async ({ browser }) => {
  await withWorld(browser, async (w) => {
    const { b, watch } = await givenBTerminal(w);
    try {
      const name = await nameOf(w, b.userId);
      await openMembers(w.o.page, w);
      await removeThroughUi(w.o.page, name, w.org.name, b.handle);
      expect(await watch.closeCode(reauthMs() + 30_000), 'the server closes B’s socket 4403').toBe(4403);
    } finally {
      await watch.close().catch(() => null);
    }
  });
});

test('TC-7.2: after the wait, the run still has its status and shows B as owner', async ({ browser }) => {
  await withWorld(browser, async (w) => {
    const { b, run, watch } = await givenBTerminal(w);
    try {
      const name = await nameOf(w, b.userId);
      const before = await runOf(w.o.page, run);
      await openMembers(w.o.page, w);
      await removeThroughUi(w.o.page, name, w.org.name, b.handle);
      await watch.closeCode(reauthMs() + 30_000);

      const after = await runOf(w.o.page, run);
      expect(after.status, 'the run keeps its status').toBe(before.status);
      expect(after.ownerUserId, 'the run still names B as owner').toBe(b.userId);
      await w.o.page.goto(`${runsUrl(w)}/${after.number}`);
      const triggered = w.o.page.getByText('Triggered by', { exact: true }).locator('xpath=following-sibling::dd[1]');
      await expect(triggered).toContainText(b.handle);
    } finally {
      await watch.close().catch(() => null);
    }
  });
});

test('TC-10.1: O invites B again as Viewer; B accepts and is listed with Viewer, no project roles and viewer rights', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const b = await join(w.scope, w.browser, w.org, 'b', 'member');
    await grant(w.scope.pa, w.org.id, b.userId, 'admin', { type: 'project', projectId: w.projectId });
    await removeViaApi(w, b.userId);
    expect(
      (await membersOf(w)).map((m) => m.userId),
      'B was removed',
    ).not.toContain(b.userId);

    // 1. O invites B's person again as Viewer: Settings, then Invitations.
    const page = w.o.page;
    await page.goto(projectsUrl(w));
    await settingsTab(page).click();
    await page.getByRole('link', { name: 'Invitations', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Invitations' })).toBeVisible();
    await page.getByRole('button', { name: 'Invite people' }).first().click();
    const invite = page.getByRole('dialog', { name: 'Invite people' });
    await expect(invite).toBeVisible();
    await invite.getByLabel('Email').fill(`${b.handle}@dev.local`);
    await invite.getByLabel('Role').selectOption({ label: 'Viewer' });
    await invite.getByRole('radio', { name: 'Whole organization' }).check();
    await invite.getByRole('button', { name: 'Create invitation' }).click();
    const created = page.getByRole('dialog', { name: 'Invitation created' });
    await expect(created).toBeVisible();
    const field = created.getByLabel('Invitation link');
    await expect(field).toContainText('/invitations/');
    const link = ((await field.textContent()) ?? '').trim();

    // 2. B accepts it.
    await b.page.goto(link);
    await expect(b.page.getByRole('heading', { level: 1, name: `Join ${w.org.name}` })).toBeVisible();
    await b.page.getByRole('button', { name: 'Accept', exact: true }).click();
    await expect(b.page).toHaveURL(new RegExp(`/o/${w.org.slug}/projects$`));

    // 3. O opens Members: B is listed with Viewer and no project roles.
    await openMembers(page, w);
    const row = rowOf(page, b.handle);
    await expect(row).toHaveCount(1);
    await expect(accessOf(row).first()).toHaveText('Organization · Viewer');
    await expect(accessOf(row)).toHaveCount(1); // the org grant only: no project grant
    const mine = (await membersOf(w)).find((m) => m.userId === b.userId);
    expect(
      mine?.assignments.map((a) => [a.role.key, a.scope.type]),
      'B holds exactly the Viewer role on the org',
    ).toEqual([['viewer', 'org']]);

    // 4. B reloads the project page: it opens, and B has viewer rights only.
    await b.page.goto(runsUrl(w));
    await b.page.reload();
    await expect(b.page).toHaveURL(new RegExp(`/o/${w.org.slug}/p/${w.projectId}/runs$`));
    await expect(b.page.getByRole('navigation', { name: 'Project sections' })).toBeVisible();
    await expect(
      b.page
        .getByRole('navigation', { name: 'Project sections' })
        .getByRole('link', { name: 'Project settings', exact: true }),
    ).toHaveCount(0);
    const access = AccessDto.parse(await ok(await b.api.get('/api/me/access'), 200, 'B access'));
    const permissions = access.assignments.flatMap((a) => a.permissions.map((p) => p.permission));
    expect(permissions, 'B can read the project').toContain('project:read');
    for (const denied of ['run:create', 'run:update', 'run:cancel', 'terminal:attach', 'member:read'] as const) {
      expect(permissions, `a Viewer does not hold ${denied}`).not.toContain(denied);
    }
  });
});
