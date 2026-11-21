import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { flattenRoutes, routeAccess, routes, type RouteKey } from '@agentdesk/contracts';
import { createTestApp, type TestApp } from './helpers/app';
import { asPlatformAdmin, createOrg, inviteAndLogin } from './helpers/auth';
import { freshStateDir, installFake, makeProject, wideFakeRepos } from './helpers/fixtures';

/** The header every org-scoped request carries (`ORG_HEADER`), written out so the test does not read it back. */
const withOrgHeader = (headers: Record<string, string>, orgId: string): Record<string, string> => ({
  ...headers,
  'x-org-id': orgId,
});

const ORG_SCOPES = new Set(['org', 'project', 'project-list', 'self', 'org-admin']);
const TERMINAL_KEYS: RouteKey[] = ['runs.terminal', 'setupTests.terminal'];

describe('the org header must be the active org', () => {
  let t: TestApp;
  const logLines: Record<string, unknown>[] = [];
  let orgA: string;
  let orgB: string;
  let orgC: string;
  let owner: string; // owner of A and B, session active in A
  let paCookie: string;
  let ownerId: string;
  let cProjectRepo: string;
  let keys: RouteKey[];
  const flat = flattenRoutes(routes);

  const urlOf = (key: RouteKey): string => {
    const def = flat[key];
    if (!def) throw new Error(`no route ${key}`);
    return def.path.replace(/:([A-Za-z]+)/g, (_m, name: string) => (name === 'orgId' ? orgA : randomUUID()));
  };
  const send = (key: RouteKey, headers: Record<string, string>) => {
    const def = flat[key];
    if (!def) throw new Error(`no route ${key}`);
    return t.app.inject({ method: def.method, url: urlOf(key), headers });
  };

  async function snapshot(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    const client = await t.db.pool.connect();
    try {
      for (const orgId of [orgA, orgB, orgC]) {
        await client.query('begin');
        await client.query("select set_config('app.org_id', $1, true)", [orgId]);
        for (const table of ['projects', 'rules', 'role_assignments', 'invitations', 'audit_log']) {
          const res = await client.query<{ n: number }>(`select count(*)::int as n from ${table}`);
          out[`${orgId}:${table}`] = Number(res.rows[0]?.n);
        }
        await client.query('commit');
      }
    } finally {
      client.release();
    }
    return out;
  }

  beforeAll(async () => {
    const logger = pino(
      { level: 'info' },
      {
        write: (line: string) => {
          logLines.push(JSON.parse(line) as Record<string, unknown>);
        },
      },
    );
    t = await createTestApp({
      env: { FAKE_STATE_DIR: freshStateDir() },
      wrapAdapters: wideFakeRepos,
      logger,
    });
    orgA = (await createOrg(t, 'Check A', 'check-a')).id;
    orgB = (await createOrg(t, 'Check B', 'check-b')).id;
    orgC = (await createOrg(t, 'Check C', 'check-c')).id;
    await inviteAndLogin(t, orgA, 'oc-owner', 'owner', { type: 'org' });
    owner = await inviteAndLogin(t, orgB, 'oc-owner', 'owner', { type: 'org' });
    const row = await t.db.pool.query<{ id: string }>(`select id from "user" where email = 'oc-owner@dev.local'`);
    ownerId = row.rows[0]?.id ?? '';
    await t.db.pool.query('update session set active_organization_id = $1 where user_id = $2', [orgA, ownerId]);
    paCookie = await asPlatformAdmin(t);
    const carol = await inviteAndLogin(t, orgC, 'oc-carol', 'owner', { type: 'org' });
    cProjectRepo = (await makeProject(t, carol, await installFake(t, carol))).repoPath;

    const fastify = t.app.getHttpAdapter().getInstance();
    keys = (Object.keys(routeAccess) as RouteKey[]).filter((k) => {
      const def = flat[k];
      const access = routeAccess[k];
      if (!def || TERMINAL_KEYS.includes(k) || !ORG_SCOPES.has(access.scope)) return false;
      // keys whose controller a later task adds are skipped until they are registered
      return fastify.hasRoute({ method: def.method, url: def.path });
    });
    t.temporal.reset();
  });
  afterAll(async () => {
    await t.close();
  });

  it('covers every org, project, project-list, self and org-admin route that is registered', () => {
    expect(keys.length).toBeGreaterThan(50);
    for (const k of ['projects.list', 'projects.get', 'me.access', 'members.list', 'runs.events', 'projects.create']) {
      expect(keys).toContain(k);
    }
  });

  it('N-5: a header naming another org of the caller is 409 org-mismatch on every such route and changes nothing', async () => {
    const before = await snapshot();
    const bad: string[] = [];
    for (const key of keys) {
      const res = await send(key, withOrgHeader({ cookie: owner }, orgB));
      const type = res.statusCode === 409 ? res.json<{ type?: string }>().type : undefined;
      if (res.statusCode !== 409 || type !== 'org-mismatch')
        bad.push(`${key}: ${res.statusCode} ${res.body.slice(0, 120)}`);
    }
    expect(bad).toEqual([]);
    expect(await snapshot()).toEqual(before);
    expect(t.temporal.calls).toEqual([]);
  });

  it('without the header, or with the active org in it, every route answers what it did before', async () => {
    const bad: string[] = [];
    for (const key of keys) {
      const plain = await send(key, { cookie: owner });
      const named = await send(key, withOrgHeader({ cookie: owner }, orgA));
      if (plain.statusCode === 409) bad.push(`${key}: 409 without a header`);
      if (named.statusCode !== plain.statusCode) bad.push(`${key}: ${plain.statusCode} vs ${named.statusCode}`);
    }
    expect(bad).toEqual([]);
  });

  it('a header naming an org the caller is not in is 409 and shows none of that org’s data', async () => {
    const res = await send('projects.list', withOrgHeader({ cookie: owner }, orgC));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ type: 'org-mismatch' });
    expect(res.body).not.toContain(cProjectRepo);
    expect(res.body).not.toContain(orgC);
  });

  it('a header with no active org in the session is 409 org-mismatch', async () => {
    const withOrgRes = await send('projects.list', withOrgHeader({ cookie: paCookie }, orgA));
    expect(withOrgRes.statusCode).toBe(409);
    expect(withOrgRes.json()).toMatchObject({ type: 'org-mismatch' });
    const plain = await send('projects.list', { cookie: paCookie });
    expect(plain.statusCode).toBe(403);
  });

  it('user routes ignore the org header: GET /api/me/invitations is never 409', async () => {
    for (const orgId of [orgA, orgB, orgC]) {
      const res = await send('me.listInvitations', withOrgHeader({ cookie: owner }, orgId));
      expect(res.statusCode).toBe(200);
    }
  });

  it('an empty header is ignored', async () => {
    const res = await send('projects.list', withOrgHeader({ cookie: owner }, ''));
    expect(res.statusCode).toBe(200);
  });

  it('platform routes ignore a mismatching header', async () => {
    const fastify = t.app.getHttpAdapter().getInstance();
    const platformKeys = (Object.keys(routeAccess) as RouteKey[]).filter((k) => {
      const def = flat[k];
      return def && routeAccess[k].scope === 'platform' && fastify.hasRoute({ method: def.method, url: def.path });
    });
    expect(platformKeys).toEqual(expect.arrayContaining(['platform.listOrgs', 'platform.listMembers']));
    const before = await snapshot();
    const bad: string[] = [];
    for (const key of platformKeys) {
      const res = await send(key, withOrgHeader({ cookie: paCookie }, orgB));
      // GET routes answer 200. Mutating ones get random ids and no body, so they fail validation or find
      // nothing and change nothing; the only claim is that the header never turns them into a 409.
      const ok = flat[key]?.method === 'GET' ? res.statusCode === 200 : res.statusCode !== 409 && res.statusCode < 500;
      if (!ok) bad.push(`${key}: ${res.statusCode} ${res.body.slice(0, 120)}`);
    }
    expect(bad).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it('N-3: the mismatch log line carries only requestId, userId, sessionOrgId and headerOrgId', async () => {
    logLines.length = 0;
    const res = await send('projects.list', withOrgHeader({ cookie: owner }, orgB));
    expect(res.statusCode).toBe(409);
    const lines = logLines.filter((l) => l['msg'] === 'org mismatch');
    expect(lines).toHaveLength(1);
    const { level, time, pid, hostname, msg, ...fields } = lines[0] ?? {};
    void [level, time, pid, hostname, msg];
    expect(Object.keys(fields).sort()).toEqual(['headerOrgId', 'requestId', 'sessionOrgId', 'userId']);
    expect(fields).toMatchObject({ userId: ownerId, sessionOrgId: orgA, headerOrgId: orgB });
    expect(JSON.stringify(lines[0])).not.toContain('@');
  });

  it('GET /api/me/access for a platform admin with no org answers 200 platformAdmin and no assignments', async () => {
    const res = await send('me.access', { cookie: paCookie });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ platformAdmin: true, assignments: [] });
  });
});
