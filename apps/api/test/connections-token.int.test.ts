import { generateKeyPairSync } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  PROVIDER_REAUTH_REQUIRED_PROBLEM_TYPE,
  PROVIDER_UNAVAILABLE_PROBLEM_TYPE,
  type ConnectionDto,
} from '@agentdesk/contracts';
import { signState } from '../src/connections/install-state';
import { createTestApp, type TestApp } from './helpers/app';
import { createOrg, inviteAndLogin, userIdOf } from './helpers/auth';
import { expectContract } from './helpers/contract';

/**
 * The GitHub user token behind `sync` and `complete`: an expired one is refreshed (and saved) before use, one that
 * cannot be refreshed or that GitHub rejects is a 409 "reconnect", and GitHub being down or limiting us is a 503/429.
 * GitHub itself is a stub on the global fetch: no network.
 */

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

interface Seen {
  url: string;
  authorization: string | null;
}

/** What the stubbed GitHub answers. `userStatus`/`installsStatus` fail those calls with a status (plus headers). */
interface GithubStub {
  refresh: 'ok' | 'bad_refresh_token' | 'down';
  userStatus?: number;
  userHeaders?: Record<string, string>;
  installsStatus?: number;
  installations: { id: number; login: string }[];
}

const NEW_ACCESS = 'ghu_new_access';
const NEW_REFRESH = 'ghr_new_refresh';

let t: TestApp;
let seen: Seen[];
let stub: GithubStub;
const realFetch = globalThis.fetch;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function installGithubStub(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const request = input instanceof Request ? input : undefined;
      const url = request?.url ?? (input instanceof URL ? input.href : String(input));
      const headers = new Headers(init?.headers ?? request?.headers);
      seen.push({ url, authorization: headers.get('authorization') });
      const { pathname, host } = new URL(url);
      if (host === 'github.com' && pathname === '/login/oauth/access_token') {
        if (stub.refresh === 'down') throw new TypeError('fetch failed');
        if (stub.refresh === 'bad_refresh_token') return json({ error: 'bad_refresh_token' });
        return json({
          access_token: NEW_ACCESS,
          refresh_token: NEW_REFRESH,
          token_type: 'bearer',
          expires_in: 28_800,
          refresh_token_expires_in: 15_811_200,
        });
      }
      if (host !== 'api.github.com') return realFetch(input as Request, init);
      if (pathname === '/user') {
        if (stub.userStatus !== undefined)
          return json({ message: 'upstream detail' }, stub.userStatus, stub.userHeaders);
        return json({ id: 100, login: 'me' });
      }
      if (pathname === '/user/installations') {
        if (stub.installsStatus !== undefined) return json({ message: 'upstream detail' }, stub.installsStatus);
        return json({
          installations: stub.installations.map((i) => ({
            id: i.id,
            account: { login: i.login, type: 'User', id: 100 },
          })),
        });
      }
      if (pathname.startsWith('/app/installations/')) {
        const id = Number(pathname.split('/').pop());
        return json({ id, account: { login: 'me' } });
      }
      return json({ message: 'not stubbed' }, 404);
    }),
  );
}

