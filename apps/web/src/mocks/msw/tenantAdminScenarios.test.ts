// The contracts package's own client is what these tests drive; the restriction is for app code.
import { ApiError, createApi } from '@agentdesk/contracts/client';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { roleFixtures } from '../dto/access';
import { ids } from '../dto/ids';
import { mockDb } from './db';
import {
  TENANT_ADMIN_SCENARIO_KEY,
  TENANT_ADMIN_SCENARIOS,
  applyTenantAdminScenario,
  parseTenantAdminScenario,
  type TenantAdminScenario,
} from './tenantAdminScenarios';

const BASE = 'http://localhost:3000';
const api = createApi({ baseUrl: BASE, parse: true });
const orgId = ids.org.alice;
const params = { orgId };
const ALICE = ids.user.alice;
const PRIYA = 'user-tenant-2';
const BEN = 'user-tenant-3';
const CLEO = 'user-tenant-4';

const roleId = (key: string): string => {
  const role = roleFixtures.find((r) => r.key === key);
  if (!role) throw new Error(`role ${key} missing`);
  return role.id;
};

async function rejection(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error('expected the call to fail');
}

const setRole = (userId: string, key: string | null) =>
  api.members.updateRole({ params: { orgId, userId }, body: { roleId: key === null ? null : roleId(key) } });
const remove = (userId: string) => api.members.remove({ params: { orgId, userId } });
const members = (query: { page?: number; pageSize?: number } = {}) => api.members.list({ params, query });
const roleOf = async (userId: string): Promise<string | undefined> => {
  const list = await members({ pageSize: 100 });
  return list.items.find((m) => m.userId === userId)?.assignments.find((a) => a.scope.type === 'org')?.role.key;
};
const projectRolesOf = async (userId: string) => {
  const list = await members({ pageSize: 100 });
  return list.items.find((m) => m.userId === userId)?.assignments.filter((a) => a.scope.type === 'project') ?? [];
};
const apply = (name: TenantAdminScenario) => applyTenantAdminScenario(mockDb, name);

it('the key and every scenario name', () => {
  expect(TENANT_ADMIN_SCENARIO_KEY).toBe('agentdesk.mock.tenantAdmin');
  expect(TENANT_ADMIN_SCENARIOS).toHaveLength(15);
  expect(parseTenantAdminScenario('soleOwner')).toBe('soleOwner');
  expect(parseTenantAdminScenario('nope')).toBeUndefined();
  expect(parseTenantAdminScenario(null)).toBeUndefined();
});

describe.each(TENANT_ADMIN_SCENARIOS)('%s', (name) => {
  it('applies, signs a user in, and a second apply starts from a clean seed', () => {
    apply(name);
    const first = JSON.stringify(mockDb.state.members);
    apply(name);
    expect(JSON.stringify(mockDb.state.members)).toBe(first);
    expect(mockDb.currentUser()).not.toBeNull();
  });
});

describe('last owner', () => {
  it('a sole owner demoting themselves is a 409 and nothing changes', async () => {
    apply('soleOwner');
    const err = await rejection(setRole(ALICE, 'admin'));
    expect(err.status).toBe(409);
    expect(err.title).toBe('The organization needs at least one owner');
    expect(await roleOf(ALICE)).toBe('owner');
  });

  it('a sole owner dropping their own role is a 409', async () => {
    apply('soleOwner');
    expect((await rejection(setRole(ALICE, null))).status).toBe(409);
  });

  it('with two owners an owner can step down, and the other cannot then', async () => {
    apply('twoOwners');
    const done = await setRole(ALICE, 'admin');
    expect(done.assignments.map((a) => a.role.key)).toEqual(['admin']);
    expect(await roleOf(ALICE)).toBe('admin');
    // Priya is the sole owner now, and the caller (an admin) may not touch her anyway.
    expect((await rejection(setRole(PRIYA, 'member'))).status).toBe(403);
  });

  it('the last owner cannot step down once the other owner is removed', async () => {
    apply('twoOwners');
    await remove(PRIYA);
    expect((await rejection(setRole(ALICE, 'viewer'))).title).toBe('The organization needs at least one owner');
  });

  it('the access of the signed-in user follows their own role change', async () => {
    apply('twoOwners');
    await setRole(ALICE, 'viewer');
    expect(mockDb.state.memberships.find((m) => m.userId === ALICE && m.orgId === orgId)?.roleKey).toBe('viewer');
  });
});

