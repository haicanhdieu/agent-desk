import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ProjectMemberDto, type Page } from '@agentdesk/contracts';
import { loadAccess } from '@agentdesk/core';
import { auditLog, connections, projects, rolePermissions, roleAssignments, roles, withOrg } from '@agentdesk/db';
import { ALREADY_ON_PROJECT, ProjectMembersService } from '../src/assignments/project-members.service';
import { createTestApp, type TestApp } from './helpers/app';
import {
  addProjectMember,
  createOrg,
  grant,
  inviteAndLogin,
  invite,
  acceptInvite,
  loginAs,
  projectMembersList,
  revoke,
  roleIdsOf,
  userIdOf,
} from './helpers/auth';
import { expectContract } from './helpers/contract';

// BR-4, BR-5, BR-6, BR-13, BR-23, BR-24, BR-26 and Review Focus 1: project members list and add.

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
  it('shows an org owner, an org admin and a project admin the people holding a project role, never org-only roles', async () => {
    const f = await buildCast('pm-list');
    for (const cookie of [f.o, f.oa, f.a]) {
      const res = await projectMembersList(t, cookie, f.orgId, f.p1);
      const page = expectContract('projectMembers.list', res) as Page<ProjectMemberDto>;
      const handles = page.items.map((i) => i.handle);
      expect(handles).toEqual(['pm-list-a', 'pm-list-b', 'pm-list-c', 'pm-list-va']);
      expect(page.total).toBe(4);
      for (const item of page.items) expect(ProjectMemberDto.safeParse(item).success).toBe(true);
      const by = Object.fromEntries(page.items.map((i) => [i.userId, i]));
      expect(by[f.ids.a]?.projectRoles.map((r) => r.role.name)).toEqual(['Admin']);
      expect(by[f.ids.b]?.projectRoles.map((r) => r.role.key)).toEqual(['member']);
      expect(handles).not.toContain('pm-list-o');
      expect(handles).not.toContain('pm-list-v');
      expect(res.body).not.toContain('@dev.local');
      for (const item of res.json<{ items: object[] }>().items) {
        expect(Object.keys(item).sort()).toEqual(['handle', 'name', 'projectRoles', 'userId']);
      }
    }
  });

  it('pages 25 extra project members as 20 then 6 with the real total', async () => {
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
    expect(first.total).toBe(29);
    const second = expectContract(
      'projectMembers.list',
      await projectMembersList(t, f.o, f.orgId, f.p1, { page: 2 }),
    ) as Page<ProjectMemberDto>;
    expect(second.items).toHaveLength(9);
    expect(second.total).toBe(29);
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
    expect(page.total).toBe(4);
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
