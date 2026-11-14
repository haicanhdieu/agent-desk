import type { QueryResultRow } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WorkflowNotFoundError } from '@temporalio/client';
import type { ProjectDto } from '@agentdesk/contracts';
import { credentialSecretName } from '@agentdesk/core';
import { createTestApp, type TestApp } from './helpers/app';
import { loginAs } from './helpers/auth';
import { expectContract } from './helpers/contract';

let t: TestApp;
let alice: string;
let bob: string;
let connectionId: string;

beforeAll(async () => {
  t = await createTestApp({
    wrapAdapters: (real) => ({
      ...real,
      codeHost: (provider) => {
        const host = real.codeHost(provider);
        if (provider !== 'fake') return host;
        const repos = ['dev/demo', 'dev/dup', ...Array.from({ length: 300 }, (_, i) => `dev/demo-${i + 1}`)];
        return Object.assign(Object.create(host), {
          listRepos: async () => repos.map((repoPath) => ({ repoPath, private: false, defaultBranch: 'main' })),
        });
      },
    }),
  });
  alice = await loginAs(t, 'alice');
  bob = await loginAs(t, 'bob');
  const inst = await t.app.inject({ method: 'POST', url: '/api/connections/fake/install', headers: { cookie: alice } });
  const u = new URL((inst.json() as { url: string }).url);
  const cb = await t.app.inject({ method: 'GET', url: `${u.pathname}${u.search}`, headers: { cookie: alice } });
  connectionId = new URL(String(cb.headers['location'])).searchParams.get('connection') ?? '';
});
afterAll(async () => {
  await t.close();
});
beforeEach(() => {
  t.temporal.reset();
});

/** Runs one statement as the app role inside the org's RLS scope (the pool itself sees no tenant rows). */
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
async function aliceOrgId(): Promise<string> {
  const org = await t.db.pool.query("select id from organization where slug = 'alice'");
  return org.rows[0].id;
}

let seq = 0;
async function createProject(body: Record<string, unknown>, cookie = alice) {
  // unique (connection, repo): vary the repo path per project.
  seq += 1;
  return t.app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: { cookie },
    payload: { connectionId, repoPath: `dev/demo-${seq}`, triggerMode: 'webhook', ...body },
  });
}
const patch = (id: string, payload: Record<string, unknown>, cookie = alice) =>
  t.app.inject({ method: 'PATCH', url: `/api/projects/${id}`, headers: { cookie }, payload });

