import { expect, test, type APIResponse } from '@playwright/test';
import { AccessDto, AssignmentDto, ProjectDto, pageOf, type PermissionLineDto } from '@agentdesk/contracts';
import { API, grant, ok } from './helpers';
import { REPO_P1, REPO_P2, buildCast, disposeCast, watchTerminal, type Actor, type Cast } from './rbac-cast';

/*
 * Local end-to-end for RBAC foundation, grants and revokes taking effect and a user's own access (spec "E2E requirements":
 * BR-34, BR-35, BR-36, BR-41, BR-63). A is the admin of P1 only, B the member of P1 and P2, C the member of P1, V the org
 * viewer, O the owner; RC is C's run. Every case runs in a fresh org (`buildCast`), so the assignments a case adds or
 * removes live and die with that org; the only thing a case leaves open (a terminal socket) is closed in a `finally`.
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

const body = async (res: APIResponse): Promise<string> => `${res.status()} ${await res.text()}`;

async function expectStatus(res: APIResponse, status: number, what: string): Promise<void> {
  expect(res.status(), `${what}: ${await body(res)}`).toBe(status);
}

/** A 403 whose body names none of `leaks`. */
async function expect403Naming(res: APIResponse, what: string, leaks: string[]): Promise<void> {
  const text = await res.text();
  expect(res.status(), `${what}: ${res.status()} ${text}`).toBe(403);
  for (const leak of leaks) expect(text, `${what}: the body names ${leak}`).not.toContain(leak);
}

/** A 404 whose body names none of `leaks` (a value the request URL carries is not an echo). */
async function expect404Naming(res: APIResponse, what: string, leaks: string[]): Promise<void> {
  const text = await res.text();
  expect(res.status(), `${what}: ${res.status()} ${text}`).toBe(404);
  for (const leak of leaks) {
    if (res.url().includes(leak)) continue;
    expect(text, `${what}: the body names ${leak}`).not.toContain(leak);
  }
}

const ProjectPage = pageOf(ProjectDto);

/** `projects.list` as `who`: the project ids it shows, and its total. */
async function visibleProjects(who: Actor): Promise<{ ids: string[]; total: number }> {
  const page = ProjectPage.parse(await ok(await who.api.get('/api/projects?pageSize=100'), 200, 'project list'));
  return { ids: page.items.map((p) => p.id).sort(), total: page.total };
}

async function assignmentsOf(who: Actor, orgId: string, query = ''): Promise<AssignmentDto[]> {
  return pageOf(AssignmentDto).parse(
    await ok(await who.api.get(`/api/orgs/${orgId}/assignments?pageSize=100${query}`), 200, 'assignment list'),
  ).items;
}

async function accessOf(who: Actor): Promise<AccessDto> {
  return AccessDto.parse(await ok(await who.api.get('/api/me/access'), 200, 'me access'));
}

/** `who`'s assignment on `projectId`, looked up by O (the Given "A's P1 assignment"). */
async function assignmentOn(c: Cast, who: Actor, projectId: string): Promise<AssignmentDto> {
  const found = (await assignmentsOf(c.o, c.orgId)).filter(
    (x) => x.userId === who.userId && x.scope.type === 'project' && x.scope.projectId === projectId,
  );
  expect(found, `${who.handle} holds exactly one assignment on project ${projectId}`).toHaveLength(1);
  const [assignment] = found;
  if (!assignment) throw new Error('unreachable');
  return assignment;
}

/** The Given "O revoked C's assignment": C, a member of the org, holds nothing (only `me/access` still answers). */
async function revokeCOnP1(c: Cast): Promise<void> {
  const mine = (await assignmentsOf(c.o, c.orgId)).filter((x) => x.userId === c.c.userId);
  expect(
    mine.map((x) => x.scope),
    'C holds one assignment, on P1',
  ).toEqual([{ type: 'project', projectId: c.p1 }]);
  await expectStatus(await c.o.api.delete(`/api/orgs/${c.orgId}/assignments/${mine[0]?.id}`), 204, 'revoke C on P1');
  expect((await accessOf(c.c)).assignments, 'C now holds nothing in the org').toEqual([]);
}

