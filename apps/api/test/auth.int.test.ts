import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrg } from '@agentdesk/db';
import { AUTH } from '../src/auth/auth';
import { createTestApp, type TestApp } from './helpers/app';
import { createOrg, grant, inviteAndLogin, revoke, userIdOf } from './helpers/auth';
import { expectContract } from './helpers/contract';
import { freshStateDir, installFake, makeProject, wideFakeRepos } from './helpers/fixtures';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ env: { FAKE_STATE_DIR: freshStateDir() }, wrapAdapters: wideFakeRepos });
});
afterAll(async () => {
  await t.close();
});

async function devLogin(handle: string, redirect?: string) {
  const qs = new URLSearchParams({ handle, ...(redirect === undefined ? {} : { redirect }) });
  return t.app.inject({ method: 'GET', url: `/auth/dev-login?${qs.toString()}` });
}

/** Creates an org named after `handle` and signs `handle` in as its owner through a real invitation. */
async function ownerOfNewOrg(handle: string): Promise<{ cookie: string; orgId: string }> {
  const orgId = (await createOrg(t, handle, handle)).id;
  const cookie = await inviteAndLogin(t, orgId, handle, 'owner', { type: 'org' });
  return { cookie, orgId };
}

function cookieOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return list.map((c) => String(c).split(';')[0]).join('; ');
}

