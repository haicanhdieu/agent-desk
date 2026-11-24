import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { InjectOptions } from 'fastify';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NO_INVITATION_CODE, type Page, type PlatformAdminDto } from '@agentdesk/contracts';
import { FORBIDDEN_DETAIL } from '../src/access/authorize';
import { startPg } from '@agentdesk/db/testing';
import { createTestApp, type TestApp } from './helpers/app';
import {
  asPlatformAdmin,
  createOrg,
  grantPlatformAdmin,
  inviteAndLogin,
  loginAs,
  revokePlatformAdmin,
  userIdOf,
} from './helpers/auth';
import { expectContract } from './helpers/contract';
import { installFake, makeProject, wideFakeRepos } from './helpers/fixtures';

let t: TestApp;
let admin: string;
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
  t = await createTestApp({ logger, wrapAdapters: wideFakeRepos });
  admin = await asPlatformAdmin(t);
});
afterAll(async () => {
  await t.close();
});

const list = (cookie: string, query = '', headers: Record<string, string> = {}) =>
  t.app.inject({ method: 'GET', url: `/api/platform/admins${query}`, headers: { cookie, ...headers } });

const listAll = async (): Promise<Page<PlatformAdminDto>> => {
  const res = await list(admin, '?pageSize=100');
  expectContract('platform.listAdmins', res);
  return res.json<Page<PlatformAdminDto>>();
};

describe('GET /api/platform/admins', () => {
  it('BR-1: lists every entry with exactly the documented keys', async () => {
    const adminId = await userIdOf(t, 'admin');
    await t.db.pool.query('insert into platform_admins (email, granted_by) values ($1, $2), ($3, $4), ($5, null)', [
      'lst-granted@dev.local',
      adminId,
      'lst-stray@dev.local',
      randomUUID(),
      'lst-noacct@dev.local',
    ]);
    await loginAs(t, 'lst-granted');
    await loginAs(t, 'lst-stray');

    const res = await list(admin, '?pageSize=100');
    expectContract('platform.listAdmins', res);
    const raw = res.json<{ items: Record<string, unknown>[] }>().items;
    for (const item of raw)
      expect(Object.keys(item).sort()).toEqual([
        'email',
        'grantedAt',
        'grantedBy',
        'handle',
        'id',
        'lastWorkingAdmin',
        'name',
        'userId',
      ]);
    const byEmail = (email: string) => raw.find((i) => i['email'] === email);

    const self = byEmail('admin@dev.local');
    expect(self).toMatchObject({ userId: adminId, handle: 'admin', grantedBy: null });
    expect(typeof self?.['name']).toBe('string');

    const granted = byEmail('lst-granted@dev.local');
    expect(granted?.['userId']).toBe(await userIdOf(t, 'lst-granted'));
    expect(granted?.['grantedBy']).toEqual({ name: self?.['name'], handle: 'admin' });
    expect(granted?.['handle']).toBe('lst-granted');

    expect(byEmail('lst-stray@dev.local')?.['grantedBy']).toBeNull();

    // BR-29 list part: an entry with no account has null account fields
    expect(byEmail('lst-noacct@dev.local')).toMatchObject({ userId: null, name: null, handle: null, grantedBy: null });
  });

  it('orders by granted_at desc, then id', async () => {
    await t.db.pool.query(
      "insert into platform_admins (email, granted_at) values ('ord-old@dev.local', now() - interval '2 days'), ('ord-new@dev.local', now() + interval '2 days')",
    );
    const page = await listAll();
    const emails = page.items.map((i) => i.email);
    expect(emails[0]).toBe('ord-new@dev.local');
    expect(emails.indexOf('ord-old@dev.local')).toBeGreaterThan(emails.indexOf('admin@dev.local'));
    const expected = await t.db.pool.query<{ id: string }>(
      'select id from platform_admins order by granted_at desc, id',
    );
    expect(page.items.map((i) => i.id)).toEqual(expected.rows.map((r) => r.id));
  });

  it('entries with the same granted_at page by id, each exactly once', async () => {
    const client = await t.db.pool.connect();
    try {
      await client.query('begin');
      for (const n of ['tie-a', 'tie-b', 'tie-c']) {
        await client.query('insert into platform_admins (email) values ($1)', [`${n}@dev.local`]);
      }
      await client.query('commit');
    } finally {
      client.release();
    }
    const expected = await t.db.pool.query<{ id: string }>(
      'select id from platform_admins order by granted_at desc, id',
    );
    const ids: string[] = [];
    for (let page = 1; page <= expected.rows.length; page += 1) {
      const res = await list(admin, `?page=${page}&pageSize=1`);
      expectContract('platform.listAdmins', res);
      const body = res.json<Page<PlatformAdminDto>>();
      expect(body.total).toBe(expected.rows.length);
      ids.push(...body.items.map((i) => i.id));
    }
    expect(ids).toEqual(expected.rows.map((r) => r.id));
    expect(new Set(ids).size).toBe(ids.length);
    const tied = await t.db.pool.query<{ id: string }>(
      "select id from platform_admins where email like 'tie-%@dev.local' order by id",
    );
    const walked = ids.filter((id) => tied.rows.some((r) => r.id === id));
    expect(walked).toEqual(tied.rows.map((r) => r.id));
  });

  it('BR-15: every non-platform caller gets 403 before any lookup on the list', async () => {
    const org = await createOrg(t, 'Pa List Org', 'pa-list-org');
    const owner = await inviteAndLogin(t, org.id, 'pal-owner', 'owner', { type: 'org' });
    const orgAdmin = await inviteAndLogin(t, org.id, 'pal-admin', 'admin', { type: 'org' });
    const connectionId = await installFake(t, owner);
    const { projectId } = await makeProject(t, owner, connectionId);
    const projectAdmin = await inviteAndLogin(t, org.id, 'pal-padmin', 'admin', {
      type: 'project',
      projectIds: [projectId],
    });
    const member = await inviteAndLogin(t, org.id, 'pal-member', 'member', { type: 'org' });
    const viewer = await inviteAndLogin(t, org.id, 'pal-viewer', 'viewer', { type: 'org' });
    // a signed-in user with an account but no org: invited into another org and never accepted
    const other = await createOrg(t, 'Pa List Other', 'pa-list-other');
    const inviteRes = await t.app.inject({
      method: 'GET',
      url: `/api/platform/orgs/${other.id}/roles`,
      headers: { cookie: admin },
    });
    const roleId = inviteRes.json<{ id: string; key: string }[]>().find((r) => r.key === 'viewer')?.id;
    await t.app.inject({
      method: 'POST',
      url: `/api/platform/orgs/${other.id}/invitations`,
      headers: { cookie: admin },
      payload: { email: 'pal-noorg@dev.local', roleId, scope: { type: 'org' } },
    });
    const noOrg = await loginAs(t, 'pal-noorg');
    expect(noOrg).not.toBe('');

    logLines.length = 0;
    for (const cookie of [owner, orgAdmin, projectAdmin, member, viewer, noOrg]) {
      const res = await list(cookie);
      expect(res.statusCode).toBe(403);
      const body = res.json<{ detail: string; items?: unknown }>();
      expect(body.detail).toBe(FORBIDDEN_DETAIL);
      expect(body.items).toBeUndefined();
    }
    const denied = logLines.filter((l) => l['msg'] === 'access denied' && l['routeKey'] === 'platform.listAdmins');
    expect(denied).toHaveLength(6);
    expect(JSON.stringify(denied)).not.toContain('@');
  });

  it('ignores an org header', async () => {
    const org = await createOrg(t, 'Pa Header Org', 'pa-header-org');
    const res = await list(admin, '', { 'x-org-id': org.id });
    expect(res.statusCode).toBe(200);
    expectContract('platform.listAdmins', res);
  });
});