/** The scopes of the assignments `me/access` lists for `who`. */
async function accessScopes(who: Actor): Promise<AccessDto['assignments'][number]['scope'][]> {
  return (await accessOf(who)).assignments.map((a) => a.scope);
}

const byPermission = (a: PermissionLineDto, b: PermissionLineDto): number =>
  a.permission === b.permission ? a.condition.localeCompare(b.condition) : a.permission.localeCompare(b.permission);

const anyOf = (permissions: PermissionLineDto['permission'][]): PermissionLineDto[] =>
  permissions.map((permission) => ({ permission, condition: 'any' }));

const ownOf = (permissions: PermissionLineDto['permission'][]): PermissionLineDto[] =>
  permissions.map((permission) => ({ permission, condition: 'own' }));

/** The built-in `member` role's permissions (spec role matrix): reads and `run:create` with any, run controls and the terminal with own. */
const MEMBER_PERMISSIONS: PermissionLineDto[] = [
  ...anyOf(['project:read', 'agent:read', 'skill:read', 'rule:read', 'setup:read', 'run:read', 'run:create']),
  ...ownOf(['run:update', 'run:cancel', 'terminal:attach']),
].sort(byPermission);

/** The built-in `owner` role's permissions: all 33 tenant permissions with any, no platform one. */
const OWNER_PERMISSIONS: PermissionLineDto[] = anyOf([
  'project:create',
  'project:read',
  'project:update',
  'project:delete',
  'connection:create',
  'connection:read',
  'agent:read',
  'agent:update',
  'secret:update',
  'skill:read',
  'skill:update',
  'skill:delete',
  'rule:create',
  'rule:read',
  'rule:update',
  'rule:delete',
  'setup:read',
  'setup:update',
  'setup:test',
  'run:read',
  'run:create',
  'run:update',
  'run:cancel',
  'terminal:attach',
  'member:read',
  'member:create',
  'member:update',
  'member:delete',
  'assignment:read',
  'assignment:create',
  'assignment:delete',
  'org:update',
  'org:delete',
]).sort(byPermission);

/** The platform route's grant of `member` on P2 to `userId`, returning the raw answer. */
const postPlatformGrant = (c: Cast, userId: string, roleId: string, projectId: string): Promise<APIResponse> =>
  c.pa.post(`/api/platform/orgs/${c.orgId}/assignments`, {
    data: { userId, roleId, scope: { type: 'project', projectId } },
  });

/** The tenant route's grant to `userId` of `roleId` on `projectId`, returning the raw answer. */
const postTenantGrant = (
  who: Actor,
  c: Cast,
  userId: string,
  roleId: string,
  projectId: string,
): Promise<APIResponse> =>
  who.api.post(`/api/orgs/${c.orgId}/assignments`, {
    data: { userId, roleId, scope: { type: 'project', projectId } },
  });

