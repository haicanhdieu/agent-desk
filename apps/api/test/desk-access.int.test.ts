import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { rules as rulesTable, runs, setupTests, withOrg } from '@agentdesk/db';
import { FORBIDDEN_DETAIL } from '../src/access/authorize';
import { createTestApp, type TestApp } from './helpers/app';
import { createOrg, inviteAndLogin, userIdOf } from './helpers/auth';
import { freshStateDir, installFake, makeProject, wideFakeRepos } from './helpers/fixtures';

// Issue 216: a member or viewer holds no Desk configuration read. Every Desk route is 403 for them over HTTP, SSE
// and WebSocket, before any id lookup; owner and admin keep access; a project admin only on their own project.

const RANDOM = '5b0f5d6e-8f4e-4c55-9d52-0c2f3a9a1e11';
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

describe('Desk configuration access by role', () => {
  const ORIGIN = 'http://localhost:5173';
  let t: TestApp;
  let base: string;
  let wsBase: string;
  let orgA: string;
  let orgB: string;
  let p1: string;
  let p2: string;
  let agentId: string;
  let ruleId: string;
  let setupTestId: string;
  let ownRun: string;
  let otherRun: string;
  const cookie = {} as Record<'owner' | 'admin' | 'member' | 'viewer' | 'p1admin' | 'bob', string>;

  const send = (method: Method, url: string, who: string, payload?: object) =>
    t.app.inject({ method, url, headers: { cookie: who }, ...(payload === undefined ? {} : { payload }) });

  /** Every Desk read of AC-6, for project p1 (ids are real). */
  const deskReads = (): [string, string][] => [
    ['agents.get', `/api/projects/${p1}/agent`],
    ['agents.models', `/api/agents/${agentId}/models`],
    ['setupScript.get', `/api/projects/${p1}/setup-script`],
    ['setupScript.versions', `/api/projects/${p1}/setup-script/versions`],
    ['setupScript.version', `/api/projects/${p1}/setup-script/versions/1`],
    ['projectEnv.list', `/api/projects/${p1}/env?kind=plain`],
    ['setup.plugins', `/api/projects/${p1}/plugins`],
    ['setupTests.latest', `/api/projects/${p1}/setup-tests/latest`],
    ['skills.list', `/api/projects/${p1}/skills`],
    ['skills.get', `/api/projects/${p1}/skills/fix`],
    ['rules.list', `/api/projects/${p1}/rules`],
    ['rules.promptPreview', `/api/projects/${p1}/rules/prompt-preview`],
  ];

  /** Every Desk write of AC-10, for project p1. */
  const deskWrites = (): [string, Method, string, object?][] => [
    ['agents.put', 'PUT', `/api/projects/${p1}/agent`, { model: 'claude-opus-4-1', timeoutSeconds: 3600 }],
    ['agents.putCredential', 'PUT', `/api/agents/${agentId}/credential`, { type: 'api_key', value: 'desk-secret' }],
    ['setupScript.put', 'PUT', `/api/projects/${p1}/setup-script`, { body: 'echo x', baseVersion: null }],
    ['projectEnv.createVar', 'POST', `/api/projects/${p1}/env-vars`, { name: 'DESK_VAR', value: 'x' }],
    ['projectEnv.updateVar', 'PUT', `/api/projects/${p1}/env-vars/DESK_VAR`, { value: 'y' }],
    ['projectEnv.removeVar', 'DELETE', `/api/projects/${p1}/env-vars/DESK_VAR`],
    ['projectEnv.createSecret', 'POST', `/api/projects/${p1}/env-secrets`, { name: 'DESK_SEC', value: 'desk-secret' }],
    ['projectEnv.updateSecret', 'PUT', `/api/projects/${p1}/env-secrets/DESK_SEC`, { value: 'desk-secret-2' }],
    ['projectEnv.removeSecret', 'DELETE', `/api/projects/${p1}/env-secrets/DESK_SEC`],
    ['setupTests.create', 'POST', `/api/projects/${p1}/setup-tests`, { script: 'echo x' }],
    ['setupTests.end', 'POST', `/api/setup-tests/${setupTestId}/end`],
    ['skills.put', 'PUT', `/api/projects/${p1}/skills/new`, { body: '---\ndescription: N\n---\nN.\n', message: 'm' }],
    ['skills.remove', 'DELETE', `/api/projects/${p1}/skills/fix`],
    [
      'rules.create',
      'POST',
      `/api/projects/${p1}/rules`,
      { kind: 'prompt', command: 'new', labelFilter: [], target: 'issue', prompt: 'p', enabled: true },
    ],
    ['rules.update', 'PATCH', `/api/rules/${ruleId}`, { enabled: false }],
    ['rules.remove', 'DELETE', `/api/rules/${ruleId}`],
  ];

  async function seedRun(ownerUserId: string, ref: string): Promise<string> {
    return withOrg(t.db, orgA, async (tx) => {
      const [row] = await tx
        .insert(runs)
        .values({
          orgId: orgA,
          projectId: p1,
          command: 'fix',
          skillName: 'fix',
          ticketRef: ref,
          ticketKind: 'issue',
          checkoutRef: 'refs/heads/main',
          triggerSource: 'webhook',
          status: 'running',
          ownerUserId,
        })
        .returning({ id: runs.id });
      if (!row) throw new Error('no run');
      return row.id;
    });
  }

  async function terminalCode(path: string, who: string): Promise<{ code: number; bytes: number }> {
    const ws = new WebSocket(`${wsBase}${path}`, { headers: { origin: ORIGIN, cookie: who } });
    let bytes = 0;
    ws.on('message', (d: Buffer, isBinary: boolean) => {
      if (isBinary) bytes += d.length;
    });
    ws.on('error', () => undefined);
    const code = await new Promise<number>((resolve) => ws.on('close', (c) => resolve(c)));
    return { code, bytes };
  }

  async function streamStatus(path: string, who: string): Promise<number> {
    const ac = new AbortController();
    try {
      const res = await fetch(`${base}${path}`, { headers: { cookie: who }, signal: ac.signal });
      await res.body?.cancel();
      return res.status;
    } finally {
      ac.abort();
    }
  }

  beforeAll(async () => {
    t = await createTestApp({
      env: { FAKE_STATE_DIR: freshStateDir(), AGENT_MODELS_SOURCE: 'builtin' },
      wrapAdapters: wideFakeRepos,
    });
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    const addr = t.app.getHttpServer().address();
    if (typeof addr !== 'object' || addr === null) throw new Error('the test app is not listening on a TCP port');
    base = `http://127.0.0.1:${addr.port}`;
    wsBase = `ws://127.0.0.1:${addr.port}`;
    orgA = (await createOrg(t, 'Desk A', 'desk-a')).id;
    orgB = (await createOrg(t, 'Desk B', 'desk-b')).id;
    cookie.owner = await inviteAndLogin(t, orgA, 'dk-owner', 'owner', { type: 'org' });
    const conn = await installFake(t, cookie.owner);
    p1 = (await makeProject(t, cookie.owner, conn)).projectId;
    p2 = (await makeProject(t, cookie.owner, conn)).projectId;
    cookie.admin = await inviteAndLogin(t, orgA, 'dk-admin', 'admin', { type: 'org' });
    cookie.member = await inviteAndLogin(t, orgA, 'dk-member', 'member', { type: 'org' });
    cookie.viewer = await inviteAndLogin(t, orgA, 'dk-viewer', 'viewer', { type: 'org' });
    cookie.p1admin = await inviteAndLogin(t, orgA, 'dk-p1admin', 'admin', { type: 'project', projectIds: [p1] });
    cookie.bob = await inviteAndLogin(t, orgB, 'dk-bob', 'owner', { type: 'org' });

    const agent = await send('GET', `/api/projects/${p1}/agent`, cookie.owner);
    expect(agent.statusCode).toBe(200);
    agentId = agent.json<{ id: string }>().id;
    const skill = await send('PUT', `/api/projects/${p1}/skills/fix`, cookie.owner, {
      body: '---\ndescription: Fix\n---\nDo it.\n',
      message: 'seed',
    });
    expect(skill.statusCode).toBe(200);
    const script = await send('PUT', `/api/projects/${p1}/setup-script`, cookie.owner, {
      body: 'echo hi',
      baseVersion: null,
    });
    expect(script.statusCode).toBeLessThan(300);
    ruleId = await withOrg(t.db, orgA, async (tx) => {
      const [row] = await tx
        .insert(rulesTable)
        .values({ orgId: orgA, projectId: p1, agentId, command: 'seeded', prompt: 'p', target: 'issue' })
        .returning({ id: rulesTable.id });
      if (!row) throw new Error('no rule');
      return row.id;
    });
    setupTestId = await withOrg(t.db, orgA, async (tx) => {
      const [row] = await tx
        .insert(setupTests)
        .values({
          orgId: orgA,
          projectId: p1,
          status: 'running',
          scriptSha256: 'x',
          startedBy: await userIdOf(t, 'dk-owner'),
        })
        .returning({ id: setupTests.id });
      if (!row) throw new Error('no setup test');
      return row.id;
    });
    ownRun = await seedRun(await userIdOf(t, 'dk-member'), 'dk-own');
    otherRun = await seedRun(await userIdOf(t, 'dk-owner'), 'dk-other');
    t.temporal.reset();
  }, 180_000);
  afterAll(async () => {
    await t.close();
  });

  describe.each(['member', 'viewer'] as const)('a %s', (who) => {
    it('gets 403 on every Desk read, with a body that names no permission', async () => {
      const bad: string[] = [];
      for (const [key, url] of deskReads()) {
        const res = await send('GET', url, cookie[who]);
        const body = res.json<{ detail?: string }>();
        if (res.statusCode !== 403 || body.detail !== FORBIDDEN_DETAIL) bad.push(`${key}: ${res.statusCode}`);
        if (/read|skill|rule|setup|agent:/i.test(body.detail ?? '')) bad.push(`${key}: detail names a permission`);
      }
      expect(bad).toEqual([]);
    });

    it('gets the same 403 for a random, foreign or malformed id as for a real one', async () => {
      const real = await send('GET', `/api/projects/${p1}/agent`, cookie[who]);
      const pick = (r: { statusCode: number; json: () => unknown }) => {
        const { requestId: _requestId, ...rest } = r.json() as Record<string, unknown>;
        return { status: r.statusCode, ...rest };
      };
      const urls = [
        `/api/projects/${RANDOM}/agent`,
        '/api/projects/not-a-uuid/agent',
        `/api/projects/${RANDOM}/skills/nope`,
        `/api/projects/${RANDOM}/rules/prompt-preview`,
        `/api/projects/${RANDOM}/setup-script/versions/999`,
        `/api/projects/${RANDOM}/env?kind=plain`,
        `/api/agents/${RANDOM}/models`,
        '/api/agents/not-a-uuid/models',
        `/api/setup-tests/${RANDOM}/events`,
      ];
      for (const url of urls) expect(pick(await send('GET', url, cookie[who])), url).toEqual(pick(real));
    });

    it('gets 403 on every Desk write and changes nothing', async () => {
      t.temporal.reset();
      for (const [key, method, url, payload] of deskWrites()) {
        const res = await send(method, url, cookie[who], payload);
        expect(res.statusCode, key).toBe(403);
        expect(res.json<{ detail: string }>().detail, key).toBe(FORBIDDEN_DETAIL);
      }
      expect(t.temporal.calls).toEqual([]);
      expect(t.secrets.names()).not.toContain('desk-secret');
      const rule = await send('GET', `/api/projects/${p1}/rules`, cookie.owner);
      expect(rule.json<{ items: { id: string }[] }>().items.map((r) => r.id)).toContain(ruleId);
    });

    it('is refused on the setup test event stream with 403 and on its terminal with 4403', async () => {
      expect(await streamStatus(`/api/setup-tests/${setupTestId}/events`, cookie[who])).toBe(403);
      expect(await streamStatus(`/api/setup-tests/${RANDOM}/events`, cookie[who])).toBe(403);
      expect(await terminalCode(`/api/setup-tests/${setupTestId}/terminal`, cookie[who])).toEqual({
        code: 4403,
        bytes: 0,
      });
    });

    it('gets 403 on the roles list, an admin-level read', async () => {
      const res = await send('GET', `/api/orgs/${orgA}/roles`, cookie[who]);
      expect(res.statusCode).toBe(403);
      expect(res.json<{ detail: string }>().detail).toBe(FORBIDDEN_DETAIL);
    });

    it('still reads projects and runs', async () => {
      for (const url of [
        '/api/projects',
        `/api/projects/${p1}`,
        `/api/projects/${p1}/connection`,
        `/api/projects/${p1}/runs`,
        `/api/runs/${ownRun}`,
        `/api/runs/${ownRun}/log`,
        `/api/runs/${otherRun}/transcript`,
      ]) {
        expect((await send('GET', url, cookie[who])).statusCode, url).toBe(200);
      }
      expect(await streamStatus(`/api/runs/${ownRun}/events`, cookie[who])).toBe(200);
    });
  });

  describe('run actions', () => {
    it('lets a member act on their own run and refuses someone else’s with 403', async () => {
      const own = await send('POST', `/api/runs/${ownRun}/cancel`, cookie.member);
      expect([200, 202, 204, 409]).toContain(own.statusCode);
      const other = await send('POST', `/api/runs/${otherRun}/cancel`, cookie.member);
      expect(other.statusCode).toBe(403);
      expect((await send('POST', `/api/runs/${otherRun}/stop`, cookie.member)).statusCode).toBe(403);
    });

    it('refuses a viewer on run:update, run:cancel and the run terminal', async () => {
      for (const action of ['stop', 'cancel', 'finish', 'resume', 'close-session']) {
        expect((await send('POST', `/api/runs/${ownRun}/${action}`, cookie.viewer)).statusCode, action).toBe(403);
      }
      expect(await terminalCode(`/api/runs/${ownRun}/terminal`, cookie.viewer)).toEqual({ code: 4403, bytes: 0 });
    });

    it('closes a member’s terminal on someone else’s run with 4403', async () => {
      expect(await terminalCode(`/api/runs/${otherRun}/terminal`, cookie.member)).toEqual({ code: 4403, bytes: 0 });
    });
  });

  describe.each(['owner', 'admin'] as const)('an org %s', (who) => {
    it('still reads every Desk route', async () => {
      for (const [key, url] of deskReads()) {
        expect((await send('GET', url, cookie[who])).statusCode, key).toBe(200);
      }
    });

    it('still writes on the Desk', async () => {
      const put = await send('PUT', `/api/projects/${p1}/skills/from-${who}`, cookie[who], {
        body: '---\ndescription: S\n---\nS.\n',
        message: 'm',
      });
      expect(put.statusCode).toBe(200);
      const rule = await send('POST', `/api/projects/${p1}/rules`, cookie[who], {
        kind: 'prompt',
        command: `from-${who}`,
        labelFilter: [],
        target: 'issue',
        prompt: 'p',
        enabled: true,
      });
      expect(rule.statusCode).toBe(201);
      const current = await send('GET', `/api/projects/${p1}/setup-script`, cookie[who]);
      const script = await send('PUT', `/api/projects/${p1}/setup-script`, cookie[who], {
        body: `echo ${who}`,
        baseVersion: current.json<{ version: number }>().version,
      });
      expect(script.statusCode).toBeLessThan(300);
      const agent = await send('PUT', `/api/projects/${p1}/agent`, cookie[who], {
        model: 'claude-opus-4-1',
        timeoutSeconds: 3600,
      });
      expect(agent.statusCode).toBeLessThan(300);
    });

    it('lists roles and the org administration data', async () => {
      for (const url of [
        `/api/orgs/${orgA}/roles`,
        `/api/orgs/${orgA}/members`,
        `/api/orgs/${orgA}/assignments`,
        `/api/orgs/${orgA}/invitations`,
        `/api/orgs/${orgA}/checklist`,
        '/api/projects',
      ]) {
        expect((await send('GET', url, cookie[who])).statusCode, url).toBe(200);
      }
    });
  });

  describe('an admin of one project only', () => {
    it('reads and changes the Desk of that project', async () => {
      for (const [key, url] of deskReads()) {
        expect((await send('GET', url, cookie.p1admin)).statusCode, key).toBe(200);
      }
      const rule = await send('POST', `/api/projects/${p1}/rules`, cookie.p1admin, {
        kind: 'prompt',
        command: 'from-p1admin',
        labelFilter: [],
        target: 'issue',
        prompt: 'p',
        enabled: true,
      });
      expect(rule.statusCode).toBe(201);
    });

    it('gets 404 on every Desk route of another project', async () => {
      for (const url of [
        `/api/projects/${p2}/agent`,
        `/api/projects/${p2}/setup-script`,
        `/api/projects/${p2}/setup-script/versions`,
        `/api/projects/${p2}/plugins`,
        `/api/projects/${p2}/setup-tests/latest`,
        `/api/projects/${p2}/skills`,
        `/api/projects/${p2}/rules`,
        `/api/projects/${p2}/rules/prompt-preview`,
      ]) {
        expect((await send('GET', url, cookie.p1admin)).statusCode, url).toBe(404);
      }
      expect(
        (
          await send('PUT', `/api/projects/${p2}/skills/x`, cookie.p1admin, {
            body: '---\ndescription: X\n---\nX.\n',
            message: 'm',
          })
        ).statusCode,
      ).toBe(404);
    });

    it('can still list the roles to invite people to their project', async () => {
      expect((await send('GET', `/api/orgs/${orgA}/roles`, cookie.p1admin)).statusCode).toBe(200);
    });
  });

  it('gives another org’s owner 404 on org A’s Desk, never 403', async () => {
    for (const [key, url] of deskReads()) {
      expect((await send('GET', url, cookie.bob)).statusCode, key).toBe(404);
    }
  });
});
