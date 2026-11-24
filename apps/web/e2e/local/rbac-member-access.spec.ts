import { expect, test, type Locator, type Page } from '@playwright/test';
import { AssignmentDto, AuditEntryDto, ProjectDto, pageOf } from '@agentdesk/contracts';
import { API, ok } from './helpers';
import { buildCast, disposeCast, type Actor, type Cast } from './rbac-cast';

/*
 * Local end-to-end for the org Members page, Change access (issue #259): the dialog saves the org role and the project
 * grants through the existing routes (PUT /role, POST and DELETE /assignments), each change is audited, and a lower role
 * never sees the dialog. V is the org viewer with no project grant; P1 and P2 are the cast's projects. Every case runs
 * in a fresh org (`buildCast`), so what it grants lives and dies with that org.
 */
test.describe.configure({ timeout: 300_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

let cast: Cast;
/** The cast to dispose: unset until a build succeeded, and again after its disposal. */
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

const membersUrl = (c: Cast): string => `/o/${c.slug}/settings/members`;
const rowOf = (page: Page, handle: string): Locator => page.locator('tbody tr').filter({ hasText: handle });
const chips = (page: Page, handle: string): Locator => rowOf(page, handle).getByRole('listitem');
const projectRow = (d: Locator, project: string): Locator => d.getByRole('listitem', { name: project });

async function projectName(who: Actor, projectId: string): Promise<string> {
  return ProjectDto.parse(await ok(await who.api.get(`/api/projects/${projectId}`), 200, 'project')).name;
}

async function projectGrantsOf(c: Cast, userId: string): Promise<AssignmentDto[]> {
  const items = pageOf(AssignmentDto).parse(
    await ok(await c.o.api.get(`/api/orgs/${c.orgId}/assignments?pageSize=100`), 200, 'assignments'),
  ).items;
  return items.filter((a) => a.userId === userId && a.scope.type === 'project');
}

async function auditActions(c: Cast): Promise<string[]> {
  return pageOf(AuditEntryDto)
    .parse(await ok(await c.o.api.get(`/api/orgs/${c.orgId}/audit?pageSize=100`), 200, 'org audit'))
    .items.map((e) => e.action);
}

async function openChangeAccess(page: Page, handle: string): Promise<Locator> {
  await rowOf(page, handle)
    .getByRole('button', { name: /^Actions for/ })
    .click();
  await page.getByRole('button', { name: 'Change access', exact: true }).click();
  const d = page.getByRole('dialog', { name: /^Change access for / });
  await expect(d).toBeVisible();
  return d;
}

test('TC-259.1: O adds, changes and removes project grants of V in Change access; the list, the assignments and the audit log follow', async () => {
  const { o, v, p1, p2 } = cast;
  const [n1, n2] = [await projectName(o, p1), await projectName(o, p2)];
  const [first, second] = [n1, n2].sort((a, b) => a.localeCompare(b));
  await o.page.goto(membersUrl(cast));
  await expect(chips(o.page, v.handle)).toHaveText(['Organization · Viewer']);

  // 1. Add P1 as Member and P2 as Viewer.
  let d = await openChangeAccess(o.page, v.handle);
  await expect(d.getByText('No project access.')).toBeVisible();
  const save = d.getByRole('button', { name: 'Save access' });
  await expect(save).toBeDisabled();
  for (const [project, role] of [
    [n1, 'Member'],
    [n2, 'Viewer'],
  ] as const) {
    await d.getByRole('combobox', { name: 'Project to add' }).selectOption({ label: project });
    await d.getByRole('combobox', { name: 'Role in the project to add' }).selectOption({ label: role });
    await d.getByRole('button', { name: 'Add project' }).click();
    await expect(projectRow(d, project)).toBeVisible();
  }
  await save.click();
  await expect(o.page.getByRole('status').filter({ hasText: 'Access changed' })).toBeVisible();
  await expect(d).toHaveCount(0);
  const roleOf = (project: string): string => (project === n1 ? 'Member' : 'Viewer');
  await expect(chips(o.page, v.handle)).toHaveText([
    'Organization · Viewer',
    `${first} · ${roleOf(first)}`,
    `${second} · ${roleOf(second)}`,
  ]);
  const after1 = await projectGrantsOf(cast, v.userId);
  expect(after1.map((a) => [a.scope.type === 'project' ? a.scope.projectId : '', a.role.key]).sort()).toEqual(
    [
      [p1, 'member'],
      [p2, 'viewer'],
    ].sort(),
  );

  // 2. Change P1 to Viewer and remove P2.
  d = await openChangeAccess(o.page, v.handle);
  await projectRow(d, n1)
    .getByRole('combobox', { name: `Role in ${n1}` })
    .selectOption({ label: 'Viewer' });
  await projectRow(d, n2)
    .getByRole('button', { name: `Remove access to ${n2}` })
    .click();
  await d.getByRole('button', { name: 'Save access' }).click();
  await expect(o.page.getByRole('status').filter({ hasText: 'Access changed' })).toBeVisible();
  await expect(chips(o.page, v.handle)).toHaveText(['Organization · Viewer', `${n1} · Viewer`]);
  const after2 = await projectGrantsOf(cast, v.userId);
  expect(after2.map((a) => [a.scope.type === 'project' ? a.scope.projectId : '', a.role.key])).toEqual([
    [p1, 'viewer'],
  ]);

  // Every grant and revoke is audited; the org role was never written.
  const actions = await auditActions(cast);
  expect(actions.filter((a) => a === 'assignment.granted').length).toBeGreaterThanOrEqual(3);
  expect(actions.filter((a) => a === 'assignment.revoked').length).toBeGreaterThanOrEqual(2);
  expect(actions).not.toContain('member.role_changed');
});

test('TC-259.2: D (org admin) may change V access too, but the dialog never offers Owner for a project', async () => {
  const { d: admin, v, p1 } = cast;
  const n1 = await projectName(cast.o, p1);
  await admin.page.goto(membersUrl(cast));
  const d = await openChangeAccess(admin.page, v.handle);
  await expect(d.getByRole('radio', { name: /^Owner/ })).toHaveCount(0);
  await expect(d.getByRole('combobox', { name: 'Role in the project to add' }).getByRole('option')).toHaveText([
    'Admin',
    'Member',
    'Viewer',
  ]);
  await d.getByRole('combobox', { name: 'Project to add' }).selectOption({ label: n1 });
  await d.getByRole('button', { name: 'Add project' }).click();
  await d.getByRole('button', { name: 'Save access' }).click();
  await expect(admin.page.getByRole('status').filter({ hasText: 'Access changed' })).toBeVisible();
  await expect(chips(admin.page, v.handle)).toHaveText(['Organization · Viewer', `${n1} · Member`]);
});

test('TC-259.3: lower roles see no Change access (B member, V viewer, A project admin) and the route refuses them', async () => {
  const { a, b, v, c, p2, orgId, roleIds } = cast;
  for (const who of [b, v, a]) {
    await who.page.goto(membersUrl(cast));
    await expect(who.page.getByText("You don't have access")).toBeVisible();
    await expect(who.page.getByRole('button', { name: /^Actions for / })).toHaveCount(0);
    await expect(who.page.getByRole('button', { name: 'Change access', exact: true })).toHaveCount(0);
  }
  // B (member) and A (admin of P1 only: nothing in P2) are refused by the assignments route, whatever the page shows.
  for (const who of [b, v]) {
    const res = await who.api.post(`/api/orgs/${orgId}/assignments`, {
      data: { userId: c.userId, roleId: roleIds.member, scope: { type: 'project', projectId: p2 } },
    });
    expect(res.status(), `${who.handle} grants on P2: ${await res.text()}`).toBe(403);
  }
  const outOfScope = await a.api.post(`/api/orgs/${orgId}/assignments`, {
    data: { userId: v.userId, roleId: roleIds.member, scope: { type: 'project', projectId: p2 } },
  });
  expect([403, 404], `A grants on P2: ${await outOfScope.text()}`).toContain(outOfScope.status());
  expect(await projectGrantsOf(cast, v.userId)).toEqual([]);
});