test.describe('BR-34: a platform admin grant applies on the next request', () => {
  test('TC-34.1: after the platform admin grants C member on P2, C lists P2 at once', async () => {
    const { c, pa, p1, p2, orgId, roleIds } = cast;
    await revokeCOnP1(cast);
    await expectStatus(await c.api.get('/api/projects?pageSize=100'), 403, 'projects.list before the grant');

    const res = await postPlatformGrant(cast, c.userId, roleIds.member, p2);
    await expectStatus(res, 201, 'platform grant member on P2');
    const granted = AssignmentDto.parse(await res.json());
    expect(granted.userId).toBe(c.userId);
    expect(granted.role.id).toBe(roleIds.member);
    expect(granted.scope).toEqual({ type: 'project', projectId: p2 });

    // The very next request, with no wait: P2 is there and only P2.
    const list = await visibleProjects(c);
    expect(list.ids, 'C lists P2 and not P1').toEqual([p2]);
    expect(list.total).toBe(1);
    expect(list.ids).not.toContain(p1);
    expect(
      (
        await pageOf(AssignmentDto).parse(
          await ok(await pa.get(`/api/platform/orgs/${orgId}/assignments?pageSize=100`), 200, 'platform list'),
        ).items
      ).filter((x) => x.userId === c.userId),
      'C holds exactly the granted assignment',
    ).toEqual([granted]);
  });

  test('TC-34.2: after the platform admin grants C viewer on the org, C lists P1 and P2', async () => {
    const { c, pa, p1, p2, orgId, roleIds } = cast;
    await revokeCOnP1(cast);

    const res = await pa.post(`/api/platform/orgs/${orgId}/assignments`, {
      data: { userId: c.userId, roleId: roleIds.viewer, scope: { type: 'org' } },
    });
    await expectStatus(res, 201, 'platform grant viewer on the org');
    const granted = AssignmentDto.parse(await res.json());
    expect(granted.userId).toBe(c.userId);
    expect(granted.role.key).toBe('viewer');
    expect(granted.scope).toEqual({ type: 'org' });

    const list = await visibleProjects(c);
    expect(list.ids, 'C lists both projects').toEqual([p1, p2].sort());
    expect(list.total).toBe(2);
  });
});

test.describe('BR-35: a revoke applies on the next request and closes the open terminal', () => {
  /** The Given: A, the admin of P1, also holds `member` on P2, so A still holds permissions in the org after the revoke. */
  async function givenAAlsoOnP2(c: Cast): Promise<AssignmentDto> {
    await grant(c.pa, c.orgId, c.a.userId, 'member', { type: 'project', projectId: c.p2 });
    expect(await accessScopes(c.a), 'A holds P1 and P2').toHaveLength(2);
    return assignmentOn(c, c.a, c.p1);
  }

  test('TC-35.1: with a terminal of RC open, revoking A on P1 closes the socket 4403 on the re-check', async () => {
    const { a, o, orgId, rc } = cast;
    const onP1 = await givenAAlsoOnP2(cast);
    // The server re-checks every TERMINAL_REAUTH_MS (60 s unless the stack was started smaller: E2E_TERMINAL_REAUTH_MS
    // says so), so the close is awaited for one interval plus a margin.
    const configured = Number(process.env['E2E_TERMINAL_REAUTH_MS']);
    const reauthMs = Number.isInteger(configured) && configured > 0 ? configured : 60_000;
    const watch = await watchTerminal(a, `/api/runs/${rc}/terminal`);
    try {
      await watch.attached(30_000);
      await expectStatus(await o.api.delete(`/api/orgs/${orgId}/assignments/${onP1.id}`), 204, 'revoke A on P1');
      expect(await watch.closeCode(reauthMs + 30_000), 'the socket closes 4403').toBe(4403);
    } finally {
      await watch.close().catch(() => null);
    }
  });

  test('TC-35.2: after revoking A on P1, A gets 404 for P1 and the list shows P2 only', async () => {
    const { a, o, orgId, p1, p2 } = cast;
    const onP1 = await givenAAlsoOnP2(cast);
    await expectStatus(await o.api.delete(`/api/orgs/${orgId}/assignments/${onP1.id}`), 204, 'revoke A on P1');

    await expect404Naming(await a.api.get(`/api/projects/${p1}`), 'projects.get P1', [REPO_P1, 'rbac-run']);
    const list = await visibleProjects(a);
    expect(list.ids, 'P1 is gone, P2 still shows').toEqual([p2]);
    expect(list.total).toBe(1);
  });
});

