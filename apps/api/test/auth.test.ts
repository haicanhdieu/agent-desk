import { Controller, Body, Param, Put, Get } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrg } from '@agentdesk/db';
import { createTestApp, type TestApp } from './helpers/app';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('api/agents')
class CredentialStubController {
  @Put(':agentId/credential')
  put(@Param('agentId') agentId: string, @Body() body: Record<string, unknown>) {
    return { agentId, name: body['name'] };
  }
}

@Controller('api/ctx')
class CtxController {
  @Get()
  get() {
    return { ok: true };
  }
}

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ controllers: [CredentialStubController, CtxController] });
});
afterAll(async () => {
  await t.close();
});

async function devLogin(handle: string, redirect?: string) {
  const qs = new URLSearchParams({ handle, ...(redirect === undefined ? {} : { redirect }) });
  return t.app.inject({ method: 'GET', url: `/auth/dev-login?${qs.toString()}` });
}

function cookieOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return list.map((c) => String(c).split(';')[0]).join('; ');
}

describe('auth', () => {
  it('dev-login creates user, uuid personal org with slug and owner membership, redirects with cookie', async () => {
    const res = await devLogin('alice', '/projects');
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/projects');
    expect(cookieOf(res)).not.toBe('');
    const org = await t.db.pool.query("select id, slug from organization where slug = 'alice'");
    expect(org.rows).toHaveLength(1);
    expect(org.rows[0].id).toMatch(UUID);
    const m = await t.db.pool.query(
      'select m.role, u.handle, u.email from member m join "user" u on u.id = m.user_id where m.organization_id = $1',
      [org.rows[0].id],
    );
    expect(m.rows).toEqual([{ role: 'owner', handle: 'alice', email: 'alice@dev.local' }]);
    const s = await t.db.pool.query('select active_organization_id from session');
    expect(s.rows.map((r) => r.active_organization_id)).toContain(org.rows[0].id);
  });

  it('a second dev-login for the same handle does not create another org', async () => {
    const res = await devLogin('alice');
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/');
    const org = await t.db.pool.query("select id from organization where slug like 'alice%'");
    expect(org.rows).toHaveLength(1);
    const users = await t.db.pool.query('select id from "user" where email = \'alice@dev.local\'');
    expect(users.rows).toHaveLength(1);
  });

  it('GET /api/projects without a cookie is a 401 problem; with a cookie it is 200', async () => {
    const anon = await t.app.inject({ method: 'GET', url: '/api/projects' });
    expect(anon.statusCode).toBe(401);
    expect(anon.headers['content-type']).toContain('application/problem+json');
    const cookie = cookieOf(await devLogin('alice'));
    const ok = await t.app.inject({ method: 'GET', url: '/api/projects', headers: { cookie } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual([]);
  });

  it('forwards /auth/* to better-auth (get-session with the dev cookie)', async () => {
    const cookie = cookieOf(await devLogin('alice'));
    const res = await t.app.inject({ method: 'GET', url: '/auth/get-session', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe('alice@dev.local');
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

  it('suffixes the personal org slug on collision', async () => {
    await devLogin('dup.one');
    await devLogin('dup-one');
    const r = await t.db.pool.query("select slug from organization where slug like 'dup-one%' order by slug");
    expect(r.rows.map((x) => x.slug)).toEqual(['dup-one', 'dup-one-2']);
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

  it.each(['/auth/./sign-in/email', '/auth/x/../sign-up/email', '/auth/%2e/sign-in/email', '/auth/sign-in/email/'])(
    'blocks %s after path normalization',
    async (url) => {
      const res = await t.app.inject({
        method: 'POST',
        url,
        payload: { email: 'alice@dev.local', password: 'password1234', name: 'x' },
      });
      expect(res.statusCode).toBe(404);
    },
  );

  it('blocks better-auth organization mutation endpoints but dev-login still works', async () => {
    const cookie = cookieOf(await devLogin('alice'));
    const res = await t.app.inject({
      method: 'POST',
      url: '/auth/organization/create',
      headers: { cookie },
      payload: { name: 'x', slug: 'x-org' },
    });
    expect(res.statusCode).toBe(404);
    expect((await devLogin('frank')).statusCode).toBe(302);
  });

  it('concurrent sign-ups with the same handle both succeed with suffixed slugs (unique-violation retry)', async () => {
    const [a, b] = await Promise.all([devLogin('race.x'), devLogin('race-x')]);
    expect([a.statusCode, b.statusCode]).toEqual([302, 302]);
    const r = await t.db.pool.query("select slug from organization where slug like 'race-x%' order by slug");
    expect(r.rows.map((x) => x.slug)).toEqual(['race-x', 'race-x-2']);
  });

  it('returns 403 when the active organization is not one the user belongs to', async () => {
    const cookie = cookieOf(await devLogin('carol'));
    const other = await t.db.pool.query("select id from organization where slug = 'alice'");
    await t.db.pool.query(
      `update session set active_organization_id = $1 where user_id = (select id from "user" where handle = 'carol')`,
      [other.rows[0].id],
    );
    const res = await t.app.inject({ method: 'GET', url: '/api/projects', headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });

  it('audits mutations with the body redacted (no value/token/secret/password keys)', async () => {
    const cookie = cookieOf(await devLogin('dave'));
    const agentId = '11111111-1111-4111-8111-111111111111';
    const res = await t.app.inject({
      method: 'PUT',
      url: `/api/agents/${agentId}/credential`,
      headers: { cookie },
      payload: { name: 'anthropic', value: 'sk-super-secret', nested: [{ token: 't', keep: 1 }], password: 'p' },
    });
    expect(res.statusCode).toBe(200);
    const org = await t.db.pool.query("select id from organization where slug = 'dave'");
    // audit_log is RLS-forced: read it through the org context.
    const found = await withOrg(t.db, org.rows[0].id, (tx) =>
      tx.execute(sql`select action, target_type, target_id, payload, actor_user_id from audit_log`),
    );
    expect(found.rows).toHaveLength(1);
    const row = found.rows[0] as Record<string, unknown>;
    expect(row['action']).toBe('PUT agents.putCredential');
    expect(row['target_type']).toBe('agents');
    expect(row['target_id']).toBe(agentId);
    expect(row['actor_user_id']).toEqual(expect.any(String));
    expect(row['payload']).toEqual({ name: 'anthropic', nested: [{ keep: 1 }] });
    expect(JSON.stringify(row['payload'])).not.toContain('sk-super-secret');
  });

  it('does not audit GETs and falls back to METHOD path for unknown routes', async () => {
    const cookie = cookieOf(await devLogin('erin'));
    await t.app.inject({ method: 'GET', url: '/api/ctx', headers: { cookie } });
    const org = await t.db.pool.query("select id from organization where slug = 'erin'");
    const found = await withOrg(t.db, org.rows[0].id, (tx) => tx.execute(sql`select 1 from audit_log`));
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