interface AuditRow {
  actor_user_id: string | null;
  action: string;
  target_type: string;
  target_id: string;
  payload: unknown;
  created_at: unknown;
}
/** Grant and revoke rows only: inviting the user into an org writes an `invitation.created` row with the same email (BR-44). */
const auditRows = async (email: string) =>
  (
    await t.db.pool.query<AuditRow>(
      "select actor_user_id, action, target_type, target_id, payload, created_at::text as created_at from platform_audit_log where payload->>'email' = $1 and action like 'platform_admin.%'",
      [email],
    )
  ).rows;
const entryRows = async (email: string) =>
  (await t.db.pool.query<{ id: string }>('select id from platform_admins where email = $1', [email])).rows;
const post = (cookie: string, payload: InjectOptions['payload'], headers: Record<string, string> = {}) =>
  t.app.inject({ method: 'POST', url: '/api/platform/admins', headers: { cookie, ...headers }, payload });

let grantOrgId: string | undefined;
/** A user with an account and a verified email: invited into one shared org as a viewer (the dev-login gate refuses an unknown handle). */
const users = new Map<string, string>();
const mkUser = async (handle: string): Promise<string> => {
  const known = users.get(handle);
  if (known !== undefined) return known;
  grantOrgId ??= (await createOrg(t, 'Pa Grant Users', 'pa-grant-users')).id;
  const cookie = await inviteAndLogin(t, grantOrgId, handle, 'viewer', { type: 'org' });
  users.set(handle, cookie);
  return cookie;
};

