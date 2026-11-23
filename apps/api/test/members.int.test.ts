import { randomUUID } from 'node:crypto';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import pino from 'pino';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemberDto, type Access, type Page } from '@agentdesk/contracts';
import { loadAccess } from '@agentdesk/core';
import { auditLog, connections, member, projects, roleAssignments, roles, runs, withOrg } from '@agentdesk/db';
import { ConflictProblemException } from '../src/common/zod-validation';
import { lockOrgOwnerRows } from '../src/members/owner-lock';
import { MembersService, NOT_A_MEMBER } from '../src/members/members.service';
import { createTestApp, type TestApp } from './helpers/app';
import {
  acceptInvite,
  changeRole,
  createOrg,
  grant,
  invite,
  inviteAndLogin,
  loginAs,
  memberSearch,
  removeMember,
  revoke,
  roleIdsOf,
  userIdOf,
} from './helpers/auth';
import { expectContract } from './helpers/contract';

let t: TestApp;

const logLines: Record<string, unknown>[] = [];

beforeAll(async () => {
  const logger = pino(
    { level: 'info' },
    {
      write: (line: string) => {
        logLines.push(JSON.parse(line) as Record<string, unknown>);
      },
    },
  );
  t = await createTestApp({ logger });
});
afterAll(async () => {
  await t.close();
});

async function seedProject(orgId: string, name: string): Promise<string> {
  return withOrg(t.db, orgId, async (tx) => {
    const [conn] = await tx
      .insert(connections)
      .values({
        orgId,
        provider: 'fake',
        capabilities: { code: true, board: true },
        externalId: randomUUID(),
        accountName: 'dev',
      })
      .returning({ id: connections.id });
    const [project] = await tx
      .insert(projects)
      .values({
        orgId,
        name,
        repoPath: `dev/${name.toLowerCase()}`,
        codeConnectionId: conn?.id ?? '',
        boardConnectionId: conn?.id ?? '',
      })
      .returning({ id: projects.id });
    return project?.id ?? '';
  });
}

interface Cast {
  orgId: string;
  p1: string;
  p2: string;
  o: string;
  a: string;
  b: string;
  v: string;
  ids: { o: string; a: string; b: string; v: string; n: string };
}

/**
 * Owner O, A admin on P1, B member on P1 and P2, V viewer on the org, N a member whose only grant was revoked.
 * Every cast has its own org and handles so the tests do not see each other's members.
 */
async function buildCast(slug: string): Promise<Cast> {
  const org = await createOrg(t, slug, slug);
  const p1 = await seedProject(org.id, `P1-${slug}`);
  const p2 = await seedProject(org.id, `P2-${slug}`);
  const h = (n: string) => `${slug}-${n}`;
  const o = await inviteAndLogin(t, org.id, h('o'), 'owner', { type: 'org' });
  const a = await inviteAndLogin(t, org.id, h('a'), 'admin', { type: 'project', projectIds: [p1] });
  const b = await inviteAndLogin(t, org.id, h('b'), 'member', { type: 'project', projectIds: [p1, p2] });
  const v = await inviteAndLogin(t, org.id, h('v'), 'viewer', { type: 'org' });
  await inviteAndLogin(t, org.id, h('n'), 'viewer', { type: 'org' });
  const n = await userIdOf(t, h('n'));
  await revoke(t, org.id, (await grant(t, org.id, n, 'viewer', { type: 'org' })).id);
  return {
    orgId: org.id,
    p1,
    p2,
    o,
    a,
    b,
    v,
    ids: {
      o: await userIdOf(t, h('o')),
      a: await userIdOf(t, h('a')),
      b: await userIdOf(t, h('b')),
      v: await userIdOf(t, h('v')),
      n,
    },
  };
}

function list(orgId: string, cookie: string, query = '') {
  return t.app.inject({ method: 'GET', url: `/api/orgs/${orgId}/members${query}`, headers: { cookie } });
}

describe('listing members', () => {
  it('shows an org owner every member with all assignments and no email', async () => {
    const f = await buildCast('mem-owner');
    const res = await list(f.orgId, f.o);
    expect(res.statusCode).toBe(200);
    const page = expectContract('members.list', res) as Page<MemberDto>;
    expect(page.total).toBe(5);
    expect(page.items.map((i) => i.handle)).toEqual([
      'mem-owner-a',
      'mem-owner-b',
      'mem-owner-n',
      'mem-owner-o',
      'mem-owner-v',
    ]);
    const by = Object.fromEntries(page.items.map((i) => [i.userId, i]));
    expect(
      by[f.ids.b]?.assignments.map((x) => (x.scope.type === 'project' ? x.scope.projectId : 'org')).sort(),
    ).toEqual([f.p1, f.p2].sort());
    expect(by[f.ids.o]?.assignments).toHaveLength(1);
    expect(by[f.ids.n]?.assignments).toEqual([]);
    // the raw body carries no email key and nothing that looks like one
    for (const item of res.json<{ items: object[] }>().items) {
      expect(Object.keys(item).sort()).toEqual(['assignments', 'handle', 'name', 'userId']);
    }
    expect(res.body).not.toContain('@dev.local');
    for (const item of page.items) expect(MemberDto.safeParse(item).success).toBe(true);
  });

  it('shows a project admin every member but only the assignments on their project', async () => {
    const f = await buildCast('mem-admin');
    const res = await list(f.orgId, f.a);
    expect(res.statusCode).toBe(200);
    const page = expectContract('members.list', res) as Page<MemberDto>;
    expect(page.total).toBe(5);
    const by = Object.fromEntries(page.items.map((i) => [i.userId, i]));
    expect(by[f.ids.b]?.assignments.map((x) => x.scope)).toEqual([{ type: 'project', projectId: f.p1 }]);
    expect(by[f.ids.a]?.assignments.map((x) => x.scope)).toEqual([{ type: 'project', projectId: f.p1 }]);
    expect(by[f.ids.o]?.assignments).toEqual([]);
    expect(by[f.ids.v]?.assignments).toEqual([]);
    expect(res.body).not.toContain('@dev.local');
    const raw = res.json<{ items: { assignments: { scope: { projectId?: string } }[] }[] }>();
    for (const item of raw.items) {
      for (const x of item.assignments) expect(x.scope.projectId).toBe(f.p1);
    }
  });

  it('refuses a member and a viewer with 403 and no data', async () => {
    const f = await buildCast('mem-denied');
    for (const cookie of [f.b, f.v]) {
      const res = await list(f.orgId, cookie);
      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain('mem-denied-o');
    }
  });

  it('answers 401 without a session and 404 for another org id', async () => {
    const f = await buildCast('mem-ids');
    expect((await t.app.inject({ method: 'GET', url: `/api/orgs/${f.orgId}/members` })).statusCode).toBe(401);
    expect((await list(randomUUID(), f.o)).statusCode).toBe(404);
    const other = await createOrg(t, 'mem-ids-other', 'mem-ids-other');
    expect((await list(other.id, f.o)).statusCode).toBe(404);
  });

  it('does not list members of another org', async () => {
    const f = await buildCast('mem-iso');
    const other = await createOrg(t, 'mem-iso-other', 'mem-iso-other');
    await inviteAndLogin(t, other.id, 'mem-iso-stranger', 'viewer', { type: 'org' });
    const page = expectContract('members.list', await list(f.orgId, f.o)) as Page<MemberDto>;
    expect(page.items.map((i) => i.handle)).not.toContain('mem-iso-stranger');
  });

  it('refuses a platform admin with no membership on the tenant route', async () => {
    const f = await buildCast('mem-plat');
    const admin = await loginAs(t, 'admin');
    const res = await list(f.orgId, admin);
    expect([403, 404]).toContain(res.statusCode);
    expect(res.body).not.toContain('mem-plat-o');
  });

  it('pages by handle with the real total and an empty page past the end', async () => {
    const f = await buildCast('mem-page');
    const first = expectContract('members.list', await list(f.orgId, f.o, '?page=1&pageSize=2')) as Page<MemberDto>;
    expect(first).toMatchObject({ page: 1, pageSize: 2, total: 5 });
    expect(first.items.map((i) => i.handle)).toEqual(['mem-page-a', 'mem-page-b']);
    const third = expectContract('members.list', await list(f.orgId, f.o, '?page=3&pageSize=2')) as Page<MemberDto>;
    expect(third.items.map((i) => i.handle)).toEqual(['mem-page-v']);
    const past = expectContract('members.list', await list(f.orgId, f.o, '?page=9&pageSize=2')) as Page<MemberDto>;
    expect(past).toMatchObject({ page: 9, total: 5, items: [] });
    expect((await list(f.orgId, f.o, '?pageSize=101')).statusCode).toBe(400);
  });
});