beforeAll(async () => {
  t = await createTestApp({
    env: {
      GITHUB_APP_ID: '1',
      GITHUB_APP_SLUG: 'agent-desk-test',
      GITHUB_PRIVATE_KEY: privateKey,
      GITHUB_WEBHOOK_SECRET: 'whsec',
      GITHUB_CLIENT_ID: 'cid',
      GITHUB_CLIENT_SECRET: 'csecret',
    },
  });
});
afterAll(async () => {
  await t.close();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function reset(next: Partial<GithubStub> = {}): void {
  seen = [];
  stub = { refresh: 'ok', installations: [{ id: 11, login: 'me' }], ...next };
  installGithubStub();
}

const HOUR = 3_600_000;
let counter = 0;

/** A new org with one owner who has linked a GitHub account with the given stored tokens. */
async function ownerWithGithub(tokens: {
  access?: string | null;
  refresh?: string | null;
  expiresAt?: Date | null;
}): Promise<{ cookie: string; orgId: string; userId: string; handle: string }> {
  counter += 1;
  const handle = `tok-owner-${counter}`;
  const orgId = (await createOrg(t, `Tok ${counter}`, `tok-${counter}`)).id;
  const cookie = await inviteAndLogin(t, orgId, handle, 'owner', { type: 'org' });
  const userId = await userIdOf(t, handle);
  await t.db.pool.query(
    `insert into account (id, account_id, provider_id, user_id, access_token, refresh_token, access_token_expires_at, updated_at)
     values ($1, $2, 'github', $3, $4, $5, $6, now())`,
    [
      `acct-${handle}`,
      `gh-${handle}`,
      userId,
      tokens.access === undefined ? 'ghu_old_access' : tokens.access,
      tokens.refresh === undefined ? 'ghr_old_refresh' : tokens.refresh,
      tokens.expiresAt === undefined ? new Date(Date.now() - HOUR) : tokens.expiresAt,
    ],
  );
  return { cookie, orgId, userId, handle };
}

const sync = (cookie: string) =>
  t.app.inject({ method: 'POST', url: '/api/connections/github/sync', headers: { cookie } });

async function storedTokens(
  userId: string,
): Promise<{ access: string | null; refresh: string | null; exp: Date | null }> {
  const r = await t.db.pool.query<{ a: string | null; r: string | null; e: Date | null }>(
    "select access_token a, refresh_token r, access_token_expires_at e from account where user_id = $1 and provider_id = 'github'",
    [userId],
  );
  const row = r.rows[0];
  return { access: row?.a ?? null, refresh: row?.r ?? null, exp: row?.e ?? null };
}

const githubUserCalls = () => seen.filter((s) => new URL(s.url).host === 'api.github.com' && s.url.includes('/user'));
const refreshCalls = () => seen.filter((s) => new URL(s.url).pathname === '/login/oauth/access_token');

function expectProblem(res: { statusCode: number; json: () => unknown }, status: number, type: string): void {
  expect(res.statusCode).toBe(status);
  const body = res.json() as { type: string; status: number; detail?: string };
  expect(body.type).toBe(type);
  expect(body.status).toBe(status);
  expect(JSON.stringify(body)).not.toContain('upstream detail');
}

describe('sync with the stored GitHub user token', () => {
  it('uses a token that is still valid as it is, without a refresh', async () => {
    reset();
    const o = await ownerWithGithub({ access: 'ghu_valid', expiresAt: new Date(Date.now() + HOUR) });
    const res = await sync(o.cookie);
    expect(res.statusCode).toBe(201);
    expect((expectContract('connections.sync', res) as ConnectionDto[]).map((c) => c.accountName)).toEqual(['me']);
    expect(refreshCalls()).toHaveLength(0);
    expect(new Set(githubUserCalls().map((c) => c.authorization))).toEqual(new Set(['token ghu_valid']));
  });

  it('refreshes an expired token, saves the new tokens, and syncs with the new one', async () => {
    reset();
    const o = await ownerWithGithub({});
    const res = await sync(o.cookie);
    expect(res.statusCode).toBe(201);
    expect(expectContract('connections.sync', res)).toHaveLength(1);
    expect(refreshCalls()).toHaveLength(1);
    expect(new Set(githubUserCalls().map((c) => c.authorization))).toEqual(new Set([`token ${NEW_ACCESS}`]));
    const stored = await storedTokens(o.userId);
    expect(stored.access).toBe(NEW_ACCESS);
    expect(stored.refresh).toBe(NEW_REFRESH);
    expect(stored.exp?.getTime()).toBeGreaterThan(Date.now());
    // The next sync needs no second refresh.
    expect((await sync(o.cookie)).statusCode).toBe(201);
    expect(refreshCalls()).toHaveLength(1);
  });

  it('refreshes once when two syncs of the same user run at the same time', async () => {
    reset();
    const o = await ownerWithGithub({});
    const [a, b] = await Promise.all([sync(o.cookie), sync(o.cookie)]);
    expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
    expect(refreshCalls()).toHaveLength(1);
  });

  it('a refresh GitHub refuses is a 409 "reconnect", not a 500, and keeps the stored tokens', async () => {
    reset({ refresh: 'bad_refresh_token' });
    const o = await ownerWithGithub({});
    const res = await sync(o.cookie);
    expectProblem(res, 409, PROVIDER_REAUTH_REQUIRED_PROBLEM_TYPE);
    expect(githubUserCalls()).toHaveLength(0);
    expect((await storedTokens(o.userId)).access).toBe('ghu_old_access');
  });

  it('an expired token with no refresh token is a 409 "reconnect"', async () => {
    reset();
    const o = await ownerWithGithub({ refresh: null });
    expectProblem(await sync(o.cookie), 409, PROVIDER_REAUTH_REQUIRED_PROBLEM_TYPE);
    expect(refreshCalls()).toHaveLength(0);
    expect(githubUserCalls()).toHaveLength(0);
  });

  it('a token GitHub rejects (revoked) is a 409 "reconnect"', async () => {
    reset({ userStatus: 401 });
    const o = await ownerWithGithub({ access: 'ghu_revoked', expiresAt: new Date(Date.now() + HOUR) });
    expectProblem(await sync(o.cookie), 409, PROVIDER_REAUTH_REQUIRED_PROBLEM_TYPE);
  });

  it('GitHub rate limiting is a 429 and a GitHub server error is a 503, never a 500', async () => {
    const o = await ownerWithGithub({ access: 'ghu_ok', expiresAt: new Date(Date.now() + HOUR) });
    reset({ userStatus: 403, userHeaders: { 'x-ratelimit-remaining': '0' } });
    expectProblem(await sync(o.cookie), 429, PROVIDER_UNAVAILABLE_PROBLEM_TYPE);
    reset({ installsStatus: 502 });
    expectProblem(await sync(o.cookie), 503, PROVIDER_UNAVAILABLE_PROBLEM_TYPE);
  });

  it('a user with no linked GitHub account keeps getting the org connections, with no GitHub call', async () => {
    reset();
    counter += 1;
    const orgId = (await createOrg(t, `Tok ${counter}`, `tok-${counter}`)).id;
    const cookie = await inviteAndLogin(t, orgId, `tok-nolink-${counter}`, 'owner', { type: 'org' });
    const res = await sync(cookie);
    expect(res.statusCode).toBe(201);
    expect(expectContract('connections.sync', res)).toEqual([]);
    expect(seen).toHaveLength(0);
  });

  it('a linked account that stores no tokens at all behaves as not linked: org connections, no GitHub call', async () => {
    reset();
    const o = await ownerWithGithub({ access: null, refresh: null, expiresAt: null });
    const res = await sync(o.cookie);
    expect(res.statusCode).toBe(201);
    expect(expectContract('connections.sync', res)).toEqual([]);
    expect(seen).toHaveLength(0);
  });

  it("never uses another user's token: a user without a linked account does not borrow one from the same org", async () => {
    reset();
    const o = await ownerWithGithub({ access: 'ghu_owner_only', expiresAt: new Date(Date.now() + HOUR) });
    const colleague = await inviteAndLogin(t, o.orgId, `tok-colleague-${counter}`, 'admin', { type: 'org' });
    const res = await sync(colleague);
    expect(res.statusCode).toBe(201);
    expect(seen).toHaveLength(0);
  });

  it('denied (403) for a member, with no GitHub call and nothing linked; another org sees none of it', async () => {
    reset();
    const o = await ownerWithGithub({ access: 'ghu_ok', expiresAt: new Date(Date.now() + HOUR) });
    const member = await inviteAndLogin(t, o.orgId, `tok-member-${counter}`, 'member', { type: 'org' });
    const viewer = await inviteAndLogin(t, o.orgId, `tok-viewer-${counter}`, 'viewer', { type: 'org' });
    for (const cookie of [member, viewer]) expect((await sync(cookie)).statusCode).toBe(403);
    expect(seen).toHaveLength(0);
    // Cross-tenant: the owner of another org syncing links nothing into this one and sees none of its rows.
    expect((await sync(o.cookie)).statusCode).toBe(201);
    const other = await ownerWithGithub({ access: 'ghu_other', expiresAt: new Date(Date.now() + HOUR) });
    const list = await t.app.inject({ method: 'GET', url: '/api/connections', headers: { cookie: other.cookie } });
    expect(list.json()).toEqual([]);
  });
});

describe('the install callback with the stored GitHub user token', () => {
  async function callback(o: { cookie: string; orgId: string; userId: string }, installationId: number) {
    const state = signState(t.config.BETTER_AUTH_SECRET, { orgId: o.orgId, userId: o.userId });
    return t.app.inject({
      method: 'GET',
      url: `/api/connections/github/callback?installation_id=${installationId}&state=${encodeURIComponent(state)}`,
      headers: { cookie: o.cookie },
    });
  }

  it('refreshes an expired token before the ownership check, then links the installation', async () => {
    reset();
    const o = await ownerWithGithub({});
    const res = await callback(o, 11);
    expect(res.statusCode).toBe(302);
    expect(refreshCalls()).toHaveLength(1);
    expect(new Set(githubUserCalls().map((c) => c.authorization))).toEqual(new Set([`token ${NEW_ACCESS}`]));
    expect((await storedTokens(o.userId)).access).toBe(NEW_ACCESS);
  });

  it('a refresh GitHub refuses is a 409 "reconnect", not a 500', async () => {
    reset({ refresh: 'bad_refresh_token' });
    const o = await ownerWithGithub({});
    expectProblem(await callback(o, 11), 409, PROVIDER_REAUTH_REQUIRED_PROBLEM_TYPE);
  });

  it('a token GitHub rejects is a 409 "reconnect"', async () => {
    reset({ installsStatus: 401 });
    const o = await ownerWithGithub({ access: 'ghu_revoked', expiresAt: new Date(Date.now() + HOUR) });
    expectProblem(await callback(o, 11), 409, PROVIDER_REAUTH_REQUIRED_PROBLEM_TYPE);
  });
});
