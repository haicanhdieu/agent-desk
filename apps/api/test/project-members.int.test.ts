import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { MemberDto, ProjectMemberDto, type Page } from '@agentdesk/contracts';
import { loadAccess } from '@agentdesk/core';
import { auditLog, connections, projects, rolePermissions, roleAssignments, roles, runs, withOrg } from '@agentdesk/db';
import { ALREADY_ON_PROJECT, NOT_ON_PROJECT, ProjectMembersService } from '../src/assignments/project-members.service';
import { createTestApp, type TestApp } from './helpers/app';
import {
  addProjectMember,
  createOrg,
  grant,
  inviteAndLogin,
  invite,
  acceptInvite,
  loginAs,
  memberSearch,
  projectMembersList,
  removeProjectMember,
  revoke,
  roleIdsOf,
  setProjectRole,
  userIdOf,
} from './helpers/auth';
import { expectContract } from './helpers/contract';

// BR-4, BR-5, BR-6, BR-13, BR-23, BR-24, BR-26 and Review Focus 1: project members list and add.
// BR-8, BR-9, BR-11, BR-12, BR-14, BR-25 and N-SELF: change a project role and remove from a project.

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
  /** Cookies. */
  o: string;
  oa: string;
  a: string;
  b: string;
  c: string;
  v: string;
  n: string;
  vAdmin: string;
  /** User ids. */
  ids: { o: string; oa: string; a: string; b: string; c: string; v: string; d: string; n: string; vAdmin: string };
  roles: Record<'owner' | 'admin' | 'member' | 'viewer', string>;
}

/**
 * Owner O, org admin OA, A admin on P1, B member on P1 and P2, C member on P1, V org viewer, D member on P2 only,
 * N with no assignment, VA org viewer who is also admin on P1. Every cast has its own org and handles.
 */
async function buildCast(slug: string): Promise<Cast> {
  const org = await createOrg(t, slug, slug);
  const p1 = await seedProject(org.id, `P1-${slug}`);
  const p2 = await seedProject(org.id, `P2-${slug}`);
  const h = (n: string) => `${slug}-${n}`;
  const o = await inviteAndLogin(t, org.id, h('o'), 'owner', { type: 'org' });
  const oa = await inviteAndLogin(t, org.id, h('oa'), 'admin', { type: 'org' });
  const a = await inviteAndLogin(t, org.id, h('a'), 'admin', { type: 'project', projectIds: [p1] });
  const b = await inviteAndLogin(t, org.id, h('b'), 'member', { type: 'project', projectIds: [p1, p2] });
  const c = await inviteAndLogin(t, org.id, h('c'), 'member', { type: 'project', projectIds: [p1] });
  const v = await inviteAndLogin(t, org.id, h('v'), 'viewer', { type: 'org' });
  await inviteAndLogin(t, org.id, h('d'), 'member', { type: 'project', projectIds: [p2] });
  const n = await inviteAndLogin(t, org.id, h('n'), 'viewer', { type: 'org' });
  const nId = await userIdOf(t, h('n'));
  await revoke(t, org.id, (await grant(t, org.id, nId, 'viewer', { type: 'org' })).id);
  const vAdmin = await inviteAndLogin(t, org.id, h('va'), 'viewer', { type: 'org' });
  const vAdminId = await userIdOf(t, h('va'));
  await grant(t, org.id, vAdminId, 'admin', { type: 'project', projectId: p1 });
  return {
    orgId: org.id,
    p1,
    p2,
    o,
    oa,
    a,
    b,
    c,
    v,
    n,
    vAdmin,
    ids: {
      o: await userIdOf(t, h('o')),
      oa: await userIdOf(t, h('oa')),
      a: await userIdOf(t, h('a')),
      b: await userIdOf(t, h('b')),
      c: await userIdOf(t, h('c')),
      v: await userIdOf(t, h('v')),
      d: await userIdOf(t, h('d')),
      n: nId,
      vAdmin: vAdminId,
    },
    roles: await roleIdsOf(t, o, org.id),
  };
}

async function projectRows(orgId: string, projectId: string, userId: string) {
  return withOrg(t.db, orgId, (tx) =>
    tx
      .select({ id: roleAssignments.id, roleId: roleAssignments.roleId })
      .from(roleAssignments)
      .where(
        and(
          eq(roleAssignments.orgId, orgId),
          eq(roleAssignments.projectId, projectId),
          eq(roleAssignments.userId, userId),
        ),
      ),
  );
}

async function auditRows(orgId: string, action: string, targetId: string) {
  return withOrg(t.db, orgId, (tx) =>
    tx
      .select({ payload: auditLog.payload, actorUserId: auditLog.actorUserId, projectIds: auditLog.projectIds })
      .from(auditLog)
      .where(and(eq(auditLog.orgId, orgId), eq(auditLog.action, action), eq(auditLog.targetId, targetId))),
  );
}