describe('the service with an org-scope assignment reader that lacks member:read', () => {
  it('shows the org-scope assignments, like the assignment list does', async () => {
    const f = await buildCast('mem-asg-read');
    // a custom role (no HTTP route builds one): org-scope assignment:read and assignment:create, no member:read
    const access: Access = {
      userId: f.ids.v,
      grants: [
        {
          roleId: randomUUID(),
          roleKey: 'custom',
          scope: { type: 'org' },
          lines: [
            { permission: 'assignment:read', condition: 'any' },
            { permission: 'assignment:create', condition: 'any' },
          ],
        },
      ],
    };
    const service = t.app.get(MembersService, { strict: false });
    const page = await service.list(access, f.orgId, { page: 1, pageSize: 50 });
    const owner = page.items.find((i) => i.userId === f.ids.o);
    expect(owner?.assignments.map((x) => x.scope.type)).toEqual(['org']);
  });
});

async function orgScopeRoles(orgId: string, userId: string): Promise<string[]> {
  return withOrg(t.db, orgId, async (tx) => {
    const rows = await tx
      .select({ key: roles.key })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(
        and(eq(roleAssignments.orgId, orgId), eq(roleAssignments.userId, userId), eq(roleAssignments.scopeType, 'org')),
      );
    return rows.map((r) => r.key).sort();
  });
}

async function projectRoleCount(orgId: string, userId: string): Promise<number> {
  return withOrg(t.db, orgId, async (tx) => {
    const rows = await tx
      .select({ id: roleAssignments.id })
      .from(roleAssignments)
      .where(
        and(
          eq(roleAssignments.orgId, orgId),
          eq(roleAssignments.userId, userId),
          eq(roleAssignments.scopeType, 'project'),
        ),
      );
    return rows.length;
  });
}

async function auditRows(orgId: string, action: string, targetId: string) {
  return withOrg(t.db, orgId, (tx) =>
    tx
      .select({ payload: auditLog.payload, actorUserId: auditLog.actorUserId })
      .from(auditLog)
      .where(and(eq(auditLog.orgId, orgId), eq(auditLog.action, action), eq(auditLog.targetId, targetId))),
  );
}

/** The caller's access as the guard would load it now; a race test captures it before the other change commits. */
async function accessOf(orgId: string, userId: string): Promise<Access> {
  return withOrg(t.db, orgId, (tx) => loadAccess(tx, userId));
}

/** Holds the org's owner-row lock in an open transaction until `release()`, so later changes queue behind it. */
async function holdOwnerLock(orgId: string): Promise<{ release: () => Promise<void> }> {
  let open = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  let taken = (): void => undefined;
  const ready = new Promise<void>((resolve) => {
    taken = resolve;
  });
  const done = withOrg(t.db, orgId, async (tx) => {
    await lockOrgOwnerRows(tx, orgId);
    taken();
    await gate;
  });
  await ready;
  return {
    release: async () => {
      open();
      await done;
    },
  };
}

async function lockWaiters(): Promise<number> {
  const res = await t.db.pool.query<{ n: number }>(
    "select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()",
  );
  return res.rows[0]?.n ?? 0;
}

/** Waits until `n` more sessions than `baseline` are blocked on a row lock. */
async function waitForWaiters(baseline: number, n: number): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if ((await lockWaiters()) >= baseline + n) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('the changes never queued behind the owner lock');
}

/**
 * Starts the changes one by one while the owner lock is held elsewhere, waits until each one is queued on it, then
 * releases the lock: every change has passed the guard and read its caller's access before any of them commits.
 * Without `lockOrgOwnerRows` nothing queues and this throws.
 */
async function queueBehindOwnerLock(
  orgId: string,
  changes: (() => Promise<unknown>)[],
): Promise<PromiseSettledResult<unknown>[]> {
  const hold = await holdOwnerLock(orgId);
  const base = await lockWaiters();
  const started: Promise<unknown>[] = [];
  try {
    for (const [i, change] of changes.entries()) {
      started.push(change());
      await waitForWaiters(base, i + 1);
    }
  } finally {
    await hold.release();
  }
  return Promise.allSettled(started);
}

/** Holds a row lock on the member's `member` row in an open transaction until `release()`. */
async function holdMemberLock(orgId: string, userId: string): Promise<{ release: () => Promise<void> }> {
  let open = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  let taken = (): void => undefined;
  const ready = new Promise<void>((resolve) => {
    taken = resolve;
  });
  const done = withOrg(t.db, orgId, async (tx) => {
    await tx
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
      .for('update');
    taken();
    await gate;
  });
  await ready;
  return {
    release: async () => {
      open();
      await done;
    },
  };
}