describe('POST /api/platform/admins', () => {
  it('BR-4: grants an existing verified user (201), stored lowercased and listed', async () => {
    await mkUser('gr-one');
    logLines.length = 0;
    const res = await post(admin, { email: 'gr-one@dev.local' });
    expect(res.statusCode).toBe(201);
    expectContract('platform.grantAdmin', res);
    const entry = res.json<PlatformAdminDto>();
    const userId = await userIdOf(t, 'gr-one');
    const adminId = await userIdOf(t, 'admin');
    expect(entry).toMatchObject({ email: 'gr-one@dev.local', userId, handle: 'gr-one' });
    expect((await listAll()).items.find((i) => i.id === entry.id)).toEqual(entry);

    expect(await auditRows('gr-one@dev.local')).toEqual([
      {
        actor_user_id: adminId,
        action: 'platform_admin.granted',
        target_type: 'platform_admin',
        target_id: entry.id,
        payload: { email: 'gr-one@dev.local', userId },
        created_at: expect.any(String),
      },
    ]);

    const line = logLines.find((l) => l['msg'] === 'platform admin granted');
    expect(line).toMatchObject({ actorUserId: adminId, adminId: entry.id, targetUserId: userId });
    expect(JSON.stringify(line)).not.toContain('@');
  });

  it("BR-5: the grantee's same cookie gets platformAdmin true and 200 on /api/platform/orgs", async () => {
    const cookie = await mkUser('gr-same');
    const before = await t.app.inject({ method: 'GET', url: '/api/platform/orgs', headers: { cookie } });
    expect(before.statusCode).toBe(403);
    expect((await grantPlatformAdmin(t, admin, 'gr-same@dev.local')).statusCode).toBe(201);
    const me = await t.app.inject({ method: 'GET', url: '/api/me/access', headers: { cookie } });
    expect(me.json<{ platformAdmin: boolean }>().platformAdmin).toBe(true);
    const after = await t.app.inject({ method: 'GET', url: '/api/platform/orgs', headers: { cookie } });
    expect(after.statusCode).toBe(200);
  });

  it.each([
    ['empty', { email: '' }],
    ['blank', { email: '   ' }],
    ['malformed', { email: 'not-an-email' }],
    ['255-character', { email: `${'a'.repeat(250)}@dev.local` }],
    ['missing', {}],
    ['extra-key', { email: 'gr-extra@dev.local', role: 'admin' }],
  ])('BR-6: %s body is 400 and grants nothing', async (_name, payload) => {
    await mkUser('gr-extra');
    const res = await post(admin, payload);
    expect(res.statusCode).toBe(400);
    const body = res.json<{ errors?: { pointer: string }[] }>();
    expect(body.errors?.length).toBeGreaterThan(0);
    expect(await entryRows('gr-extra@dev.local')).toEqual([]);
    expect(await auditRows('gr-extra@dev.local')).toEqual([]);
  });

  it('BR-6: trims and lowercases the email', async () => {
    await mkUser('gr-trim');
    const res = await post(admin, { email: '  GR-Trim@Dev.Local ' });
    expect(res.statusCode).toBe(201);
    expect(res.json<PlatformAdminDto>().email).toBe('gr-trim@dev.local');
  });

  it('BR-7: no user with the email is 404 pointing at /email, no row, no audit', async () => {
    const res = await post(admin, { email: 'gr-nobody@dev.local' });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ errors: { pointer: string }[] }>().errors.map((e) => e.pointer)).toEqual(['/email']);
    expect(await entryRows('gr-nobody@dev.local')).toEqual([]);
    expect(await auditRows('gr-nobody@dev.local')).toEqual([]);
  });

  it('BR-8: an unverified user is 422 pointing at /email, no row, no audit', async () => {
    await mkUser('gr-unver');
    await t.db.pool.query('update "user" set email_verified = false where email = $1', ['gr-unver@dev.local']);
    const res = await post(admin, { email: 'gr-unver@dev.local' });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ errors: { pointer: string }[] }>().errors.map((e) => e.pointer)).toEqual(['/email']);
    expect(await entryRows('gr-unver@dev.local')).toEqual([]);
    expect(await auditRows('gr-unver@dev.local')).toEqual([]);
  });

  it('BR-8: an entry plus an unverified session is 403', async () => {
    const cookie = await mkUser('gr-unver2');
    await t.db.pool.query('insert into platform_admins (email) values ($1)', ['gr-unver2@dev.local']);
    await t.db.pool.query('update "user" set email_verified = false where email = $1', ['gr-unver2@dev.local']);
    expect((await post(cookie, { email: 'gr-unver2@dev.local' })).statusCode).toBe(403);
  });

  it('BR-9: a repeat grant is 200 with the same id, one row, no second audit row', async () => {
    await mkUser('gr-rep');
    const first = await grantPlatformAdmin(t, admin, 'gr-rep@dev.local');
    const second = await grantPlatformAdmin(t, admin, 'gr-rep@dev.local');
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.entry.id).toBe(first.entry.id);
    expect(await entryRows('gr-rep@dev.local')).toHaveLength(1);
    expect(await auditRows('gr-rep@dev.local')).toHaveLength(1);
  });

  it('BR-15: every non-platform caller gets 403 before any lookup on grant, with the same body for a known and an unknown email', async () => {
    const org = await createOrg(t, 'Pa Grant Org', 'pa-grant-org');
    const owner = await inviteAndLogin(t, org.id, 'pag-owner', 'owner', { type: 'org' });
    const orgAdmin = await inviteAndLogin(t, org.id, 'pag-admin', 'admin', { type: 'org' });
    const connectionId = await installFake(t, owner);
    const { projectId } = await makeProject(t, owner, connectionId);
    const projectAdmin = await inviteAndLogin(t, org.id, 'pag-padmin', 'admin', {
      type: 'project',
      projectIds: [projectId],
    });
    const member = await inviteAndLogin(t, org.id, 'pag-member', 'member', { type: 'org' });
    const viewer = await inviteAndLogin(t, org.id, 'pag-viewer', 'viewer', { type: 'org' });
    const other = await createOrg(t, 'Pa Grant Other', 'pa-grant-other');
    const roles = await t.app.inject({
      method: 'GET',
      url: `/api/platform/orgs/${other.id}/roles`,
      headers: { cookie: admin },
    });
    const roleId = roles.json<{ id: string; key: string }[]>().find((r) => r.key === 'viewer')?.id;
    await t.app.inject({
      method: 'POST',
      url: `/api/platform/orgs/${other.id}/invitations`,
      headers: { cookie: admin },
      payload: { email: 'pag-noorg@dev.local', roleId, scope: { type: 'org' } },
    });
    const noOrg = await loginAs(t, 'pag-noorg');
    expect(noOrg).not.toBe('');

    for (const cookie of [owner, orgAdmin, projectAdmin, member, viewer, noOrg]) {
      const known = await post(cookie, { email: 'pag-viewer@dev.local' });
      const unknown = await post(cookie, { email: 'pag-nobody@dev.local' });
      expect(known.statusCode).toBe(403);
      expect(unknown.statusCode).toBe(403);
      expect(known.json<{ detail: string }>().detail).toBe(FORBIDDEN_DETAIL);
      expect(unknown.json<{ detail: string }>().detail).toBe(FORBIDDEN_DETAIL);
    }
    expect(await entryRows('pag-viewer@dev.local')).toEqual([]);
  });

  it("BR-15: a granted platform admin with no assignment gets 403, 404 or 409 and no data on another org's /api/orgs/:orgId routes, with and without x-org-id", async () => {
    const org = await createOrg(t, 'Pa Scope Org', 'pa-scope-org');
    const cookie = await mkUser('gr-scope');
    expect((await grantPlatformAdmin(t, admin, 'gr-scope@dev.local')).statusCode).toBe(201);
    for (const headers of [{}, { 'x-org-id': org.id }]) {
      const urls = [`/api/orgs/${org.id}/members`, `/api/orgs/${org.id}/projects`];
      if ('x-org-id' in headers) urls.push('/api/projects');
      for (const url of urls) {
        const res = await t.app.inject({ method: 'GET', url, headers: { cookie, ...headers } });
        // 409 is the org-mismatch refusal, only possible when x-org-id names an org that is not the active one
        const allowed = 'x-org-id' in headers ? [403, 404, 409] : [403, 404];
        expect(allowed, `${url} ${JSON.stringify(headers)} ${res.body}`).toContain(res.statusCode);
        expect(res.json<{ items?: unknown }>().items).toBeUndefined();
      }
    }
  });

  it('grant matches an account whose stored email has upper case', async () => {
    const cookie = await mkUser('pa-case');
    await t.db.pool.query('update "user" set email = $1 where email = $2', ['Pa-Case@Dev.Local', 'pa-case@dev.local']);
    const res = await post(admin, { email: 'pa-case@dev.local' });
    expect(res.statusCode).toBe(201);
    const entry = res.json<PlatformAdminDto>();
    expect(entry.email).toBe('pa-case@dev.local');
    const userId = (
      await t.db.pool.query<{ id: string }>('select id from "user" where lower(email) = $1', ['pa-case@dev.local'])
    ).rows[0]?.id;
    const listed = (await listAll()).items.find((i) => i.id === entry.id);
    expect(listed?.userId).toBe(userId);
    expect(typeof listed?.name).toBe('string');
    expect(typeof listed?.handle).toBe('string');
    const me = await t.app.inject({ method: 'GET', url: '/api/me/access', headers: { cookie } });
    expect(me.json<{ platformAdmin: boolean }>().platformAdmin).toBe(true);
  });

  it('concurrent grants of one email give one 201, one 200, one row and one audit row', async () => {
    await mkUser('gr-race');
    const results = await Promise.all([
      post(admin, { email: 'gr-race@dev.local' }),
      post(admin, { email: 'gr-race@dev.local' }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 201]);
    expect(await entryRows('gr-race@dev.local')).toHaveLength(1);
    expect(await auditRows('gr-race@dev.local')).toHaveLength(1);
  });

  it('grant to a seeded email with no account is 404 and changes nothing', async () => {
    await t.db.pool.query('insert into platform_admins (email) values ($1)', ['gr-seeded@dev.local']);
    const before = await entryRows('gr-seeded@dev.local');
    const res = await post(admin, { email: 'gr-seeded@dev.local' });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ errors: { pointer: string }[] }>().errors.map((e) => e.pointer)).toEqual(['/email']);
    expect(await entryRows('gr-seeded@dev.local')).toEqual(before);
    expect(await auditRows('gr-seeded@dev.local')).toEqual([]);
  });
});