describe('projects', () => {
  it('creates a webhook project with defaults, agent row, and no schedule', async () => {
    const res = await createProject({});
    expect(res.statusCode).toBe(201);
    const p = expectContract('projects.create', res) as ProjectDto;
    expect(p).toMatchObject({
      setupStep: 'agent',
      triggerMode: 'webhook',
      codeConnectionId: connectionId,
      boardConnectionId: connectionId,
      counts: { needsYou: 0, running: 0, queued: 0 },
      lastRunAt: null,
    });
    expect(p.name).toBe(p.repoPath);
    expect(t.temporal.callsOfKind('scheduleCreate')).toHaveLength(0);
    const agents = await asOrg(
      await aliceOrgId(),
      'select name, model, max_turns, timeout_seconds from agents where project_id = $1',
      [p.id],
    );
    expect(agents.rows).toEqual([{ name: 'Claude', model: 'sonnet', max_turns: 50, timeout_seconds: 1800 }]);
    const cur = await asOrg(await aliceOrgId(), 'select 1 from poll_cursors where project_id = $1', [p.id]);
    expect(cur.rows).toHaveLength(0);

    const get = await t.app.inject({ method: 'GET', url: `/api/projects/${p.id}`, headers: { cookie: alice } });
    expectContract('projects.get', get);
    const list = await t.app.inject({ method: 'GET', url: '/api/projects', headers: { cookie: alice } });
    expect((expectContract('projects.list', list) as ProjectDto[]).some((x) => x.id === p.id)).toBe(true);
  });

  it('rejects a duplicate repo with 409 and an unknown/foreign connection with 404', async () => {
    const first = (await createProject({ repoPath: 'dev/dup' })).json() as ProjectDto;
    expect(first.id).toBeDefined();
    const dup = await t.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { cookie: alice },
      payload: { connectionId, repoPath: 'dev/dup', triggerMode: 'webhook' },
    });
    expect(dup.statusCode).toBe(409);
    const foreign = await createProject({}, bob);
    expect(foreign.statusCode).toBe(404);
  });

  it('org boundary: bob gets 404 for alice project and an empty list', async () => {
    const p = (await createProject({})).json() as ProjectDto;
    for (const [method, url] of [
      ['GET', `/api/projects/${p.id}`],
      ['GET', `/api/projects/${p.id}/connection`],
      ['PATCH', `/api/projects/${p.id}`],
      ['DELETE', `/api/projects/${p.id}`],
    ] as const) {
      const res = await t.app.inject({
        method,
        url,
        headers: { cookie: bob },
        ...(method === 'PATCH' ? { payload: {} } : {}),
      });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
    const list = await t.app.inject({ method: 'GET', url: '/api/projects', headers: { cookie: bob } });
    expect(expectContract('projects.list', list)).toEqual([]);
    const still = await t.app.inject({ method: 'GET', url: `/api/projects/${p.id}`, headers: { cookie: alice } });
    expect(still.statusCode).toBe(200);
  });

  it('polling create records schedule poll-{id} at 300s and a cursor; PATCH to webhook deletes it', async () => {
    const p = expectContract('projects.create', await createProject({ triggerMode: 'polling' })) as ProjectDto;
    expect(p.pollIntervalSeconds).toBe(300);
    const creates = t.temporal.callsOfKind('scheduleCreate');
    expect(creates).toHaveLength(1);
    expect(creates[0]?.scheduleId).toBe(`poll-${p.id}`);
    expect(creates[0]?.args[0]).toMatchObject({
      scheduleId: `poll-${p.id}`,
      spec: { intervals: [{ every: 300_000 }] },
      action: {
        type: 'startWorkflow',
        workflowType: 'PollOnceWorkflow',
        taskQueue: 'agentdesk',
        args: [{ orgId: expect.any(String), projectId: p.id }],
      },
    });
    const cur = await asOrg(await aliceOrgId(), 'select since from poll_cursors where project_id = $1', [p.id]);
    expect(cur.rows).toHaveLength(1);
    expect(cur.rows[0].since).toBeInstanceOf(Date);

    const conn = await t.app.inject({
      method: 'GET',
      url: `/api/projects/${p.id}/connection`,
      headers: { cookie: alice },
    });
    const dto = expectContract('projects.connection', conn) as {
      mode: string;
      polling: { intervalSeconds: number } | null;
    };
    expect(dto.mode).toBe('polling');
    expect(dto.polling?.intervalSeconds).toBe(300);

    // interval change updates the schedule
    const upd = await patch(p.id, { pollIntervalSeconds: 600 });
    expect(expectContract('projects.update', upd)).toMatchObject({ pollIntervalSeconds: 600 });
    expect(t.temporal.callsOfKind('scheduleUpdate').map((c) => c.scheduleId)).toEqual([`poll-${p.id}`]);

    const wh = await patch(p.id, { triggerMode: 'webhook' });
    expect(expectContract('projects.update', wh)).toMatchObject({ triggerMode: 'webhook' });
    expect(t.temporal.callsOfKind('scheduleDelete').map((c) => c.scheduleId)).toEqual([`poll-${p.id}`]);
  });

  it('PATCH to polling creates the schedule and a cursor', async () => {
    const p = (await createProject({})).json() as ProjectDto;
    await patch(p.id, { triggerMode: 'polling', pollIntervalSeconds: 900 });
    const creates = t.temporal.callsOfKind('scheduleCreate');
    expect(creates[0]?.args[0]).toMatchObject({ spec: { intervals: [{ every: 900_000 }] } });
    const cur = await asOrg(await aliceOrgId(), 'select 1 from poll_cursors where project_id = $1', [p.id]);
    expect(cur.rows).toHaveLength(1);
  });

  it('setupStep only moves forward', async () => {
    const p = (await createProject({})).json() as ProjectDto;
    expect(((await patch(p.id, { setupStep: 'rules' })).json() as ProjectDto).setupStep).toBe('rules');
    const back = await patch(p.id, { setupStep: 'skills' });
    expect(back.statusCode).toBe(200);
    expect((back.json() as ProjectDto).setupStep).toBe('rules');
    expect(((await patch(p.id, { setupStep: 'ready' })).json() as ProjectDto).setupStep).toBe('ready');
  });

  it('setupStep accepts agent → setup → skills and ignores skills → setup', async () => {
    const p = (await createProject({})).json() as ProjectDto;
    expect(((await patch(p.id, { setupStep: 'setup' })).json() as ProjectDto).setupStep).toBe('setup');
    expect(((await patch(p.id, { setupStep: 'skills' })).json() as ProjectDto).setupStep).toBe('skills');
    const back = await patch(p.id, { setupStep: 'setup' });
    expect(back.statusCode).toBe(200);
    expect((back.json() as ProjectDto).setupStep).toBe('skills');
  });

  it('maxConcurrentRuns change signals the gate via signalWithStart', async () => {
    const p = (await createProject({})).json() as ProjectDto;
    t.temporal.reset();
    await patch(p.id, { name: 'renamed' });
    expect(t.temporal.callsOfKind('signalWithStart')).toHaveLength(0);
    const res = await patch(p.id, { maxConcurrentRuns: 2 });
    expect(res.statusCode).toBe(200);
    const calls = t.temporal.callsOfKind('signalWithStart');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.workflowId).toBe(`gate-${p.id}`);
    expect(calls[0]?.args[0]).toBe('ProjectGateWorkflow');
    expect(calls[0]?.args[1]).toMatchObject({
      workflowId: `gate-${p.id}`,
      taskQueue: 'agentdesk',
      signal: 'setLimit',
      signalArgs: [2],
      args: [{ projectId: p.id, limit: 2 }],
    });
  });

  it('computes counts in the list from runs', async () => {
    const p = (await createProject({})).json() as ProjectDto;
    const orgId = await aliceOrgId();
    const ins = (status: string, ref: string) =>
      asOrg(
        orgId,
        `insert into runs (org_id, project_id, command, skill_name, ticket_ref, ticket_kind, checkout_ref, status, trigger_source)
         values ($1,$2,'/x','x',$3,'issue','main',$4,'manual')`,
        [orgId, p.id, ref, status],
      );
    await ins('queued', 'a#1');
    await ins('queued', 'a#2');
    await ins('running', 'a#3');
    await ins('idle', 'a#4');
    await ins('succeeded', 'a#5');
    const get = await t.app.inject({ method: 'GET', url: `/api/projects/${p.id}`, headers: { cookie: alice } });
    const dto = expectContract('projects.get', get) as ProjectDto;
    expect(dto.counts).toEqual({ needsYou: 1, running: 2, queued: 2 });
    expect(dto.lastRunAt).not.toBeNull();
  });

  it('webhook connection reports the newest webhook delivery', async () => {
    const p = (await createProject({})).json() as ProjectDto;
    const empty = await t.app.inject({
      method: 'GET',
      url: `/api/projects/${p.id}/connection`,
      headers: { cookie: alice },
    });
    expect(expectContract('projects.connection', empty)).toEqual({
      mode: 'webhook',
      webhook: { lastEventAt: null, lastEventAction: null },
      polling: null,
    });
    const orgId = await aliceOrgId();
    const ins = (id: string, channel: string, action: string, at: string) =>
      asOrg(
        orgId,
        `insert into inbound_events (provider, channel, delivery_id, org_id, project_id, outcome, action, received_at)
         values ('fake',$1,$2,$3,$4,'run_started',$5,$6)`,
        [channel, id, orgId, p.id, action, at],
      );
    await ins(`d1-${p.id}`, 'webhook', 'created', '2026-01-01T00:00:00Z');
    await ins(`d2-${p.id}`, 'webhook', 'edited', '2026-01-02T00:00:00Z');
    await ins(`d3-${p.id}`, 'poll', 'created', '2026-01-03T00:00:00Z');
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/projects/${p.id}/connection`,
      headers: { cookie: alice },
    });
    const dto = expectContract('projects.connection', res) as {
      webhook: { lastEventAt: string; lastEventAction: string };
    };
    expect(dto.webhook.lastEventAction).toBe('edited');
    expect(new Date(dto.webhook.lastEventAt).toISOString()).toBe('2026-01-02T00:00:00.000Z');
  });

  it('DELETE returns 204 and removes the poll schedule', async () => {
    const p = (await createProject({ triggerMode: 'polling', pollIntervalSeconds: 600 })).json() as ProjectDto;
    t.temporal.reset();
    const res = await t.app.inject({ method: 'DELETE', url: `/api/projects/${p.id}`, headers: { cookie: alice } });
    expect(res.statusCode).toBe(204);
    expectContract('projects.remove', res);
    expect(t.temporal.callsOfKind('scheduleDelete').map((c) => c.scheduleId)).toEqual([`poll-${p.id}`]);
    const get = await t.app.inject({ method: 'GET', url: `/api/projects/${p.id}`, headers: { cookie: alice } });
    expect(get.statusCode).toBe(404);
  });

  describe('DELETE with runs and credentials', () => {
    async function seedRunAndCredential(projectId: string, status: string): Promise<string> {
      const orgId = await aliceOrgId();
      const agent = await asOrg(orgId, 'select id from agents where project_id = $1', [projectId]);
      const agentId = String(agent.rows[0]?.id);
      await asOrg(
        orgId,
        `insert into runs (org_id, project_id, agent_id, command, skill_name, ticket_ref, ticket_kind, checkout_ref,
                           status, trigger_source)
         values ($1, $2, $3, 'fix', 'fix', '1', 'issue', 'main', $4, 'manual')`,
        [orgId, projectId, agentId, status],
      );
      const secret = credentialSecretName(orgId, agentId);
      await t.secrets.put(secret, { type: 'api_key', value: 'sk-test-credential-value' });
      return secret;
    }

    it.each(['queued', 'starting', 'running', 'idle'])(
      'a %s run blocks the delete with a 409 problem and nothing is removed',
      async (status) => {
        const p = (await createProject({ triggerMode: 'polling' })).json() as ProjectDto;
        const secret = await seedRunAndCredential(p.id, status);
        t.temporal.reset();
        const res = await t.app.inject({ method: 'DELETE', url: `/api/projects/${p.id}`, headers: { cookie: alice } });
        expect(res.statusCode).toBe(409);
        expect(res.headers['content-type']).toContain('application/problem+json');
        expect((res.json() as { detail: string }).detail).toContain('Cancel active runs first');
        const get = await t.app.inject({ method: 'GET', url: `/api/projects/${p.id}`, headers: { cookie: alice } });
        expect(get.statusCode).toBe(200);
        expect(t.temporal.calls).toEqual([]);
        expect(await t.secrets.get(secret)).not.toBeNull();
      },
    );

    it('with only final runs: deletes the row, terminates gate-{id}, deletes the schedule and the credential Secret', async () => {
      const p = (await createProject({ triggerMode: 'polling' })).json() as ProjectDto;
      const secret = await seedRunAndCredential(p.id, 'succeeded');
      t.temporal.reset();
      const res = await t.app.inject({ method: 'DELETE', url: `/api/projects/${p.id}`, headers: { cookie: alice } });
      expect(res.statusCode).toBe(204);
      expect(t.temporal.callsOfKind('terminate').map((c) => c.workflowId)).toEqual([`gate-${p.id}`]);
      expect(t.temporal.callsOfKind('scheduleDelete').map((c) => c.scheduleId)).toEqual([`poll-${p.id}`]);
      expect(await t.secrets.get(secret)).toBeNull();
      const get = await t.app.inject({ method: 'GET', url: `/api/projects/${p.id}`, headers: { cookie: alice } });
      expect(get.statusCode).toBe(404);
    });

    it('a missing gate workflow is fine: still 204 and the Secret is deleted', async () => {
      const p = (await createProject({})).json() as ProjectDto;
      const secret = await seedRunAndCredential(p.id, 'cancelled');
      t.temporal.reset();
      t.temporal.terminateError = new WorkflowNotFoundError('not found', `gate-${p.id}`, undefined);
      const res = await t.app.inject({ method: 'DELETE', url: `/api/projects/${p.id}`, headers: { cookie: alice } });
      expect(res.statusCode).toBe(204);
      expect(await t.secrets.get(secret)).toBeNull();
    });
  });

  it('validates bodies (400 problem)', async () => {
    const bad = await t.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { cookie: alice },
      payload: { connectionId, repoPath: 'x/y', triggerMode: 'polling', pollIntervalSeconds: 7 },
    });
    expect(bad.statusCode).toBe(400);
    const p = (await createProject({})).json() as ProjectDto;
    expect((await patch(p.id, { maxConcurrentRuns: 0 })).statusCode).toBe(400);
    const badId = await t.app.inject({ method: 'GET', url: '/api/projects/not-a-uuid', headers: { cookie: alice } });
    expect(badId.statusCode).toBe(400);
  });

  it('rejects malformed or inaccessible repoPath with a /repoPath problem pointer', async () => {
    const long = `dev/${'a'.repeat(300)}`;
    for (const repoPath of [
      '../etc/passwd',
      'a/b/c',
      'solo',
      'dev/..',
      './x',
      'dev/a b',
      'dev/a;rm',
      long,
      'dev/missing',
    ]) {
      const res = await createProject({ repoPath });
      expect(res.statusCode, repoPath).toBe(400);
      expect((res.json() as { errors: { pointer: string }[] }).errors[0]?.pointer, repoPath).toBe('/repoPath');
    }
  });

  it('Temporal failures after commit are best-effort: create 201, update 200, delete 204', async () => {
    t.temporal.failing = true;
    const created = await createProject({ triggerMode: 'polling' });
    expect(created.statusCode).toBe(201);
    const p = created.json() as ProjectDto;
    expect((await patch(p.id, { pollIntervalSeconds: 600, maxConcurrentRuns: 3 })).statusCode).toBe(200);
    expect((await patch(p.id, { triggerMode: 'webhook' })).statusCode).toBe(200);
    const del = await t.app.inject({ method: 'DELETE', url: `/api/projects/${p.id}`, headers: { cookie: alice } });
    expect(del.statusCode).toBe(204);
    const gone = await t.app.inject({ method: 'GET', url: `/api/projects/${p.id}`, headers: { cookie: alice } });
    expect(gone.statusCode).toBe(404);
  });

  it('PATCH re-syncs an explicitly set polling mode (re-creates a missing schedule)', async () => {
    const p = (await createProject({ triggerMode: 'polling' })).json() as ProjectDto;
    t.temporal.reset();
    await patch(p.id, { triggerMode: 'polling' });
    expect(t.temporal.callsOfKind('scheduleUpdate')).toHaveLength(1);
  });
});
