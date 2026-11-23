// The contracts package's own client is what these tests drive; the restriction is for app code.
import { ApiError, createApi } from '@agentdesk/contracts/client';
import { describe, expect, it } from 'vitest';
import { MAX_RETRIES } from '../../app/queryClient';
import { roleFixtures } from '../dto/access';
import { ids } from '../dto/ids';
import { mockDb } from './db';
import {
  PROJECT_SPACE_KEY,
  PROJECT_SPACE_ROLES,
  PROJECT_SPACE_SCENARIOS,
  applyProjectSpace,
  parseProjectSpace,
  type ProjectSpaceRole,
  type ProjectSpaceScenario,
} from './projectSpaceScenarios';

const api = createApi({ baseUrl: 'http://localhost:3000', parse: true });
const P = ids.project.invoicerApi;
const OTHER = ids.project.invoicerWeb;
const orgId = ids.org.alice;
const ALICE = ids.user.alice;
const CLEO = 'user-tenant-4';
const RAE = 'user-candidate-1';
const MIRA = 'user-candidate-2';

const roleId = (key: string): string => {
  const role = roleFixtures.find((r) => r.key === key);
  if (!role) throw new Error(`role ${key} missing`);
  return role.id;
};

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (e) {
    if (e instanceof ApiError) return e.status;
    throw e;
  }
}

async function rejection(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error('expected the call to fail');
}

const apply = (role: ProjectSpaceRole, scenario?: ProjectSpaceScenario) =>
  applyProjectSpace(mockDb, { role, ...(scenario && { scenario }) });
const list = (projectId = P, query: { page?: number; pageSize?: number } = {}) =>
  api.projectMembers.list({ params: { projectId }, query });
const add = (userId: string, key = 'member', projectId = P) =>
  api.projectMembers.add({ params: { projectId }, body: { userId, roleId: roleId(key) } });
const setRole = (userId: string, key: string, projectId = P) =>
  api.projectMembers.setRole({ params: { projectId, userId }, body: { roleId: roleId(key) } });
const remove = (userId: string, projectId = P) => api.projectMembers.remove({ params: { projectId, userId } });
const audit = (projectId = P, query: { page?: number; pageSize?: number } = {}) =>
  api.projects.audit({ params: { projectId }, query });
const picker = (query: Record<string, unknown>) =>
  api.members.list({ params: { orgId }, query: { page: 1, pageSize: 20, ...query } });

it('the key, the roles and every scenario name', () => {
  expect(PROJECT_SPACE_KEY).toBe('agentdesk.mock.projectSpace');
  expect(PROJECT_SPACE_ROLES).toEqual(['owner', 'admin', 'projectAdmin', 'member', 'viewer']);
  expect(PROJECT_SPACE_SCENARIOS).toHaveLength(14);
});

describe('parseProjectSpace', () => {
  it('reads a role and an optional scenario', () => {
    expect(parseProjectSpace(JSON.stringify({ role: 'admin' }))).toEqual({ role: 'admin' });
    expect(parseProjectSpace(JSON.stringify({ role: 'owner', scenario: 'auditPaged' }))).toEqual({
      role: 'owner',
      scenario: 'auditPaged',
    });
  });

  it.each([null, '', 'nope', '{}', JSON.stringify({ role: 'root' }), JSON.stringify({ role: 'owner', scenario: 'x' })])(
    'ignores %j',
    (raw) => {
      expect(parseProjectSpace(raw)).toBeUndefined();
    },
  );
});

describe.each(PROJECT_SPACE_SCENARIOS)('%s', (scenario) => {
  it('applies for an owner and a second apply starts from a clean seed', () => {
    apply('owner', scenario);
    const first = JSON.stringify(mockDb.state.projectSpace);
    apply('owner', scenario);
    expect(JSON.stringify(mockDb.state.projectSpace)).toBe(first);
    expect(mockDb.currentUser()).not.toBeNull();
  });
});

describe('who may call', () => {
  it.each(['member', 'viewer'] as const)('%s gets 403 on all five routes, before any lookup', async (role) => {
    apply(role);
    const calls = [
      list(),
      add(MIRA),
      setRole(CLEO, 'viewer'),
      remove(CLEO),
      audit(),
      // an id that does not exist is still 403, never 404
      list(ids.created(999)),
    ];
    for (const call of calls) expect(await status(call)).toBe(403);
  });

  it.each(['owner', 'admin', 'projectAdmin'] as const)('%s reads the members and the audit of P', async (role) => {
    apply(role);
    expect((await list()).items.length).toBeGreaterThan(0);
    expect((await audit()).items.length).toBeGreaterThan(0);
  });

  it('a project admin on another project gets 404 on all five routes', async () => {
    apply('projectAdmin');
    for (const call of [
      list(OTHER),
      add(MIRA, 'member', OTHER),
      setRole(CLEO, 'viewer', OTHER),
      remove(CLEO, OTHER),
      audit(OTHER),
    ]) {
      expect(await status(call)).toBe(404);
    }
  });

  it('a project that does not exist is 404, and an org admin reads another project', async () => {
    apply('admin');
    expect(await status(list(ids.created(999)))).toBe(404);
    expect((await list(OTHER)).items.length).toBeGreaterThan(0);
  });

  it('nobody removes themselves: 403 before any lookup', async () => {
    apply('owner');
    expect(await status(remove(ALICE))).toBe(403);
    expect((await list()).items.some((m) => m.userId === ALICE)).toBe(true);
  });
});