describe('DELETE /api/platform/admins/:adminId', () => {
  const revokeRaw = (cookie: string, adminId: string) =>
    t.app.inject({ method: 'DELETE', url: `/api/platform/admins/${adminId}`, headers: { cookie } });

  it('BR-10: revoking another entry is 204 and it leaves the list', async () => {
    await mkUser('rv-one');
    const granted = await grantPlatformAdmin(t, admin, 'rv-one@dev.local');
    const adminUserId = await userIdOf(t, 'admin');
    const targetUserId = await userIdOf(t, 'rv-one');
    logLines.length = 0;
    const res = await revokeRaw(admin, granted.entry.id);
    expect(res.statusCode).toBe(204);
    expectContract('platform.revokeAdmin', res);
    expect((await listAll()).items.find((i) => i.id === granted.entry.id)).toBeUndefined();
    expect(await entryRows('rv-one@dev.local')).toEqual([]);

    const revoked = (await auditRows('rv-one@dev.local')).filter((r) => r.action === 'platform_admin.revoked');
    expect(revoked).toEqual([
      {
        actor_user_id: adminUserId,
        action: 'platform_admin.revoked',
        target_type: 'platform_admin',
        target_id: granted.entry.id,
        payload: { email: 'rv-one@dev.local', userId: targetUserId },
        created_at: expect.any(String),
      },
    ]);
    const line = logLines.find((l) => l['msg'] === 'platform admin revoked');
    expect(line).toMatchObject({ actorUserId: adminUserId, adminId: granted.entry.id, targetUserId });
    expect(JSON.stringify(line)).not.toContain('@');

    expect((await revokeRaw(admin, granted.entry.id)).statusCode).toBe(404);
    expect((await auditRows('rv-one@dev.local')).filter((r) => r.action === 'platform_admin.revoked')).toHaveLength(1);
  });

  it('a malformed adminId is 400', async () => {
    expect((await revokeRaw(admin, 'not-a-uuid')).statusCode).toBe(400);
  });

  it("BR-11: the revoked user's same cookie gets platformAdmin false and 403 on list, grant and /api/platform/orgs", async () => {
    const cookie = await mkUser('rv-same');
    const granted = await grantPlatformAdmin(t, admin, 'rv-same@dev.local');
    expect((await list(cookie)).statusCode).toBe(200);
    expect((await revokeRaw(admin, granted.entry.id)).statusCode).toBe(204);
    const me = await t.app.inject({ method: 'GET', url: '/api/me/access', headers: { cookie } });
    expect(me.json<{ platformAdmin: boolean }>().platformAdmin).toBe(false);
    expect((await list(cookie)).statusCode).toBe(403);
    expect((await post(cookie, { email: 'rv-same@dev.local' })).statusCode).toBe(403);
    const orgs = await t.app.inject({ method: 'GET', url: '/api/platform/orgs', headers: { cookie } });
    expect(orgs.statusCode).toBe(403);
  });

  it('BR-15: every non-platform caller gets 403 before any lookup on revoke, the same for a real and a random adminId', async () => {
    const org = await createOrg(t, 'Pa Revoke Org', 'pa-revoke-org');
    const owner = await inviteAndLogin(t, org.id, 'par-owner', 'owner', { type: 'org' });
    const orgAdmin = await inviteAndLogin(t, org.id, 'par-admin', 'admin', { type: 'org' });
    const connectionId = await installFake(t, owner);
    const { projectId } = await makeProject(t, owner, connectionId);
    const projectAdmin = await inviteAndLogin(t, org.id, 'par-padmin', 'admin', {
      type: 'project',
      projectIds: [projectId],
    });
    const member = await inviteAndLogin(t, org.id, 'par-member', 'member', { type: 'org' });
    const viewer = await inviteAndLogin(t, org.id, 'par-viewer', 'viewer', { type: 'org' });
    const other = await createOrg(t, 'Pa Revoke Other', 'pa-revoke-other');
    const roles = await t.app.inject({
      method: 'GET',
      url: `/api/platform/orgs/${other.id}/roles`,
      headers: { cookie: admin },
    });
    const roleId = roles.json<{ id: string; key: string }[]>().find((r) => r.key === 'viewer')?.id;
    await t.app.inject({
      method: 'POST',
      url: `/api/platform/orgs/${other.id}/invitations`,
      headers: { cookie: admin },
      payload: { email: 'par-noorg@dev.local', roleId, scope: { type: 'org' } },
    });
    const noOrg = await loginAs(t, 'par-noorg');
    expect(noOrg).not.toBe('');
    await mkUser('par-target');
    const target = await grantPlatformAdmin(t, admin, 'par-target@dev.local');

    for (const cookie of [owner, orgAdmin, projectAdmin, member, viewer, noOrg]) {
      const real = await revokeRaw(cookie, target.entry.id);
      const random = await revokeRaw(cookie, randomUUID());
      expect(real.statusCode).toBe(403);
      expect(random.statusCode).toBe(403);
      expect(real.json<{ detail: string }>().detail).toBe(FORBIDDEN_DETAIL);
      expect(random.json<{ detail: string }>().detail).toBe(FORBIDDEN_DETAIL);
    }
    expect(await entryRows('par-target@dev.local')).toHaveLength(1);
  });
});