describe('auth', () => {
  it("an invited handle's first dev-login creates no personal org and lands in the invited org", async () => {
    const orgId = (await createOrg(t, 'Invited Org', 'invited-org')).id;
    const orgsBefore = (await t.db.pool.query('select count(*)::int as n from organization')).rows[0]?.n;
    const cookie = await inviteAndLogin(t, orgId, 'alice', 'viewer', { type: 'org' });
    expect(cookie).not.toBe('');
    const res = await devLogin('alice', '/projects');
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/projects');
    expect(cookieOf(res)).not.toBe('');
    const orgsAfter = (await t.db.pool.query('select count(*)::int as n from organization')).rows[0]?.n;
    expect(orgsAfter).toBe(orgsBefore);
    const m = await t.db.pool.query(
      'select m.organization_id, u.handle, u.email from member m join "user" u on u.id = m.user_id where u.email = $1',
      ['alice@dev.local'],
    );
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0]).toMatchObject({ organization_id: orgId, handle: 'alice', email: 'alice@dev.local' });
    expect(orgId).toMatch(UUID);
    const s = await t.db.pool.query(
      'select active_organization_id from session where user_id = (select id from "user" where email = $1)',
      ['alice@dev.local'],
    );
    expect(s.rows.length).toBeGreaterThan(0);
    expect(s.rows.map((r) => r.active_organization_id)).toEqual(s.rows.map(() => orgId));
  });

  it('an uninvited handle is refused with 401, no cookie and no user', async () => {
    const res = await devLogin('uninvited');
    expect(res.statusCode).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
    const users = await t.db.pool.query('select 1 from "user" where email = \'uninvited@dev.local\'');
    expect(users.rows).toHaveLength(0);
    const orgs = await t.db.pool.query("select 1 from organization where slug like 'uninvited%'");
    expect(orgs.rows).toHaveLength(0);
  });

  it('a second dev-login for the same handle creates no second user or org', async () => {
    const res = await devLogin('alice');
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/');
    const users = await t.db.pool.query('select id from "user" where email = \'alice@dev.local\'');
    expect(users.rows).toHaveLength(1);
    const members = await t.db.pool.query('select 1 from member where user_id = $1', [users.rows[0]?.id]);
    expect(members.rows).toHaveLength(1);
  });

  it('GET /api/projects without a cookie is a 401 problem; with a cookie it is 200', async () => {
    const anon = await t.app.inject({ method: 'GET', url: '/api/projects' });
    expect(anon.statusCode).toBe(401);
    expect(anon.headers['content-type']).toContain('application/problem+json');
    const { cookie } = await ownerOfNewOrg('auth-alice');
    const ok = await t.app.inject({ method: 'GET', url: '/api/projects', headers: { cookie } });
    expect(ok.statusCode).toBe(200);
    expect(expectContract('projects.list', ok)).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
  });

  it('forwards /auth/* to better-auth (get-session with the dev cookie)', async () => {
    const { cookie } = await ownerOfNewOrg('auth-sess');
    const res = await t.app.inject({ method: 'GET', url: '/auth/get-session', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe('auth-sess@dev.local');
    const anon = await t.app.inject({ method: 'GET', url: '/auth/get-session' });
    expect(anon.json()).toBeNull();
  });

  it('keeps docs and health public', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/docs/json' })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
  });

  it.each(['https://evil.example', '//evil.example', '/\\evil.example', 'evil', '/a\r\nb'])(
    'rejects redirect %j with 400',
    async (redirect) => {
      const res = await devLogin('mallory', redirect);
      expect(res.statusCode).toBe(400);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.headers['set-cookie']).toBeUndefined();
    },
  );

  it('rejects an invalid handle with 400', async () => {
    expect((await devLogin('Bad Handle!')).statusCode).toBe(400);
  });

  it('blocks direct email/password sign-in and sign-up endpoints', async () => {
    for (const url of ['/auth/sign-in/email', '/auth/sign-up/email']) {
      const res = await t.app.inject({
        method: 'POST',
        url,
        payload: { email: 'alice@dev.local', password: 'password1234', name: 'x' },
      });
      expect(res.statusCode).toBe(404);
    }
  });

  it.each([
    '/auth/./sign-in/email',
    '/auth/x/../sign-up/email',
    '/auth/%2e/sign-in/email',
    '/auth/sign-in/email/',
    '/auth/organization/create/',
    '/auth/Organization/Delete',
    '/auth/organization/List-Members',
    '/auth/organization/list-members/',
    '/auth/organization/./get-full-organization',
    '/auth/organization/%2e/get-full-organization',
    '/auth//organization/list-members',
    '/auth/organization//list-members',
    '/auth/organization',
  ])('blocks %s after path normalization', async (url) => {
    const res = await t.app.inject({
      method: 'POST',
      url,
      payload: { email: 'alice@dev.local', password: 'password1234', name: 'x' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('blocks better-auth organization mutation endpoints but dev-login still works', async () => {
    const { cookie } = await ownerOfNewOrg('auth-block');
    const res = await t.app.inject({
      method: 'POST',
      url: '/auth/organization/create',
      headers: { cookie },
      payload: { name: 'x', slug: 'x-org' },
    });
    expect(res.statusCode).toBe(404);
    expect((await devLogin('auth-block')).statusCode).toBe(302);
  });

  it('a member with no assignment gets no member emails from the organization plugin read endpoints', async () => {
    const { cookie: ownerCookie, orgId } = await ownerOfNewOrg('leak-owner');
    const cookie = await inviteAndLogin(t, orgId, 'leak-locked', 'viewer', { type: 'org' });
    const userId = await userIdOf(t, 'leak-locked');
    await revoke(t, orgId, (await grant(t, orgId, userId, 'viewer', { type: 'org' })).id);
    // The RBAC route refuses this user, so the plugin must not hand out what that route withholds.
    expect(
      (await t.app.inject({ method: 'GET', url: `/api/orgs/${orgId}/members`, headers: { cookie } })).statusCode,
    ).toBe(403);
    for (const url of [
      `/auth/organization/list-members?organizationId=${orgId}`,
      `/auth/organization/get-full-organization?organizationId=${orgId}`,
    ]) {
      const res = await t.app.inject({ method: 'GET', url, headers: { cookie } });
      expect(res.body, url).not.toContain('@dev.local');
      expect(res.statusCode, url).toBe(404);
    }
    // The owner is a member too, and the plugin answers it nothing either: the surface is closed for everyone.
    const asOwner = await t.app.inject({
      method: 'GET',
      url: `/auth/organization/list-members?organizationId=${orgId}`,
      headers: { cookie: ownerCookie },
    });
    expect(asOwner.statusCode).toBe(404);
  });

  it('answers only the organization plugin endpoints the web uses and 404 for every other one', async () => {
    const { cookie } = await ownerOfNewOrg('plugin-surface');
    const auth = t.app.get(AUTH, { strict: false });
    const paths = Object.values(auth.api as Record<string, { path?: unknown }>)
      .map((endpoint) => endpoint.path)
      .filter((p): p is string => typeof p === 'string' && p.startsWith('/organization/'));
    // Guards the enumeration itself: the plugin exposes dozens of endpoints, not zero.
    expect(paths.length).toBeGreaterThan(20);
    const answered: string[] = [];
    for (const path of paths) {
      for (const method of ['GET', 'POST'] as const) {
        const res = await t.app.inject({
          method,
          url: `/auth${path}`,
          headers: { cookie },
          ...(method === 'POST' ? { payload: {} } : {}),
        });
        if (res.statusCode !== 404) answered.push(`${method} ${path}`);
      }
    }
    // Deny by default: a new plugin endpoint is unreachable until it is added to the allow list in auth.ts.
    expect(answered.sort()).toEqual(['GET /organization/list', 'POST /organization/set-active'].sort());
  });

  it('returns 403 when the active organization is not one the user belongs to', async () => {
    const { cookie } = await ownerOfNewOrg('carol');
    const otherOrgId = (await createOrg(t, 'Other', 'other-org')).id;
    // The point of this test: point a session at an org its user has no membership in.
    await t.db.pool.query(
      `update session set active_organization_id = $1 where user_id = (select id from "user" where handle = 'carol')`,
      [otherOrgId],
    );
    const res = await t.app.inject({ method: 'GET', url: '/api/projects', headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });

  it('audits mutations with the body redacted (no value/token/secret/password keys)', async () => {
    const { cookie, orgId } = await ownerOfNewOrg('dave');
    const { projectId } = await makeProject(t, cookie, await installFake(t, cookie));
    const agent = await t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/agent`, headers: { cookie } });
    const agentId = (agent.json() as { id: string }).id;
    const res = await t.app.inject({
      method: 'PUT',
      url: `/api/agents/${agentId}/credential`,
      headers: { cookie },
      payload: {
        type: 'api_key',
        value: 'sk-super-secret',
        nested: [{ token: 't', keep: 1 }],
        password: 'p',
      },
    });
    expect(res.statusCode).toBe(200);
    // audit_log is RLS-forced: read it through the org context.
    const found = await withOrg(t.db, orgId, (tx) =>
      tx.execute(
        sql`select action, target_type, target_id, payload, actor_user_id from audit_log where action like 'PUT %'`,
      ),
    );
    expect(found.rows).toHaveLength(1);
    const row = found.rows[0] as Record<string, unknown>;
    expect(row['action']).toBe('PUT agents.putCredential');
    expect(row['target_type']).toBe('agents');
    expect(row['target_id']).toBe(agentId);
    expect(row['actor_user_id']).toEqual(expect.any(String));
    expect(row['payload']).toEqual({ type: 'api_key', nested: [{ keep: 1 }] });
    expect(JSON.stringify(row['payload'])).not.toContain('sk-super-secret');
  });

  it('does not audit GETs', async () => {
    const { cookie, orgId } = await ownerOfNewOrg('erin');
    await t.app.inject({ method: 'GET', url: '/api/projects', headers: { cookie } });
    const found = await withOrg(t.db, orgId, (tx) =>
      tx.execute(sql`select action from audit_log where action like 'GET %'`),
    );
    expect(found.rows).toHaveLength(0);
  });
});

describe('auth with dev login disabled', () => {
  it('404s dev-login and the email endpoints', async () => {
    const off = await createTestApp({ env: { AUTH_DEV_LOGIN: 'false' } });
    try {
      expect((await off.app.inject({ method: 'GET', url: '/auth/dev-login?handle=x' })).statusCode).toBe(404);
      expect(
        (await off.app.inject({ method: 'GET', url: '/auth/dev-login?handle=Bad%20!&redirect=//x' })).statusCode,
      ).toBe(404);
      expect(
        (
          await off.app.inject({
            method: 'POST',
            url: '/auth/sign-in/email',
            payload: { email: 'a@b.co', password: 'x' },
          })
        ).statusCode,
      ).toBe(404);
    } finally {
      await off.close();
    }
  });
});