test.describe('BR-36: grant and revoke are refused for members, viewers and out-of-scope project admins', () => {
  test('TC-36.1: B granting C member on P2 gets 403 and C does not list P2', async () => {
    const { b, c, p1, p2, roleIds } = cast;
    await expect403Naming(await postTenantGrant(b, cast, c.userId, roleIds.member, p2), 'assignments.create as B', [
      REPO_P2,
    ]);
    expect(await accessScopes(c), 'C still holds P1 only').toEqual([{ type: 'project', projectId: p1 }]);
    expect((await visibleProjects(c)).ids, 'C does not list P2').toEqual([p1]);
  });

  test('TC-36.2: V granting C member on P2 gets 403', async () => {
    const { v, c, p1, p2, roleIds } = cast;
    await expect403Naming(await postTenantGrant(v, cast, c.userId, roleIds.member, p2), 'assignments.create as V', [
      REPO_P2,
    ]);
    expect(await accessScopes(c), 'nothing changed: C still holds P1 only').toEqual([
      { type: 'project', projectId: p1 },
    ]);
  });

  test('TC-36.3: A granting C member on P2 gets 403 and C does not list P2', async () => {
    const { a, c, p1, p2, roleIds } = cast;
    await expect403Naming(await postTenantGrant(a, cast, c.userId, roleIds.member, p2), 'assignments.create as A', [
      REPO_P2,
    ]);
    expect(await accessScopes(c), 'C still holds P1 only').toEqual([{ type: 'project', projectId: p1 }]);
    expect((await visibleProjects(c)).ids, 'C does not list P2').toEqual([p1]);
  });

  test("TC-36.4: B deleting C's P1 assignment gets 403 and the assignment still exists", async () => {
    const { b, c, o, orgId, p1 } = cast;
    const onP1 = await assignmentOn(cast, c, p1);
    await expect403Naming(
      await b.api.delete(`/api/orgs/${orgId}/assignments/${onP1.id}`),
      'assignments.remove as B',
      [],
    );
    expect(await assignmentOn(cast, c, p1), "C's assignment is unchanged").toEqual(onP1);
    expect((await assignmentsOf(o, orgId)).map((x) => x.id)).toContain(onP1.id);
    expect((await visibleProjects(c)).ids, 'C still lists P1').toEqual([p1]);
  });

  test("TC-36.5: A deleting B's P2 assignment gets 403 and B still sees P2", async () => {
    const { a, b, o, orgId, p1, p2 } = cast;
    const onP2 = await assignmentOn(cast, b, p2);
    await expect403Naming(await a.api.delete(`/api/orgs/${orgId}/assignments/${onP2.id}`), 'assignments.remove as A', [
      REPO_P2,
    ]);
    expect(await assignmentOn(cast, b, p2), "B's assignment is unchanged").toEqual(onP2);
    expect((await assignmentsOf(o, orgId)).map((x) => x.id)).toContain(onP2.id);
    expect((await visibleProjects(b)).ids, 'B still sees P2').toEqual([p1, p2].sort());
    await expectStatus(await b.api.get(`/api/projects/${p2}`), 200, 'projects.get P2 as B');
  });
});

