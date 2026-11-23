import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  CreateOrgResponse,
  Page,
  PlatformMemberDto,
  PlatformOrgDetailDto,
  PlatformOrgDto,
  PlatformProjectDto,
  RoleDto,
} from '@agentdesk/contracts';
import { FakeKubeGateway } from '@agentdesk/core';
import { connections, organization, projects, runs, seedPlatformAdmin, withOrg } from '@agentdesk/db';
import { FORBIDDEN_DETAIL } from '../src/access/authorize';
import { createTestApp, type TestApp } from './helpers/app';
import { asPlatformAdmin, cookieOf, createOrg, grant, inviteAndLogin, loginAs, revoke, userIdOf } from './helpers/auth';
import { expectContract } from './helpers/contract';
import { freshStateDir } from './helpers/fixtures';

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

async function post(payload: unknown, cookie: string = admin) {
  return t.app.inject({ method: 'POST', url: '/api/platform/orgs', headers: { cookie }, payload: payload as object });
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

describe('platform org creation', () => {
  it('creates the org with its built-in roles, no members and an audit entry', async () => {
    const res = await post({ name: 'Acme', slug: 'acme' });
    expect(res.statusCode).toBe(201);
    const created = expectContract('platform.createOrg', res) as CreateOrgResponse;
    expect(created).toEqual({ id: created.id, name: 'Acme', slug: 'acme' });

    const rolesRes = await t.app.inject({
      method: 'GET',
      url: `/api/platform/orgs/${created.id}/roles`,
      headers: { cookie: admin },
    });
    const roles = expectContract('platform.listRoles', rolesRes) as RoleDto[];
    expect(roles.map((r) => r.key).sort()).toEqual(['admin', 'member', 'owner', 'viewer']);
    expect(roles.every((r) => r.builtIn)).toBe(true);
    const owner = roles.find((r) => r.key === 'owner');
    expect(owner?.assignableScopes).toEqual(['org']);
    expect(owner?.permissions).toHaveLength(34);
    const member = roles.find((r) => r.key === 'member');
    expect(member?.permissions).toContainEqual({ permission: 'run:cancel', condition: 'own' });
    expect(member?.permissions).toContainEqual({ permission: 'run:read', condition: 'any' });
    for (const r of roles) expect(r.permissions.some((p) => p.permission.startsWith('platform-'))).toBe(false);

    const members = await t.db.pool.query('select count(*)::int as n from member where organization_id = $1', [
      created.id,
    ]);
    expect(members.rows[0]?.n).toBe(0);

    const adminId = (await t.db.pool.query('select id from "user" where email = $1', ['admin@dev.local'])).rows[0]?.id;
    const audit = await asOrg(created.id, "select * from audit_log where action = 'org.created'");
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      actor_user_id: adminId,
      target_type: 'org',
      target_id: created.id,
      payload: { name: 'Acme', slug: 'acme', actorKind: 'platform_admin' },
    });
  });

  it('a taken slug is 409 with a /slug pointer', async () => {
    await createOrg(t, 'Taken', 'taken-slug');
    const res = await post({ name: 'Other', slug: 'taken-slug' });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { errors: { pointer: string }[] }).errors[0]?.pointer).toBe('/slug');
  });

  it('concurrent creates with one slug give 201 and 409', async () => {
    const results = await Promise.all([
      post({ name: 'Race A', slug: 'race-slug' }),
      post({ name: 'Race B', slug: 'race-slug' }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const loser = results.find((r) => r.statusCode === 409);
    expect((loser?.json() as { errors: { pointer: string }[] }).errors[0]?.pointer).toBe('/slug');
    const count = await t.db.pool.query("select count(*)::int as n from organization where slug = 'race-slug'");
    expect(count.rows[0]?.n).toBe(1);
  });

  it('stores an edited slug as sent', async () => {
    const created = await createOrg(t, 'Acme Corp', 'acme-eu-7');
    expect(created.slug).toBe('acme-eu-7');
    expect(created.name).toBe('Acme Corp');
  });

  it.each([
    ['a missing name', { slug: 'ok-slug' }, '/name'],
    ['a missing slug', { name: 'Ok' }, '/slug'],
    ['a 101-character name', { name: 'n'.repeat(101), slug: 'ok-slug' }, '/name'],
    ['a slug with capitals and an underscore', { name: 'Ok', slug: 'Bad_Slug' }, '/slug'],
  ])('rejects %s with a 400 and a pointer', async (_label, payload, pointer) => {
    const res = await post(payload);
    expect(res.statusCode).toBe(400);
    const pointers = (res.json() as { errors: { pointer: string }[] }).errors.map((e) => e.pointer);
    expect(pointers).toContain(pointer);
  });

  it('refuses a caller who is not a platform admin, creating nothing', async () => {
    const home = await createOrg(t, 'Alice Home', 'alice-home');
    const alice = await inviteAndLogin(t, home.id, 'alice', 'owner', { type: 'org' });
    const res = await post({ name: 'Nope', slug: 'nope-org' }, alice);
    expect(res.statusCode).toBe(403);
    expect((res.json() as { detail: string }).detail).toBe(FORBIDDEN_DETAIL);
    const count = await t.db.pool.query("select count(*)::int as n from organization where slug = 'nope-org'");
    expect(count.rows[0]?.n).toBe(0);
  });

  it('answers 401 without a session', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/platform/orgs', payload: { name: 'x', slug: 'x' } });
    expect(res.statusCode).toBe(401);
  });
});