describe('members.list for the picker', () => {
  it('excludeProject leaves out the people who hold a role on P', async () => {
    apply('owner');
    const all = await picker({ pageSize: 100 });
    const without = await picker({ pageSize: 100, excludeProject: P });
    const onP = (await list()).items.map((m) => m.userId);
    expect(onP).toContain(CLEO);
    expect(all.items.map((m) => m.userId)).toContain(CLEO);
    expect(without.items.map((m) => m.userId).filter((u) => onP.includes(u))).toEqual([]);
    expect(without.total).toBe(all.total - onP.length);
  });

  it('excludeProject of a project out of scope is 404, of a missing one 404', async () => {
    apply('projectAdmin');
    expect(await status(picker({ excludeProject: OTHER }))).toBe(404);
    expect(await status(picker({ excludeProject: ids.created(999) }))).toBe(404);
    expect(await status(picker({ excludeProject: P }))).toBe(200);
  });

  it('q matches the literal name case-insensitively: % is not a wildcard', async () => {
    apply('owner');
    expect((await picker({ q: '%' })).items.map((m) => m.userId)).toEqual([RAE]);
    expect((await picker({ q: '_' })).items.map((m) => m.name)).toEqual(['Under_score Uma']);
    expect((await picker({ q: 'RELIABLE' })).items.map((m) => m.userId)).toEqual([RAE]);
    expect((await picker({ q: 'person4' })).items.length).toBeGreaterThan(0);
  });

  it('an empty q is 400, and so is one over 100 characters', async () => {
    apply('owner');
    expect(await status(picker({ q: '' }))).toBe(400);
    expect(await status(picker({ q: 'a'.repeat(101) }))).toBe(400);
  });

  it('pickerMany pages 20, 20, 5 with a total of 45', async () => {
    apply('owner', 'pickerMany');
    const pages = [1, 2, 3].map((page) => picker({ page, excludeProject: P }));
    const [one, two, three] = await Promise.all(pages);
    expect([one?.items.length, two?.items.length, three?.items.length]).toEqual([20, 20, 5]);
    expect(one?.total).toBe(45);
  });

  it('pickerError fails the first loads, then answers', async () => {
    apply('owner', 'pickerError');
    for (let i = 0; i <= MAX_RETRIES; i += 1) expect(await status(picker({ excludeProject: P }))).toBe(500);
    expect(await status(picker({ excludeProject: P }))).toBe(200);
  });
});

describe('the store', () => {
  it('adds a person, and the list, the picker and the audit follow', async () => {
    apply('owner');
    const added = await add(MIRA, 'viewer');
    expect(added).toMatchObject({ userId: MIRA, projectRoles: [{ role: { key: 'viewer' } }] });
    expect((await list(P, { pageSize: 100 })).items.map((m) => m.userId)).toContain(MIRA);
    expect((await picker({ pageSize: 100, excludeProject: P })).items.map((m) => m.userId)).not.toContain(MIRA);
    expect((await audit()).items[0]).toMatchObject({ action: 'assignment.granted', target: { id: MIRA } });
  });

  it('refuses a second role for a person who already has one (409), an unknown person (422) and a bad role (422)', async () => {
    apply('owner');
    expect((await rejection(add(CLEO, 'viewer'))).status).toBe(409);
    const gone = await rejection(add('user-nobody'));
    expect(gone.status).toBe(422);
    expect(gone.errors?.[0]?.pointer).toBe('/userId');
    const bad = await rejection(add(MIRA, 'owner'));
    expect(bad.status).toBe(422);
    expect(bad.errors?.[0]?.pointer).toBe('/roleId');
  });

  it('the audit "from" of a person with the same role twice names it once', async () => {
    apply('owner');
    const dup = mockDb.state.projectSpace.members[P]?.find((m) => m.userId === CLEO);
    const first = dup?.projectRoles[0];
    if (!dup || !first) throw new Error('fixture');
    dup.projectRoles.push({ ...first, assignmentId: 'dup-assignment' });
    await setRole(CLEO, first.role.key === 'viewer' ? 'member' : 'viewer');
    const change = (await audit()).items[0]?.changes[0];
    expect(change?.from).toBe(first.role.name);
  });

  it('changes a role into one row, and the same role again writes no audit entry', async () => {
    apply('owner');
    const before = (await audit()).total;
    const changed = await setRole(CLEO, 'viewer');
    expect(changed.projectRoles.map((r) => r.role.key)).toEqual(['viewer']);
    expect((await audit()).total).toBe(before + 1);
    await setRole(CLEO, 'viewer');
    expect((await audit()).total).toBe(before + 1);
    expect((await audit()).items[0]).toMatchObject({ action: 'project_member.role_changed' });
  });

  it('changing the role of a person with no row is 404, with a bad role 422', async () => {
    apply('owner');
    expect(await status(setRole(MIRA, 'viewer'))).toBe(404);
    expect(await status(setRole(CLEO, 'owner'))).toBe(422);
  });

  it('removes a person, then they are gone from the list (and a second remove is 404)', async () => {
    apply('owner');
    await remove(CLEO);
    expect((await list(P, { pageSize: 100 })).items.map((m) => m.userId)).not.toContain(CLEO);
    expect(await status(remove(CLEO))).toBe(404);
  });

  it('P audit holds only the entries of P', async () => {
    apply('owner');
    const mine = (await audit(P, { pageSize: 100 })).items;
    const theirs = (await audit(OTHER, { pageSize: 100 })).items;
    expect(mine.some((e) => theirs.some((t) => t.id === e.id))).toBe(false);
    expect(mine.map((e) => e.at)).toEqual([...mine.map((e) => e.at)].sort().reverse());
  });
});

