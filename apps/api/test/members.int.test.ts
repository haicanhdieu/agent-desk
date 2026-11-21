import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemberDto, type Access, type Page } from '@agentdesk/contracts';
import { connections, projects, withOrg } from '@agentdesk/db';
import { MembersService } from '../src/members/members.service';
import { createTestApp, type TestApp } from './helpers/app';
import { createOrg, grant, inviteAndLogin, loginAs, revoke, userIdOf } from './helpers/auth';
import { expectContract } from './helpers/contract';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
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
