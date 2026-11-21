import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  CreateOrgResponse,
  Page,
  PlatformMemberDto,
  PlatformOrgDto,
  PlatformProjectDto,
  RoleDto,
} from '@agentdesk/contracts';
import { FakeKubeGateway } from '@agentdesk/core';
import { connections, projects, withOrg } from '@agentdesk/db';
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
    expect(owner?.permissions).toHaveLength(33);
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
      expect(Object.keys(item).sort()).toEqual(['createdAt', 'id', 'memberCount', 'name', 'slug']);
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

describe('platform admin from config', () => {
  it('removing the email from config makes the same session a 403 on the next call', async () => {
    const strict = await createTestApp({ env: { PLATFORM_ADMIN_EMAILS: '' } });
    try {
      const res = await strict.app.inject({ method: 'GET', url: '/api/platform/orgs', headers: { cookie: admin } });
      expect(res.statusCode).toBe(403);
      expect((res.json() as { detail: string }).detail).toBe(FORBIDDEN_DETAIL);
    } finally {
      await strict.close();
    }
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
  it('BR-62: the configured email signs up with no invitation, has no membership and no active org', async () => {
    const fresh = await createTestApp({ env: { PLATFORM_ADMIN_EMAILS: 'fresh-pa@dev.local' } });
    try {
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
    } finally {
      await fresh.close();
    }
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
