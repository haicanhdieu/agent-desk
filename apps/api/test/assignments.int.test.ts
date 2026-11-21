import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AccessDto, AssignmentDto, Page, RoleDto } from '@agentdesk/contracts';
import { loadAccess } from '@agentdesk/core';
import { connections, projects, roleAssignments, withOrg } from '@agentdesk/db';
import { AssignmentsService } from '../src/assignments/assignments.service';
import { createTestApp, type TestApp } from './helpers/app';
import { asPlatformAdmin, createOrg, inviteAndLogin, userIdOf } from './helpers/auth';
import { expectContract } from './helpers/contract';

let t: TestApp;
let admin: string;

beforeAll(async () => {
  t = await createTestApp();
  admin = await asPlatformAdmin(t);
});
afterAll(async () => {
  await t.close();
});

/** One statement as the app role inside the org's RLS scope. */
async function asOrg(orgId: string, text: string, params: unknown[] = []): Promise<{ rows: QueryResultRow[] }> {
  const client = await t.db.pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.org_id', $1, true)", [orgId]);
    const res = await client.query(text, params);
    await client.query('commit');
    return res;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

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

async function roleIds(orgId: string): Promise<Record<string, string>> {
  const res = await t.app.inject({
    method: 'GET',
    url: `/api/platform/orgs/${orgId}/roles`,
    headers: { cookie: admin },
  });
  return Object.fromEntries(res.json<RoleDto[]>().map((r) => [r.key, r.id]));
}

interface Cast {
  orgId: string;
  roles: Record<string, string>;
  p1: string;
  p2: string;
  /** cookies */
  o: string;
  d: string;
  a: string;
  b: string;
  v: string;
  c: string;
  /** user ids */
  ids: { o: string; d: string; a: string; b: string; v: string; c: string };
}

/**
 * Owner O, org admin D, A admin on P1, B member on P1 and P2, V viewer on the org, C member on P1.
 * Every cast has its own org and handles, so the tests do not see each other's assignments.
 */
async function buildCast(slug: string): Promise<Cast> {
  const org = await createOrg(t, slug, slug);
  const p1 = await seedProject(org.id, `P1-${slug}`);
  const p2 = await seedProject(org.id, `P2-${slug}`);
  const h = (n: string) => `${slug}-${n}`;
  const o = await inviteAndLogin(t, org.id, h('o'), 'owner', { type: 'org' });
  const d = await inviteAndLogin(t, org.id, h('d'), 'admin', { type: 'org' });
  const a = await inviteAndLogin(t, org.id, h('a'), 'admin', { type: 'project', projectIds: [p1] });
  const b = await inviteAndLogin(t, org.id, h('b'), 'member', { type: 'project', projectIds: [p1, p2] });
  const v = await inviteAndLogin(t, org.id, h('v'), 'viewer', { type: 'org' });
  const c = await inviteAndLogin(t, org.id, h('c'), 'member', { type: 'project', projectIds: [p1] });
  return {
    orgId: org.id,
    roles: await roleIds(org.id),
    p1,
    p2,
    o,
    d,
    a,
    b,
    v,
    c,
    ids: {
      o: await userIdOf(t, h('o')),
      d: await userIdOf(t, h('d')),
      a: await userIdOf(t, h('a')),
      b: await userIdOf(t, h('b')),
      v: await userIdOf(t, h('v')),
      c: await userIdOf(t, h('c')),
    },
  };
}

function grant(orgId: string, cookie: string, payload: unknown) {
  return t.app.inject({
    method: 'POST',
    url: `/api/orgs/${orgId}/assignments`,
    headers: { cookie },
    payload: payload as object,
  });
}

function list(orgId: string, cookie: string, query = '') {
  return t.app.inject({ method: 'GET', url: `/api/orgs/${orgId}/assignments${query}`, headers: { cookie } });
}

async function rowCount(orgId: string, userId: string, roleId: string): Promise<number> {
  const res = await asOrg(
    orgId,
    'select count(*)::int as n from role_assignments where org_id = $1 and user_id = $2 and role_id = $3',
    [orgId, userId, roleId],
  );
  return Number(res.rows[0]?.n);
}

/** Invitation acceptance writes `assignment.granted` too, so count only this user and role. */
async function grantedAuditCount(orgId: string, userId: string, roleId: string): Promise<number> {
  const res = await asOrg(
    orgId,
    "select count(*)::int as n from audit_log where action = 'assignment.granted' and target_id = $1 and payload->'to'->>'roleId' = $2",
    [userId, roleId],
  );
  return Number(res.rows[0]?.n);
}

function pointerOf(res: { json: () => unknown }): string | undefined {
  return (res.json() as { errors?: { pointer: string }[] }).errors?.[0]?.pointer;
}

describe('BR-36: grants refused outside the caller rights', () => {
  it('refuses a member and a viewer, and a project admin granting on another project', async () => {
    const f = await buildCast('as-br36');
    const body = (p: string) => ({ userId: f.ids.c, roleId: f.roles.member, scope: { type: 'project', projectId: p } });
    expect((await grant(f.orgId, f.b, body(f.p1))).statusCode).toBe(403);
    expect((await grant(f.orgId, f.v, body(f.p1))).statusCode).toBe(403);
    const res = await grant(f.orgId, f.a, body(f.p2));
    expect(res.statusCode).toBe(403);
    expect((res.json() as { detail: string }).detail).toBe('Not allowed for your role here');
    expect(await rowCount(f.orgId, f.ids.c, f.roles.member)).toBe(1);
  });

  it('answers a project admin 403 for another project whether or not it exists (nothing about it leaks)', async () => {
    const f = await buildCast('as-br36-leak');
    const missing = await grant(f.orgId, f.a, {
      userId: f.ids.c,
      roleId: f.roles.member,
      scope: { type: 'project', projectId: randomUUID() },
    });
    expect(missing.statusCode).toBe(403);
  });
});

describe('BR-37: grant validation', () => {
  it('answers 422 with a pointer for a bad role, scope, project or user and 400 for a malformed body', async () => {
    const f = await buildCast('as-br37');
    const other = await createOrg(t, 'as-br37-other', 'as-br37-other');
    const otherRoles = await roleIds(other.id);
    const otherProject = await seedProject(other.id, 'Foreign');
    const outsider = await inviteAndLogin(t, other.id, 'as-br37-outsider', 'viewer', { type: 'org' });
    expect(outsider).not.toBe('');
    const outsiderId = await userIdOf(t, 'as-br37-outsider');
    const org = { type: 'org' };
    const send = (payload: unknown) => grant(f.orgId, f.o, payload);

    const unknownRole = await send({ userId: f.ids.c, roleId: randomUUID(), scope: org });
    expect(unknownRole.statusCode).toBe(422);
    expect(pointerOf(unknownRole)).toBe('/roleId');

    const foreignRole = await send({ userId: f.ids.c, roleId: otherRoles.viewer, scope: org });
    expect(foreignRole.statusCode).toBe(422);
    expect(pointerOf(foreignRole)).toBe('/roleId');

    const ownerOnProject = await send({
      userId: f.ids.c,
      roleId: f.roles.owner,
      scope: { type: 'project', projectId: f.p1 },
    });
    expect(ownerOnProject.statusCode).toBe(422);
    expect(pointerOf(ownerOnProject)).toBe('/roleId');

    const foreignProject = await send({
      userId: f.ids.c,
      roleId: f.roles.viewer,
      scope: { type: 'project', projectId: otherProject },
    });
    expect(foreignProject.statusCode).toBe(422);
    expect(pointerOf(foreignProject)).toBe('/scope/projectId');

    const unknownUser = await send({ userId: 'no-such-user', roleId: f.roles.viewer, scope: org });
    expect(unknownUser.statusCode).toBe(422);
    expect(pointerOf(unknownUser)).toBe('/userId');

    const nonMember = await send({ userId: outsiderId, roleId: f.roles.viewer, scope: org });
    expect(nonMember.statusCode).toBe(422);
    expect(pointerOf(nonMember)).toBe('/userId');

    expect((await send({ userId: f.ids.c, scope: org })).statusCode).toBe(400);
    expect((await send({ userId: f.ids.c, roleId: 'nope', scope: org })).statusCode).toBe(400);
    expect((await send({ userId: f.ids.c, roleId: f.roles.viewer, scope: { type: 'team' } })).statusCode).toBe(400);
  });

  it('answers 404 for another org id in the path', async () => {
    const f = await buildCast('as-br37-path');
    const res = await grant(randomUUID(), f.o, { userId: f.ids.c, roleId: f.roles.viewer, scope: { type: 'org' } });
    expect(res.statusCode).toBe(404);
    const other = await createOrg(t, 'as-br37-path-other', 'as-br37-path-other');
    const foreign = await grant(other.id, f.o, { userId: f.ids.c, roleId: f.roles.viewer, scope: { type: 'org' } });
    expect(foreign.statusCode).toBe(404);
  });
});

describe('BR-41: the same grant twice', () => {
  it('answers 201 then 200 with the same id and keeps one row', async () => {
    const f = await buildCast('as-br41');
    const payload = { userId: f.ids.c, roleId: f.roles.viewer, scope: { type: 'project', projectId: f.p1 } };
    const first = await grant(f.orgId, f.o, payload);
    expect(first.statusCode).toBe(201);
    const second = await grant(f.orgId, f.o, payload);
    expect(second.statusCode).toBe(200);
    const one = expectContract('assignments.create', first) as AssignmentDto;
    const two = expectContract('assignments.create', second) as AssignmentDto;
    expect(two.id).toBe(one.id);
    expect(await rowCount(f.orgId, f.ids.c, f.roles.viewer)).toBe(1);
    expect(await grantedAuditCount(f.orgId, f.ids.c, f.roles.viewer)).toBe(1);
  });

  it('two concurrent identical grants give 201 and 200 and one row', async () => {
    const f = await buildCast('as-br41-race');
    const payload = { userId: f.ids.c, roleId: f.roles.viewer, scope: { type: 'org' } };
    const [x, y] = await Promise.all([grant(f.orgId, f.o, payload), grant(f.orgId, f.o, payload)]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([200, 201]);
    expect((x.json() as AssignmentDto).id).toBe((y.json() as AssignmentDto).id);
    expect(await rowCount(f.orgId, f.ids.c, f.roles.viewer)).toBe(1);
    expect(await grantedAuditCount(f.orgId, f.ids.c, f.roles.viewer)).toBe(1);
  });
});

describe('BR-45: org owner and admin grants', () => {
  it('lets an owner grant admin at org so the next request works, and grant owner', async () => {
    const f = await buildCast('as-br45');
    expect((await list(f.orgId, f.v)).statusCode).toBe(403);
    const toAdmin = await grant(f.orgId, f.o, { userId: f.ids.v, roleId: f.roles.admin, scope: { type: 'org' } });
    expect(toAdmin.statusCode).toBe(201);
    expect((await list(f.orgId, f.v)).statusCode).toBe(200);
    const toOwner = await grant(f.orgId, f.o, { userId: f.ids.a, roleId: f.roles.owner, scope: { type: 'org' } });
    expect(toOwner.statusCode).toBe(201);
    expect((await list(f.orgId, f.a)).statusCode).toBe(200);
  });

  it('refuses an org admin granting owner and leaves no row', async () => {
    const f = await buildCast('as-br45-owner');
    const res = await grant(f.orgId, f.d, { userId: f.ids.c, roleId: f.roles.owner, scope: { type: 'org' } });
    expect(res.statusCode).toBe(403);
    expect(await rowCount(f.orgId, f.ids.c, f.roles.owner)).toBe(0);
  });

  it('refuses a grant whose role holds permissions the grantor lacks at that scope', async () => {
    const f = await buildCast('as-br45-escalation');
    // A project admin may not hand out org scope; an org admin may not grant owner (covered above).
    const res = await grant(f.orgId, f.a, { userId: f.ids.c, roleId: f.roles.viewer, scope: { type: 'org' } });
    expect(res.statusCode).toBe(403);
    expect(await rowCount(f.orgId, f.ids.c, f.roles.viewer)).toBe(0);
  });
});

describe('BR-61: project admin grants on their own project', () => {
  it('grants member, admin and viewer on P1 but not on P2 or at org', async () => {
    const f = await buildCast('as-br61');
    for (const key of ['member', 'admin', 'viewer']) {
      const res = await grant(f.orgId, f.a, {
        userId: f.ids.v,
        roleId: f.roles[key],
        scope: { type: 'project', projectId: f.p1 },
      });
      expect(res.statusCode, key).toBe(201);
    }
    const onP2 = await grant(f.orgId, f.a, {
      userId: f.ids.v,
      roleId: f.roles.member,
      scope: { type: 'project', projectId: f.p2 },
    });
    expect(onP2.statusCode).toBe(403);
    const atOrg = await grant(f.orgId, f.a, { userId: f.ids.v, roleId: f.roles.member, scope: { type: 'org' } });
    expect(atOrg.statusCode).toBe(403);
    const owner = await grant(f.orgId, f.a, {
      userId: f.ids.v,
      roleId: f.roles.owner,
      scope: { type: 'project', projectId: f.p1 },
    });
    expect(owner.statusCode).toBe(422);
  });
});

describe('BR-64: listing assignments', () => {
  it('lists everything for an owner and an org admin', async () => {
    const f = await buildCast('as-br64-all');
    for (const cookie of [f.o, f.d]) {
      const res = await list(f.orgId, cookie);
      expect(res.statusCode).toBe(200);
      const page = expectContract('assignments.list', res) as Page<AssignmentDto>;
      expect(page.total).toBe(7);
      expect(page.items.map((i) => i.userId).sort()).toEqual(
        [f.ids.o, f.ids.d, f.ids.a, f.ids.b, f.ids.b, f.ids.v, f.ids.c].sort(),
      );
    }
  });

  it('filters by project for an org-level reader and 404s a project that is not in the org', async () => {
    const f = await buildCast('as-br64-filter');
    const res = await list(f.orgId, f.o, `?projectId=${f.p2}`);
    const page = expectContract('assignments.list', res) as Page<AssignmentDto>;
    expect(page.items.map((i) => i.userId)).toEqual([f.ids.b]);
    expect((await list(f.orgId, f.o, `?projectId=${randomUUID()}`)).statusCode).toBe(404);
  });

  it('shows a project admin only their project, with and without projectId', async () => {
    const f = await buildCast('as-br64-a');
    const expected = [f.ids.a, f.ids.b, f.ids.c].sort();
    for (const query of ['', `?projectId=${f.p1}`]) {
      const res = await list(f.orgId, f.a, query);
      expect(res.statusCode).toBe(200);
      const page = expectContract('assignments.list', res) as Page<AssignmentDto>;
      expect(page.total).toBe(3);
      expect(page.items.map((i) => i.userId).sort()).toEqual(expected);
      expect(page.items.every((i) => i.scope.type === 'project' && i.scope.projectId === f.p1)).toBe(true);
    }
    expect((await list(f.orgId, f.a, `?projectId=${f.p2}`)).statusCode).toBe(404);
  });

  it('refuses a member and a viewer', async () => {
    const f = await buildCast('as-br64-b');
    expect((await list(f.orgId, f.b)).statusCode).toBe(403);
    expect((await list(f.orgId, f.v)).statusCode).toBe(403);
  });

  it('pages the list', async () => {
    const f = await buildCast('as-br64-page');
    const res = await list(f.orgId, f.o, '?page=2&pageSize=5');
    const page = expectContract('assignments.list', res) as Page<AssignmentDto>;
    expect(page).toMatchObject({ page: 2, pageSize: 5, total: 7 });
    expect(page.items).toHaveLength(2);
  });
});

describe('N5: the grant audit entry', () => {
  it('records the target user, the role and scope granted, the actor kind, and no from', async () => {
    const f = await buildCast('as-n5');
    const res = await grant(f.orgId, f.a, {
      userId: f.ids.v,
      roleId: f.roles.member,
      scope: { type: 'project', projectId: f.p1 },
    });
    expect(res.statusCode).toBe(201);
    const rows = await asOrg(
      f.orgId,
      "select * from audit_log where action = 'assignment.granted' and target_id = $1 and payload->'to'->>'roleId' = $2",
      [f.ids.v, f.roles.member],
    );
    expect(rows.rows).toHaveLength(1);
    const row = rows.rows[0] as {
      actor_user_id: string;
      target_type: string;
      target_id: string;
      payload: Record<string, unknown>;
    };
    expect(row.actor_user_id).toBe(f.ids.a);
    expect(row.target_type).toBe('user');
    expect(row.target_id).toBe(f.ids.v);
    expect(row.payload).toEqual({
      to: { roleId: f.roles.member, roleKey: 'member', scope: { type: 'project', projectId: f.p1 } },
      actorKind: 'member',
    });
    expect(row.payload).not.toHaveProperty('from');
  });
});

describe('the service with a platform admin actor', () => {
  it('skips the tenant-only rules, grants owner and marks the audit entry as a platform action', async () => {
    const f = await buildCast('as-platform');
    const service = t.app.get(AssignmentsService, { strict: false });
    const adminId = await userIdOf(t, 'admin');
    const actor = { kind: 'platform_admin' as const, userId: adminId };
    const result = await service.grant(actor, f.orgId, {
      userId: f.ids.c,
      roleId: f.roles.owner,
      scope: { type: 'org' },
    });
    expect(result.created).toBe(true);
    expect(result.assignment.grantedBy).toBe(adminId);
    const again = await service.grant(actor, f.orgId, {
      userId: f.ids.c,
      roleId: f.roles.owner,
      scope: { type: 'org' },
    });
    expect(again).toMatchObject({ created: false, assignment: { id: result.assignment.id } });
    const audit = await asOrg(
      f.orgId,
      "select payload from audit_log where action = 'assignment.granted' and target_id = $1 and payload->'to'->>'roleId' = $2",
      [f.ids.c, f.roles.owner],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.payload).toMatchObject({ actorKind: 'platform_admin' });

    const all = await service.list(actor, f.orgId, { page: 1, pageSize: 50 });
    expect(all.total).toBe(8);
    const onP2 = await service.list(actor, f.orgId, { page: 1, pageSize: 50, projectId: f.p2 });
    expect(onP2.items.map((i) => i.userId)).toEqual([f.ids.b]);
    await expect(service.list(actor, f.orgId, { page: 1, pageSize: 50, projectId: randomUUID() })).rejects.toThrow(
      'Project not found',
    );
    await expect(
      service.grant(actor, randomUUID(), { userId: f.ids.c, roleId: f.roles.viewer, scope: { type: 'org' } }),
    ).rejects.toThrow('Organization not found');
  });

  it('lets the service refuse a member whose access lists no assignment:read at all', async () => {
    const f = await buildCast('as-failclosed');
    const service = t.app.get(AssignmentsService, { strict: false });
    await expect(
      service.list({ kind: 'member', access: { userId: f.ids.b, grants: [] } }, f.orgId, { page: 1, pageSize: 20 }),
    ).rejects.toThrow('Not allowed for your role here');
    await expect(
      service.grant({ kind: 'member', access: { userId: f.ids.b, grants: [] } }, f.orgId, {
        userId: f.ids.c,
        roleId: f.roles.viewer,
        scope: { type: 'org' },
      }),
    ).rejects.toThrow('Not allowed for your role here');
  });
});

// ---- revoke, own access and the roles list (Task 19) ----

function revoke(orgId: string, cookie: string, assignmentId: string) {
  return t.app.inject({
    method: 'DELETE',
    url: `/api/orgs/${orgId}/assignments/${assignmentId}`,
    headers: { cookie },
  });
}

function meAccess(cookie: string) {
  return t.app.inject({ method: 'GET', url: '/api/me/access', headers: { cookie } });
}

function rolesOf(orgId: string, cookie: string) {
  return t.app.inject({ method: 'GET', url: `/api/orgs/${orgId}/roles`, headers: { cookie } });
}

/** The id of the one assignment of `userId` with this role key at this project (or the org when `projectId` is null). */
async function assignmentId(f: Cast, userId: string, roleKey: string, projectId: string | null): Promise<string> {
  const res = await asOrg(
    f.orgId,
    `select ra.id from role_assignments ra join roles r on r.org_id = ra.org_id and r.id = ra.role_id
      where ra.org_id = $1 and ra.user_id = $2 and r.key = $3 and ra.project_id is not distinct from $4`,
    [f.orgId, userId, roleKey, projectId],
  );
  const id = res.rows[0]?.id;
  if (typeof id !== 'string') throw new Error(`no ${roleKey} assignment for ${userId}`);
  return id;
}

async function assignmentRows(orgId: string, id: string): Promise<number> {
  const res = await asOrg(orgId, 'select count(*)::int as n from role_assignments where id = $1', [id]);
  return Number(res.rows[0]?.n);
}

describe('BR-36: revokes refused outside the caller rights', () => {
  it('refuses a member on a peer and a project admin on another project, and keeps the rows', async () => {
    const f = await buildCast('as-br36-revoke');
    const cOnP1 = await assignmentId(f, f.ids.c, 'member', f.p1);
    const bOnP2 = await assignmentId(f, f.ids.b, 'member', f.p2);
    const byMember = await revoke(f.orgId, f.b, cOnP1);
    expect(byMember.statusCode).toBe(403);
    expect((byMember.json() as { detail: string }).detail).toBe('Not allowed for your role here');
    expect((await revoke(f.orgId, f.v, cOnP1)).statusCode).toBe(403);
    expect((await revoke(f.orgId, f.a, bOnP2)).statusCode).toBe(403);
    expect(await assignmentRows(f.orgId, cOnP1)).toBe(1);
    expect(await assignmentRows(f.orgId, bOnP2)).toBe(1);
  });

  it('answers 404 for an assignment that does not exist or belongs to another org', async () => {
    const f = await buildCast('as-br36-missing');
    const other = await buildCast('as-br36-other');
    const foreign = await assignmentId(other, other.ids.c, 'member', other.p1);
    expect((await revoke(f.orgId, f.o, randomUUID())).statusCode).toBe(404);
    expect((await revoke(f.orgId, f.o, foreign)).statusCode).toBe(404);
    expect((await revoke(f.orgId, f.a, randomUUID())).statusCode).toBe(404);
    expect(await assignmentRows(other.orgId, foreign)).toBe(1);
  });
});

describe('BR-45: org owner and admin revokes', () => {
  it('lets an owner revoke a viewer at org and the next request lists nothing', async () => {
    const f = await buildCast('as-br45-revoke');
    const id = await assignmentId(f, f.ids.v, 'viewer', null);
    const res = await revoke(f.orgId, f.o, id);
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(await assignmentRows(f.orgId, id)).toBe(0);
    const access = expectContract('me.access', await meAccess(f.v)) as AccessDto;
    expect(access.assignments).toEqual([]);
    expect((await list(f.orgId, f.v)).statusCode).toBe(403);
  });

  it('refuses an org admin revoking owner and keeps the row', async () => {
    const f = await buildCast('as-br45-revoke-owner');
    const toOwner = await grant(f.orgId, f.o, { userId: f.ids.a, roleId: f.roles.owner, scope: { type: 'org' } });
    expect(toOwner.statusCode).toBe(201);
    const id = await assignmentId(f, f.ids.a, 'owner', null);
    expect((await revoke(f.orgId, f.d, id)).statusCode).toBe(403);
    expect(await assignmentRows(f.orgId, id)).toBe(1);
  });
});

describe('BR-46: the last owner', () => {
  it('refuses an owner revoking the only owner assignment, then allows it with a second owner', async () => {
    const f = await buildCast('as-br46');
    const own = await assignmentId(f, f.ids.o, 'owner', null);
    const refused = await revoke(f.orgId, f.o, own);
    expect(refused.statusCode).toBe(409);
    expect(await assignmentRows(f.orgId, own)).toBe(1);

    const o2 = await inviteAndLogin(t, f.orgId, 'as-br46-o2', 'owner', { type: 'org' });
    expect(o2).not.toBe('');
    const second = await assignmentId(f, await userIdOf(t, 'as-br46-o2'), 'owner', null);
    expect((await revoke(f.orgId, f.o, second)).statusCode).toBe(204);
    expect(await assignmentRows(f.orgId, second)).toBe(0);
    // the first owner is the last one again
    expect((await revoke(f.orgId, f.o, own)).statusCode).toBe(409);
  });

  it('counts the owners after a revoke that commits while it waits, so the last one is kept', async () => {
    const f = await buildCast('as-br46-race');
    await inviteAndLogin(t, f.orgId, 'as-br46-race-o2', 'owner', { type: 'org' });
    const o2Id = await userIdOf(t, 'as-br46-race-o2');
    const first = await assignmentId(f, f.ids.o, 'owner', null);
    const second = await assignmentId(f, o2Id, 'owner', null);
    const service = t.app.get(AssignmentsService, { strict: false });
    // the second owner loaded their access before the other owner's revoke commits
    const o2Actor = {
      kind: 'member' as const,
      access: await withOrg(t.db, f.orgId, (tx) => loadAccess(tx, o2Id)),
    };
    let pending: Promise<void> | undefined;
    await withOrg(t.db, f.orgId, async (tx) => {
      // an uncommitted revoke of the second owner holds that row; the second owner's revoke of the first must wait
      await tx.delete(roleAssignments).where(eq(roleAssignments.id, second));
      pending = service.revoke(o2Actor, f.orgId, first);
      pending.catch(() => undefined);
      for (let i = 0; i < 100; i += 1) {
        const waiting = await t.db.pool.query(
          "select 1 from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()",
        );
        if (waiting.rows.length > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    });
    await expect(pending).rejects.toMatchObject({ status: 409 });
    expect(await assignmentRows(f.orgId, first)).toBe(1);
  });

  it('does not block the revoke of a role other than owner', async () => {
    const f = await buildCast('as-br46-other');
    const id = await assignmentId(f, f.ids.d, 'admin', null);
    expect((await revoke(f.orgId, f.o, id)).statusCode).toBe(204);
  });
});

describe('BR-61: project admin revokes on their own project', () => {
  it('revokes the member role on P1 that the admin granted', async () => {
    const f = await buildCast('as-br61-revoke');
    const granted = await grant(f.orgId, f.a, {
      userId: f.ids.v,
      roleId: f.roles.member,
      scope: { type: 'project', projectId: f.p1 },
    });
    expect(granted.statusCode).toBe(201);
    const id = (granted.json() as AssignmentDto).id;
    expect((await revoke(f.orgId, f.a, id)).statusCode).toBe(204);
    expect(await assignmentRows(f.orgId, id)).toBe(0);
  });

  it('refuses a project admin revoking an org-scope assignment', async () => {
    const f = await buildCast('as-br61-org');
    const id = await assignmentId(f, f.ids.v, 'viewer', null);
    expect((await revoke(f.orgId, f.a, id)).statusCode).toBe(403);
    expect(await assignmentRows(f.orgId, id)).toBe(1);
  });
});

describe('BR-63: own access', () => {
  it('answers 200 with no assignments after the last revoke, then lists a new grant with its lines', async () => {
    const f = await buildCast('as-br63');
    const id = await assignmentId(f, f.ids.c, 'member', f.p1);
    expect((await revoke(f.orgId, f.o, id)).statusCode).toBe(204);
    const empty = await meAccess(f.c);
    expect(empty.statusCode).toBe(200);
    expect(expectContract('me.access', empty)).toEqual({ userId: f.ids.c, platformAdmin: false, assignments: [] });

    const given = await grant(f.orgId, f.o, {
      userId: f.ids.c,
      roleId: f.roles.member,
      scope: { type: 'project', projectId: f.p2 },
    });
    expect(given.statusCode).toBe(201);
    const memberRole = (await rolesOf(f.orgId, f.o).then((r) => r.json<RoleDto[]>())).find((r) => r.key === 'member');
    const byPermission = <T extends { permission: string }>(lines: T[]) =>
      [...lines].sort((l, r) => l.permission.localeCompare(r.permission));
    const after = expectContract('me.access', await meAccess(f.c)) as AccessDto;
    expect(after.assignments).toHaveLength(1);
    expect(after.assignments[0]).toMatchObject({ roleKey: 'member', scope: { type: 'project', projectId: f.p2 } });
    expect(byPermission(after.assignments[0]?.permissions ?? [])).toEqual(byPermission(memberRole?.permissions ?? []));

    const owner = expectContract('me.access', await meAccess(f.o)) as AccessDto;
    expect(owner).toMatchObject({ userId: f.ids.o, platformAdmin: false });
    expect(owner.assignments.map((a) => [a.roleKey, a.scope.type])).toEqual([['owner', 'org']]);
  });

  it('reports a config-listed platform admin as platformAdmin', async () => {
    const res = await meAccess(admin);
    expect(res.statusCode).toBe(200);
    expect((expectContract('me.access', res) as AccessDto).platformAdmin).toBe(true);
  });

  it('refuses a request without a session', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/me/access' })).statusCode).toBe(401);
  });
});

describe('the org roles list', () => {
  it('gives the four roles to any assignment holder and 403 to a member with none', async () => {
    const f = await buildCast('as-roles');
    for (const cookie of [f.o, f.d, f.a, f.b, f.v]) {
      const res = await rolesOf(f.orgId, cookie);
      expect(res.statusCode).toBe(200);
      const roles = expectContract('roles.list', res) as RoleDto[];
      expect(roles.map((r) => r.key)).toEqual(['owner', 'admin', 'member', 'viewer']);
    }
    const id = await assignmentId(f, f.ids.c, 'member', f.p1);
    expect((await revoke(f.orgId, f.o, id)).statusCode).toBe(204);
    const none = await rolesOf(f.orgId, f.c);
    expect(none.statusCode).toBe(403);
    expect((none.json() as { detail: string }).detail).toBe('Not allowed for your role here');
  });

  it('answers 404 for another org id in the path', async () => {
    const f = await buildCast('as-roles-path');
    const other = await createOrg(t, 'as-roles-path-other', 'as-roles-path-other');
    expect((await rolesOf(other.id, f.o)).statusCode).toBe(404);
  });
});

describe('N5: the revoke audit entry', () => {
  it('records the target user, the role and scope removed, the actor kind, and no to', async () => {
    const f = await buildCast('as-n5-revoke');
    const id = await assignmentId(f, f.ids.b, 'member', f.p2);
    expect((await revoke(f.orgId, f.o, id)).statusCode).toBe(204);
    const rows = await asOrg(f.orgId, "select * from audit_log where action = 'assignment.revoked'");
    expect(rows.rows).toHaveLength(1);
    const row = rows.rows[0] as {
      actor_user_id: string;
      target_type: string;
      target_id: string;
      payload: Record<string, unknown>;
    };
    expect(row.actor_user_id).toBe(f.ids.o);
    expect(row.target_type).toBe('user');
    expect(row.target_id).toBe(f.ids.b);
    expect(row.payload).toEqual({
      from: { roleId: f.roles.member, roleKey: 'member', scope: { type: 'project', projectId: f.p2 } },
      actorKind: 'member',
    });
    expect(row.payload).not.toHaveProperty('to');
  });

  it('writes no audit entry for a refused revoke', async () => {
    const f = await buildCast('as-n5-refused');
    const id = await assignmentId(f, f.ids.c, 'member', f.p1);
    expect((await revoke(f.orgId, f.b, id)).statusCode).toBe(403);
    const rows = await asOrg(f.orgId, "select 1 from audit_log where action = 'assignment.revoked'");
    expect(rows.rows).toHaveLength(0);
  });
});

describe('the service revoke with other actors', () => {
  it('lets a platform admin remove the last owner and marks the audit entry as a platform action', async () => {
    const f = await buildCast('as-platform-revoke');
    const service = t.app.get(AssignmentsService, { strict: false });
    const adminId = await userIdOf(t, 'admin');
    const actor = { kind: 'platform_admin' as const, userId: adminId };
    const id = await assignmentId(f, f.ids.o, 'owner', null);
    await service.revoke(actor, f.orgId, id);
    expect(await assignmentRows(f.orgId, id)).toBe(0);
    const audit = await asOrg(
      f.orgId,
      "select actor_user_id, payload from audit_log where action = 'assignment.revoked'",
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.actor_user_id).toBe(adminId);
    expect(audit.rows[0]?.payload).toMatchObject({ actorKind: 'platform_admin' });
    await expect(service.revoke(actor, f.orgId, randomUUID())).rejects.toThrow('Assignment not found');
    await expect(service.revoke(actor, randomUUID(), randomUUID())).rejects.toThrow('Organization not found');
  });

  it('refuses a member whose access lists no assignment:delete, before looking the target up', async () => {
    const f = await buildCast('as-revoke-failclosed');
    const service = t.app.get(AssignmentsService, { strict: false });
    const nobody = { kind: 'member' as const, access: { userId: f.ids.b, grants: [] } };
    const id = await assignmentId(f, f.ids.c, 'member', f.p1);
    await expect(service.revoke(nobody, f.orgId, id)).rejects.toThrow('Not allowed for your role here');
    await expect(service.revoke(nobody, f.orgId, randomUUID())).rejects.toThrow('Not allowed for your role here');
    expect(await assignmentRows(f.orgId, id)).toBe(1);
  });
});
