import { randomUUID } from 'node:crypto';
import type { InjectOptions } from 'fastify';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page, PlatformAdminDto } from '@agentdesk/contracts';
import { FORBIDDEN_DETAIL } from '../src/access/authorize';
import { createTestApp, type TestApp } from './helpers/app';
import { asPlatformAdmin, createOrg, grantPlatformAdmin, inviteAndLogin, loginAs, userIdOf } from './helpers/auth';
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
      expect(Object.keys(item).sort()).toEqual(['email', 'grantedAt', 'grantedBy', 'handle', 'id', 'name', 'userId']);
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
const auditRows = async (email: string) =>
  (
    await t.db.pool.query<AuditRow>(
      "select actor_user_id, action, target_type, target_id, payload, created_at::text as created_at from platform_audit_log where payload->>'email' = $1",
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
