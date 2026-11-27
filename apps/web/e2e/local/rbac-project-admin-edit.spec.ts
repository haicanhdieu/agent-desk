import { expect, test, type Locator, type Page } from '@playwright/test';
import { ACTIVE_RUN_STATUSES, ProjectDto, ProjectMemberDto, pageOf } from '@agentdesk/contracts';
import { API, ok, runOf } from './helpers';
import { REPO_P1, buildCast, disposeCast, watchTerminal, type Actor, type Cast } from './rbac-cast';
import { freshOrgMember, projectMembersApi } from './project-admin';

/*
 * Local end-to-end for changing and removing project roles (spec "E2E requirements": BR-8, BR-9, BR-10, BR-14, BR-25).
 * A is the admin of P1 only, B the member of P1 and P2, C the member of P1, O the owner, V the org viewer, RC is C's
 * run on P1 (`buildCast`); every case runs in a fresh org. The extra person of a case (F) is built inside the case as
 * a member of P2 only, in its own browser context (`freshOrgMember`), and closed in a `finally`. In the cast a dev-login
 * person's name is their handle, so a row, a dialog title or a toast names the handle.
 *
 * BR-10 needs the stack started with `TERMINAL_REAUTH_MS=1000` and the run with `E2E_TERMINAL_REAUTH_MS=1000`
 * (see org-members.spec.ts). Unset, those cases wait one default interval (60 s).
 */