describe('platform org and project lists', () => {
  it('lists orgs with exactly the documented keys, newest first', async () => {
    const first = await createOrg(t, 'List One', 'list-one');
    const second = await createOrg(t, 'List Two', 'list-two');
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/platform/orgs?pageSize=100',
      headers: { cookie: admin },
    });
    const page = expectContract('platform.listOrgs', res) as Page<PlatformOrgDto>;
    for (const item of page.items) {
      expect(Object.keys(item).sort()).toEqual([
        'createdAt',
        'id',
        'lastActivityAt',
        'memberCount',
        'name',
        'owner',
        'projectCount',
        'slug',
        'status',
        'suspendedAt',
      ]);
    }
    const ids = page.items.map((i) => i.id);
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));
    expect(page.items.find((i) => i.id === first.id)?.memberCount).toBe(0);
    expect(page.total).toBe(ids.length);
  });

  it('counts an org member', async () => {
    const org = await createOrg(t, 'Counted', 'counted-org');
    const userId = (await t.db.pool.query('select id from "user" where email = $1', ['admin@dev.local'])).rows[0]?.id;
    await t.db.pool.query(
      'insert into member (id, organization_id, user_id, role, created_at) values ($1,$2,$3,$4,now())',
      [randomUUID(), org.id, userId, 'member'],
    );
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/platform/orgs?pageSize=100',
      headers: { cookie: admin },
    });
    const page = expectContract('platform.listOrgs', res) as Page<PlatformOrgDto>;
    expect(page.items.find((i) => i.id === org.id)?.memberCount).toBe(1);
  });

  it('lists only the target org projects as ids and names', async () => {
    const a = await createOrg(t, 'Proj A', 'proj-a');
    const b = await createOrg(t, 'Proj B', 'proj-b');
    const pa = await seedProject(a.id, 'Alpha');
    await seedProject(b.id, 'Beta');
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/platform/orgs/${a.id}/projects`,
      headers: { cookie: admin },
    });
    const page = expectContract('platform.listProjects', res) as Page<PlatformProjectDto>;
    expect(page.items).toEqual([{ id: pa, name: 'Alpha' }]);
    expect(page.total).toBe(1);
  });

  it('answers 404 for an unknown org on projects and roles', async () => {
    const unknown = randomUUID();
    for (const leaf of ['projects', 'roles']) {
      const res = await t.app.inject({
        method: 'GET',
        url: `/api/platform/orgs/${unknown}/${leaf}`,
        headers: { cookie: admin },
      });
      expect(res.statusCode, leaf).toBe(404);
    }
  });

  it('refuses a non-platform user on the lists', async () => {
    const org = await createOrg(t, 'Guarded', 'guarded-org');
    const alice = await inviteAndLogin(t, org.id, 'alice-lists', 'owner', { type: 'org' });
    for (const url of [
      '/api/platform/orgs',
      `/api/platform/orgs/${org.id}/projects`,
      `/api/platform/orgs/${org.id}/roles`,
    ]) {
      const res = await t.app.inject({ method: 'GET', url, headers: { cookie: alice } });
      expect(res.statusCode, url).toBe(403);
    }
  });
});

async function listOrgsBy(query: string, cookie: string = admin) {
  return t.app.inject({ method: 'GET', url: `/api/platform/orgs?${query}`, headers: { cookie } });
}

async function seedRunAt(orgId: string, projectId: string, queuedAt: Date): Promise<void> {
  await withOrg(t.db, orgId, async (tx) => {
    await tx.insert(runs).values({
      orgId,
      projectId,
      command: 'fix',
      skillName: 'fix',
      ticketRef: `T-${randomUUID().slice(0, 6)}`,
      ticketKind: 'issue',
      checkoutRef: 'refs/heads/main',
      triggerSource: 'webhook',
      status: 'succeeded',
      queuedAt,
    });
  });
}

describe('platform directory (BR-18 to BR-20)', () => {
  it('BR-18: a no-owner, no-run org has owner null, zero projects, null activity and status active', async () => {
    const org = await createOrg(t, 'Dir Bare', 'dir-bare');
    const page = expectContract('platform.listOrgs', await listOrgsBy('pageSize=100')) as Page<PlatformOrgDto>;
    const row = page.items.find((i) => i.id === org.id);
    expect(row).toMatchObject({
      status: 'active',
      suspendedAt: null,
      projectCount: 0,
      lastActivityAt: null,
      owner: null,
    });
    expect(page.items.every((i) => i.status === 'active')).toBe(true);
  });

  it('BR-18: shows the owner identity, the project count and the latest run queue time', async () => {
    const org = await createOrg(t, 'Dir Full', 'dir-full');
    const pid = await seedProject(org.id, 'DF1');
    await seedProject(org.id, 'DF2');
    const early = new Date('2026-01-02T03:04:05.000Z');
    const late = new Date('2026-02-03T04:05:06.000Z');
    await seedRunAt(org.id, pid, early);
    await seedRunAt(org.id, pid, late);
    await inviteAndLogin(t, org.id, 'dir-full-o', 'owner', { type: 'org' });
    const ownerId = await userIdOf(t, 'dir-full-o');
    const page = expectContract('platform.listOrgs', await listOrgsBy('q=dir-full')) as Page<PlatformOrgDto>;
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      projectCount: 2,
      lastActivityAt: late.toISOString(),
      owner: { userId: ownerId, handle: 'dir-full-o', email: 'dir-full-o@dev.local' },
    });
    expect(Object.keys(page.items[0]?.owner ?? {}).sort()).toEqual(['email', 'handle', 'name', 'userId']);
  });

  it('BR-18: with two owners the earlier grant is shown', async () => {
    const org = await createOrg(t, 'Dir Two', 'dir-two');
    await inviteAndLogin(t, org.id, 'dir-two-a', 'owner', { type: 'org' });
    await new Promise((r) => setTimeout(r, 20));
    await inviteAndLogin(t, org.id, 'dir-two-b', 'owner', { type: 'org' });
    const page = expectContract('platform.listOrgs', await listOrgsBy('q=dir-two')) as Page<PlatformOrgDto>;
    expect(page.items[0]?.owner?.handle).toBe('dir-two-a');
  });

  it('BR-18: lists the newest org first, breaks a createdAt tie by id, and page 2 holds the next older org', async () => {
    const a = await createOrg(t, 'Ordr A', 'ordr-a');
    const b = await createOrg(t, 'Ordr B', 'ordr-b');
    const c = await createOrg(t, 'Ordr C', 'ordr-c');
    const all = expectContract('platform.listOrgs', await listOrgsBy('q=ordr-&pageSize=100')) as Page<PlatformOrgDto>;
    expect(all.items.map((i) => i.id)).toEqual([c.id, b.id, a.id]);
    const page2 = expectContract(
      'platform.listOrgs',
      await listOrgsBy('q=ordr-&pageSize=1&page=2'),
    ) as Page<PlatformOrgDto>;
    expect(page2.total).toBe(3);
    expect(page2.items.map((i) => i.id)).toEqual([b.id]);

    const same = new Date('2020-01-01T00:00:00.000Z');
    await t.db.orm.update(organization).set({ createdAt: same }).where(eq(organization.id, a.id));
    await t.db.orm.update(organization).set({ createdAt: same }).where(eq(organization.id, b.id));
    const tied = expectContract('platform.listOrgs', await listOrgsBy('q=ordr-&pageSize=100')) as Page<PlatformOrgDto>;
    expect(tied.items.map((i) => i.id)).toEqual([c.id, ...[a.id, b.id].sort()]);
  });

  it('BR-18: a page size above 100 is refused', async () => {
    expect((await listOrgsBy('pageSize=101')).statusCode).toBe(400);
  });

  it('BR-20: q matches name and slug case-insensitively', async () => {
    const org = await createOrg(t, 'Zebra Quartz Inc', 'srch-quartz-1');
    const byName = expectContract('platform.listOrgs', await listOrgsBy('q=zEbRa%20qUARtz')) as Page<PlatformOrgDto>;
    expect(byName.items.map((i) => i.id)).toEqual([org.id]);
    const bySlug = expectContract('platform.listOrgs', await listOrgsBy('q=SRCH-QUARTZ')) as Page<PlatformOrgDto>;
    expect(bySlug.items.map((i) => i.id)).toEqual([org.id]);
    expect(bySlug.total).toBe(1);
  });

  it('BR-20: %, _ and \\ match only literally', async () => {
    const lit = await createOrg(t, '50%_off\\deal', 'lit-special');
    await createOrg(t, '50xyoffzdeal', 'lit-plain');
    for (const q of ['50%', '%_off', '_off', 'off\\deal']) {
      const page = expectContract(
        'platform.listOrgs',
        await listOrgsBy(`q=${encodeURIComponent(q)}`),
      ) as Page<PlatformOrgDto>;
      expect(
        page.items.map((i) => i.id),
        q,
      ).toEqual([lit.id]);
    }
    const wild = expectContract('platform.listOrgs', await listOrgsBy('q=%25')) as Page<PlatformOrgDto>;
    expect(wild.items.map((i) => i.id)).toEqual([lit.id]);
  });

  it('BR-20: status=suspended returns only suspended orgs and total follows the filter', async () => {
    const sus = await createOrg(t, 'Filter Sus', 'filter-sus');
    await createOrg(t, 'Filter Act', 'filter-act');
    await withOrg(t.db, sus.id, async (tx) => {
      await tx
        .update(organization)
        .set({ status: 'suspended', suspendedAt: new Date() })
        .where(eq(organization.id, sus.id));
    });
    const page = expectContract(
      'platform.listOrgs',
      await listOrgsBy('status=suspended&q=filter-'),
    ) as Page<PlatformOrgDto>;
    expect(page.items.map((i) => i.id)).toEqual([sus.id]);
    expect(page.items[0]?.status).toBe('suspended');
    expect(page.items[0]?.suspendedAt).not.toBeNull();
    expect(page.total).toBe(1);
    const active = expectContract(
      'platform.listOrgs',
      await listOrgsBy('status=active&q=filter-'),
    ) as Page<PlatformOrgDto>;
    expect(active.items.map((i) => i.slug)).toEqual(['filter-act']);
  });

  it('BR-20: a 101-character q is a 400; a 100-character q is accepted', async () => {
    expect((await listOrgsBy(`q=${'a'.repeat(101)}`)).statusCode).toBe(400);
    expect((await listOrgsBy(`q=${'a'.repeat(100)}`)).statusCode).toBe(200);
  });

  it('BR-18: the directory carries counts and identity only, never tenant text', async () => {
    const org = await createOrg(t, 'Dir Text', 'dir-text');
    const pid = await seedProject(org.id, 'SecretProjectName');
    await seedRunAt(org.id, pid, new Date());
    const res = await listOrgsBy('q=dir-text');
    expect(res.body).not.toContain('SecretProjectName');
    expect(res.body).not.toContain('T-');
  });

  it('refuses every non-platform caller on the directory with 403', async () => {
    const org = await createOrg(t, 'Dir Guard', 'dir-guard');
    const owner = await inviteAndLogin(t, org.id, 'dir-guard-o', 'owner', { type: 'org' });
    expect((await listOrgsBy('', owner)).statusCode).toBe(403);
    expect((await t.app.inject({ method: 'GET', url: '/api/platform/orgs' })).statusCode).toBe(401);
  });
});

describe('platform org detail (BR-24, BR-23)', () => {
  const get = (id: string, cookie?: string, headers: Record<string, string> = {}) =>
    t.app.inject({
      method: 'GET',
      url: `/api/platform/orgs/${id}`,
      headers: { ...(cookie === undefined ? {} : { cookie }), ...headers },
    });

  it('BR-24: returns the detail with suspension null', async () => {
    const org = await createOrg(t, 'Detail Org', 'detail-org');
    await inviteAndLogin(t, org.id, 'detail-o', 'owner', { type: 'org' });
    const detail = expectContract('platform.getOrg', await get(org.id, admin)) as PlatformOrgDetailDto;
    expect(detail).toMatchObject({
      id: org.id,
      name: 'Detail Org',
      slug: 'detail-org',
      memberCount: 1,
      status: 'active',
      suspension: null,
      owner: { handle: 'detail-o' },
    });
  });

  it('BR-24: an unknown and a malformed id are 404 for the platform admin', async () => {
    expect((await get(randomUUID(), admin)).statusCode).toBe(404);
    expect((await get('not-a-uuid', admin)).statusCode).toBe(404);
    expect((await get('x'.repeat(100), admin)).statusCode).toBe(404);
  });

  /** A signed-in user with no membership and no assignment: invited (so dev-login may sign them up) but never accepted. */
  async function signedInWithoutOrg(handle: string, orgId: string): Promise<string> {
    const roles = (
      await t.app.inject({ method: 'GET', url: `/api/platform/orgs/${orgId}/roles`, headers: { cookie: admin } })
    ).json<RoleDto[]>();
    const viewer = roles.find((r) => r.key === 'viewer');
    if (!viewer) throw new Error('no viewer role');
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/platform/orgs/${orgId}/invitations`,
      headers: { cookie: admin },
      payload: { email: `${handle}@dev.local`, roleId: viewer.id, scope: { type: 'org' } },
    });
    if (res.statusCode !== 201) throw new Error(`invite ${handle} answered ${res.statusCode}`);
    const cookie = await loginAs(t, handle);
    const memberships = await t.db.pool.query('select 1 from member where user_id = $1', [await userIdOf(t, handle)]);
    expect(memberships.rowCount).toBe(0);
    return cookie;
  }

  it('BR-24: every non-platform caller gets 403 before lookup, the same for a known and an unknown id', async () => {
    const org = await createOrg(t, 'Detail Guard', 'detail-guard');
    const other = await createOrg(t, 'Detail Other', 'detail-other');
    const p1 = await seedProject(org.id, 'DG1');
    const cookies: Record<string, string> = {
      owner: await inviteAndLogin(t, org.id, 'dg-owner', 'owner', { type: 'org' }),
      admin: await inviteAndLogin(t, org.id, 'dg-admin', 'admin', { type: 'org' }),
      projectAdmin: await inviteAndLogin(t, org.id, 'dg-padmin', 'admin', { type: 'project', projectIds: [p1] }),
      member: await inviteAndLogin(t, org.id, 'dg-member', 'member', { type: 'org' }),
      viewer: await inviteAndLogin(t, org.id, 'dg-viewer', 'viewer', { type: 'org' }),
      otherOrgOwner: await inviteAndLogin(t, other.id, 'dg-other-o', 'owner', { type: 'org' }),
      noOrg: await signedInWithoutOrg('dg-nobody', org.id),
    };
    for (const [who, cookie] of Object.entries(cookies)) {
      const known = await get(org.id, cookie);
      const unknown = await get(randomUUID(), cookie);
      expect(known.statusCode, who).toBe(403);
      expect(unknown.statusCode, who).toBe(403);
      expect((known.json() as { detail: string }).detail, who).toBe(FORBIDDEN_DETAIL);
      expect(known.body, who).not.toContain('Detail Guard');
    }
  });

  it('BR-24: answers 401 signed out', async () => {
    const org = await createOrg(t, 'Detail Anon', 'detail-anon');
    expect((await get(org.id)).statusCode).toBe(401);
  });

  it('BR-24: x-org-id is ignored', async () => {
    const org = await createOrg(t, 'Detail Hdr', 'detail-hdr');
    const other = await createOrg(t, 'Detail Hdr2', 'detail-hdr2');
    const detail = expectContract(
      'platform.getOrg',
      await get(org.id, admin, { 'x-org-id': other.id }),
    ) as PlatformOrgDetailDto;
    expect(detail.id).toBe(org.id);
  });
});

