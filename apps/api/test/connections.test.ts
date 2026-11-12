import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { loginAs } from './helpers/auth';
import { expectContract } from './helpers/contract';

let t: TestApp;
let alice: string;
let bob: string;
beforeAll(async () => {
  t = await createTestApp();
  alice = await loginAs(t, 'alice');
  bob = await loginAs(t, 'bob');
});
afterAll(async () => {
  await t.close();
});

async function install(cookie: string) {
  return t.app.inject({ method: 'POST', url: '/api/connections/fake/install', headers: { cookie } });
}

describe('connections', () => {
  it('fake install round-trip creates a connection visible in the list and its repos', async () => {
    const res = await install(alice);
    expect(res.statusCode).toBe(201);
    const { url } = expectContract('connections.install', res) as { url: string };
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(`${t.config.PUBLIC_ORIGIN}/api/connections/fake/callback`);

    const cb = await t.app.inject({
      method: 'GET',
      url: `${parsed.pathname}${parsed.search}`,
      headers: { cookie: alice },
    });
    expect(cb.statusCode).toBe(302);
    const location = new URL(String(cb.headers['location']));
    expect(location.origin).toBe(t.config.PUBLIC_ORIGIN);
    expect(location.pathname).toBe('/o/alice/projects/new/repo');
    const connectionId = location.searchParams.get('connection');
    expect(connectionId).toMatch(/^[0-9a-f-]{36}$/);

    const list = await t.app.inject({ method: 'GET', url: '/api/connections', headers: { cookie: alice } });
    const conns = expectContract('connections.list', list) as { id: string; provider: string }[];
    expect(conns.map((c) => c.id)).toEqual([connectionId]);
    expect(conns[0]?.provider).toBe('fake');

    const repos = await t.app.inject({
      method: 'GET',
      url: `/api/connections/${connectionId}/repos`,
      headers: { cookie: alice },
    });
    const parsedRepos = expectContract('connections.repos', repos) as { repoPath: string }[];
    expect(parsedRepos.map((r) => r.repoPath)).toContain('dev/demo');

    // Reinstalling upserts: still one connection.
    const again = await install(alice);
    const u2 = new URL((again.json() as { url: string }).url);
    await t.app.inject({ method: 'GET', url: `${u2.pathname}${u2.search}`, headers: { cookie: alice } });
    const list2 = await t.app.inject({ method: 'GET', url: '/api/connections', headers: { cookie: alice } });
    expect(list2.json()).toHaveLength(1);
  });

  it('other orgs cannot see or use the connection (404, empty list)', async () => {
    const list = await t.app.inject({ method: 'GET', url: '/api/connections', headers: { cookie: bob } });
    expect(expectContract('connections.list', list)).toEqual([]);
    const aliceList = await t.app.inject({ method: 'GET', url: '/api/connections', headers: { cookie: alice } });
    const id = (aliceList.json() as { id: string }[])[0]?.id;
    const repos = await t.app.inject({
      method: 'GET',
      url: `/api/connections/${id}/repos`,
      headers: { cookie: bob },
    });
    expect(repos.statusCode).toBe(404);
  });

  it('callback with a tampered, malformed or expired state is a 400', async () => {
    const res = await install(alice);
    const state = new URL((res.json() as { url: string }).url).searchParams.get('state') ?? '';
    const [payload = '', sig = ''] = state.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ orgId: 'x', userId: 'y', exp: Date.now() + 60_000 })).toString(
      'base64url',
    );
    const cases = [`${payload}.${sig.slice(0, -2)}AA`, `${forgedPayload}.${sig}`, 'garbage', ''];
    for (const s of cases) {
      const cb = await t.app.inject({
        method: 'GET',
        url: `/api/connections/fake/callback?state=${encodeURIComponent(s)}`,
        headers: { cookie: alice },
      });
      expect(cb.statusCode, `state ${s}`).toBe(400);
    }
    const noState = await t.app.inject({
      method: 'GET',
      url: '/api/connections/fake/callback',
      headers: { cookie: alice },
    });
    expect(noState.statusCode).toBe(400);
  });

  it('rejects an expired state', async () => {
    const { signState } = await import('../src/connections/install-state');
    const state = signState(t.config.BETTER_AUTH_SECRET, { orgId: 'o', userId: 'u' }, new Date(Date.now() - 3600_000));
    const cb = await t.app.inject({
      method: 'GET',
      url: `/api/connections/fake/callback?state=${encodeURIComponent(state)}`,
      headers: { cookie: alice },
    });
    expect(cb.statusCode).toBe(400);
  });

  it('install for an unknown provider is a 400', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/connections/nope/install',
      headers: { cookie: alice },
    });
    expect(res.statusCode).toBe(400);
  });

  it('state is bound to its user: another user redeeming it gets 403, the owner can replay idempotently', async () => {
    const res = await install(alice);
    const u = new URL((res.json() as { url: string }).url);
    const path = `${u.pathname}${u.search}`;
    const stolen = await t.app.inject({ method: 'GET', url: path, headers: { cookie: bob } });
    expect(stolen.statusCode).toBe(403);
    expect((await t.app.inject({ method: 'GET', url: '/api/connections', headers: { cookie: bob } })).json()).toEqual(
      [],
    );
    const first = await t.app.inject({ method: 'GET', url: path, headers: { cookie: alice } });
    const replay = await t.app.inject({ method: 'GET', url: path, headers: { cookie: alice } });
    expect(first.statusCode).toBe(302);
    expect(replay.statusCode).toBe(302);
    expect(first.headers['location']).toBe(replay.headers['location']);
    const list = await t.app.inject({ method: 'GET', url: '/api/connections', headers: { cookie: alice } });
    expect(list.json()).toHaveLength(1);
  });

  it('a state signed for an org the user is not a member of is 403', async () => {
    const { signState } = await import('../src/connections/install-state');
    const org = await t.db.pool.query("select id from organization where slug = 'alice'");
    const bobId = await t.db.pool.query('select id from "user" where handle = \'bob\'');
    const state = signState(t.config.BETTER_AUTH_SECRET, { orgId: org.rows[0].id, userId: bobId.rows[0].id });
    const cb = await t.app.inject({
      method: 'GET',
      url: `/api/connections/fake/callback?state=${encodeURIComponent(state)}`,
      headers: { cookie: bob },
    });
    expect(cb.statusCode).toBe(403);
  });

  it('rejects repeated query parameters (array values) on the callback', async () => {
    const cb = await t.app.inject({
      method: 'GET',
      url: '/api/connections/fake/callback?state=a&state=b',
      headers: { cookie: alice },
    });
    expect(cb.statusCode).toBe(400);
  });

  it('two orgs can both install the fake provider (org-specific external id)', async () => {
    const carol = await loginAs(t, 'carol');
    const dave = await loginAs(t, 'dave');
    for (const cookie of [carol, dave]) {
      const u = new URL(((await install(cookie)).json() as { url: string }).url);
      const cb = await t.app.inject({ method: 'GET', url: `${u.pathname}${u.search}`, headers: { cookie } });
      expect(cb.statusCode).toBe(302);
      const list = await t.app.inject({ method: 'GET', url: '/api/connections', headers: { cookie } });
      expect(list.json()).toHaveLength(1);
    }
    const ids = await t.db.pool.query("select 1 from organization where slug in ('carol','dave')");
    expect(ids.rows).toHaveLength(2);
  });

  it('a successful callback resumes polling projects paused as token_revoked (cursor cleared, schedule unpaused)', async () => {
    const erin = await loginAs(t, 'erin');
    const complete = async () => {
      const u = new URL(((await install(erin)).json() as { url: string }).url);
      const cb = await t.app.inject({ method: 'GET', url: `${u.pathname}${u.search}`, headers: { cookie: erin } });
      expect(cb.statusCode).toBe(302);
      return new URL(String(cb.headers['location'])).searchParams.get('connection') ?? '';
    };
    const connectionId = await complete();
    const mk = async (repoPath: string, triggerMode: string) =>
      (
        await t.app.inject({
          method: 'POST',
          url: '/api/projects',
          headers: { cookie: erin },
          payload: { connectionId, repoPath, triggerMode, pollIntervalSeconds: 300 },
        })
      ).json() as { id: string };
    const revoked = await mk('dev/demo', 'polling');
    const orgId = String((await t.db.pool.query("select id from organization where slug = 'erin'")).rows[0].id);
    const sql = async (text: string, params: unknown[]) => {
      const c = await t.db.pool.connect();
      try {
        await c.query('begin');
        await c.query("select set_config('app.org_id', $1, true)", [orgId]);
        const res = await c.query(text, params);
        await c.query('commit');
        return res.rows;
      } finally {
        c.release();
      }
    };
    await sql(
      "update poll_cursors set paused_reason = 'token_revoked', last_error = 'x', failures = 2 where project_id = $1",
      [revoked.id],
    );
    t.temporal.reset();

    await complete();

    const rows = await sql('select paused_reason, last_error, failures from poll_cursors where project_id = $1', [
      revoked.id,
    ]);
    expect(rows).toEqual([{ paused_reason: null, last_error: null, failures: 0 }]);
    expect(t.temporal.callsOfKind('scheduleUnpause').map((c) => c.scheduleId)).toEqual([`poll-${revoked.id}`]);
  });
});