/** A fresh database with only `admin@dev.local` seeded, for the cases that depend on the exact admin count. */
async function withFreshApp(fn: (f: TestApp, adminCookie: string) => Promise<void>): Promise<void> {
  const pgs = await startPg();
  try {
    const f = await createTestApp({ pg: pgs });
    try {
      await fn(f, await asPlatformAdmin(f));
    } finally {
      await f.close();
    }
  } finally {
    await pgs.stop();
  }
}

describe('DELETE /api/platform/admins/:adminId on a fresh database', () => {
  const entryId = async (f: TestApp, email: string): Promise<string> => {
    const res = await f.db.pool.query<{ id: string }>('select id from platform_admins where email = $1', [email]);
    const id = res.rows[0]?.id;
    if (id === undefined) throw new Error(`no entry for ${email}`);
    return id;
  };
  const audit = async (f: TestApp): Promise<string[]> =>
    (
      await f.db.pool.query<{ action: string }>('select action from platform_audit_log order by created_at, id')
    ).rows.map((r) => r.action);
  const verifiedUser = async (f: TestApp, handle: string): Promise<string> => {
    const org = (await createOrg(f, `Fresh ${handle}`, `fresh-${handle}`)).id;
    return inviteAndLogin(f, org, handle, 'viewer', { type: 'org' });
  };

  it('BR-12: revoking the last working admin is 409 and nothing changes, no audit', async () => {
    await withFreshApp(async (f, cookie) => {
      const id = await entryId(f, 'admin@dev.local');
      expect(await revokePlatformAdmin(f, cookie, id)).toBe(409);
      expect(await entryId(f, 'admin@dev.local')).toBe(id);
      expect(await audit(f)).toEqual([]);
      const res = await f.app.inject({ method: 'GET', url: '/api/platform/admins', headers: { cookie } });
      expect(res.statusCode).toBe(200);
    });
  });

  it('BR-13: self-revoke while another working admin remains is 204, then 403', async () => {
    await withFreshApp(async (f, cookie) => {
      await verifiedUser(f, 'rv-other');
      expect((await grantPlatformAdmin(f, cookie, 'rv-other@dev.local')).statusCode).toBe(201);
      expect(await revokePlatformAdmin(f, cookie, await entryId(f, 'admin@dev.local'))).toBe(204);
      const after = await f.app.inject({ method: 'GET', url: '/api/platform/admins', headers: { cookie } });
      expect(after.statusCode).toBe(403);
    });
  });

  it('BR-14: two last admins revoking each other at once give one 204 and one 409; one entry remains', async () => {
    await withFreshApp(async (f, cookie) => {
      const peerCookie = await verifiedUser(f, 'rv-peer');
      expect((await grantPlatformAdmin(f, cookie, 'rv-peer@dev.local')).statusCode).toBe(201);
      const adminEntry = await entryId(f, 'admin@dev.local');
      const peerEntry = await entryId(f, 'rv-peer@dev.local');
      // hold the table lock until both requests have passed the guard and wait on it, so neither is a 403 by timing
      const holder = await f.db.pool.connect();
      let statuses: number[];
      try {
        await holder.query('begin');
        await holder.query("select pg_advisory_xact_lock(hashtext('platform_admins'))");
        const both = Promise.all([
          revokePlatformAdmin(f, cookie, peerEntry),
          revokePlatformAdmin(f, peerCookie, adminEntry),
        ]);
        for (let i = 0; i < 200; i += 1) {
          const waiting = await holder.query<{ n: number }>(
            "select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted",
          );
          if ((waiting.rows[0]?.n ?? 0) >= 2) break;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        await holder.query('commit');
        statuses = await both;
      } finally {
        holder.release();
      }
      expect([...statuses].sort()).toEqual([204, 409]);
      const left = await f.db.pool.query('select 1 from platform_admins');
      expect(left.rows).toHaveLength(1);
      expect((await audit(f)).filter((a) => a === 'platform_admin.revoked')).toHaveLength(1);
    });
  });

  it('BR-29: a seeded email with no account is revocable (204) and never counts as the last working admin', async () => {
    await withFreshApp(async (f, cookie) => {
      await f.db.pool.query('insert into platform_admins (email) values ($1)', ['noacct@dev.local']);
      expect(await revokePlatformAdmin(f, cookie, await entryId(f, 'admin@dev.local'))).toBe(409);
      const seededId = await entryId(f, 'noacct@dev.local');
      expect(await revokePlatformAdmin(f, cookie, seededId)).toBe(204);
      const row = await f.db.pool.query<{ payload: unknown; target_id: string }>(
        "select payload, target_id from platform_audit_log where action = 'platform_admin.revoked'",
      );
      expect(row.rows).toEqual([{ payload: { email: 'noacct@dev.local', userId: null }, target_id: seededId }]);
    });
  });

  it('BR-30: an entry whose account was deleted', async () => {
    await withFreshApp(async (f, cookie) => {
      const org = (await createOrg(f, 'Orphan Org', 'orphan-org')).id;
      const roles = await f.app.inject({ method: 'GET', url: `/api/platform/orgs/${org}/roles`, headers: { cookie } });
      const roleId = roles.json<{ id: string; key: string }[]>().find((r) => r.key === 'viewer')?.id;
      const inv = await f.app.inject({
        method: 'POST',
        url: `/api/platform/orgs/${org}/invitations`,
        headers: { cookie },
        payload: { email: 'orphan@dev.local', roleId, scope: { type: 'org' } },
      });
      expect(inv.statusCode).toBe(201);
      expect(await loginAs(f, 'orphan')).not.toBe('');
      const granted = await grantPlatformAdmin(f, cookie, 'orphan@dev.local');
      expect(granted.statusCode).toBe(201);

      const owner = new pg.Pool({ connectionString: f.pg.ownerUrl, max: 1 });
      try {
        await owner.query('delete from "user" where email = $1', ['orphan@dev.local']);
        const listed = await f.app.inject({
          method: 'GET',
          url: '/api/platform/admins?pageSize=100',
          headers: { cookie },
        });
        const entry = listed.json<Page<PlatformAdminDto>>().items.find((i) => i.id === granted.entry.id);
        expect(entry).toMatchObject({ userId: null, name: null, handle: null, grantedBy: granted.entry.grantedBy });

        // the orphan does not count as a working admin (N-4)
        expect(await revokePlatformAdmin(f, cookie, await entryId(f, 'admin@dev.local'))).toBe(409);

        // revoke the pending invitation so only the entry lets the email sign up
        const removed = await f.app.inject({
          method: 'DELETE',
          url: `/api/platform/orgs/${org}/invitations/${inv.json<{ id: string }>().id}`,
          headers: { cookie },
        });
        expect(removed.statusCode).toBe(204);
        const again = await loginAs(f, 'orphan');
        expect(again).not.toBe('');
        const me = await f.app.inject({ method: 'GET', url: '/api/me/access', headers: { cookie: again } });
        expect(me.json<{ platformAdmin: boolean }>().platformAdmin).toBe(true);
        const orgs = await f.app.inject({ method: 'GET', url: '/api/platform/orgs', headers: { cookie: again } });
        expect(orgs.statusCode).toBe(200);

        expect(await revokePlatformAdmin(f, cookie, granted.entry.id)).toBe(204);
        await owner.query('delete from "user" where email = $1', ['orphan@dev.local']);
        const refused = await f.app.inject({ method: 'GET', url: '/auth/dev-login?handle=orphan' });
        expect(refused.statusCode).toBe(302);
        expect(refused.headers['location']).toBe(`/sign-in?error=${NO_INVITATION_CODE}`);
        expect(refused.headers['set-cookie']).toBeUndefined();
        const rows = await owner.query('select 1 from "user" where email = $1', ['orphan@dev.local']);
        expect(rows.rows).toHaveLength(0);
      } finally {
        await owner.end();
      }
    });
  });

  it('an entry whose account is unverified does not count as a working admin', async () => {
    await withFreshApp(async (f, cookie) => {
      await verifiedUser(f, 'unv');
      expect((await grantPlatformAdmin(f, cookie, 'unv@dev.local')).statusCode).toBe(201);
      const owner = new pg.Pool({ connectionString: f.pg.ownerUrl, max: 1 });
      try {
        await owner.query('update "user" set email_verified = false where email = $1', ['unv@dev.local']);
      } finally {
        await owner.end();
      }
      const adminEntry = await entryId(f, 'admin@dev.local');
      expect(await revokePlatformAdmin(f, cookie, adminEntry)).toBe(409);
      expect(await entryId(f, 'admin@dev.local')).toBe(adminEntry);
      expect((await audit(f)).filter((a) => a === 'platform_admin.revoked')).toEqual([]);
    });
  });
});

describe('lastWorkingAdmin on a fresh database', () => {
  const listAdmins = async (f: TestApp, cookie: string, query = '?pageSize=100'): Promise<PlatformAdminDto[]> => {
    const res = await f.app.inject({ method: 'GET', url: `/api/platform/admins${query}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    return res.json<Page<PlatformAdminDto>>().items;
  };
  const flags = (items: PlatformAdminDto[]): Record<string, boolean> =>
    Object.fromEntries(items.map((i) => [i.email, i.lastWorkingAdmin]));
  const verifiedUser = async (f: TestApp, handle: string): Promise<string> => {
    const org = (await createOrg(f, `Flag ${handle}`, `flag-${handle}`)).id;
    return inviteAndLogin(f, org, handle, 'viewer', { type: 'org' });
  };

  it('BR-16: is true only on the sole working admin, and false on both when two work', async () => {
    await withFreshApp(async (f, cookie) => {
      expect(flags(await listAdmins(f, cookie))).toEqual({ 'admin@dev.local': true });
      await verifiedUser(f, 'flag-two');
      const granted = await grantPlatformAdmin(f, cookie, 'flag-two@dev.local');
      expect(granted.statusCode).toBe(201);
      expect(granted.entry.lastWorkingAdmin).toBe(false);
      expect(flags(await listAdmins(f, cookie))).toEqual({ 'admin@dev.local': false, 'flag-two@dev.local': false });
      const repeat = await grantPlatformAdmin(f, cookie, 'flag-two@dev.local');
      expect(repeat.statusCode).toBe(200);
      expect(repeat.entry.lastWorkingAdmin).toBe(false);
    });
  });

  it('BR-16: a seeded entry with no account is never flagged and does not count', async () => {
    await withFreshApp(async (f, cookie) => {
      // a seeded entry with no account does not count, so a repeat grant cannot happen; the list still flags the sole admin
      await f.db.pool.query('insert into platform_admins (email) values ($1)', ['flag-noacct@dev.local']);
      expect(flags(await listAdmins(f, cookie))).toEqual({ 'admin@dev.local': true, 'flag-noacct@dev.local': false });
    });
  });

  it('BR-16: an unverified or deleted account is never flagged and does not count', async () => {
    await withFreshApp(async (f, cookie) => {
      await verifiedUser(f, 'flag-unv');
      await verifiedUser(f, 'flag-del');
      await grantPlatformAdmin(f, cookie, 'flag-unv@dev.local');
      await grantPlatformAdmin(f, cookie, 'flag-del@dev.local');
      const owner = new pg.Pool({ connectionString: f.pg.ownerUrl, max: 1 });
      try {
        await owner.query('update "user" set email_verified = false where email = $1', ['flag-unv@dev.local']);
        await owner.query('delete from "user" where email = $1', ['flag-del@dev.local']);
      } finally {
        await owner.end();
      }
      expect(flags(await listAdmins(f, cookie))).toEqual({
        'admin@dev.local': true,
        'flag-unv@dev.local': false,
        'flag-del@dev.local': false,
      });
    });
  });

  it('BR-16: page 1 and page 2 of a paged list carry the same value', async () => {
    await withFreshApp(async (f, cookie) => {
      await f.db.pool.query("insert into platform_admins (email, granted_at) values ($1, now() + interval '1 day')", [
        'flag-page@dev.local',
      ]);
      const first = await listAdmins(f, cookie, '?page=1&pageSize=1');
      const second = await listAdmins(f, cookie, '?page=2&pageSize=1');
      expect(first.map((i) => [i.email, i.lastWorkingAdmin])).toEqual([['flag-page@dev.local', false]]);
      expect(second.map((i) => [i.email, i.lastWorkingAdmin])).toEqual([['admin@dev.local', true]]);
    });
  });

  it('BR-16: revoking the flagged entry is 409, any other entry is 204', async () => {
    await withFreshApp(async (f, cookie) => {
      await verifiedUser(f, 'flag-rv');
      const items = await listAdmins(f, cookie);
      expect(items).toHaveLength(1);
      const sole = items[0];
      expect(sole?.lastWorkingAdmin).toBe(true);
      expect(await revokePlatformAdmin(f, cookie, sole?.id ?? '')).toBe(409);
      await f.db.pool.query('insert into platform_admins (email) values ($1)', ['flag-other@dev.local']);
      const other = (await listAdmins(f, cookie)).find((i) => i.email === 'flag-other@dev.local');
      expect(other?.lastWorkingAdmin).toBe(false);
      expect(await revokePlatformAdmin(f, cookie, other?.id ?? '')).toBe(204);
    });
  });
});