/** Waits until `n` more sessions than `baseline` are blocked on a lock, or `call` has settled, whichever is first. */
async function queuedOrSettled(baseline: number, n: number, call: Promise<unknown>): Promise<void> {
  let settled = false;
  void call.then(
    () => (settled = true),
    () => (settled = true),
  );
  for (let i = 0; i < 200 && !settled; i++) {
    if ((await lockWaiters()) >= baseline + n) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** The org with no owner (an org after deploy): two org admins A and V, the owner's assignment deleted. */
async function buildOwnerlessCast(slug: string): Promise<Cast> {
  const f = await buildCast(slug);
  await grant(t, f.orgId, f.ids.a, 'admin', { type: 'org' });
  await grant(t, f.orgId, f.ids.v, 'admin', { type: 'org' });
  await withOrg(t.db, f.orgId, async (tx) => {
    const owners = await lockOrgOwnerRows(tx, f.orgId);
    await tx.delete(roleAssignments).where(
      and(
        eq(roleAssignments.orgId, f.orgId),
        inArray(
          roleAssignments.id,
          owners.map((o) => o.id),
        ),
      ),
    );
  });
  return f;
}

describe('changing a member org role', () => {
  it('BR-3: an owner sets a member to admin, keeps project roles and audits once', async () => {
    const f = await buildCast('mr-set');
    const r = await roleIdsOf(t, f.o, f.orgId);
    const res = await changeRole(t, f.o, f.orgId, f.ids.b, r.admin);
    expect(res.statusCode).toBe(200);
    const dto = expectContract('members.updateRole', res) as MemberDto;
    expect(dto.userId).toBe(f.ids.b);
    expect(await orgScopeRoles(f.orgId, f.ids.b)).toEqual(['admin']);
    expect(await projectRoleCount(f.orgId, f.ids.b)).toBe(2);
    // B's next request follows the new role: an org admin can list members now
    expect((await list(f.orgId, f.b)).statusCode).toBe(200);
    expect((await changeRole(t, f.o, f.orgId, f.ids.b, r.admin)).statusCode).toBe(200);
    expect(await auditRows(f.orgId, 'member.role_changed', f.ids.b)).toHaveLength(1);
    const cleared = await changeRole(t, f.o, f.orgId, f.ids.b, null);
    expect(cleared.statusCode).toBe(200);
    expect(await orgScopeRoles(f.orgId, f.ids.b)).toEqual([]);
    expect(await projectRoleCount(f.orgId, f.ids.b)).toBe(2);
  });

  it('BR-21: one audit row per change with from and to role keys; a refused change writes none', async () => {
    const f = await buildCast('mr-audit');
    const r = await roleIdsOf(t, f.o, f.orgId);
    await changeRole(t, f.o, f.orgId, f.ids.v, r.member);
    const rows = await auditRows(f.orgId, 'member.role_changed', f.ids.v);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorUserId).toBe(f.ids.o);
    expect(rows[0]?.payload).toMatchObject({ from: ['viewer'], to: 'member' });
    expect((await changeRole(t, f.b, f.orgId, f.ids.v, r.admin)).statusCode).toBe(403);
    expect(await auditRows(f.orgId, 'member.role_changed', f.ids.v)).toHaveLength(1);
  });

  it('BR-40, BR-41, BR-42: owners give owner and demote each other, but never themselves', async () => {
    const f = await buildCast('mr-owners');
    const r = await roleIdsOf(t, f.o, f.orgId);
    expect((await changeRole(t, f.o, f.orgId, f.ids.b, r.owner)).statusCode).toBe(200);
    // B is an owner now: can give owner and demote O
    expect((await changeRole(t, f.b, f.orgId, f.ids.v, r.owner)).statusCode).toBe(200);
    expect((await changeRole(t, f.b, f.orgId, f.ids.o, r.admin)).statusCode).toBe(200);
    expect(await orgScopeRoles(f.orgId, f.ids.o)).toEqual(['admin']);
    // V and B are owners; B cannot step down, V can demote B, and B as an admin cannot touch owner V
    expect((await changeRole(t, f.b, f.orgId, f.ids.b, r.admin)).statusCode).toBe(403);
    expect(await orgScopeRoles(f.orgId, f.ids.b)).toEqual(['owner']);
    expect((await changeRole(t, f.v, f.orgId, f.ids.b, r.admin)).statusCode).toBe(200);
    expect((await changeRole(t, f.b, f.orgId, f.ids.v, r.member)).statusCode).toBe(403);
  });

  it('BR-5: the only owner cannot demote themselves: 403 (own role), nothing changes', async () => {
    const f = await buildCast('mr-last');
    const r = await roleIdsOf(t, f.o, f.orgId);
    expect((await changeRole(t, f.o, f.orgId, f.ids.o, r.admin)).statusCode).toBe(403);
    expect((await changeRole(t, f.o, f.orgId, f.ids.o, null)).statusCode).toBe(403);
    expect(await orgScopeRoles(f.orgId, f.ids.o)).toEqual(['owner']);
    expect(await auditRows(f.orgId, 'member.role_changed', f.ids.o)).toHaveLength(0);
  });

  it('NO-3: nobody changes their own org role: owner, org admin, project admin, member and viewer get 403 and nothing changes', async () => {
    const f = await buildCast('mr-self');
    const r = await roleIdsOf(t, f.o, f.orgId);
    // a second owner, so the refusal is the self rule and not the last-owner 409
    expect((await changeRole(t, f.o, f.orgId, f.ids.v, r.owner)).statusCode).toBe(200);
    const orgAdmin = await inviteAndLogin(t, f.orgId, 'mr-self-oa', 'admin', { type: 'org' });
    const oaId = await userIdOf(t, 'mr-self-oa');
    const viewer = await inviteAndLogin(t, f.orgId, 'mr-self-vw', 'viewer', { type: 'org' });
    const viewerId = await userIdOf(t, 'mr-self-vw');
    const actors: [string, string][] = [
      [f.o, f.ids.o],
      [f.v, f.ids.v],
      [orgAdmin, oaId],
      [f.a, f.ids.a],
      [f.b, f.ids.b],
      [viewer, viewerId],
    ];
    for (const [cookie, userId] of actors) {
      const before = await orgScopeRoles(f.orgId, userId);
      for (const roleId of [r.owner, r.admin, r.member, r.viewer, null]) {
        expect((await changeRole(t, cookie, f.orgId, userId, roleId)).statusCode).toBe(403);
      }
      expect(await orgScopeRoles(f.orgId, userId)).toEqual(before);
    }
    expect(await auditRows(f.orgId, 'member.role_changed', f.ids.o)).toHaveLength(0);
    expect(await auditRows(f.orgId, 'member.role_changed', oaId)).toHaveLength(0);
    // only the grant of owner to V above was audited
    expect(await auditRows(f.orgId, 'member.role_changed', f.ids.v)).toHaveLength(1);
  });

  it('NO-3: the service refuses a self change for an owner before any lookup, change or audit', async () => {
    const f = await buildCast('mr-self-svc');
    const r = await roleIdsOf(t, f.o, f.orgId);
    const service = t.app.get(MembersService, { strict: false });
    const accO = await accessOf(f.orgId, f.ids.o);
    await expect(service.updateRole(accO, f.orgId, f.ids.o, r.owner)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.updateRole(accO, f.orgId, f.ids.o, r.admin)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await orgScopeRoles(f.orgId, f.ids.o)).toEqual(['owner']);
    expect(await auditRows(f.orgId, 'member.role_changed', f.ids.o)).toHaveLength(0);
  });

  it('NO-3: a body that names another actor does not bypass the rule; the session user is the actor', async () => {
    const f = await buildCast('mr-self-spoof');
    const r = await roleIdsOf(t, f.o, f.orgId);
    const other = await t.app.inject({
      method: 'PUT',
      url: `/api/orgs/${f.orgId}/members/${f.ids.b}/role`,
      headers: { cookie: f.o, 'x-org-id': f.orgId },
      payload: { roleId: r.admin, actorUserId: f.ids.v, userId: f.ids.v },
    });
    // the session user is O and the target in the path is B: allowed, and the audit actor is O, not the spoofed id
    expect(other.statusCode).toBe(200);
    expect((await auditRows(f.orgId, 'member.role_changed', f.ids.b))[0]?.actorUserId).toBe(f.ids.o);
    const self = await t.app.inject({
      method: 'PUT',
      url: `/api/orgs/${f.orgId}/members/${f.ids.b}/role`,
      headers: { cookie: f.b, 'x-org-id': f.orgId },
      payload: { roleId: r.viewer, actorUserId: f.ids.o, userId: f.ids.o },
    });
    // B is an org admin now and may give viewer to others, but not to itself
    expect(self.statusCode).toBe(403);
    expect(await orgScopeRoles(f.orgId, f.ids.b)).toEqual(['admin']);
    expect(await auditRows(f.orgId, 'member.role_changed', f.ids.b)).toHaveLength(1);
  });

  it('BR-18: lower roles get the same 403 for any user id; an org admin cannot touch owner', async () => {
    const f = await buildCast('mr-403');
    const r = await roleIdsOf(t, f.o, f.orgId);
    for (const cookie of [f.b, f.v, f.a]) {
      for (const id of [randomUUID(), 'not-a-uuid', f.ids.v]) {
        const res = await changeRole(t, cookie, f.orgId, id, r.viewer);
        expect(res.statusCode).toBe(403);
      }
    }
    const orgAdmin = await inviteAndLogin(t, f.orgId, 'mr-403-oa', 'admin', { type: 'org' });
    const oaId = await userIdOf(t, 'mr-403-oa');
    expect((await changeRole(t, orgAdmin, f.orgId, f.ids.v, r.owner)).statusCode).toBe(403);
    expect((await changeRole(t, orgAdmin, f.orgId, f.ids.o, r.admin)).statusCode).toBe(403);
    expect((await changeRole(t, orgAdmin, f.orgId, oaId, r.owner)).statusCode).toBe(403);
    expect(await orgScopeRoles(f.orgId, f.ids.o)).toEqual(['owner']);
  });

  it('BR-18: an org admin giving owner to an existing owner is 403 and nothing changes or is audited', async () => {
    const f = await buildCast('mr-owner-same');
    const r = await roleIdsOf(t, f.o, f.orgId);
    const orgAdmin = await inviteAndLogin(t, f.orgId, 'mr-owner-same-oa', 'admin', { type: 'org' });
    const res = await changeRole(t, orgAdmin, f.orgId, f.ids.o, r.owner);
    expect(res.statusCode).toBe(403);
    expect(await orgScopeRoles(f.orgId, f.ids.o)).toEqual(['owner']);
    expect(await auditRows(f.orgId, 'member.role_changed', f.ids.o)).toHaveLength(0);
  });

  it('BR-3: giving owner to an owner is 200 for an owner with no audit row', async () => {
    const f = await buildCast('mr-owner-noop');
    const r = await roleIdsOf(t, f.o, f.orgId);
    expect((await changeRole(t, f.o, f.orgId, f.ids.b, r.owner)).statusCode).toBe(200);
    expect(await auditRows(f.orgId, 'member.role_changed', f.ids.b)).toHaveLength(1);
    const again = await changeRole(t, f.o, f.orgId, f.ids.b, r.owner);
    expect(again.statusCode).toBe(200);
    expect(await orgScopeRoles(f.orgId, f.ids.b)).toEqual(['owner']);
    expect(await auditRows(f.orgId, 'member.role_changed', f.ids.b)).toHaveLength(1);
  });

  it('BR-3: an org admin sending the same non-owner role is 200 with no audit row', async () => {
    const f = await buildCast('mr-admin-noop');
    const r = await roleIdsOf(t, f.o, f.orgId);
    const orgAdmin = await inviteAndLogin(t, f.orgId, 'mr-admin-noop-oa', 'admin', { type: 'org' });
    expect((await changeRole(t, orgAdmin, f.orgId, f.ids.v, r.viewer)).statusCode).toBe(200);
    expect(await orgScopeRoles(f.orgId, f.ids.v)).toEqual(['viewer']);
    expect(await auditRows(f.orgId, 'member.role_changed', f.ids.v)).toHaveLength(0);
  });

  it('BR-8: a user who is not a member is 404; the audit from is the current role', async () => {
    const f = await buildCast('mr-gone');
    const r = await roleIdsOf(t, f.o, f.orgId);
    const res = await changeRole(t, f.o, f.orgId, randomUUID(), r.admin);
    expect(res.statusCode).toBe(404);
    expect(res.json<{ detail: string }>().detail).toBe(NOT_A_MEMBER);
    await changeRole(t, f.o, f.orgId, f.ids.v, r.member);
    await changeRole(t, f.o, f.orgId, f.ids.v, r.admin);
    const rows = await auditRows(f.orgId, 'member.role_changed', f.ids.v);
    expect(rows.map((x) => x.payload)).toEqual(
      expect.arrayContaining([expect.objectContaining({ from: ['member'], to: 'admin' })]),
    );
  });

  it('BR-36: an admin demoted to member cannot change roles any more', async () => {
    const f = await buildCast('mr-demoted');
    const r = await roleIdsOf(t, f.o, f.orgId);
    const oa = await inviteAndLogin(t, f.orgId, 'mr-demoted-oa', 'admin', { type: 'org' });
    expect((await changeRole(t, oa, f.orgId, f.ids.v, r.member)).statusCode).toBe(200);
    expect((await changeRole(t, f.o, f.orgId, await userIdOf(t, 'mr-demoted-oa'), r.member)).statusCode).toBe(200);
    expect((await changeRole(t, oa, f.orgId, f.ids.v, r.viewer)).statusCode).toBe(403);
  });

  it('refuses a role of another org, an unknown role and a project-only role with 422 /roleId', async () => {
    const f = await buildCast('mr-422');
    const other = await buildCast('mr-422-other');
    const foreign = (await roleIdsOf(t, other.o, other.orgId)).admin;
    // a role of this org that can only be given on a project, never at org scope
    const projectOnly = await withOrg(t.db, f.orgId, async (tx) => {
      const [row] = await tx
        .insert(roles)
        .values({ orgId: f.orgId, key: 'project-only', name: 'Project only', assignableScopes: ['project'] })
        .returning({ id: roles.id });
      return row?.id ?? '';
    });
    for (const id of [foreign, randomUUID(), projectOnly]) {
      const res = await changeRole(t, f.o, f.orgId, f.ids.b, id);
      expect(res.statusCode).toBe(422);
      expect(JSON.stringify(res.json())).toContain('/roleId');
    }
    expect(await orgScopeRoles(f.orgId, f.ids.b)).toEqual([]);
    expect(await auditRows(f.orgId, 'member.role_changed', f.ids.b)).toHaveLength(0);
  });

  it('answers 404 for a member of another org and takes the tenant from the session', async () => {
    const f = await buildCast('mr-iso');
    const other = await buildCast('mr-iso-other');
    const r = await roleIdsOf(t, other.o, other.orgId);
    // the active org is f's: another org's id in the path is 404 with a matching x-org-id header
    const res = await t.app.inject({
      method: 'PUT',
      url: `/api/orgs/${other.orgId}/members/${other.ids.b}/role`,
      headers: { cookie: f.o, 'x-org-id': f.orgId },
      payload: { roleId: r.admin },
    });
    expect(res.statusCode).toBe(404);
    expect(await orgScopeRoles(other.orgId, other.ids.b)).toEqual([]);
  });

  it('NO-1: two owners demoting each other at once leave one owner', async () => {
    const f = await buildCast('mr-race');
    const r = await roleIdsOf(t, f.o, f.orgId);
    expect((await changeRole(t, f.o, f.orgId, f.ids.b, r.owner)).statusCode).toBe(200);
    const codes = (
      await Promise.all([changeRole(t, f.o, f.orgId, f.ids.b, r.admin), changeRole(t, f.b, f.orgId, f.ids.o, r.admin)])
    )
      .map((x) => x.statusCode)
      .sort();
    // the loser is 409 when its access was read before the winner committed, 403 when after (it is no longer an owner)
    expect(codes[0]).toBe(200);
    expect([403, 409]).toContain(codes[1]);
    const owners = [...(await orgScopeRoles(f.orgId, f.ids.o)), ...(await orgScopeRoles(f.orgId, f.ids.b))].filter(
      (k) => k === 'owner',
    );
    expect(owners).toHaveLength(1);
  });

  it('NO-1 (a): two owners that both passed the guard demote each other; exactly one 409, one owner left', async () => {
    const f = await buildCast('mr-race-svc');
    const r = await roleIdsOf(t, f.o, f.orgId);
    await changeRole(t, f.o, f.orgId, f.ids.b, r.owner);
    const accO = await accessOf(f.orgId, f.ids.o);
    const accB = await accessOf(f.orgId, f.ids.b);
    const service = t.app.get(MembersService, { strict: false });
    const res = await queueBehindOwnerLock(f.orgId, [
      () => service.updateRole(accO, f.orgId, f.ids.b, r.admin),
      () => service.updateRole(accB, f.orgId, f.ids.o, r.admin),
    ]);
    expect(res.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const lost = res.filter((x): x is PromiseRejectedResult => x.status === 'rejected');
    expect(lost).toHaveLength(1);
    expect(lost[0]?.reason).toBeInstanceOf(ConflictProblemException);
    const owners = [...(await orgScopeRoles(f.orgId, f.ids.o)), ...(await orgScopeRoles(f.orgId, f.ids.b))].filter(
      (k) => k === 'owner',
    );
    expect(owners).toHaveLength(1);
    expect(
      (await auditRows(f.orgId, 'member.role_changed', f.ids.o)).length +
        (await auditRows(f.orgId, 'member.role_changed', f.ids.b)).length,
    ).toBe(2 /* the owner grant to B above plus the one winning demotion */);
  });

  it('BR-8, BR-10: a role change queued behind the removal of the same member finds no member and writes nothing', async () => {
    const f = await buildCast('mr-after-rm');
    const r = await roleIdsOf(t, f.o, f.orgId);
    await changeRole(t, f.o, f.orgId, f.ids.v, r.owner);
    const accO = await accessOf(f.orgId, f.ids.o);
    const accP = await accessOf(f.orgId, f.ids.v);
    const service = t.app.get(MembersService, { strict: false });
    const hold = await holdOwnerLock(f.orgId);
    const base = await lockWaiters();
    const removal = service.remove(accO, f.orgId, f.ids.b);
    await waitForWaiters(base, 1);
    const change = service.updateRole(accP, f.orgId, f.ids.b, r.admin);
    await waitForWaiters(base, 2);
    await hold.release();
    await expect(removal).resolves.toBeUndefined();
    await expect(change).rejects.toBeInstanceOf(NotFoundException);
    expect(await memberCount(f.orgId, f.ids.b)).toBe(0);
    expect(await assignmentCount(f.orgId, f.ids.b)).toBe(0);
    expect(await auditRows(f.orgId, 'member.role_changed', f.ids.b)).toHaveLength(0);
    // invited again as viewer, B holds the viewer role and nothing else
    const inv = await invite(t, f.orgId, 'mr-after-rm-b@dev.local', 'viewer', { type: 'org' });
    const cookie = await loginAs(t, 'mr-after-rm-b');
    expect((await acceptInvite(t, cookie, inv.id)).statusCode).toBe(200);
    expect(await orgScopeRoles(f.orgId, f.ids.b)).toEqual(['viewer']);
  });

  it('logs the change with ids only at info', async () => {
    const f = await buildCast('mr-log');
    const r = await roleIdsOf(t, f.o, f.orgId);
    logLines.length = 0;
    expect((await changeRole(t, f.o, f.orgId, f.ids.b, r.admin)).statusCode).toBe(200);
    const line = logLines.find((l) => l['action'] === 'member.role_changed' && l['level'] === 30);
    expect(line).toMatchObject({ orgId: f.orgId, actorUserId: f.ids.o, targetUserId: f.ids.b });
    expect(JSON.stringify(logLines)).not.toContain('@dev.local');
  });
});

async function memberCount(orgId: string, userId: string): Promise<number> {
  return withOrg(t.db, orgId, async (tx) => {
    const rows = await tx
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)));
    return rows.length;
  });
}