describe('who may do what', () => {
  it('an admin touching an owner is 403, and so is giving owner', async () => {
    apply('admin');
    expect((await rejection(setRole(PRIYA, 'member'))).status).toBe(403);
    expect((await rejection(remove(PRIYA))).status).toBe(403);
    expect((await rejection(setRole(CLEO, 'owner'))).status).toBe(403);
    expect(await roleOf(PRIYA)).toBe('owner');
    expect(await roleOf(CLEO)).toBe('member');
  });

  it('an admin changes a member and a no-role member', async () => {
    apply('admin');
    const projectRolesBefore = await projectRolesOf(CLEO);
    expect(await setRole(CLEO, 'viewer')).toMatchObject({ userId: CLEO });
    expect(await roleOf(CLEO)).toBe('viewer');
    await setRole(CLEO, null);
    expect(await roleOf(CLEO)).toBeUndefined();
    // TC-3.3: No role leaves the project roles alone
    expect(projectRolesBefore.length).toBeGreaterThan(0);
    expect(await projectRolesOf(CLEO)).toEqual(projectRolesBefore);
  });

  it('an owner gives and takes owner', async () => {
    apply('twoOwners');
    await setRole(CLEO, 'owner');
    expect(await roleOf(CLEO)).toBe('owner');
    await setRole(CLEO, 'member');
    expect(await roleOf(CLEO)).toBe('member');
  });

  it('the same role again is a 200 and keeps the assignment id', async () => {
    apply('twoOwners');
    const before = (await members({ pageSize: 100 })).items.find((m) => m.userId === BEN);
    await setRole(BEN, 'admin');
    const after = (await members({ pageSize: 100 })).items.find((m) => m.userId === BEN);
    expect(after).toEqual(before);
  });

  it('removing yourself is 403 before any lookup, even for an unknown id', async () => {
    apply('twoOwners');
    expect((await rejection(remove(ALICE))).status).toBe(403);
    expect(await roleOf(ALICE)).toBe('owner');
  });

  it('removing a member drops every assignment of theirs', async () => {
    apply('twoOwners');
    expect((await projectRolesOf(CLEO)).length).toBeGreaterThan(0);
    await remove(CLEO);
    const list = await members({ pageSize: 100 });
    expect(list.items.some((m) => m.userId === CLEO)).toBe(false);
    expect(await projectRolesOf(CLEO)).toEqual([]);
    expect(list.total).toBe(4);
  });

  it('a removed or unknown member is a 404 with the problem title', async () => {
    apply('twoOwners');
    await remove(CLEO);
    const gone = 'Member is no longer in the organization';
    expect((await rejection(setRole(CLEO, 'viewer'))).title).toBe(gone);
    expect((await rejection(remove(CLEO))).status).toBe(404);
    expect((await rejection(remove('user-nobody'))).title).toBe(gone);
  });

  it('an unknown role id is a 422 on /roleId', async () => {
    apply('twoOwners');
    const err = await rejection(
      api.members.updateRole({ params: { orgId, userId: CLEO }, body: { roleId: ids.created(4242) } }),
    );
    expect(err.status).toBe(422);
    expect(err.errors?.[0]?.pointer).toBe('/roleId');
  });

  it('another org id is a 404 and nothing changes', async () => {
    apply('twoOwners');
    const other = { orgId: ids.org.acme, userId: CLEO };
    expect((await rejection(api.members.updateRole({ params: other, body: { roleId: null } }))).status).toBe(404);
    expect((await rejection(api.members.remove({ params: other }))).status).toBe(404);
    expect((await rejection(api.audit.list({ params: { orgId: ids.org.acme }, query: {} }))).status).toBe(404);
    expect((await rejection(api.members.list({ params: { orgId: ids.org.acme }, query: {} }))).status).toBe(404);
    expect(await roleOf(CLEO)).toBe('member');
  });

  it.each(['projectAdmin', 'member', 'viewer'] as const)('%s gets 403 on every admin route', async (name) => {
    apply(name);
    expect((await rejection(setRole(CLEO, 'viewer'))).status).toBe(403);
    expect((await rejection(remove(CLEO))).status).toBe(403);
    expect((await rejection(api.orgs.update({ params, body: { name: 'X' } }))).status).toBe(403);
    expect((await rejection(api.audit.list({ params, query: {} }))).status).toBe(403);
  });
});