describe('list scenarios', () => {
  it('membersEmpty and auditEmpty', async () => {
    apply('owner', 'membersEmpty');
    expect((await list()).total).toBe(0);
    apply('owner', 'auditEmpty');
    expect((await audit()).total).toBe(0);
  });

  it.each([
    ['membersError', () => list()],
    ['auditError', () => audit()],
  ] as const)('%s fails MAX_RETRIES + 1 times, then answers', async (scenario, call) => {
    apply('owner', scenario);
    for (let i = 0; i <= MAX_RETRIES; i += 1) expect(await status(call())).toBe(500);
    expect(await status(call())).toBe(200);
  });

  it.each([
    ['membersSlow', () => list()],
    ['auditSlow', () => audit()],
  ] as const)('%s holds the answer back', async (scenario, call) => {
    apply('owner', scenario);
    const started = Date.now();
    await call();
    expect(Date.now() - started).toBeGreaterThanOrEqual(1400);
  });

  it('membersPaged has 25 people and auditPaged 25 entries', async () => {
    apply('owner', 'membersPaged');
    expect((await list()).total).toBe(25);
    apply('owner', 'auditPaged');
    expect((await audit()).total).toBe(25);
  });
});

describe('meanwhile scenarios', () => {
  it('goneFromOrg: adding that person is 422 /userId and they leave the picker', async () => {
    apply('owner', 'goneFromOrg');
    const err = await rejection(add(RAE));
    expect(err.status).toBe(422);
    expect(err.errors?.[0]?.pointer).toBe('/userId');
    expect((await picker({ pageSize: 100 })).items.map((m) => m.userId)).not.toContain(RAE);
    expect(await status(add(MIRA))).toBe(200);
  });

  it('roleAddedMeanwhile: the picker still offers the person; then they have a role, so adding is 409 and the picker drops them', async () => {
    apply('owner', 'roleAddedMeanwhile');
    await list();
    const first = await picker({ pageSize: 100, excludeProject: P });
    expect(first.items.map((m) => m.userId)).toContain(RAE);
    expect((await rejection(add(RAE))).status).toBe(409);
    expect((await picker({ pageSize: 100, excludeProject: P })).items.map((m) => m.userId)).not.toContain(RAE);
    expect((await list(P, { pageSize: 100 })).items.map((m) => m.userId)).toContain(RAE);
  });

  it('roleRemovedMeanwhile: after the first list the person is gone, so changing and removing are 404', async () => {
    apply('owner', 'roleRemovedMeanwhile');
    expect((await list()).items.map((m) => m.userId)).toContain(CLEO);
    expect(await status(setRole(CLEO, 'viewer'))).toBe(404);
    expect(await status(remove(CLEO))).toBe(404);
  });

  it('demotedMeanwhile: the page and the picker load, then the caller is a member, so the add and a reload are 403', async () => {
    apply('projectAdmin', 'demotedMeanwhile');
    expect((await list()).items.length).toBeGreaterThan(0);
    expect((await picker({ excludeProject: P })).items.length).toBeGreaterThan(0);
    expect(await status(add(MIRA))).toBe(403);
    expect(await status(list())).toBe(403);
  });
});