async function assignmentCount(orgId: string, userId: string): Promise<number> {
  return withOrg(t.db, orgId, async (tx) => {
    const rows = await tx
      .select({ id: roleAssignments.id })
      .from(roleAssignments)
      .where(and(eq(roleAssignments.orgId, orgId), eq(roleAssignments.userId, userId)));
    return rows.length;
  });
}

describe('removing a member', () => {
  it('BR-6: an owner removes a member; every assignment goes, access ends and one audit row lists them', async () => {
    const f = await buildCast('rm-ok');
    // B reaches the org's projects through the two project grants, until the removal
    const before = await t.app.inject({ method: 'GET', url: '/api/projects', headers: { cookie: f.b } });
    expect(before.statusCode).toBe(200);
    expect(before.json<{ total: number }>().total).toBe(2);
    expect(await assignmentCount(f.orgId, f.ids.b)).toBe(2);
    const res = await removeMember(t, f.o, f.orgId, f.ids.b);
    expect(res.statusCode).toBe(204);
    expect(await memberCount(f.orgId, f.ids.b)).toBe(0);
    expect(await assignmentCount(f.orgId, f.ids.b)).toBe(0);
    const after = await t.app.inject({ method: 'GET', url: '/api/projects', headers: { cookie: f.b } });
    expect(after.statusCode).toBe(403);
    const rows = await auditRows(f.orgId, 'member.removed', f.ids.b);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorUserId).toBe(f.ids.o);
    expect(rows[0]?.payload).toMatchObject({
      from: [
        expect.objectContaining({ roleKey: 'member', scope: 'project' }),
        expect.objectContaining({ roleKey: 'member', scope: 'project' }),
      ],
    });
    expect(JSON.stringify(rows[0]?.payload)).not.toContain('@dev.local');
  });

  it('BR-7: the removed member keeps their run with its status and owner', async () => {
    const f = await buildCast('rm-run');
    const runId = await withOrg(t.db, f.orgId, async (tx) => {
      const [row] = await tx
        .insert(runs)
        .values({
          orgId: f.orgId,
          projectId: f.p1,
          command: 'fix',
          skillName: 'fix',
          ticketRef: 'rm-run-1',
          ticketKind: 'issue',
          checkoutRef: 'refs/heads/main',
          triggerSource: 'webhook',
          status: 'running',
          ownerUserId: f.ids.b,
        })
        .returning({ id: runs.id });
      return row?.id ?? '';
    });
    expect((await removeMember(t, f.o, f.orgId, f.ids.b)).statusCode).toBe(204);
    const [run] = await withOrg(t.db, f.orgId, (tx) =>
      tx
        .select({ status: runs.status, ownerUserId: runs.ownerUserId })
        .from(runs)
        .where(and(eq(runs.orgId, f.orgId), eq(runs.id, runId))),
    );
    expect(run).toEqual({ status: 'running', ownerUserId: f.ids.b });
  });

  it('BR-41: removing another owner is 204 with two owners, and again with three', async () => {
    const f = await buildCast('rm-owners');
    const r = await roleIdsOf(t, f.o, f.orgId);
    await changeRole(t, f.o, f.orgId, f.ids.b, r.owner);
    expect((await removeMember(t, f.o, f.orgId, f.ids.b)).statusCode).toBe(204);
    await changeRole(t, f.o, f.orgId, f.ids.v, r.owner);
    await changeRole(t, f.o, f.orgId, f.ids.a, r.owner);
    expect((await removeMember(t, f.o, f.orgId, f.ids.v)).statusCode).toBe(204);
    expect((await removeMember(t, f.o, f.orgId, f.ids.a)).statusCode).toBe(204);
    expect(await orgScopeRoles(f.orgId, f.ids.o)).toEqual(['owner']);
  });

  it('BR-5, NO-1: A removes B while B demotes A leaves one owner and exactly one refusal', async () => {
    const f = await buildCast('rm-race');
    const r = await roleIdsOf(t, f.o, f.orgId);
    await changeRole(t, f.o, f.orgId, f.ids.b, r.owner);
    const res = await Promise.all([
      removeMember(t, f.o, f.orgId, f.ids.b),
      changeRole(t, f.b, f.orgId, f.ids.o, r.admin),
    ]);
    const codes = res.map((x) => x.statusCode);
    // the loser is 409 (it passed the guard before the winner committed) or 403 (its access was already gone)
    expect(codes.filter((c) => c === 204 || c === 200)).toHaveLength(1);
    expect(codes.filter((c) => c === 409 || c === 403)).toHaveLength(1);
    const owners = [...(await orgScopeRoles(f.orgId, f.ids.o)), ...(await orgScopeRoles(f.orgId, f.ids.b))].filter(
      (k) => k === 'owner',
    );
    expect(owners).toHaveLength(1);
  });

  it('BR-5, NO-1 (b): both passed the guard, A removes B while B demotes A; exactly one 409, one owner left', async () => {
    const f = await buildCast('rm-race-svc');
    const r = await roleIdsOf(t, f.o, f.orgId);
    await changeRole(t, f.o, f.orgId, f.ids.b, r.owner);
    const accO = await accessOf(f.orgId, f.ids.o);
    const accB = await accessOf(f.orgId, f.ids.b);
    const service = t.app.get(MembersService, { strict: false });
    const res = await queueBehindOwnerLock(f.orgId, [
      () => service.remove(accO, f.orgId, f.ids.b),
      () => service.updateRole(accB, f.orgId, f.ids.o, r.admin),
    ]);
    expect(res.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const lost = res.filter((x): x is PromiseRejectedResult => x.status === 'rejected');
    expect(lost).toHaveLength(1);
    expect(lost[0]?.reason).toBeInstanceOf(ConflictProblemException);
    const owners = [...(await orgScopeRoles(f.orgId, f.ids.o)), ...(await orgScopeRoles(f.orgId, f.ids.b))].filter(
      (k) => k === 'owner',
    );
    expect(owners).toHaveLength(1);
  });

  it('BR-8: two removals of the same member queued on the owner lock give one 204 and one 404, one audit row', async () => {
    const f = await buildCast('rm-twice');
    const r = await roleIdsOf(t, f.o, f.orgId);
    await changeRole(t, f.o, f.orgId, f.ids.v, r.owner);
    const accO = await accessOf(f.orgId, f.ids.o);
    const accP = await accessOf(f.orgId, f.ids.v);
    const service = t.app.get(MembersService, { strict: false });
    const hold = await holdOwnerLock(f.orgId);
    const base = await lockWaiters();
    const first = service.remove(accO, f.orgId, f.ids.b);
    await waitForWaiters(base, 1);
    const second = service.remove(accP, f.orgId, f.ids.b);
    await waitForWaiters(base, 2);
    await hold.release();
    await expect(first).resolves.toBeUndefined();
    await expect(second).rejects.toBeInstanceOf(NotFoundException);
    expect(await auditRows(f.orgId, 'member.removed', f.ids.b)).toHaveLength(1);
  });

  it('BR-8: in an org without an owner, two admins removing the same member give one 204 and one 404, one audit row', async () => {
    const f = await buildOwnerlessCast('rm-twice-noowner');
    const accA = await accessOf(f.orgId, f.ids.a);
    const accV = await accessOf(f.orgId, f.ids.v);
    const service = t.app.get(MembersService, { strict: false });
    const hold = await holdMemberLock(f.orgId, f.ids.b);
    const base = await lockWaiters();
    const first = service.remove(accA, f.orgId, f.ids.b);
    await queuedOrSettled(base, 1, first);
    const second = service.remove(accV, f.orgId, f.ids.b);
    await queuedOrSettled(base, 2, second);
    await hold.release();
    const settled = await Promise.allSettled([first, second]);
    expect(settled.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect((settled[1] as PromiseRejectedResult).reason).toBeInstanceOf(NotFoundException);
    expect(await auditRows(f.orgId, 'member.removed', f.ids.b)).toHaveLength(1);
    expect(await memberCount(f.orgId, f.ids.b)).toBe(0);
  });

  it('BR-8, BR-10: in an org without an owner, a role change racing the removal of the same member leaves no assignment behind', async () => {
    const f = await buildOwnerlessCast('rm-vs-role-noowner');
    const r = await withOrg(t.db, f.orgId, async (tx) => {
      const rows = await tx.select({ id: roles.id, key: roles.key }).from(roles).where(eq(roles.orgId, f.orgId));
      return Object.fromEntries(rows.map((x) => [x.key, x.id]));
    });
    const accA = await accessOf(f.orgId, f.ids.a);
    const accV = await accessOf(f.orgId, f.ids.v);
    const service = t.app.get(MembersService, { strict: false });
    const hold = await holdMemberLock(f.orgId, f.ids.b);
    const base = await lockWaiters();
    const removal = service.remove(accA, f.orgId, f.ids.b);
    await queuedOrSettled(base, 1, removal);
    const change = service.updateRole(accV, f.orgId, f.ids.b, r['admin'] ?? '');
    await queuedOrSettled(base, 2, change);
    await hold.release();
    await expect(removal).resolves.toBeUndefined();
    await expect(change).rejects.toBeInstanceOf(NotFoundException);
    expect(await memberCount(f.orgId, f.ids.b)).toBe(0);
    expect(await assignmentCount(f.orgId, f.ids.b)).toBe(0);
    expect(await auditRows(f.orgId, 'member.role_changed', f.ids.b)).toHaveLength(0);
  });

  it('BR-5: an org admin cannot remove the only owner, and nothing changes', async () => {
    const f = await buildCast('rm-last');
    const oa = await inviteAndLogin(t, f.orgId, 'rm-last-oa', 'admin', { type: 'org' });
    expect((await removeMember(t, oa, f.orgId, f.ids.o)).statusCode).toBe(403);
    expect(await orgScopeRoles(f.orgId, f.ids.o)).toEqual(['owner']);
    expect(await memberCount(f.orgId, f.ids.o)).toBe(1);
  });

  it('NO-2: an owner and an org admin removing themselves get 403 and nothing changes', async () => {
    const f = await buildCast('rm-self');
    const oa = await inviteAndLogin(t, f.orgId, 'rm-self-oa', 'admin', { type: 'org' });
    const oaId = await userIdOf(t, 'rm-self-oa');
    expect((await removeMember(t, f.o, f.orgId, f.ids.o)).statusCode).toBe(403);
    expect((await removeMember(t, oa, f.orgId, oaId)).statusCode).toBe(403);
    expect(await memberCount(f.orgId, f.ids.o)).toBe(1);
    expect(await memberCount(f.orgId, oaId)).toBe(1);
    expect(await auditRows(f.orgId, 'member.removed', f.ids.o)).toHaveLength(0);
  });

  it('BR-18: member, viewer and a project admin get 403 for any user id; an org admin cannot remove an owner', async () => {
    const f = await buildCast('rm-403');
    for (const cookie of [f.b, f.v, f.a]) {
      for (const id of [randomUUID(), 'not-a-uuid', f.ids.v]) {
        expect((await removeMember(t, cookie, f.orgId, id)).statusCode).toBe(403);
      }
    }
    const orgAdmin = await inviteAndLogin(t, f.orgId, 'rm-403-oa', 'admin', { type: 'org' });
    expect((await removeMember(t, orgAdmin, f.orgId, f.ids.o)).statusCode).toBe(403);
    expect(await memberCount(f.orgId, f.ids.o)).toBe(1);
    expect(await memberCount(f.orgId, f.ids.v)).toBe(1);
  });

  it('BR-8: removing a user who is not a member is 404', async () => {
    const f = await buildCast('rm-gone');
    const res = await removeMember(t, f.o, f.orgId, randomUUID());
    expect(res.statusCode).toBe(404);
    expect(res.json<{ detail: string }>().detail).toBe(NOT_A_MEMBER);
    expect((await removeMember(t, f.o, f.orgId, f.ids.b)).statusCode).toBe(204);
    expect((await removeMember(t, f.o, f.orgId, f.ids.b)).statusCode).toBe(404);
  });

  it('BR-10: a removed member invited again as viewer has exactly one org viewer role and no project role', async () => {
    const f = await buildCast('rm-again');
    expect((await removeMember(t, f.o, f.orgId, f.ids.b)).statusCode).toBe(204);
    const inv = await invite(t, f.orgId, 'rm-again-b@dev.local', 'viewer', { type: 'org' });
    const cookie = await loginAs(t, 'rm-again-b');
    expect((await acceptInvite(t, cookie, inv.id)).statusCode).toBe(200);
    expect(await orgScopeRoles(f.orgId, f.ids.b)).toEqual(['viewer']);
    expect(await projectRoleCount(f.orgId, f.ids.b)).toBe(0);
    expect(await memberCount(f.orgId, f.ids.b)).toBe(1);
  });

  it('BR-25: an owner of one org removing a member of another org is 404 and changes nothing', async () => {
    const f = await buildCast('rm-iso');
    const other = await buildCast('rm-iso-other');
    const res = await t.app.inject({
      method: 'DELETE',
      url: `/api/orgs/${other.orgId}/members/${other.ids.b}`,
      headers: { cookie: f.o, 'x-org-id': f.orgId },
    });
    expect(res.statusCode).toBe(404);
    expect(await memberCount(other.orgId, other.ids.b)).toBe(1);
    expect(await assignmentCount(other.orgId, other.ids.b)).toBe(2);
  });

  it('logs the removal with ids only at info', async () => {
    const f = await buildCast('rm-log');
    logLines.length = 0;
    expect((await removeMember(t, f.o, f.orgId, f.ids.b)).statusCode).toBe(204);
    const line = logLines.find((l) => l['action'] === 'member.removed' && l['level'] === 30);
    expect(line).toMatchObject({ orgId: f.orgId, actorUserId: f.ids.o, targetUserId: f.ids.b });
    expect(JSON.stringify(logLines)).not.toContain('@dev.local');
  });
});

describe('searching members and leaving out a project', () => {
  const handles = (res: { json: () => unknown }) => (res.json() as Page<MemberDto>).items.map((i) => i.handle);

  async function rename(handle: string, name: string): Promise<void> {
    await t.db.pool.query('update "user" set name = $1 where handle = $2', [name, handle]);
  }

  it('N-FILTER: excludeProject leaves out the project members, and total counts only eligible people', async () => {
    const f = await buildCast('mem-ex');
    const res = await memberSearch(t, f.o, f.orgId, { excludeProject: f.p1 });
    expect(res.statusCode).toBe(200);
    const page = expectContract('members.list', res) as Page<MemberDto>;
    expect(page.items.map((i) => i.handle)).toEqual(['mem-ex-n', 'mem-ex-o', 'mem-ex-v']);
    expect(page.total).toBe(3);
    expect(JSON.stringify(page)).not.toContain('email');
    // a project admin on P1 may use the filter on P1
    expect((await memberSearch(t, f.a, f.orgId, { excludeProject: f.p1 })).statusCode).toBe(200);
  });

  it('N-FILTER: the exclusion happens before paging', async () => {
    const f = await buildCast('mem-expage');
    for (let i = 0; i < 24; i++) {
      await inviteAndLogin(t, f.orgId, `mem-expage-x${String(i).padStart(2, '0')}`, 'viewer', { type: 'org' });
    }
    const first = (await memberSearch(t, f.o, f.orgId, { excludeProject: f.p1, pageSize: 20 })).json<Page<MemberDto>>();
    const second = (await memberSearch(t, f.o, f.orgId, { excludeProject: f.p1, pageSize: 20, page: 2 })).json<
      Page<MemberDto>
    >();
    expect(first.total).toBe(27);
    expect(second.total).toBe(27);
    expect(first.items).toHaveLength(20);
    expect(second.items).toHaveLength(7);
  });

  it('BR-24: q is optional, trimmed, bounded to 1 to 100 characters and answers 400 /q otherwise', async () => {
    const f = await buildCast('mem-qlen');
    expect(handles(await memberSearch(t, f.o, f.orgId, {}))).toHaveLength(5);
    for (const q of ['', '   ', 'a'.repeat(101)]) {
      const res = await memberSearch(t, f.o, f.orgId, { q });
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('/q');
    }
    expect((await memberSearch(t, f.o, f.orgId, { q: 'a' })).statusCode).toBe(200);
    expect((await memberSearch(t, f.o, f.orgId, { q: 'a'.repeat(100) })).statusCode).toBe(200);
  });

  it('BR-24: q matches name and handle case-insensitively', async () => {
    const f = await buildCast('mem-qci');
    await rename('mem-qci-b', 'Alice Wonder');
    expect(handles(await memberSearch(t, f.o, f.orgId, { q: 'ali' }))).toEqual(['mem-qci-b']);
    expect(handles(await memberSearch(t, f.o, f.orgId, { q: 'WONDER' }))).toEqual(['mem-qci-b']);
    expect(handles(await memberSearch(t, f.o, f.orgId, { q: 'MEM-QCI-V' }))).toEqual(['mem-qci-v']);
    const page = (await memberSearch(t, f.o, f.orgId, { q: 'ali' })).json<Page<MemberDto>>();
    expect(page.total).toBe(1);
  });

  it('BR-24: percent, underscore and backslash match only literally', async () => {
    const f = await buildCast('mem-qesc');
    await rename('mem-qesc-a', '100% sure');
    await rename('mem-qesc-b', 'snake_case');
    await rename('mem-qesc-v', 'back\\slash');
    expect(handles(await memberSearch(t, f.o, f.orgId, { q: '%' }))).toEqual(['mem-qesc-a']);
    expect(handles(await memberSearch(t, f.o, f.orgId, { q: 'e_c' }))).toEqual(['mem-qesc-b']);
    expect(handles(await memberSearch(t, f.o, f.orgId, { q: '\\' }))).toEqual(['mem-qesc-v']);
    expect(handles(await memberSearch(t, f.o, f.orgId, { q: 'snake.case' }))).toEqual([]);
  });

  it('BR-24: q combines with excludeProject', async () => {
    const f = await buildCast('mem-qcomb');
    expect(handles(await memberSearch(t, f.o, f.orgId, { q: 'mem-qcomb-', excludeProject: f.p1 }))).toEqual([
      'mem-qcomb-n',
      'mem-qcomb-o',
      'mem-qcomb-v',
    ]);
    expect(handles(await memberSearch(t, f.o, f.orgId, { q: 'mem-qcomb-a', excludeProject: f.p1 }))).toEqual([]);
  });

  it('BR-7: a project out of scope, unknown or in another org is one identical 404', async () => {
    const f = await buildCast('mem-ex404');
    const other = await buildCast('mem-ex404-o');
    const bodies = new Set<string>();
    for (const id of [f.p2, randomUUID(), other.p1]) {
      const res = await memberSearch(t, f.a, f.orgId, { excludeProject: id });
      expect(res.statusCode).toBe(404);
      const { title, detail, status } = res.json<{ title: string; detail: string; status: number }>();
      bodies.add(JSON.stringify({ title, detail, status }));
    }
    expect(bodies.size).toBe(1);
    expect((await memberSearch(t, f.o, f.orgId, { excludeProject: other.p1 })).statusCode).toBe(404);
  });

  it('BR-7: a malformed project id is refused by the contract with 400 /excludeProject', async () => {
    const f = await buildCast('mem-ex400');
    const res = await memberSearch(t, f.a, f.orgId, { excludeProject: 'nope' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('/excludeProject');
  });

  it('BR-7: members and viewers get 403 from the base guard, before any project lookup', async () => {
    const f = await buildCast('mem-ex403');
    const other = await buildCast('mem-ex403-o');
    const p2member = await inviteAndLogin(t, f.orgId, 'mem-ex403-p2', 'member', {
      type: 'project',
      projectIds: [f.p2],
    });
    for (const cookie of [p2member, f.b, f.v]) {
      for (const id of [f.p1, f.p2, randomUUID(), other.p1]) {
        expect((await memberSearch(t, cookie, f.orgId, { excludeProject: id })).statusCode).toBe(403);
      }
    }
  });

  it('BR-7: admin on one project and plain member on the filtered one gets 403 there, 200 on their own', async () => {
    const f = await buildCast('mem-ex403b');
    const mixed = await inviteAndLogin(t, f.orgId, 'mem-ex403b-m', 'admin', { type: 'project', projectIds: [f.p1] });
    await grant(t, f.orgId, await userIdOf(t, 'mem-ex403b-m'), 'member', { type: 'project', projectId: f.p2 });
    expect((await memberSearch(t, mixed, f.orgId, { excludeProject: f.p2 })).statusCode).toBe(403);
    expect((await memberSearch(t, mixed, f.orgId, { excludeProject: f.p1 })).statusCode).toBe(200);
  });

  it('BR-7: the filter never adds assignments the caller could not see without it', async () => {
    const f = await buildCast('mem-exsame');
    const plain = (await memberSearch(t, f.a, f.orgId, {})).json<Page<MemberDto>>();
    const filtered = (await memberSearch(t, f.a, f.orgId, { excludeProject: f.p1 })).json<Page<MemberDto>>();
    const byId = new Map(plain.items.map((i) => [i.userId, i]));
    for (const item of filtered.items) expect(item).toEqual(byId.get(item.userId));
  });
});