describe('orgs.update', () => {
  it('a taken slug is a 409 on /slug', async () => {
    apply('twoOwners');
    const err = await rejection(api.orgs.update({ params, body: { slug: 'taken' } }));
    expect(err.status).toBe(409);
    expect(err.errors?.[0]?.pointer).toBe('/slug');
    expect(mockDb.state.orgs.find((o) => o.id === orgId)?.slug).toBe('alice');
  });

  it('keeping the own slug is fine, and a rename changes the org list', async () => {
    apply('twoOwners');
    expect(await api.orgs.update({ params, body: { name: 'Harbor Labs', slug: 'alice' } })).toEqual({
      id: orgId,
      name: 'Harbor Labs',
      slug: 'alice',
    });
    await api.orgs.update({ params, body: { slug: 'harbor-labs' } });
    const res = await fetch(`${BASE}/auth/organization/list`);
    const list = z.array(z.object({ id: z.string(), name: z.string(), slug: z.string() })).parse(await res.json());
    expect(list.find((o) => o.id === orgId)).toMatchObject({ name: 'Harbor Labs', slug: 'harbor-labs' });
  });
});

describe('audit.list', () => {
  it('pages the entries newest first', async () => {
    apply('auditPaged');
    const first = await api.audit.list({ params, query: { page: 1, pageSize: 20 } });
    const second = await api.audit.list({ params, query: { page: 2, pageSize: 20 } });
    expect([first.items.length, second.items.length, first.total]).toEqual([20, 5, 25]);
    const times = [...first.items, ...second.items].map((e) => e.at);
    expect(times).toEqual([...times].sort().reverse());
  });

  it('auditEmpty has no entries', async () => {
    apply('auditEmpty');
    expect((await api.audit.list({ params, query: {} })).total).toBe(0);
  });
});

describe('members.list', () => {
  it('membersPaged has 25 members over two pages at the default size', async () => {
    apply('membersPaged');
    const first = await members();
    expect([first.items.length, first.total]).toEqual([20, 25]);
    expect((await members({ page: 2 })).items).toHaveLength(5);
  });
});

describe('changes meanwhile', () => {
  it('memberRemovedMeanwhile returns B on the first list and 404 on a later change', async () => {
    apply('memberRemovedMeanwhile');
    expect((await members({ pageSize: 100 })).items.some((m) => m.userId === CLEO)).toBe(true);
    const err = await rejection(setRole(CLEO, 'admin'));
    expect(err.status).toBe(404);
    expect(err.title).toBe('Member is no longer in the organization');
    expect((await members({ pageSize: 100 })).items.some((m) => m.userId === CLEO)).toBe(false);
  });

  it('memberRemovedMeanwhile makes a later remove a 404 too', async () => {
    apply('memberRemovedMeanwhile');
    await members();
    expect((await rejection(remove(CLEO))).status).toBe(404);
  });

  it('roleChangedMeanwhile shows B as Member, then B is a Viewer and the change still succeeds', async () => {
    apply('roleChangedMeanwhile');
    expect(await roleOf(CLEO)).toBe('member');
    // The first read above flipped the data: the list now shows the new role.
    expect(await roleOf(CLEO)).toBe('viewer');
    await setRole(CLEO, 'admin');
    expect(await roleOf(CLEO)).toBe('admin');
  });
});

describe('error and slow scenarios', () => {
  it('membersError answers 500 with a request id once, then the list', async () => {
    apply('membersError');
    const err = await rejection(members());
    expect(err.status).toBe(500);
    expect(err.requestId).toMatch(/^req-mock-/);
    expect((await members()).total).toBeGreaterThan(0);
  });

  it('auditError answers 500 with a request id once, then the list', async () => {
    apply('auditError');
    const err = await rejection(api.audit.list({ params, query: {} }));
    expect(err.status).toBe(500);
    expect(err.requestId).toMatch(/^req-mock-/);
    expect((await api.audit.list({ params, query: {} })).total).toBeGreaterThan(0);
  });

  it.each([
    ['membersSlow', () => members()],
    ['auditSlow', () => api.audit.list({ params, query: {} })],
  ] as const)('%s holds the answer back 1500 ms', async (name, call) => {
    apply(name);
    const started = Date.now();
    await call();
    expect(Date.now() - started).toBeGreaterThanOrEqual(1450);
  });
});

describe('default seed', () => {
  it('a role change does not survive a reset and is not shared between the two orgs', async () => {
    mockDb.reset();
    const bob = 'user-bob';
    const keyOf = () =>
      mockDb.state.members[ids.org.alice]
        ?.find((m) => m.userId === bob)
        ?.assignments.find((a) => a.scope.type === 'org')?.role.key;
    const before = keyOf();
    expect(mockDb.state.members[ids.org.alice]?.[1]).not.toBe(mockDb.state.members[ids.org.acme]?.[1]);
    await setRole(bob, before === 'viewer' ? 'member' : 'viewer');
    expect(keyOf()).not.toBe(before);
    mockDb.reset();
    expect(keyOf()).toBe(before);
  });
});