describe('platform member list', () => {
  it('BR-40: lists members with email and every assignment', async () => {
    const org = await createOrg(t, 'Members Org', 'members-org');
    const p1 = await seedProject(org.id, 'M1');
    const p2 = await seedProject(org.id, 'M2');
    await inviteAndLogin(t, org.id, 'plat-mem-o', 'owner', { type: 'org' });
    await inviteAndLogin(t, org.id, 'plat-mem-b', 'member', { type: 'project', projectIds: [p1, p2] });
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/platform/orgs/${org.id}/members`,
      headers: { cookie: admin },
    });
    const page = expectContract('platform.listMembers', res) as Page<PlatformMemberDto>;
    expect(page.total).toBe(2);
    expect(page.items.map((i) => i.handle)).toEqual(['plat-mem-b', 'plat-mem-o']);
    const [b, o] = page.items;
    expect(Object.keys(b ?? {}).sort()).toEqual(['assignments', 'email', 'handle', 'name', 'userId']);
    expect(b?.email).toBe('plat-mem-b@dev.local');
    expect(b?.userId).toBe(await userIdOf(t, 'plat-mem-b'));
    expect(b?.assignments).toHaveLength(2);
    expect(o?.assignments).toHaveLength(1);
  });

  it('shows a member who holds no assignment, with an empty list', async () => {
    const org = await createOrg(t, 'Bare Org', 'bare-org');
    await inviteAndLogin(t, org.id, 'plat-bare', 'viewer', { type: 'org' });
    const id = await userIdOf(t, 'plat-bare');
    const granted = await grant(t, org.id, id, 'viewer', { type: 'org' });
    await revoke(t, org.id, granted.id);
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/platform/orgs/${org.id}/members`,
      headers: { cookie: admin },
    });
    const page = expectContract('platform.listMembers', res) as Page<PlatformMemberDto>;
    expect(page.items.map((i) => [i.userId, i.assignments])).toEqual([[id, []]]);
  });

  it('answers 404 for an unknown org and 403 for a non-platform user, including an org owner', async () => {
    const org = await createOrg(t, 'Guard Members', 'guard-members');
    const owner = await inviteAndLogin(t, org.id, 'plat-guard-o', 'owner', { type: 'org' });
    const unknown = await t.app.inject({
      method: 'GET',
      url: `/api/platform/orgs/${randomUUID()}/members`,
      headers: { cookie: admin },
    });
    expect(unknown.statusCode).toBe(404);
    const denied = await t.app.inject({
      method: 'GET',
      url: `/api/platform/orgs/${org.id}/members`,
      headers: { cookie: owner },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.body).not.toContain('@dev.local');
    const anon = await t.app.inject({ method: 'GET', url: `/api/platform/orgs/${org.id}/members` });
    expect(anon.statusCode).toBe(401);
  });

  it('BR-38: the platform admin reads projects and members through /api/platform but is refused on the tenant routes', async () => {
    const org = await createOrg(t, 'Split Org', 'split-org');
    await seedProject(org.id, 'S1');
    await inviteAndLogin(t, org.id, 'plat-split-o', 'owner', { type: 'org' });
    for (const leaf of ['projects', 'members']) {
      const res = await t.app.inject({
        method: 'GET',
        url: `/api/platform/orgs/${org.id}/${leaf}`,
        headers: { cookie: admin },
      });
      expect(res.statusCode, leaf).toBe(200);
      expect(res.json<Page<unknown>>().total, leaf).toBeGreaterThan(0);
    }
    for (const leaf of ['members', 'invitations']) {
      const res = await t.app.inject({
        method: 'GET',
        url: `/api/orgs/${org.id}/${leaf}`,
        headers: { cookie: admin },
      });
      expect([403, 404], leaf).toContain(res.statusCode);
      expect(res.body, leaf).not.toContain('plat-split-o');
    }
  });
});