describe('listing project members (BR-4)', () => {
  it('shows an org owner, an org admin and a project admin everyone with access: project roles and org-wide roles', async () => {
    const f = await buildCast('pm-list');
    for (const cookie of [f.o, f.oa, f.a]) {
      const res = await projectMembersList(t, cookie, f.orgId, f.p1);
      const page = expectContract('projectMembers.list', res) as Page<ProjectMemberDto>;
      const handles = page.items.map((i) => i.handle);
      expect(handles).toEqual([
        'pm-list-a',
        'pm-list-b',
        'pm-list-c',
        'pm-list-o',
        'pm-list-oa',
        'pm-list-v',
        'pm-list-va',
      ]);
      expect(page.total).toBe(7);
      for (const item of page.items) expect(ProjectMemberDto.safeParse(item).success).toBe(true);
      const by = Object.fromEntries(page.items.map((i) => [i.userId, i]));
      expect(by[f.ids.a]?.projectRoles.map((r) => r.role.name)).toEqual(['Admin']);
      expect(by[f.ids.a]?.orgRoles).toEqual([]);
      expect(by[f.ids.a]?.source).toBe('project');
      expect(by[f.ids.b]?.projectRoles.map((r) => r.role.key)).toEqual(['member']);
      expect(res.body).not.toContain('@dev.local');
      for (const item of res.json<{ items: object[] }>().items) {
        expect(Object.keys(item).sort()).toEqual(['handle', 'name', 'orgRoles', 'projectRoles', 'source', 'userId']);
      }
    }
  });

  it('lists a person with only an org-wide role as inherited: the org role, no project role, source org', async () => {
    const f = await buildCast('pm-org');
    const page = expectContract(
      'projectMembers.list',
      await projectMembersList(t, f.a, f.orgId, f.p1),
    ) as Page<ProjectMemberDto>;
    const by = Object.fromEntries(page.items.map((i) => [i.userId, i]));
    expect(by[f.ids.o]?.orgRoles.map((r) => r.role.key)).toEqual(['owner']);
    expect(by[f.ids.o]?.projectRoles).toEqual([]);
    expect(by[f.ids.o]?.source).toBe('org');
    expect(by[f.ids.oa]?.orgRoles.map((r) => r.role.key)).toEqual(['admin']);
    expect(by[f.ids.v]?.orgRoles.map((r) => r.role.key)).toEqual(['viewer']);
    expect(by[f.ids.v]?.source).toBe('org');
    // the person who was revoked holds no role at all and stays out
    expect(by[f.ids.n]).toBeUndefined();
  });

  it('lists a person with an org role and a project role once, showing both, source project', async () => {
    const f = await buildCast('pm-both');
    const page = expectContract(
      'projectMembers.list',
      await projectMembersList(t, f.o, f.orgId, f.p1),
    ) as Page<ProjectMemberDto>;
    expect(page.items.filter((i) => i.userId === f.ids.vAdmin)).toHaveLength(1);
    const va = page.items.find((i) => i.userId === f.ids.vAdmin);
    expect(va?.orgRoles.map((r) => r.role.key)).toEqual(['viewer']);
    expect(va?.projectRoles.map((r) => r.role.key)).toEqual(['admin']);
    expect(va?.source).toBe('project');
  });

  it('lists on another project only that project roles plus the org-wide people, never another org', async () => {
    const f = await buildCast('pm-iso');
    const other = await buildCast('pm-iso-other');
    const p2 = expectContract(
      'projectMembers.list',
      await projectMembersList(t, f.o, f.orgId, f.p2),
    ) as Page<ProjectMemberDto>;
    // A is admin on P1 only: not on P2
    expect(p2.items.find((i) => i.userId === f.ids.a)).toBeUndefined();
    expect(p2.items.find((i) => i.userId === f.ids.d)?.source).toBe('project');
    expect(p2.items.find((i) => i.userId === f.ids.v)?.source).toBe('org');
    const ids = new Set(p2.items.map((i) => i.userId));
    for (const id of Object.values(other.ids)) expect(ids.has(id)).toBe(false);
  });

  it('pages 25 extra project members as 20 then 12 with the real total', async () => {
    const f = await buildCast('pm-page');
    for (let i = 0; i < 25; i += 1) {
      await inviteAndLogin(t, f.orgId, `pm-page-x${String(i).padStart(2, '0')}`, 'member', {
        type: 'project',
        projectIds: [f.p1],
      });
    }
    const first = expectContract(
      'projectMembers.list',
      await projectMembersList(t, f.o, f.orgId, f.p1),
    ) as Page<ProjectMemberDto>;
    expect(first.items).toHaveLength(20);
    expect(first.total).toBe(32);
    const second = expectContract(
      'projectMembers.list',
      await projectMembersList(t, f.o, f.orgId, f.p1, { page: 2 }),
    ) as Page<ProjectMemberDto>;
    expect(second.items).toHaveLength(12);
    expect(second.total).toBe(32);
    const names = [...first.items, ...second.items].map((i) => i.name);
    expect(names).toEqual([...names].sort((x, y) => x.localeCompare(y)));
  });

  it('lists a person with two project roles once, with both roles', async () => {
    const f = await buildCast('pm-two');
    await grant(t, f.orgId, f.ids.c, 'viewer', { type: 'project', projectId: f.p1 });
    const page = expectContract(
      'projectMembers.list',
      await projectMembersList(t, f.o, f.orgId, f.p1),
    ) as Page<ProjectMemberDto>;
    const c = page.items.find((i) => i.userId === f.ids.c);
    expect(c?.projectRoles.map((r) => r.role.key).sort()).toEqual(['member', 'viewer']);
    expect(page.total).toBe(7);
  });

  it('lists a person who accepted an invitation to the project (BR-13)', async () => {
    const f = await buildCast('pm-inv');
    const inv = await invite(t, f.orgId, 'pm-inv-new@dev.local', 'member', { type: 'project', projectIds: [f.p1] });
    const cookie = await loginAs(t, 'pm-inv-new');
    expect((await acceptInvite(t, cookie, inv.id)).statusCode).toBe(200);
    const page = expectContract(
      'projectMembers.list',
      await projectMembersList(t, f.a, f.orgId, f.p1),
    ) as Page<ProjectMemberDto>;
    expect(page.items.map((i) => i.handle)).toContain('pm-inv-new');
  });
});