test.describe.configure({ timeout: 300_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

let cast: Cast;
/** The cast to dispose: unset until a build succeeded, and again after its disposal, so a failed build never disposes a stale one. */
let built: Cast | undefined;

test.beforeEach(async ({ browser }) => {
  built = undefined;
  built = await buildCast(browser);
  cast = built;
});

test.afterEach(async () => {
  const done = built;
  built = undefined;
  if (done) await disposeCast(done);
});

/** Cleanup that never masks the failure of the test it runs after. */
async function quietly(action: () => Promise<unknown>): Promise<void> {
  await action().catch(() => null);
}

/** The cast's org name: `buildCast` creates the org as `RBAC <tag>` with the slug `rbac-<tag>`. */
const orgName = (): string => `RBAC ${cast.slug.slice('rbac-'.length)}`;

/** The reauth interval the stack was started with: the terminal close is awaited for one interval plus a margin. */
function reauthMs(): number {
  const configured = Number(process.env['E2E_TERMINAL_REAUTH_MS']);
  return Number.isInteger(configured) && configured > 0 ? configured : 60_000;
}

const membersHeading = (page: Page): Locator => page.getByRole('heading', { level: 1, name: 'Members' });
const rowOf = (page: Page, handle: string): Locator => page.getByRole('row').filter({ hasText: handle });
const roleCell = (row: Locator): Locator => row.getByRole('cell').nth(1);
const okToast = (page: Page, title: string): Locator => page.getByRole('status').filter({ hasText: title });
const runsUrl = (): string => `/o/${cast.slug}/p/${cast.p1}/runs`;
const forbidden = (page: Page): Locator => page.getByRole('heading', { name: "You don't have access" });
const notFound = (page: Page): Locator => page.getByRole('heading', { name: 'Page not found' });

/** A cast project's name, as the owner reads it. */
async function nameOf(projectId: string): Promise<string> {
  return ProjectDto.parse(await ok(await cast.o.api.get(`/api/projects/${projectId}`), 200, 'project')).name;
}

/** P1's Members as the owner reads them over the API. */
async function membersOf(): Promise<ProjectMemberDto[]> {
  return pageOf(ProjectMemberDto).parse(
    await ok(await projectMembersApi(cast.o, cast.p1).list(), 200, 'project members'),
  ).items;
}

/** The role keys `userId` holds on P1, as the owner reads them over the API. */
async function roleKeysOnP1(userId: string): Promise<string[]> {
  const found = (await membersOf()).find((m) => m.userId === userId);
  return (found?.projectRoles ?? []).map((r) => r.role.key).sort();
}

/** Opens P1 → Settings → Members through the Project menu, and waits for the list. */
async function openMembers(who: Actor): Promise<void> {
  await who.page.goto(runsUrl());
  await who.page.getByRole('navigation', { name: 'Project menu' }).getByRole('link', { name: 'Members' }).click();
  await expect(membersHeading(who.page)).toBeVisible();
  await expect(rowOf(who.page, cast.c.handle)).toBeVisible();
}

async function reloadMembers(who: Actor): Promise<void> {
  await who.page.reload();
  await expect(membersHeading(who.page)).toBeVisible();
}

const changeDialog = (page: Page, handle: string): Locator =>
  page.getByRole('dialog', { name: `Change role for ${handle}` });

/** On the open Members page: "Actions for <handle>" → "Change role"; returns the open dialog. */
async function openChangeRole(page: Page, handle: string): Promise<Locator> {
  await rowOf(page, handle)
    .getByRole('button', { name: `Actions for ${handle}` })
    .click();
  await page.getByRole('button', { name: 'Change role', exact: true }).click();
  const dialog = changeDialog(page, handle);
  await expect(dialog).toBeVisible();
  return dialog;
}

async function pickRole(dialog: Locator, role: 'Admin' | 'Member' | 'Viewer'): Promise<void> {
  await dialog.getByRole('radio', { name: new RegExp(`^${role}`) }).check({ force: true });
}

/** Opens Change role for `handle`, picks `role`, clicks "Save role"; ends on the "Role changed" toast. */
async function changeRoleViaUi(page: Page, handle: string, role: 'Admin' | 'Member' | 'Viewer'): Promise<void> {
  const dialog = await openChangeRole(page, handle);
  await pickRole(dialog, role);
  await dialog.getByRole('button', { name: 'Save role' }).click();
  await expect(okToast(page, 'Role changed')).toBeVisible();
  await expect(dialog).toHaveCount(0);
}

/** On the open Members page: "Actions for <handle>" → "Remove from project"; returns the confirm dialog. */
async function openRemove(page: Page, handle: string, projectName: string): Promise<Locator> {
  await rowOf(page, handle)
    .getByRole('button', { name: `Actions for ${handle}` })
    .click();
  await page.getByRole('button', { name: 'Remove from project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Remove ${handle} from ${projectName}?` });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Removes `handle` from P1 through the confirm dialog; ends on the toast and the row gone. */
/** `inherited`: the person keeps an org-wide role, so their row stays (as an Organization row) without the removed role. */
async function removeViaUi(page: Page, handle: string, projectName: string, inherited = false): Promise<void> {
  const dialog = await openRemove(page, handle, projectName);
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(okToast(page, `${handle} removed from ${projectName}`)).toBeVisible();
  if (inherited) await expect(roleCell(rowOf(page, handle))).toHaveText('ViewerOrganization');
  else await expect(rowOf(page, handle)).toHaveCount(0);
}

const addDialog = (page: Page): Locator => page.getByRole('dialog', { name: /^Add member to/ });

/** On the open Members page: Add member, pick `handle` in Person and the `role` card; the dialog stays open, unsent. */
async function fillAddDialog(page: Page, handle: string, role: 'Admin' | 'Member' | 'Viewer'): Promise<void> {
  await page.getByRole('button', { name: 'Add member' }).first().click();
  await expect(addDialog(page)).toBeVisible();
  await addDialog(page).getByRole('combobox', { name: 'Person' }).click();
  await page.getByRole('option').filter({ hasText: handle }).first().click();
  await addDialog(page)
    .getByRole('radiogroup', { name: 'Role' })
    .getByRole('radio', { name: new RegExp(`^${role}`) })
    .check({ force: true });
}

/** O's org Settings → Members row of `handle`. */
const orgMembersRow = (page: Page, handle: string): Locator => page.locator('tbody tr').filter({ hasText: handle });
/** The org Members table: Name, Access (one chip per grant, "<scope> · <role>"), then the row menu. */
const ACCESS_CELL = 1;

/** Whether a run status is one of the active ones. */
const isActive = (status: string): boolean => ACTIVE_RUN_STATUSES.some((s) => s === status);

test.describe('BR-8: change a person’s project role', () => {
  test('TC-8.1: A changes C from Member to Viewer; the toast shows and after a reload C’s row shows only Viewer', async () => {
    const { a, c } = cast;
    await openMembers(a);
    await expect(roleCell(rowOf(a.page, c.handle))).toHaveText('Member');
    await changeRoleViaUi(a.page, c.handle, 'Viewer');
    await reloadMembers(a);
    await expect(roleCell(rowOf(a.page, c.handle))).toHaveText('Viewer');
    expect(await roleKeysOnP1(c.userId), 'one row: Viewer only').toEqual(['viewer']);
  });

  test('TC-8.2: after the change C’s P1 run page shows no Cancel run, and cancelling RC answers 403', async () => {
    const { a, c, rc } = cast;
    const run = await runOf(c.page, rc);
    const runUrl = `${runsUrl()}/${run.number}`;
    // Control: before the change C owns RC and its page offers Cancel run, so the absence below is a real difference.
    await c.page.goto(runUrl);
    await expect(c.page.getByText('Triggered by')).toBeVisible();
    await expect(c.page.getByRole('button', { name: 'Cancel run' })).toBeVisible();

    await openMembers(a);
    await changeRoleViaUi(a.page, c.handle, 'Viewer');

    await c.page.goto(runUrl);
    await expect(c.page.getByText('Triggered by')).toBeVisible();
    await expect(c.page.getByRole('button', { name: 'Cancel run' })).toHaveCount(0);
    const cancel = await c.api.post(`/api/runs/${rc}/cancel`);
    expect(cancel.status(), `cancel RC as Viewer: ${await cancel.text()}`).toBe(403);
  });

  test('TC-8.3: with the current role selected, Save role is disabled until a different role is picked', async () => {
    const { a, c } = cast;
    await openMembers(a);
    const dialog = await openChangeRole(a.page, c.handle);
    await expect(dialog.getByRole('radio', { name: /^Member/ })).toBeChecked();
    await expect(dialog.getByRole('button', { name: 'Save role' })).toBeDisabled();
    await pickRole(dialog, 'Viewer');
    await expect(dialog.getByRole('button', { name: 'Save role' })).toBeEnabled();
    expect(await roleKeysOnP1(c.userId), 'nothing was saved').toEqual(['member']);
  });

  test('TC-8.4: F holds Member and Viewer on P1 (both listed joined with ", "); A makes F Admin and after a reload only Admin shows', async () => {
    const { a, o, orgId, p1, roleIds } = cast;
    const f = await freshOrgMember(cast, 'member', { type: 'project', projectId: cast.p2 });
    try {
      for (const roleId of [roleIds.member, roleIds.viewer]) {
        const res = await o.api.post(`/api/orgs/${orgId}/assignments`, {
          data: { userId: f.userId, roleId, scope: { type: 'project', projectId: p1 } },
        });
        expect(res.ok(), `O grants F a role on P1: ${res.status()} ${await res.text()}`).toBe(true);
      }
      await openMembers(a);
      // Before: both roles, joined with ", " (the order is not specified).
      await expect(roleCell(rowOf(a.page, f.handle))).toHaveText(/^(Member, Viewer|Viewer, Member)$/);
      await changeRoleViaUi(a.page, f.handle, 'Admin');
      await reloadMembers(a);
      await expect(roleCell(rowOf(a.page, f.handle))).toHaveText('Admin');
      expect(await roleKeysOnP1(f.userId), 'one row: Admin only').toEqual(['admin']);
    } finally {
      await quietly(() => f.ctx.close());
    }
  });
});

test.describe('BR-9: remove a person from P1', () => {
  test('TC-9.1: A removes C after confirming; the dialog and toast read as specified and the row is gone after a reload', async () => {
    const { a, c } = cast;
    const projectName = await nameOf(cast.p1);
    await openMembers(a);
    const dialog = await openRemove(a.page, c.handle, projectName);
    await expect(
      dialog.getByText(`They lose their role on this project. A role they hold in ${orgName()} stays.`),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(okToast(a.page, `${c.handle} removed from ${projectName}`)).toBeVisible();
    await reloadMembers(a);
    // The list is loaded: B and A are there, so C's absence is a result.
    await expect(rowOf(a.page, cast.b.handle)).toBeVisible();
    await expect(rowOf(a.page, a.handle)).toBeVisible();
    await expect(rowOf(a.page, c.handle)).toHaveCount(0);
  });

  test('TC-9.2: after the removal C holds no grant: the project list and P1’s link both show "You don’t have access"', async () => {
    const { a, c } = cast;
    const projectName = await nameOf(cast.p1);
    await openMembers(a);
    await removeViaUi(a.page, c.handle, projectName);

    await c.page.goto(`/o/${cast.slug}/projects`);
    await expect(forbidden(c.page)).toBeVisible();
    await expect(c.page.locator('body')).not.toContainText(projectName);
    await expect(c.page.locator('body')).not.toContainText(REPO_P1);

    await c.page.goto(runsUrl());
    await expect(forbidden(c.page)).toBeVisible();
    await expect(c.page.locator('body')).not.toContainText(projectName);
    await expect(c.page.locator('body')).not.toContainText(REPO_P1);
  });

  test('TC-9.3: Cancel in the confirm dialog closes it and C’s row is still listed', async () => {
    const { a, c } = cast;
    const projectName = await nameOf(cast.p1);
    await openMembers(a);
    const dialog = await openRemove(a.page, c.handle, projectName);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(roleCell(rowOf(a.page, c.handle))).toHaveText('Member');
    expect(await roleKeysOnP1(c.userId), 'C still holds Member on P1').toEqual(['member']);
  });

  test('TC-9.4: B is a member of P1 and P2; after A removes B from P1, B’s project list has no P1 and still has P2', async () => {
    const { a, b } = cast;
    const [name1, name2] = [await nameOf(cast.p1), await nameOf(cast.p2)];
    await openMembers(a);
    await removeViaUi(a.page, b.handle, name1);

    await b.page.goto(`/o/${cast.slug}/projects`);
    await expect(b.page.getByRole('link', { name: name2, exact: true })).toBeVisible();
    await expect(b.page.getByRole('link', { name: name1, exact: true })).toHaveCount(0);
  });

  test('TC-9.5: V (org Viewer) also holds Admin on P1; A removes V from P1, V’s row leaves and P1 still opens read-only', async () => {
    const { a, o, v, orgId, p1, rb, roleIds } = cast;
    const granted = await o.api.post(`/api/orgs/${orgId}/assignments`, {
      data: { userId: v.userId, roleId: roleIds.admin, scope: { type: 'project', projectId: p1 } },
    });
    expect(granted.ok(), `O gives V Admin on P1: ${granted.status()} ${await granted.text()}`).toBe(true);
    const projectName = await nameOf(p1);
    const run = await runOf(o.page, rb);
    const runUrl = `${runsUrl()}/${run.number}`;
    await openMembers(a);
    // BR-4: one row shows the role granted on P1 and the inherited org-wide role (labelled Organization).
    await expect(roleCell(rowOf(a.page, v.handle))).toHaveText('AdminViewerOrganization');
    // The project role goes; V's org Viewer role (BR-4) keeps an Organization row without Admin.
    await removeViaUi(a.page, v.handle, projectName, true);
    await reloadMembers(a);
    await expect(rowOf(a.page, a.handle)).toBeVisible();
    await expect(roleCell(rowOf(a.page, v.handle))).toHaveText('ViewerOrganization');
    await expect(roleCell(rowOf(a.page, v.handle))).not.toContainText('Admin');

    // Control: the owner sees Cancel run on this run, so its absence for V is a real difference.
    await o.page.goto(runUrl);
    await expect(o.page.getByRole('button', { name: 'Cancel run' })).toBeVisible();

    await v.page.goto(runsUrl());
    await expect(notFound(v.page)).toHaveCount(0);
    await expect(v.page.locator(`a[href="${runUrl}"]`).first()).toBeVisible();
    await v.page.goto(runUrl);
    await expect(v.page.getByText('Triggered by')).toBeVisible();
    await expect(v.page.getByRole('button', { name: 'Cancel run' })).toHaveCount(0);
  });
});

test.describe('BR-10: the removed person’s terminal and runs', () => {
  /** The Given: C's terminal of RC is attached. A then removes C from P1 through the Members page. */
  async function removeWithTerminalOpen(): Promise<Awaited<ReturnType<typeof watchTerminal>>> {
    const { a, c, rc } = cast;
    const projectName = await nameOf(cast.p1);
    // The terminal helpers run `WebSocket` from a light same-origin page of C's context (parked there by the cast).
    const watch = await watchTerminal(c, `/api/runs/${rc}/terminal`);
    try {
      await watch.attached(30_000);
      await openMembers(a);
      await removeViaUi(a.page, c.handle, projectName);
    } catch (error) {
      await watch.close().catch(() => null);
      throw error;
    }
    return watch;
  }

  test('TC-10.1: after A removes C from P1, C’s open terminal of RC closes with code 4403 within one reauth interval', async () => {
    const watch = await removeWithTerminalOpen();
    try {
      expect(await watch.closeCode(reauthMs() + 30_000), 'the server closes C’s socket 4403').toBe(4403);
    } finally {
      await watch.close().catch(() => null);
    }
  });

  test('TC-10.2: after the terminal closes, RC is still running and its page shows C as owner', async () => {
    const { a, c, rc } = cast;
    const before = await runOf(a.page, rc);
    const watch = await removeWithTerminalOpen();
    try {
      await watch.closeCode(reauthMs() + 30_000);
      const after = await runOf(a.page, rc);
      expect(isActive(after.status), `RC is still running, got ${after.status}`).toBe(true);
      expect(after.status, 'RC keeps its status').toBe(before.status);
      expect(after.ownerUserId, 'RC still names C as owner').toBe(c.userId);
      await a.page.goto(`${runsUrl()}/${after.number}`);
      const triggered = a.page.getByText('Triggered by', { exact: true }).locator('xpath=following-sibling::dd[1]');
      await expect(triggered).toContainText(c.handle);
    } finally {
      await watch.close().catch(() => null);
    }
  });
});

test.describe('BR-14: org Members shows the new project role', () => {
  test('TC-14.1: after A changes C from Member to Viewer on P1, O’s org Settings → Members shows Viewer (not Member), also after a reload', async () => {
    const { a, o, c } = cast;
    const projectName = await nameOf(cast.p1);
    await openMembers(a);
    await changeRoleViaUi(a.page, c.handle, 'Viewer');

    await o.page.goto(`/o/${cast.slug}/settings/members`);
    await expect(o.page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
    // C holds no org-wide role ("No role") and one project grant, now Viewer.
    const chips = (): Locator =>
      orgMembersRow(o.page, c.handle).getByRole('cell').nth(ACCESS_CELL).getByRole('listitem');
    await expect(chips()).toHaveText(['No role', `${projectName} · Viewer`]);
    await o.page.reload();
    await expect(o.page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
    await expect(chips()).toHaveText(['No role', `${projectName} · Viewer`]);
    await expect(orgMembersRow(o.page, c.handle).getByRole('cell').nth(ACCESS_CELL)).not.toContainText('Member');
  });
});

test.describe('BR-25: a demoted or removed admin with the page open', () => {
  test('TC-25.1: O makes A a Member on P1; A’s Add is refused with an error Banner and a request id, nothing is added, and after a reload Forbidden shows', async () => {
    const { a, o, p1, roleIds } = cast;
    const d = await freshOrgMember(cast, 'member', { type: 'project', projectId: cast.p2 });
    try {
      await openMembers(a);
      // The Person list needs A's rights, so the person and the role are chosen while A still has them; the Add is sent after.
      await fillAddDialog(a.page, d.handle, 'Member');
      const swap = await projectMembersApi(o, p1).setRole(a.userId, roleIds.member);
      expect(swap.status(), `O makes A a Member on P1: ${await swap.text()}`).toBe(200);

      await addDialog(a.page).getByRole('button', { name: 'Add member' }).click();
      await expect(addDialog(a.page).getByText(/^Request ID: \S+/)).toBeVisible();
      await expect(addDialog(a.page)).toBeVisible();
      expect(
        (await membersOf()).map((m) => m.userId),
        'D was not added',
      ).not.toContain(d.userId);

      await a.page.reload();
      await expect(forbidden(a.page)).toBeVisible();
      await expect(a.page.getByRole('table')).toHaveCount(0);
    } finally {
      await quietly(() => d.ctx.close());
    }
  });

  test('TC-25.2: O removes all of A’s roles on P1 (A still holds Admin on P2); A’s Change role is refused, nothing changes, and after a reload "Page not found" shows', async () => {
    const { a, c, o, p1, p2, roleIds } = cast;
    // The Given: A also holds Admin on P2, so A still holds `assignment:read` somewhere (the guard says Forbidden for a
    // permission held nowhere, before it looks at the project) and P1 is out of A's scope, hence not found.
    const onP2 = await projectMembersApi(o, p2).add(a.userId, roleIds.admin);
    expect(onP2.status(), `O gives A Admin on P2: ${await onP2.text()}`).toBe(201);
    await openMembers(a);
    // The role cards load with A's rights, so the dialog is opened and a role picked first; the save is sent after.
    const dialog = await openChangeRole(a.page, c.handle);
    await pickRole(dialog, 'Viewer');
    const removed = await projectMembersApi(o, p1).remove(a.userId);
    expect(removed.status(), `O removes all of A's roles on P1: ${await removed.text()}`).toBe(204);

    // P1 is now out of A's scope: the API answers 404 to the save; the page closes the dialog and toasts it.
    await dialog.getByRole('button', { name: 'Save role' }).click();
    await expect(a.page.getByText('Member is no longer on this project')).toBeVisible();
    await expect(dialog).toHaveCount(0);
    expect(await roleKeysOnP1(c.userId), 'C is still a Member').toEqual(['member']);

    await a.page.reload();
    await expect(notFound(a.page)).toBeVisible();
    await expect(a.page.getByRole('table')).toHaveCount(0);
  });
});