describe('platform admin from the database', () => {
  it('deleting the entry makes the same session a 403 on the next call', async () => {
    await seedPlatformAdmin(t.db, 'cfg-rm@dev.local');
    const cookie = cookieOf(await t.app.inject({ method: 'GET', url: '/auth/dev-login?handle=cfg-rm' }));
    const before = await t.app.inject({ method: 'GET', url: '/api/platform/orgs', headers: { cookie } });
    expect(before.statusCode).toBe(200);
    await t.db.pool.query('delete from platform_admins where email = $1', ['cfg-rm@dev.local']);
    const res = await t.app.inject({ method: 'GET', url: '/api/platform/orgs', headers: { cookie } });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { detail: string }).detail).toBe(FORBIDDEN_DETAIL);
  });

  it('dev-login of admin leaves the user email verified', async () => {
    const rows = await t.db.pool.query('select email_verified from "user" where email = $1', ['admin@dev.local']);
    expect(rows.rows[0]?.email_verified).toBe(true);
  });

  it('dev-login marks a user that was created unverified as verified on its next login', async () => {
    const home = await createOrg(t, 'Carol Home', 'carol-home');
    await inviteAndLogin(t, home.id, 'carol', 'viewer', { type: 'org' });
    await t.db.pool.query('update "user" set email_verified = false where email = \'carol@dev.local\'');
    await loginAs(t, 'carol');
    const rows = await t.db.pool.query('select email_verified from "user" where email = \'carol@dev.local\'');
    expect(rows.rows[0]?.email_verified).toBe(true);
  });
});