describe('adding a project member (BR-5, BR-6)', () => {
  it('lets a project admin add an org member, who then holds the role on the project', async () => {
    const f = await buildCast('pm-add');
    logLines.length = 0;
    const res = await addProjectMember(t, f.a, f.orgId, f.p1, { userId: f.ids.d, roleId: f.roles.member });
    expect(res.statusCode).toBe(201);
    const dto = expectContract('projectMembers.add', res) as ProjectMemberDto;
    expect(dto.userId).toBe(f.ids.d);
    expect(dto.projectRoles.map((r) => r.role.key)).toEqual(['member']);
    const access = (
      await t.app.inject({
        method: 'GET',
        url: '/api/me/access',
        headers: { cookie: await loginAs(t, 'pm-add-d'), 'x-org-id': f.orgId },
      })
    ).json<{ assignments: { roleKey: string; scope: { type: string; projectId?: string } }[] }>();
    expect(access.assignments.filter((x) => x.scope.projectId === f.p1).map((x) => x.roleKey)).toEqual(['member']);
    const rows = await auditRows(f.orgId, 'assignment.granted', f.ids.d);
    const mine = rows.filter((r) => r.projectIds.includes(f.p1));
    expect(mine).toHaveLength(1);
    expect(mine[0]?.projectIds).toEqual([f.p1]);
    expect(mine[0]?.actorUserId).toBe(f.ids.a);
    expect(mine[0]?.payload).toMatchObject({
      to: { roleId: f.roles.member, roleKey: 'member', scope: { type: 'project', projectId: f.p1 } },
    });
    const line = logLines.find((l) => l['action'] === 'assignment.granted' && l['level'] === 30);
    expect(line).toMatchObject({ orgId: f.orgId, projectId: f.p1, actorUserId: f.ids.a, targetUserId: f.ids.d });
    expect(JSON.stringify(logLines)).not.toContain('@dev.local');
  });

  it('lets a project admin give the admin role on their own project', async () => {
    const f = await buildCast('pm-adm');
    const res = await addProjectMember(t, f.a, f.orgId, f.p1, { userId: f.ids.d, roleId: f.roles.admin });
    expect(res.statusCode).toBe(201);
  });

  it('refuses roles that are org-only or from another org with 422 /roleId', async () => {
    const f = await buildCast('pm-role');
    const other = await buildCast('pm-role-other');
    for (const roleId of [f.roles.owner, other.roles.member, randomUUID()]) {
      const res = await addProjectMember(t, f.a, f.orgId, f.p1, { userId: f.ids.d, roleId });
      expect(res.statusCode).toBe(422);
      expect(res.json<{ errors: { pointer: string }[] }>().errors[0]?.pointer).toBe('/roleId');
    }
    expect(await projectRows(f.orgId, f.p1, f.ids.d)).toHaveLength(0);
  });

  it('refuses a non-member and a user of another org with the same 422 /userId', async () => {
    const f = await buildCast('pm-user');
    const other = await buildCast('pm-user-other');
    const bodies: string[] = [];
    for (const userId of [randomUUID(), other.ids.d]) {
      const res = await addProjectMember(t, f.a, f.orgId, f.p1, { userId, roleId: f.roles.member });
      expect(res.statusCode).toBe(422);
      expect(res.json<{ errors: { pointer: string }[] }>().errors[0]?.pointer).toBe('/userId');
      bodies.push(res.body.replace(/"requestId":"[^"]*"/, ''));
    }
    expect(bodies[0]).toBe(bodies[1]);
  });

  it('answers 409 for a person who already has any role on the project and writes nothing', async () => {
    const f = await buildCast('pm-dup');
    const before = (await auditRows(f.orgId, 'assignment.granted', f.ids.c)).length;
    for (const roleId of [f.roles.viewer, f.roles.member]) {
      const res = await addProjectMember(t, f.a, f.orgId, f.p1, { userId: f.ids.c, roleId });
      expect(res.statusCode).toBe(409);
      expect(res.json<{ detail: string }>().detail).toBe(ALREADY_ON_PROJECT);
    }
    expect(await projectRows(f.orgId, f.p1, f.ids.c)).toHaveLength(1);
    expect(await auditRows(f.orgId, 'assignment.granted', f.ids.c)).toHaveLength(before);
  });

  it('refuses a project member without assignment:create at the route guard with 403 and writes nothing', async () => {
    const f = await buildCast('pm-noright');
    const res = await addProjectMember(t, f.b, f.orgId, f.p1, { userId: f.ids.d, roleId: f.roles.member });
    expect(res.statusCode).toBe(403);
    expect(await projectRows(f.orgId, f.p1, f.ids.d)).toHaveLength(0);
  });

  it('refuses a role the admin does not fully hold with 403 from the service, writing no row and no audit entry', async () => {
    const f = await buildCast('pm-esc');
    const auditBefore = (await auditRows(f.orgId, 'assignment.granted', f.ids.d)).length;
    // N holds only a narrow project role (read + assignment:create), so the member role is more than N holds
    await withOrg(t.db, f.orgId, async (tx) => {
      const [row] = await tx
        .insert(roles)
        .values({ orgId: f.orgId, key: 'narrow-assigner', name: 'Narrow assigner', assignableScopes: ['project'] })
        .returning({ id: roles.id });
      const narrow = row?.id ?? '';
      await tx.insert(rolePermissions).values(
        (['project:read', 'assignment:read', 'assignment:create'] as const).map((permission) => ({
          orgId: f.orgId,
          roleId: narrow,
          permission,
          condition: 'any',
        })),
      );
      await tx.insert(roleAssignments).values({
        orgId: f.orgId,
        userId: f.ids.n,
        roleId: narrow,
        scopeType: 'project',
        projectId: f.p1,
      });
    });
    const res = await addProjectMember(t, f.n, f.orgId, f.p1, { userId: f.ids.d, roleId: f.roles.member });
    expect(res.statusCode).toBe(403);
    expect(await projectRows(f.orgId, f.p1, f.ids.d)).toHaveLength(0);
    expect(await auditRows(f.orgId, 'assignment.granted', f.ids.d)).toHaveLength(auditBefore);
  });

  it('answers 404, never a foreign-key 500, when the project is gone after the guard passed', async () => {
    const f = await buildCast('pm-gone');
    const auditBefore = (await auditRows(f.orgId, 'assignment.granted', f.ids.d)).length;
    const access = await withOrg(t.db, f.orgId, (tx) => loadAccess(tx, f.ids.oa));
    const service = t.app.get(ProjectMembersService, { strict: false });
    await expect(
      service.add(access, f.orgId, randomUUID(), { userId: f.ids.d, roleId: f.roles.member }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await auditRows(f.orgId, 'assignment.granted', f.ids.d)).toHaveLength(auditBefore);
  });

  it('takes the tenant from the session and ignores an orgId in the body', async () => {
    const f = await buildCast('pm-body');
    const other = await buildCast('pm-body-other');
    const res = await addProjectMember(t, f.a, f.orgId, f.p1, {
      userId: f.ids.d,
      roleId: f.roles.member,
      orgId: other.orgId,
    });
    // AddProjectMemberRequest is a non-strict z.object: unknown keys are dropped, so the request succeeds
    expect(res.statusCode).toBe(201);
    expect(await projectRows(other.orgId, f.p1, f.ids.d)).toHaveLength(0);
    expect(await projectRows(other.orgId, other.p1, other.ids.d)).toHaveLength(0);
  });
});

describe('access: list and add (BR-23, BR-24, BR-26)', () => {
  it('answers 403 to a member, a viewer and a person with no assignment, whatever the project id', async () => {
    const f = await buildCast('pm-403');
    for (const cookie of [f.b, f.v, f.n]) {
      const bodies = new Set<string>();
      for (const id of [f.p1, randomUUID(), 'not-a-uuid']) {
        const list = await projectMembersList(t, cookie, f.orgId, id);
        expect(list.statusCode).toBe(403);
        bodies.add(list.body.replace(/"requestId":"[^"]*"/, ''));
        const add = await addProjectMember(t, cookie, f.orgId, id, { userId: f.ids.d, roleId: f.roles.member });
        expect(add.statusCode).toBe(403);
        bodies.add(add.body.replace(/"requestId":"[^"]*"/, ''));
      }
      expect(bodies.size).toBe(1);
    }
    expect(await projectRows(f.orgId, f.p1, f.ids.d)).toHaveLength(0);
  });

  it('answers 404 to an admin on P1 for P2, for list and add', async () => {
    const f = await buildCast('pm-404');
    expect((await projectMembersList(t, f.a, f.orgId, f.p2)).statusCode).toBe(404);
    const add = await addProjectMember(t, f.a, f.orgId, f.p2, { userId: f.ids.n, roleId: f.roles.member });
    expect(add.statusCode).toBe(404);
    expect(await projectRows(f.orgId, f.p2, f.ids.n)).toHaveLength(0);
  });

  it('answers 404 to the owner of another org, naming nothing of this org', async () => {
    const f = await buildCast('pm-xorg');
    const other = await buildCast('pm-xorg-other');
    const res = await projectMembersList(t, other.o, other.orgId, f.p1);
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('pm-xorg-');
    const add = await addProjectMember(t, other.o, other.orgId, f.p1, {
      userId: other.ids.d,
      roleId: other.roles.member,
    });
    expect(add.statusCode).toBe(404);
    expect(await projectRows(f.orgId, f.p1, other.ids.d)).toHaveLength(0);
  });

  it('lets an org viewer who is admin on P1 list and add on P1 but answers 403 on P2', async () => {
    const f = await buildCast('pm-va');
    expect((await projectMembersList(t, f.vAdmin, f.orgId, f.p1)).statusCode).toBe(200);
    const add = await addProjectMember(t, f.vAdmin, f.orgId, f.p1, { userId: f.ids.d, roleId: f.roles.member });
    expect(add.statusCode).toBe(201);
    expect((await projectMembersList(t, f.vAdmin, f.orgId, f.p2)).statusCode).toBe(403);
    expect(
      (await addProjectMember(t, f.vAdmin, f.orgId, f.p2, { userId: f.ids.n, roleId: f.roles.member })).statusCode,
    ).toBe(403);
  });

  it('answers 401 without a session', async () => {
    const f = await buildCast('pm-401');
    const res = await t.app.inject({ method: 'GET', url: `/api/projects/${f.p1}/members` });
    expect(res.statusCode).toBe(401);
  });
});

describe('a project deleted while its Members page is open (Review Focus 1)', () => {
  it('answers 404 to an org admin and 403 (never 500) to the project admin whose grant went with the project', async () => {
    const f = await buildCast('pm-del');
    const del = await t.app.inject({
      method: 'DELETE',
      url: `/api/projects/${f.p1}`,
      headers: { cookie: f.o, 'x-org-id': f.orgId },
    });
    expect(del.statusCode).toBe(204);
    expect((await projectMembersList(t, f.oa, f.orgId, f.p1)).statusCode).toBe(404);
    const add = await addProjectMember(t, f.oa, f.orgId, f.p1, { userId: f.ids.d, roleId: f.roles.member });
    expect(add.statusCode).toBe(404);
    // A held admin only on P1: the grant is deleted with the project, so the permission check (403) comes first
    expect((await projectMembersList(t, f.a, f.orgId, f.p1)).statusCode).toBe(403);
  });
});

async function seedRun(orgId: string, projectId: string, ownerUserId: string): Promise<string> {
  return withOrg(t.db, orgId, async (tx) => {
    const [row] = await tx
      .insert(runs)
      .values({
        orgId,
        projectId,
        command: 'fix',
        skillName: 'fix',
        ticketRef: `pm-${randomUUID()}`,
        ticketKind: 'issue',
        checkoutRef: 'refs/heads/main',
        triggerSource: 'webhook',
        status: 'running',
        ownerUserId,
      })
      .returning({ id: runs.id });
    return row?.id ?? '';
  });
}

const cancelRun = (cookie: string, orgId: string, runId: string) =>
  t.app.inject({ method: 'POST', url: `/api/runs/${runId}/cancel`, headers: { cookie, 'x-org-id': orgId } });

/** The role keys of the person's project-scope rows on `projectId`, sorted. */
async function keysOf(orgId: string, projectId: string, userId: string): Promise<string[]> {
  return withOrg(t.db, orgId, async (tx) => {
    const rows = await tx
      .select({ key: roles.key })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(
        and(
          eq(roleAssignments.orgId, orgId),
          eq(roleAssignments.scopeType, 'project'),
          eq(roleAssignments.projectId, projectId),
          eq(roleAssignments.userId, userId),
        ),
      );
    return rows.map((r) => r.key).sort();
  });
}

/** A project-only role holding exactly `permissions`, given to `userId` on `projectId`. */
async function giveNarrowRole(
  orgId: string,
  projectId: string,
  userId: string,
  key: string,
  permissions: string[],
): Promise<void> {
  await withOrg(t.db, orgId, async (tx) => {
    const [row] = await tx
      .insert(roles)
      .values({ orgId, key, name: key, assignableScopes: ['project'] })
      .returning({ id: roles.id });
    const roleId = row?.id ?? '';
    await tx
      .insert(rolePermissions)
      .values([...new Set(permissions)].map((permission) => ({ orgId, roleId, permission, condition: 'any' })));
    await tx.insert(roleAssignments).values({ orgId, userId, roleId, scopeType: 'project', projectId });
  });
}

describe('changing a project role (BR-8, BR-14)', () => {
  it('replaces the role with one row, audits the change and takes the old rights away at once', async () => {
    const f = await buildCast('pm-set');
    const runC = await seedRun(f.orgId, f.p1, f.ids.c);
    logLines.length = 0;
    const res = await setProjectRole(t, f.a, f.orgId, f.p1, f.ids.c, f.roles.viewer);
    expect(res.statusCode).toBe(200);
    const dto = expectContract('projectMembers.setRole', res) as ProjectMemberDto;
    expect(dto.projectRoles.map((r) => r.role.key)).toEqual(['viewer']);
    expect(await keysOf(f.orgId, f.p1, f.ids.c)).toEqual(['viewer']);
    const rows = await auditRows(f.orgId, 'project_member.role_changed', f.ids.c);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toMatchObject({ projectId: f.p1, from: ['member'], to: 'viewer' });
    expect(rows[0]?.projectIds).toEqual([f.p1]);
    expect(rows[0]?.actorUserId).toBe(f.ids.a);
    expect((await cancelRun(f.c, f.orgId, runC)).statusCode).toBe(403);
    const line = logLines.find((l) => l['action'] === 'project_member.role_changed' && l['level'] === 30);
    expect(line).toMatchObject({ orgId: f.orgId, projectId: f.p1, actorUserId: f.ids.a, targetUserId: f.ids.c });
    expect(JSON.stringify(logLines)).not.toContain('@dev.local');
  });

  it('lets the person cancel their own run before the change (the 403 above is the change, not the setup)', async () => {
    const f = await buildCast('pm-set-before');
    const runC = await seedRun(f.orgId, f.p1, f.ids.c);
    expect((await cancelRun(f.c, f.orgId, runC)).statusCode).toBeLessThan(300);
  });

  it('collapses two roles into one row and lists both in the audit entry', async () => {
    const f = await buildCast('pm-set-two');
    await grant(t, f.orgId, f.ids.c, 'viewer', { type: 'project', projectId: f.p1 });
    const res = await setProjectRole(t, f.a, f.orgId, f.p1, f.ids.c, f.roles.admin);
    expect(res.statusCode).toBe(200);
    expect(await keysOf(f.orgId, f.p1, f.ids.c)).toEqual(['admin']);
    const rows = await auditRows(f.orgId, 'project_member.role_changed', f.ids.c);
    expect(rows).toHaveLength(1);
    const payload = rows[0]?.payload as { from: string[]; to: string };
    expect([...payload.from].sort()).toEqual(['member', 'viewer']);
    expect(payload.to).toBe('admin');
  });

  it('answers 200 and writes neither an audit entry nor a log line for the role the person already has', async () => {
    const f = await buildCast('pm-set-same');
    logLines.length = 0;
    const res = await setProjectRole(t, f.a, f.orgId, f.p1, f.ids.c, f.roles.member);
    expect(res.statusCode).toBe(200);
    expect(await keysOf(f.orgId, f.p1, f.ids.c)).toEqual(['member']);
    expect(await auditRows(f.orgId, 'project_member.role_changed', f.ids.c)).toHaveLength(0);
    expect(logLines.filter((l) => l['action'] === 'project_member.role_changed')).toHaveLength(0);
  });

  it('answers 404 for a person with no role on the project, and for a user who is not in the org', async () => {
    const f = await buildCast('pm-set-none');
    const none = await setProjectRole(t, f.a, f.orgId, f.p1, f.ids.d, f.roles.viewer);
    expect(none.statusCode).toBe(404);
    expect(none.json<{ detail: string }>().detail).toBe(NOT_ON_PROJECT);
    const stranger = await setProjectRole(t, f.a, f.orgId, f.p1, randomUUID(), f.roles.viewer);
    expect(stranger.statusCode).toBe(404);
    expect(await projectRows(f.orgId, f.p1, f.ids.d)).toHaveLength(0);
  });

  it('refuses roles that are org-only, from another org or unknown with 422 /roleId and changes nothing', async () => {
    const f = await buildCast('pm-set-role');
    const other = await buildCast('pm-set-role-other');
    for (const roleId of [f.roles.owner, other.roles.viewer, randomUUID()]) {
      const res = await setProjectRole(t, f.a, f.orgId, f.p1, f.ids.c, roleId);
      expect(res.statusCode).toBe(422);
      expect(res.json<{ errors: { pointer: string }[] }>().errors[0]?.pointer).toBe('/roleId');
    }
    expect(await keysOf(f.orgId, f.p1, f.ids.c)).toEqual(['member']);
  });

  it('refuses a new role the admin does not fully hold with 403, changing nothing and writing no audit entry', async () => {
    const f = await buildCast('pm-set-esc');
    await giveNarrowRole(f.orgId, f.p1, f.ids.n, 'narrow-setter', [
      'project:read',
      'assignment:read',
      'assignment:create',
      'assignment:delete',
    ]);
    expect((await setProjectRole(t, f.n, f.orgId, f.p1, f.ids.c, f.roles.member)).statusCode).toBe(403);
    expect(await keysOf(f.orgId, f.p1, f.ids.c)).toEqual(['member']);
    expect(await auditRows(f.orgId, 'project_member.role_changed', f.ids.c)).toHaveLength(0);
  });

  it('refuses replacing a role the admin could not delete with 403, changing nothing', async () => {
    const f = await buildCast('pm-set-del');
    // N holds every viewer line plus assignment rights: it may give viewer, but not take admin away from A
    const viewerLines = await withOrg(t.db, f.orgId, (tx) =>
      tx
        .select({ permission: rolePermissions.permission })
        .from(rolePermissions)
        .where(eq(rolePermissions.roleId, f.roles.viewer)),
    );
    await giveNarrowRole(f.orgId, f.p1, f.ids.n, 'viewer-assigner', [
      ...viewerLines.map((l) => l.permission),
      'project:read',
      'assignment:read',
      'assignment:create',
      'assignment:delete',
    ]);
    // a viewer-only person is within N's reach: the same role again is allowed (200)
    await grant(t, f.orgId, f.ids.d, 'viewer', { type: 'project', projectId: f.p1 });
    expect((await setProjectRole(t, f.n, f.orgId, f.p1, f.ids.d, f.roles.viewer)).statusCode).toBe(200);
    expect((await setProjectRole(t, f.n, f.orgId, f.p1, f.ids.a, f.roles.viewer)).statusCode).toBe(403);
    expect(await keysOf(f.orgId, f.p1, f.ids.a)).toEqual(['admin']);
    expect(await auditRows(f.orgId, 'project_member.role_changed', f.ids.a)).toHaveLength(0);
  });

  it('shows the new role in the org members list (BR-14)', async () => {
    const f = await buildCast('pm-set-list');
    expect((await setProjectRole(t, f.a, f.orgId, f.p1, f.ids.c, f.roles.viewer)).statusCode).toBe(200);
    const page = expectContract('members.list', await memberSearch(t, f.o, f.orgId, {})) as Page<MemberDto>;
    const c = page.items.find((i) => i.userId === f.ids.c);
    expect(
      c?.assignments.filter((x) => x.scope.type === 'project' && x.scope.projectId === f.p1).map((x) => x.role.key),
    ).toEqual(['viewer']);
  });
});

describe('removing a project member (BR-9, BR-11)', () => {
  it('deletes only the project rows, keeps other scopes, audits it and answers 404 the second time', async () => {
    const f = await buildCast('pm-rm');
    logLines.length = 0;
    const res = await removeProjectMember(t, f.a, f.orgId, f.p1, f.ids.b);
    expect(res.statusCode).toBe(204);
    expectContract('projectMembers.remove', res);
    expect(await projectRows(f.orgId, f.p1, f.ids.b)).toHaveLength(0);
    expect(await keysOf(f.orgId, f.p2, f.ids.b)).toEqual(['member']);
    const rows = await auditRows(f.orgId, 'project_member.removed', f.ids.b);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toMatchObject({ projectId: f.p1, from: ['member'] });
    expect(rows[0]?.projectIds).toEqual([f.p1]);
    expect(rows[0]?.actorUserId).toBe(f.ids.a);
    const line = logLines.find((l) => l['action'] === 'project_member.removed' && l['level'] === 30);
    expect(line).toMatchObject({ orgId: f.orgId, projectId: f.p1, actorUserId: f.ids.a, targetUserId: f.ids.b });
    const again = await removeProjectMember(t, f.a, f.orgId, f.p1, f.ids.b);
    expect(again.statusCode).toBe(404);
    expect(await auditRows(f.orgId, 'project_member.removed', f.ids.b)).toHaveLength(1);
  });

  it('never touches the person org-scope rows', async () => {
    const f = await buildCast('pm-rm-org');
    await grant(t, f.orgId, f.ids.v, 'member', { type: 'project', projectId: f.p1 });
    expect((await removeProjectMember(t, f.a, f.orgId, f.p1, f.ids.v)).statusCode).toBe(204);
    const all = await withOrg(t.db, f.orgId, (tx) =>
      tx
        .select({ scopeType: roleAssignments.scopeType })
        .from(roleAssignments)
        .where(and(eq(roleAssignments.orgId, f.orgId), eq(roleAssignments.userId, f.ids.v))),
    );
    expect(all.map((r) => r.scopeType)).toEqual(['org']);
  });

  it('refuses to remove yourself with 403 before any lookup, writing nothing', async () => {
    const f = await buildCast('pm-rm-self');
    expect((await removeProjectMember(t, f.a, f.orgId, f.p1, f.ids.a)).statusCode).toBe(403);
    expect(await keysOf(f.orgId, f.p1, f.ids.a)).toEqual(['admin']);
    expect(await auditRows(f.orgId, 'project_member.removed', f.ids.a)).toHaveLength(0);
    // an org owner who holds no project row is refused alike, not told 404
    expect((await removeProjectMember(t, f.o, f.orgId, f.p1, f.ids.o)).statusCode).toBe(403);
  });

  it('answers 403 when a replaced role is more than the admin holds, deleting nothing', async () => {
    const f = await buildCast('pm-rm-esc');
    await giveNarrowRole(f.orgId, f.p1, f.ids.n, 'narrow-remover', [
      'project:read',
      'assignment:read',
      'assignment:delete',
    ]);
    expect((await removeProjectMember(t, f.n, f.orgId, f.p1, f.ids.a)).statusCode).toBe(403);
    expect(await keysOf(f.orgId, f.p1, f.ids.a)).toEqual(['admin']);
    expect(await auditRows(f.orgId, 'project_member.removed', f.ids.a)).toHaveLength(0);
  });
});

describe('serialized writes for one person (BR-12)', () => {
  it('two role changes at once both answer 200 and leave one row and two audit entries', async () => {
    const f = await buildCast('pm-race');
    const [r1, r2] = await Promise.all([
      setProjectRole(t, f.a, f.orgId, f.p1, f.ids.c, f.roles.viewer),
      setProjectRole(t, f.oa, f.orgId, f.p1, f.ids.c, f.roles.admin),
    ]);
    expect([r1.statusCode, r2.statusCode]).toEqual([200, 200]);
    expect(await projectRows(f.orgId, f.p1, f.ids.c)).toHaveLength(1);
    expect(await auditRows(f.orgId, 'project_member.role_changed', f.ids.c)).toHaveLength(2);
  });

  it('a role change and a removal at once never leave two rows or a 500', async () => {
    const f = await buildCast('pm-race-rm');
    const [set, rm] = await Promise.all([
      setProjectRole(t, f.a, f.orgId, f.p1, f.ids.c, f.roles.viewer),
      removeProjectMember(t, f.oa, f.orgId, f.p1, f.ids.c),
    ]);
    expect([200, 404]).toContain(set.statusCode);
    expect(rm.statusCode).toBe(204);
    expect((await projectRows(f.orgId, f.p1, f.ids.c)).length).toBeLessThanOrEqual(1);
  });
});

describe('a project delete racing a project member write (project row locked first)', () => {
  /**
   * Plays `ProjectsService.remove`: a transaction that locks the project row FOR UPDATE, waits until `during` has been
   * started (and has had time to take its locks), then deletes the project (the cascade deletes its role rows) and
   * commits. The delete must commit: a deadlock (40P01) aborts it or `during`, which fails the test.
   */
  async function deleteProjectWhile<T>(orgId: string, projectId: string, during: () => Promise<T>): Promise<T> {
    let locked: () => void = () => undefined;
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const deleter = withOrg(t.db, orgId, async (tx) => {
      await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).for('update');
      locked();
      await new Promise((resolve) => setTimeout(resolve, 600));
      await tx.delete(projects).where(eq(projects.id, projectId));
    });
    await lockTaken;
    const write = during();
    const [outcome, result] = await Promise.allSettled([deleter, write]);
    expect(outcome.status, `the project delete: ${JSON.stringify(outcome)}`).toBe('fulfilled');
    if (result.status === 'rejected') throw result.reason;
    return result.value;
  }

  it('a role change on a project being deleted answers 404, with no deadlock and no 500', async () => {
    const f = await buildCast('pm-del-set');
    const res = await deleteProjectWhile(f.orgId, f.p1, () =>
      setProjectRole(t, f.a, f.orgId, f.p1, f.ids.c, f.roles.viewer),
    );
    expect(res.statusCode).toBe(404);
    expect(await auditRows(f.orgId, 'project_member.role_changed', f.ids.c)).toHaveLength(0);
  });

  it('an add on a project being deleted answers 404, with no deadlock and no 500', async () => {
    const f = await buildCast('pm-del-add');
    const before = (await auditRows(f.orgId, 'assignment.granted', f.ids.n)).length;
    const res = await deleteProjectWhile(f.orgId, f.p1, () =>
      addProjectMember(t, f.a, f.orgId, f.p1, { userId: f.ids.n, roleId: f.roles.member }),
    );
    expect(res.statusCode).toBe(404);
    expect(await auditRows(f.orgId, 'assignment.granted', f.ids.n)).toHaveLength(before);
  });

  it('a removal on a project being deleted answers 204 beside the delete, with no deadlock', async () => {
    const f = await buildCast('pm-del-rm');
    const res = await deleteProjectWhile(f.orgId, f.p1, () => removeProjectMember(t, f.oa, f.orgId, f.p1, f.ids.c));
    expect(res.statusCode).toBe(204);
  });
});

describe('a project admin whose rights change (BR-25)', () => {
  it('loses add, set-role and remove at once when the admin role is replaced by member', async () => {
    const f = await buildCast('pm-demote');
    expect((await setProjectRole(t, f.o, f.orgId, f.p1, f.ids.a, f.roles.member)).statusCode).toBe(200);
    const add = await addProjectMember(t, f.a, f.orgId, f.p1, { userId: f.ids.d, roleId: f.roles.member });
    expect(add.statusCode).toBe(403);
    expect((await setProjectRole(t, f.a, f.orgId, f.p1, f.ids.c, f.roles.viewer)).statusCode).toBe(403);
    expect((await removeProjectMember(t, f.a, f.orgId, f.p1, f.ids.c)).statusCode).toBe(403);
    expect(await projectRows(f.orgId, f.p1, f.ids.d)).toHaveLength(0);
    expect(await keysOf(f.orgId, f.p1, f.ids.c)).toEqual(['member']);
  });

  it('loses everything on the project once all their rows there are removed', async () => {
    const f = await buildCast('pm-demote-all');
    expect((await removeProjectMember(t, f.o, f.orgId, f.p1, f.ids.a)).statusCode).toBe(204);
    expect((await setProjectRole(t, f.a, f.orgId, f.p1, f.ids.c, f.roles.viewer)).statusCode).toBe(403);
    expect(await keysOf(f.orgId, f.p1, f.ids.c)).toEqual(['member']);
  });

  it('answers 404 to a set-role for a person whose project rows are all gone', async () => {
    const f = await buildCast('pm-gone-rows');
    expect((await removeProjectMember(t, f.o, f.orgId, f.p1, f.ids.c)).statusCode).toBe(204);
    expect((await setProjectRole(t, f.a, f.orgId, f.p1, f.ids.c, f.roles.viewer)).statusCode).toBe(404);
  });
});

describe('access: set-role and remove (BR-23, BR-24, BR-26)', () => {
  it('answers 403 to a member, a viewer and a person with no assignment, whatever the project id', async () => {
    const f = await buildCast('pm-403b');
    for (const cookie of [f.b, f.v, f.n]) {
      const set = new Set<string>();
      const rm = new Set<string>();
      for (const id of [f.p1, randomUUID(), 'not-a-uuid']) {
        const a = await setProjectRole(t, cookie, f.orgId, id, f.ids.c, f.roles.viewer);
        expect(a.statusCode).toBe(403);
        set.add(a.body.replace(/"requestId":"[^"]*"/, ''));
        const b = await removeProjectMember(t, cookie, f.orgId, id, f.ids.c);
        expect(b.statusCode).toBe(403);
        rm.add(b.body.replace(/"requestId":"[^"]*"/, ''));
      }
      expect(set.size).toBe(1);
      expect(rm.size).toBe(1);
    }
    expect(await keysOf(f.orgId, f.p1, f.ids.c)).toEqual(['member']);
  });

  it('answers 404 to an admin on P1 for P2 and leaves the P2 row alone', async () => {
    const f = await buildCast('pm-404b');
    expect((await setProjectRole(t, f.a, f.orgId, f.p2, f.ids.b, f.roles.viewer)).statusCode).toBe(404);
    expect((await removeProjectMember(t, f.a, f.orgId, f.p2, f.ids.b)).statusCode).toBe(404);
    expect(await keysOf(f.orgId, f.p2, f.ids.b)).toEqual(['member']);
  });

  it('answers 404 to the owner of another org, naming nothing of this org', async () => {
    const f = await buildCast('pm-xorg-b');
    const other = await buildCast('pm-xorg-b-other');
    const set = await setProjectRole(t, other.o, other.orgId, f.p1, f.ids.c, other.roles.viewer);
    expect(set.statusCode).toBe(404);
    expect(set.body).not.toContain('pm-xorg-b-');
    expect((await removeProjectMember(t, other.o, other.orgId, f.p1, f.ids.c)).statusCode).toBe(404);
    expect(await keysOf(f.orgId, f.p1, f.ids.c)).toEqual(['member']);
  });

  it('lets an org viewer who is admin on P1 manage P1 and answers 403 on P2', async () => {
    const f = await buildCast('pm-va-b');
    expect((await setProjectRole(t, f.vAdmin, f.orgId, f.p1, f.ids.c, f.roles.viewer)).statusCode).toBe(200);
    expect((await removeProjectMember(t, f.vAdmin, f.orgId, f.p1, f.ids.c)).statusCode).toBe(204);
    expect((await setProjectRole(t, f.vAdmin, f.orgId, f.p2, f.ids.b, f.roles.viewer)).statusCode).toBe(403);
    expect((await removeProjectMember(t, f.vAdmin, f.orgId, f.p2, f.ids.b)).statusCode).toBe(403);
  });

  it('answers 401 without a session', async () => {
    const f = await buildCast('pm-401b');
    const put = await t.app.inject({
      method: 'PUT',
      url: `/api/projects/${f.p1}/members/${f.ids.c}/role`,
      payload: { roleId: f.roles.viewer },
    });
    expect(put.statusCode).toBe(401);
    const del = await t.app.inject({ method: 'DELETE', url: `/api/projects/${f.p1}/members/${f.ids.c}` });
    expect(del.statusCode).toBe(401);
  });
});
