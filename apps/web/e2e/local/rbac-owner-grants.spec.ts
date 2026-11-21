import { expect, test, type APIResponse } from '@playwright/test';
import { AccessDto, AssignmentDto, ProjectDto, RunDto, RunListResponse, pageOf } from '@agentdesk/contracts';
import { API, inviteAndSignIn, ok } from './helpers';
import { REPO_NEW, REPO_P1, REPO_P2, buildCast, disposeCast, type Actor, type Cast } from './rbac-cast';

/*
 * Local end-to-end for RBAC foundation, who may grant and revoke and who may list assignments (spec "E2E requirements":
 * BR-45, BR-46, BR-61, BR-64). O is the org owner, D the org admin, A the admin of P1 only, B the member of P1 and P2,
 * C the member of P1, V the org viewer; RB is B's run on P1 and RP2 O's run on P2. Every case runs in a fresh org
 * (`buildCast`), so the assignments it adds or removes live and die with that org; what a case creates outside the
 * assignments (a project made to prove owner access, a second owner's browser context, the owner assignment TC-46.2
 * removes) is undone in a `finally` or the `afterEach`, with cleanup errors swallowed.
 */

test.describe.configure({ timeout: 300_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

let cast: Cast;
/** The cast to dispose: unset until a build succeeded, and again after its disposal, so a failed build never disposes a stale one. */
let built: Cast | undefined;
/** Projects a case made to prove owner access; the afterEach removes them (as O) before the cast is disposed. */
let madeProjects: string[] = [];

test.beforeEach(async ({ browser }) => {
  built = undefined;
  madeProjects = [];
  built = await buildCast(browser);
  cast = built;
});

test.afterEach(async () => {
  const done = built;
  built = undefined;
  if (!done) return;
  for (const id of madeProjects) await done.o.api.delete(`/api/projects/${id}`).catch(() => null);
  madeProjects = [];
  await disposeCast(done);
});

async function expectStatus(res: APIResponse, status: number, what: string): Promise<void> {
  expect(res.status(), `${what}: ${res.status()} ${await res.text()}`).toBe(status);
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

const AssignmentPage = pageOf(AssignmentDto);

async function assignmentsOf(who: Actor, orgId: string, query = ''): Promise<AssignmentDto[]> {
  return AssignmentPage.parse(
    await ok(await who.api.get(`/api/orgs/${orgId}/assignments?pageSize=100${query}`), 200, 'assignment list'),
  ).items;
}

async function accessOf(who: Actor): Promise<AccessDto> {
  return AccessDto.parse(await ok(await who.api.get('/api/me/access'), 200, 'me access'));
}

/** The `role:scope` of each assignment `me/access` lists for `who`, sorted (a project scope reads `project:<id>`). */
async function accessOn(who: Actor): Promise<string[]> {
  return (await accessOf(who)).assignments
    .map((a) => `${a.roleKey}:${a.scope.type === 'org' ? 'org' : `project:${a.scope.projectId}`}`)
    .sort();
}

const orgAssignment = (roleId: string) => ({ roleId, scope: { type: 'org' } }) as const;

/** The tenant route's grant to `userId`, returning the raw answer. */
const postTenantGrant = (
  who: Actor,
  c: Cast,
  userId: string,
  roleId: string,
  scope: { type: 'org' } | { type: 'project'; projectId: string },
): Promise<APIResponse> => who.api.post(`/api/orgs/${c.orgId}/assignments`, { data: { userId, roleId, scope } });

/** A grant that must answer exactly 201 with the assignment it describes. */
async function grantCreated(
  who: Actor,
  c: Cast,
  userId: string,
  roleId: string,
  scope: { type: 'org' } | { type: 'project'; projectId: string },
  what: string,
): Promise<AssignmentDto> {
  const res = await postTenantGrant(who, c, userId, roleId, scope);
  await expectStatus(res, 201, what);
  const created = AssignmentDto.parse(await res.json());
  expect(created.userId, `${what}: the grantee`).toBe(userId);
  expect(created.role.id, `${what}: the role`).toBe(roleId);
  expect(created.scope, `${what}: the scope`).toEqual(scope);
  return created;
}

/** Tries `projects.create` as `who` on a repo no cast project uses; a project it made is removed in the afterEach. */
async function createProject(who: Actor, c: Cast): Promise<{ status: number; text: string }> {
  const res = await who.api.post('/api/projects', {
    data: { connectionId: c.connectionId, repoPath: REPO_NEW, triggerMode: 'webhook' },
  });
  const text = await res.text();
  if (res.status() === 201) madeProjects.push(ProjectDto.parse(JSON.parse(text)).id);
  return { status: res.status(), text };
}

/** `who` has owner access: an owner assignment shows in their access and `projects.create` is accepted (201). */
async function expectOwnerAccess(who: Actor, c: Cast, what: string): Promise<void> {
  expect(
    (await accessOf(who)).assignments.map((a) => a.roleKey),
    `${what}: access lists owner`,
  ).toContain('owner');
  const made = await createProject(who, c);
  expect(made.status, `${what}: projects.create as ${who.handle}: ${made.text}`).toBe(201);
}

/** `who` has no owner access: no owner assignment in their access and `projects.create` is refused (403). */
async function expectNoOwnerAccess(who: Actor, c: Cast, what: string): Promise<void> {
  expect(
    (await accessOf(who)).assignments.map((a) => a.roleKey),
    `${what}: access lists no owner`,
  ).not.toContain('owner');
  const made = await createProject(who, c);
  expect(made.status, `${what}: projects.create as ${who.handle}: ${made.text}`).toBe(403);
}

/** `runs.list` of `projectId` as `who`: the raw answer. */
const listRuns = (who: Actor, projectId: string): Promise<APIResponse> =>
  who.api.get(`/api/projects/${projectId}/runs?filter=all&pageSize=100`);

/** `who` reads P2's data: its runs list shows RP2 and `runs.get` of RP2 answers 200. */
async function expectReadsP2(who: Actor, c: Cast, what: string): Promise<void> {
  const list = RunListResponse.parse(await ok(await listRuns(who, c.p2), 200, `${what}: runs.list P2`));
  expect(
    list.items.map((r) => r.id),
    `${what}: P2's runs`,
  ).toContain(c.rp2);
  expect(RunDto.parse(await ok(await who.api.get(`/api/runs/${c.rp2}`), 200, `${what}: runs.get RP2`)).id).toBe(c.rp2);
}

/** `who` no longer reads P2: its runs list and RP2 answer 404, naming neither the repo nor the run. */
async function expectNoP2(who: Actor, c: Cast, what: string): Promise<void> {
  await expect404Naming(await listRuns(who, c.p2), `${what}: runs.list P2`, [REPO_P2]);
  await expect404Naming(await who.api.get(`/api/runs/${c.rp2}`), `${what}: runs.get RP2`, [REPO_P2]);
}

/** `who`'s assignment of `roleKey` on the org, found through O's list. */
async function ownerAssignmentOf(c: Cast, who: Actor): Promise<AssignmentDto> {
  const found = (await assignmentsOf(c.o, c.orgId)).filter(
    (x) => x.userId === who.userId && x.role.key === 'owner' && x.scope.type === 'org',
  );
  expect(found, `${who.handle} holds exactly one owner assignment on the org`).toHaveLength(1);
  const [assignment] = found;
  if (!assignment) throw new Error('unreachable');
  return assignment;
}

test.describe('BR-45: owner and admin grant and revoke', () => {
  test('TC-45.1: O granting C viewer on the org gets 201 and C reads P2 on the next request', async () => {
    const { o, c, rb, roleIds } = cast;
    await expectNoP2(c, cast, 'before the grant');

    await grantCreated(o, cast, c.userId, roleIds.viewer, { type: 'org' }, 'O grants C viewer on the org');

    // The very next request, with no wait.
    expect(RunDto.parse(await ok(await c.api.get(`/api/runs/${rb}`), 200, 'runs.get RB')).id).toBe(rb);
    await expectReadsP2(c, cast, 'after the grant');
  });

  test("TC-45.2: O revoking C's org viewer assignment gets 204 and C no longer reads P2 (404)", async () => {
    const { o, c, orgId, p1, roleIds } = cast;
    const viewer = await grantCreated(o, cast, c.userId, roleIds.viewer, { type: 'org' }, 'O grants C viewer');
    await expectReadsP2(c, cast, 'with the grant');

    await expectStatus(await o.api.delete(`/api/orgs/${orgId}/assignments/${viewer.id}`), 204, 'O revokes it');

    await expectNoP2(c, cast, 'after the revoke');
    expect(
      (await assignmentsOf(o, orgId)).map((x) => x.id),
      'the assignment is gone',
    ).not.toContain(viewer.id);
    expect(await accessOn(c), 'C is back to member on P1').toEqual([`member:project:${p1}`]);
  });

  test('TC-45.3: O granting A owner on the org through the tenant route gets 201 and A can create a project', async () => {
    const { o, a, roleIds } = cast;
    await expectNoOwnerAccess(a, cast, 'before the grant');

    await grantCreated(o, cast, a.userId, roleIds.owner, { type: 'org' }, 'O grants A owner on the org');

    await expectOwnerAccess(a, cast, 'after the grant');
  });

  test('TC-45.4: D granting C viewer on the org gets 201 and C reads P2', async () => {
    const { d, c, roleIds } = cast;
    await expectNoP2(c, cast, 'before the grant');

    await grantCreated(d, cast, c.userId, roleIds.viewer, { type: 'org' }, 'D grants C viewer on the org');

    await expectReadsP2(c, cast, 'after the grant');
  });

  test('TC-45.5: D granting C owner on the org gets 403 and C has no owner access', async () => {
    const { d, c, o, orgId, p1, p2, roleIds } = cast;
    const before = await assignmentsOf(o, orgId);

    await expect403Naming(
      await postTenantGrant(d, cast, c.userId, roleIds.owner, { type: 'org' }),
      'assignments.create owner as D',
      [REPO_P1, REPO_P2, p2],
    );

    await expectNoOwnerAccess(c, cast, 'after the refused grant');
    expect(await accessOn(c), 'C still holds member on P1 only').toEqual([`member:project:${p1}`]);
    expect(await assignmentsOf(o, orgId), 'nothing changed in the org').toEqual(before);
  });

  test("TC-45.6: D deleting A's owner assignment gets 403 and A still has owner access", async () => {
    const { o, d, a, orgId, roleIds } = cast;
    const owner = await grantCreated(o, cast, a.userId, roleIds.owner, { type: 'org' }, 'O grants A owner');
    const before = await assignmentsOf(o, orgId);

    await expect403Naming(
      await d.api.delete(`/api/orgs/${orgId}/assignments/${owner.id}`),
      "assignments.remove A's owner as D",
      [REPO_P1, REPO_P2],
    );

    expect(await assignmentsOf(o, orgId), "A's owner assignment is still there, nothing else changed").toEqual(before);
    expect(await ownerAssignmentOf(cast, a), 'unchanged').toEqual(owner);
    await expectOwnerAccess(a, cast, 'after the refused revoke');
  });

  test('TC-45.7: the platform admin granting C owner on the org through the platform route gets 201 and C has owner access', async () => {
    const { pa, c, orgId, roleIds } = cast;
    await expectNoOwnerAccess(c, cast, 'before the grant');

    const res = await pa.post(`/api/platform/orgs/${orgId}/assignments`, {
      data: { userId: c.userId, ...orgAssignment(roleIds.owner) },
    });
    await expectStatus(res, 201, 'platform grant owner on the org');
    const created = AssignmentDto.parse(await res.json());
    expect(created.userId).toBe(c.userId);
    expect(created.role.id).toBe(roleIds.owner);
    expect(created.scope).toEqual({ type: 'org' });

    await expectOwnerAccess(c, cast, 'after the platform grant');
  });
});

test.describe('BR-46: the last owner', () => {
  test("TC-46.1: O deleting O's own owner assignment through the tenant route gets 409 and O still has owner access", async () => {
    const { o, orgId } = cast;
    const mine = await ownerAssignmentOf(cast, o);
    const owners = (await assignmentsOf(o, orgId)).filter((x) => x.role.key === 'owner');
    expect(owners, 'O holds the only owner assignment').toEqual([mine]);

    await expectStatus(
      await o.api.delete(`/api/orgs/${orgId}/assignments/${mine.id}`),
      409,
      'O revokes the last owner',
    );

    expect(await ownerAssignmentOf(cast, o), 'the assignment is unchanged').toEqual(mine);
    await expectOwnerAccess(o, cast, 'after the refused revoke');
  });

  test("TC-46.2: the platform admin deleting O's owner assignment gets 204 and the org has no owner assignment", async () => {
    const { pa, o, orgId, roleIds } = cast;
    const mine = await ownerAssignmentOf(cast, o);
    try {
      await expectStatus(
        await pa.delete(`/api/platform/orgs/${orgId}/assignments/${mine.id}`),
        204,
        'platform revokes the last owner',
      );

      const left = AssignmentPage.parse(
        await ok(await pa.get(`/api/platform/orgs/${orgId}/assignments?pageSize=100`), 200, 'platform assignment list'),
      ).items;
      expect(
        left.filter((x) => x.role.key === 'owner'),
        'the org has no owner assignment',
      ).toEqual([]);
      expect(
        left.map((x) => x.id),
        "O's owner assignment is gone",
      ).not.toContain(mine.id);
    } finally {
      // The cast is disposed as O (cancelling the runs): give O the owner role back, whatever the case's result was.
      await pa
        .post(`/api/platform/orgs/${orgId}/assignments`, {
          data: { userId: o.userId, ...orgAssignment(roleIds.owner) },
        })
        .catch(() => null);
    }
  });

  test("TC-46.3: with a second owner O2, O deleting O2's owner assignment through the tenant route gets 204", async ({
    browser,
  }) => {
    const { o, pa, orgId, roleIds } = cast;
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      const handle = `rbac-o2-${orgId.slice(0, 8)}`;
      const { userId } = await inviteAndSignIn(page, pa, orgId, handle, 'viewer', { type: 'org' });
      const second = await grantCreated(o, cast, userId, roleIds.owner, { type: 'org' }, 'O grants O2 owner');
      expect(
        (await assignmentsOf(o, orgId)).filter((x) => x.role.key === 'owner').length,
        'the org has two owner assignments',
      ).toBe(2);

      await expectStatus(
        await o.api.delete(`/api/orgs/${orgId}/assignments/${second.id}`),
        204,
        "O revokes O2's owner assignment",
      );

      const owners = (await assignmentsOf(o, orgId)).filter((x) => x.role.key === 'owner');
      expect(
        owners.map((x) => x.userId),
        'O is the one owner left',
      ).toEqual([o.userId]);
    } finally {
      await ctx.close().catch(() => null);
    }
  });
});

test.describe('BR-61: a project admin grants and revokes on their own project', () => {
  /** Proof of member rights on P1: poll now on a webhook project is 409 for someone allowed to ask and 403 for a viewer. */
  async function pollNowStatus(who: Actor, c: Cast): Promise<number> {
    return (await who.api.post(`/api/projects/${c.p1}/connection/poll`)).status();
  }

  test('TC-61.1: A granting V member on P1 gets 201 and V shows P1 member rights on the next request', async () => {
    const { a, v, p1, roleIds } = cast;
    expect(await pollNowStatus(v, cast), 'V as a viewer may not poll now').toBe(403);

    await grantCreated(
      a,
      cast,
      v.userId,
      roleIds.member,
      { type: 'project', projectId: p1 },
      'A grants V member on P1',
    );

    expect(await accessOn(v), 'V holds the org viewer assignment and member on P1').toEqual(
      ['viewer:org', `member:project:${p1}`].sort(),
    );
    const member = (await accessOf(v)).assignments.find((x) => x.roleKey === 'member');
    expect(
      member?.permissions.map((p) => `${p.permission}:${p.condition}`),
      'the member permissions',
    ).toEqual(expect.arrayContaining(['run:create:any', 'run:update:own', 'run:cancel:own', 'terminal:attach:own']));
    // Projects are not polling here, so a caller allowed to ask gets the state conflict, not the permission refusal.
    expect(await pollNowStatus(v, cast), 'V may now poll now on P1 (the project is not polling: 409)').toBe(409);
  });

  test('TC-61.2: A granting V admin on P1 gets 201', async () => {
    const { a, v, p1, roleIds } = cast;
    const created = await grantCreated(
      a,
      cast,
      v.userId,
      roleIds.admin,
      { type: 'project', projectId: p1 },
      'A grants V admin on P1',
    );
    expect(created.role.key).toBe('admin');
    expect(await accessOn(v), 'V holds viewer on the org and admin on P1').toEqual(
      ['viewer:org', `admin:project:${p1}`].sort(),
    );
  });

  test('TC-61.3: A granting V viewer on P1 gets 201', async () => {
    const { a, v, p1, roleIds } = cast;
    const created = await grantCreated(
      a,
      cast,
      v.userId,
      roleIds.viewer,
      { type: 'project', projectId: p1 },
      'A grants V viewer on P1',
    );
    expect(created.role.key).toBe('viewer');
    expect(await accessOn(v), 'V holds viewer on the org and viewer on P1').toEqual(
      ['viewer:org', `viewer:project:${p1}`].sort(),
    );
  });

  test('TC-61.4: A granting V member on P2 gets 403 and nothing changes', async () => {
    const { a, v, o, orgId, p2, roleIds } = cast;
    const before = await assignmentsOf(o, orgId);

    await expect403Naming(
      await postTenantGrant(a, cast, v.userId, roleIds.member, { type: 'project', projectId: p2 }),
      'assignments.create member on P2 as A',
      [REPO_P2, p2],
    );

    expect(await accessOn(v), 'V still holds only the org viewer assignment').toEqual(['viewer:org']);
    expect(await assignmentsOf(o, orgId), 'no assignment was added').toEqual(before);
  });

  test('TC-61.5: A granting V member on the org scope gets 403 and nothing changes', async () => {
    const { a, v, o, orgId, roleIds } = cast;
    const before = await assignmentsOf(o, orgId);

    await expect403Naming(
      await postTenantGrant(a, cast, v.userId, roleIds.member, { type: 'org' }),
      'assignments.create member on the org as A',
      [REPO_P1, REPO_P2],
    );

    expect(await accessOn(v), 'V still holds only the org viewer assignment').toEqual(['viewer:org']);
    expect(await assignmentsOf(o, orgId), 'no assignment was added').toEqual(before);
  });

  test("TC-61.6: A deleting V's P1 member assignment gets 204 and it applies on V's next request", async () => {
    const { a, v, o, orgId, p1, roleIds } = cast;
    const member = await grantCreated(
      a,
      cast,
      v.userId,
      roleIds.member,
      { type: 'project', projectId: p1 },
      'A grants V member on P1',
    );
    expect(await pollNowStatus(v, cast), 'with the grant V may ask for a poll (409)').toBe(409);

    await expectStatus(await a.api.delete(`/api/orgs/${orgId}/assignments/${member.id}`), 204, 'A revokes it');

    expect(await accessOn(v), 'V is back to the org viewer assignment').toEqual(['viewer:org']);
    expect(await pollNowStatus(v, cast), 'V may no longer ask for a poll').toBe(403);
    expect(
      (await assignmentsOf(o, orgId)).map((x) => x.id),
      'the assignment is gone',
    ).not.toContain(member.id);
  });
});

test.describe('BR-64: listing assignments', () => {
  /** What an assignment is for these cases: who, which role and where. */
  const label = (x: AssignmentDto): string =>
    `${x.userId}|${x.role.key}|${x.scope.type === 'org' ? 'org' : x.scope.projectId}`;

  test('TC-64.1: O lists every assignment in the org (200)', async () => {
    const { o, d, a, b, c, v, p1, p2, orgId } = cast;
    const res = await o.api.get(`/api/orgs/${orgId}/assignments?pageSize=100`);
    await expectStatus(res, 200, 'assignments.list as O');
    const list = AssignmentPage.parse(await res.json());
    expect(list.items.map(label).sort(), 'O, D, A, B on P1 and P2, C and V').toEqual(
      [
        `${o.userId}|owner|org`,
        `${d.userId}|admin|org`,
        `${a.userId}|admin|${p1}`,
        `${b.userId}|member|${p1}`,
        `${b.userId}|member|${p2}`,
        `${c.userId}|member|${p1}`,
        `${v.userId}|viewer|org`,
      ].sort(),
    );
    expect(list.total).toBe(7);
  });

  test('TC-64.2: D lists every assignment in the org (200)', async () => {
    const { o, d, a, b, c, v, p1, p2, orgId } = cast;
    const res = await d.api.get(`/api/orgs/${orgId}/assignments?pageSize=100`);
    await expectStatus(res, 200, 'assignments.list as D');
    const list = AssignmentPage.parse(await res.json());
    expect(list.items.map(label).sort(), 'O, D, A, B on P1 and P2, C and V').toEqual(
      [
        `${o.userId}|owner|org`,
        `${d.userId}|admin|org`,
        `${a.userId}|admin|${p1}`,
        `${b.userId}|member|${p1}`,
        `${b.userId}|member|${p2}`,
        `${c.userId}|member|${p1}`,
        `${v.userId}|viewer|org`,
      ].sort(),
    );
    expect(list.total).toBe(7);
  });

  test('TC-64.3: A listing with projectId=P1 gets 200 with the P1 assignments only (A, B, C)', async () => {
    const { a, b, c, p1, orgId } = cast;
    const res = await a.api.get(`/api/orgs/${orgId}/assignments?pageSize=100&projectId=${p1}`);
    await expectStatus(res, 200, 'assignments.list?projectId=P1 as A');
    const list = AssignmentPage.parse(await res.json());
    expect(list.items.map(label).sort()).toEqual(
      [`${a.userId}|admin|${p1}`, `${b.userId}|member|${p1}`, `${c.userId}|member|${p1}`].sort(),
    );
    expect(list.total).toBe(3);
  });

  test("TC-64.4: A listing with no projectId gets 200 with P1's assignments only, none of B's P2, V's or D's", async () => {
    const { o, d, a, b, c, v, p1, p2, orgId } = cast;
    const bOnP2 = (await assignmentsOf(o, orgId)).find(
      (x) => x.userId === b.userId && x.scope.type === 'project' && x.scope.projectId === p2,
    );
    expect(bOnP2, "B's P2 assignment exists").toBeTruthy();

    const res = await a.api.get(`/api/orgs/${orgId}/assignments?pageSize=100`);
    const text = await res.text();
    expect(res.status(), `assignments.list as A: ${res.status()} ${text}`).toBe(200);
    const list = AssignmentPage.parse(JSON.parse(text));
    expect(list.items.map(label).sort()).toEqual(
      [`${a.userId}|admin|${p1}`, `${b.userId}|member|${p1}`, `${c.userId}|member|${p1}`].sort(),
    );
    expect(list.total).toBe(3);
    // Ids and names: nothing of B's P2 assignment, V's or D's (nor O's) org-scope ones anywhere in the body.
    for (const leak of [bOnP2?.id ?? '', p2, v.userId, d.userId, o.userId]) {
      expect(leak).not.toBe('');
      expect(text, `the list names ${leak}`).not.toContain(leak);
    }
  });

  test('TC-64.5: B listing assignments gets 403', async () => {
    const { b, o, d, a, c, v, p1, p2, slug, orgId } = cast;
    await expect403Naming(await b.api.get(`/api/orgs/${orgId}/assignments?pageSize=100`), 'assignments.list as B', [
      o.userId,
      d.userId,
      a.userId,
      c.userId,
      v.userId,
      p1,
      p2,
      slug,
      REPO_P1,
      REPO_P2,
    ]);
  });

  test('TC-64.6: V listing assignments gets 403', async () => {
    const { v, o, d, a, b, c, p1, p2, slug, orgId } = cast;
    await expect403Naming(await v.api.get(`/api/orgs/${orgId}/assignments?pageSize=100`), 'assignments.list as V', [
      o.userId,
      d.userId,
      a.userId,
      b.userId,
      c.userId,
      p1,
      p2,
      slug,
      REPO_P1,
      REPO_P2,
    ]);
  });
});