describe('platform admin sign-up (BR-62, N9)', () => {
  it('BR-62: a seeded email signs up with no invitation, has no membership and no active org', async () => {
    const fresh = t;
    await seedPlatformAdmin(fresh.db, 'fresh-pa@dev.local');
    const login = await fresh.app.inject({ method: 'GET', url: '/auth/dev-login?handle=fresh-pa' });
    expect(login.statusCode).toBe(302);
    const cookie = cookieOf(login);
    const users = await fresh.db.pool.query<{ id: string; email_verified: boolean }>(
      'select id, email_verified from "user" where email = $1',
      ['fresh-pa@dev.local'],
    );
    expect(users.rows).toHaveLength(1);
    expect(users.rows[0]?.email_verified).toBe(true);
    const id = users.rows[0]?.id;
    const members = await fresh.db.pool.query('select 1 from member where user_id = $1', [id]);
    expect(members.rows).toHaveLength(0);
    const orgs = await fresh.app.inject({ method: 'GET', url: '/api/platform/orgs', headers: { cookie } });
    expect(orgs.statusCode).toBe(200);
    const sess = await fresh.app.inject({ method: 'GET', url: '/auth/get-session', headers: { cookie } });
    expect(sess.json<{ session: { activeOrganizationId: string | null } }>().session.activeOrganizationId).toBeNull();
  });

  it('N9: dev-login is absent when the config is production', async () => {
    const prod = await createTestApp({
      env: {
        NODE_ENV: 'production',
        AUTH_DEV_LOGIN: 'false',
        ENABLE_FAKE_PROVIDER: 'false',
        KUBE_MODE: 'incluster',
        RUN_VOLUME_STORAGE_CLASS: 'delete-on-release',
      },
      kube: new FakeKubeGateway(join(freshStateDir(), 'kube')),
    });
    try {
      const res = await prod.app.inject({ method: 'GET', url: '/auth/dev-login?handle=prod-probe' });
      expect(res.statusCode).toBe(404);
      expect(res.headers['set-cookie']).toBeUndefined();
      const users = await prod.db.pool.query('select 1 from "user" where email = \'prod-probe@dev.local\'');
      expect(users.rows).toHaveLength(0);
    } finally {
      await prod.close();
    }
  });
});