test.describe('BR-41: the same grant twice leaves one assignment', () => {
  test('TC-41.1: O granting V member on P2 twice gets 201 then 200 with the same assignment, and V holds one', async () => {
    const { o, v, orgId, p2, roleIds } = cast;
    const first = await postTenantGrant(o, cast, v.userId, roleIds.member, p2);
    await expectStatus(first, 201, 'first grant');
    const firstBody: unknown = await first.json();
    const created = AssignmentDto.parse(firstBody);
    expect(created.userId).toBe(v.userId);
    expect(created.role.id).toBe(roleIds.member);
    expect(created.scope).toEqual({ type: 'project', projectId: p2 });

    const second = await postTenantGrant(o, cast, v.userId, roleIds.member, p2);
    await expectStatus(second, 200, 'identical grant');
    expect(await second.json(), 'the second call returns the same assignment').toEqual(firstBody);

    const onP2 = (await assignmentsOf(o, orgId, `&projectId=${p2}`)).filter((x) => x.userId === v.userId);
    expect(
      onP2.filter((x) => x.scope.type === 'project'),
      'exactly one assignment for V on P2',
    ).toEqual([created]);
    // Beyond the list filter: V holds the org viewer assignment and the one grant, nothing else.
    expect(
      (await assignmentsOf(o, orgId))
        .filter((x) => x.userId === v.userId)
        .map((x) => `${x.role.key}:${x.scope.type}`)
        .sort(),
      'V holds exactly the org viewer assignment and the one project member grant',
    ).toEqual(['member:project', 'viewer:org']);
    expect((await accessOf(v)).assignments, 'V holds two assignments in all').toHaveLength(2);
  });

  test('TC-41.2: the platform admin granting V member on P2 twice gets 201 then 200, and V holds one', async () => {
    const { pa, v, orgId, p2, roleIds } = cast;
    const first = await postPlatformGrant(cast, v.userId, roleIds.member, p2);
    await expectStatus(first, 201, 'first platform grant');
    const firstBody: unknown = await first.json();
    const created = AssignmentDto.parse(firstBody);

    const second = await postPlatformGrant(cast, v.userId, roleIds.member, p2);
    await expectStatus(second, 200, 'identical platform grant');
    expect(await second.json(), 'the second call returns the same assignment').toEqual(firstBody);

    const list = pageOf(AssignmentDto).parse(
      await ok(
        await pa.get(`/api/platform/orgs/${orgId}/assignments?pageSize=100&projectId=${p2}`),
        200,
        'platform assignment list',
      ),
    ).items;
    expect(
      list.filter((x) => x.userId === v.userId && x.scope.type === 'project'),
      'exactly one assignment for V on P2',
    ).toEqual([created]);
    expect((await accessOf(v)).assignments, 'V holds the org viewer assignment and the one grant').toHaveLength(2);
  });
});

test.describe('BR-63: own access', () => {
  test('TC-63.1: C with no assignment gets 200 with an empty access, and the project list is still 403', async () => {
    const { c } = cast;
    await revokeCOnP1(cast);
    const res = await c.api.get('/api/me/access');
    await expectStatus(res, 200, 'me.access');
    expect(await res.json(), 'C, not a platform admin, no assignments').toEqual({
      userId: c.userId,
      platformAdmin: false,
      assignments: [],
    });
    await expectStatus(await c.api.get('/api/projects?pageSize=100'), 403, 'projects.list');
  });

  test('TC-63.2: after the platform admin grants C member on P2, the access lists that one assignment', async () => {
    const { c, pa, p2, orgId } = cast;
    await revokeCOnP1(cast);
    await grant(pa, orgId, c.userId, 'member', { type: 'project', projectId: p2 });

    const res = await c.api.get('/api/me/access');
    await expectStatus(res, 200, 'me.access');
    const access = AccessDto.parse(await res.json());
    expect(access.userId).toBe(c.userId);
    expect(access.platformAdmin).toBe(false);
    expect(access.assignments, 'one assignment').toHaveLength(1);
    const [only] = access.assignments;
    expect(only?.roleKey).toBe('member');
    expect(only?.scope).toEqual({ type: 'project', projectId: p2 });
    expect([...(only?.permissions ?? [])].sort(byPermission), "the member role's permissions").toEqual(
      MEMBER_PERMISSIONS,
    );
  });

  test('TC-63.3: O gets 200 with an owner assignment on the org scope and its permissions', async () => {
    const { o } = cast;
    const res = await o.api.get('/api/me/access');
    await expectStatus(res, 200, 'me.access');
    const access = AccessDto.parse(await res.json());
    expect(access.userId).toBe(o.userId);
    expect(access.platformAdmin).toBe(false);
    expect(access.assignments, 'one assignment').toHaveLength(1);
    const [only] = access.assignments;
    expect(only?.roleKey).toBe('owner');
    expect(only?.scope).toEqual({ type: 'org' });
    expect([...(only?.permissions ?? [])].sort(byPermission), "the owner role's permissions").toEqual(
      OWNER_PERMISSIONS,
    );
  });
});
