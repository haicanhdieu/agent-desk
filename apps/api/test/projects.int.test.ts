import type { QueryResultRow } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ScheduleNotFoundError, WorkflowNotFoundError } from '@temporalio/client';
import type { Page, ProjectDto } from '@agentdesk/contracts';
import { SIGNAL, credentialSecretName, projectEnvSecretName } from '@agentdesk/core';
import { createTestApp, type TestApp } from './helpers/app';
import { createOrg, inviteAndLogin } from './helpers/auth';
import { expectContract } from './helpers/contract';

let t: TestApp;
let alice: string;
let bob: string;
let connectionId: string;
let aliceOrg: string;

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
  aliceOrg = (await createOrg(t, 'Alice', 'alice')).id;
  const bobOrg = (await createOrg(t, 'Bob', 'bob')).id;
  alice = await inviteAndLogin(t, aliceOrg, 'alice', 'owner', { type: 'org' });
  bob = await inviteAndLogin(t, bobOrg, 'bob', 'owner', { type: 'org' });
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
  return aliceOrg;
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
      codeProvider: 'fake',
      repoUrl: expect.stringMatching(/^https:\/\/fake\.invalid\/dev\/demo-\d+$/),
      skillFileBaseUrl: expect.stringMatching(/^https:\/\/fake\.invalid\/dev\/demo-\d+\/-\/blob\/main\/$/),
      defaultBranch: expect.any(String),
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
    expect(agents.rows).toEqual([{ name: 'Claude', model: 'sonnet', max_turns: 50, timeout_seconds: 86400 }]);
    const cur = await asOrg(await aliceOrgId(), 'select 1 from poll_cursors where project_id = $1', [p.id]);
    expect(cur.rows).toHaveLength(0);

    const get = await t.app.inject({ method: 'GET', url: `/api/projects/${p.id}`, headers: { cookie: alice } });
    expectContract('projects.get', get);
    const list = await t.app.inject({ method: 'GET', url: '/api/projects', headers: { cookie: alice } });
    expect((expectContract('projects.list', list) as Page<ProjectDto>).items.some((x) => x.id === p.id)).toBe(true);
  });

  it('projects with no recorded default branch have no skill file prefix', async () => {
    const created = (await createProject({})).json() as ProjectDto;
    await asOrg(aliceOrg, 'update projects set default_branch = null where id = $1', [created.id]);
    const got = await t.app.inject({ method: 'GET', url: `/api/projects/${created.id}`, headers: { cookie: alice } });
    const p = expectContract('projects.get', got) as ProjectDto;
    expect(p.defaultBranch).toBeNull();
    expect(p.skillFileBaseUrl).toBeNull();
    const list = await t.app.inject({ method: 'GET', url: '/api/projects', headers: { cookie: alice } });
    const page = expectContract('projects.list', list) as Page<ProjectDto>;
    expect(page.items.find((x) => x.id === created.id)?.skillFileBaseUrl).toBeNull();
  });

  it('a project whose code connection is not visible in its org has no repository link', async () => {
    // Installing in Bob's org gives us a real connection that Alice's RLS scope cannot see. Pointing the project at it
    // is the same state the API sees when a connection was removed from the org.
    const install = await t.app.inject({
      method: 'POST',
      url: '/api/connections/fake/install',
      headers: { cookie: bob },
    });
    const start = new URL((install.json() as { url: string }).url);
    const callback = await t.app.inject({
      method: 'GET',
      url: `${start.pathname}${start.search}`,
      headers: { cookie: bob },
    });
    const bobConnection = new URL(String(callback.headers['location'])).searchParams.get('connection') ?? '';
    expect(bobConnection).not.toBe('');

    const created = (await createProject({})).json() as ProjectDto;
    await asOrg(aliceOrg, 'update projects set code_connection_id = $1, repo_path = $2 where id = $3', [
      bobConnection,
      `dev/orphan-${randomUUID()}`,
      created.id,
    ]);
    const got = await t.app.inject({ method: 'GET', url: `/api/projects/${created.id}`, headers: { cookie: alice } });
    const p = expectContract('projects.get', got) as ProjectDto;
    expect(p).toMatchObject({ repoUrl: null, skillFileBaseUrl: null, codeProvider: null });
    const list = await t.app.inject({ method: 'GET', url: '/api/projects', headers: { cookie: alice } });
    const page = expectContract('projects.list', list) as Page<ProjectDto>;
    expect(page.items.find((x) => x.id === created.id)).toMatchObject({
      repoUrl: null,
      skillFileBaseUrl: null,
      codeProvider: null,
    });
  });

  it('BR-50: create writes exactly one placeholder default agent; a second project gets its own', async () => {
    const q =
      'select provider, name, model, max_turns, is_default, credential_secret_name, credential_type from agents where project_id = $1';
    const a = (await createProject({})).json() as ProjectDto;
    const b = (await createProject({})).json() as ProjectDto;
    const placeholder = {
      provider: 'claude',
      name: 'Claude',
      model: 'sonnet',
      max_turns: 50,
      is_default: true,
      credential_secret_name: null,
      credential_type: null,
    };
    expect((await asOrg(aliceOrg, q, [a.id])).rows).toEqual([placeholder]);
    expect((await asOrg(aliceOrg, q, [b.id])).rows).toEqual([placeholder]);
    expect(a.setupStep).toBe('agent');
    const agent = await t.app.inject({ method: 'GET', url: `/api/projects/${a.id}/agent`, headers: { cookie: alice } });
    expect(agent.statusCode).toBe(200);
    expect(agent.json()).toMatchObject({ projectId: a.id, name: 'Claude', provider: 'claude', isDefault: true });
  });

  it('a failed create leaves no project and no agent behind', async () => {
    const first = (await createProject({})).json() as ProjectDto;
    const count = async () => Number((await asOrg(aliceOrg, 'select count(*)::int as n from agents')).rows[0]?.['n']);
    const before = await count();
    const dup = await t.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { cookie: alice },
      payload: { connectionId, repoPath: first.repoPath, triggerMode: 'webhook' },
    });
    expect(dup.statusCode).toBe(409);
    expect(await count()).toBe(before);
  });

  it('BR-45: PATCH stores the five project-wide limits and GET returns them', async () => {
    const p = (await createProject({})).json() as ProjectDto;
    expect(p).toMatchObject({
      timeoutSeconds: 86400,
      pausedKeepSeconds: 604800,
      doneKeepSeconds: 86400,
      idleEndSeconds: 1800,
      autoResumeMax: 5,
    });
    const limits = {
      timeoutSeconds: 3600,
      pausedKeepSeconds: 7200,
      doneKeepSeconds: 0,
      idleEndSeconds: 600,
      autoResumeMax: 2,
    };
    const res = await patch(p.id, limits);
    expect(res.statusCode).toBe(200);
    expect(expectContract('projects.update', res)).toMatchObject(limits);
    const got = await t.app.inject({ method: 'GET', url: `/api/projects/${p.id}`, headers: { cookie: alice } });
    expect(expectContract('projects.get', got)).toMatchObject(limits);
    const row = await asOrg(
      aliceOrg,
      'select timeout_seconds, paused_keep_seconds, done_keep_seconds, idle_end_seconds, auto_resume_max from projects where id = $1',
      [p.id],
    );
    expect(row.rows).toEqual([
      {
        timeout_seconds: 3600,
        paused_keep_seconds: 7200,
        done_keep_seconds: 0,
        idle_end_seconds: 600,
        auto_resume_max: 2,
      },
    ]);
  });

  it.each([
    { timeoutSeconds: 59 },
    { timeoutSeconds: 604801 },
    { pausedKeepSeconds: 3599 },
    { doneKeepSeconds: 604801 },
    { idleEndSeconds: 299 },
    { autoResumeMax: 11 },
  ])('PATCH refuses out-of-range limit %o and stores nothing', async (bad) => {
    const p = (await createProject({})).json() as ProjectDto;
    expect((await patch(p.id, bad)).statusCode).toBe(400);
    const got = await t.app.inject({ method: 'GET', url: `/api/projects/${p.id}`, headers: { cookie: alice } });
    expect(got.json()).toMatchObject({ timeoutSeconds: 86400, autoResumeMax: 5, idleEndSeconds: 1800 });
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
    expect(expectContract('projects.list', list)).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
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

  it('done run counts as running, not needs you', async () => {
    const p = (await createProject({})).json() as ProjectDto;
    const orgId = await aliceOrgId();
    await asOrg(
      orgId,
      `insert into runs (org_id, project_id, command, skill_name, ticket_ref, ticket_kind, checkout_ref, status, trigger_source)
       values ($1,$2,'/x','x','a#1','issue','main','done','manual')`,
      [orgId, p.id],
    );
    const get = await t.app.inject({ method: 'GET', url: `/api/projects/${p.id}`, headers: { cookie: alice } });
    const dto = expectContract('projects.get', get) as ProjectDto;
    expect(dto.counts).toEqual({ needsYou: 0, running: 1, queued: 0 });
  });

  it('a paused run counts as needs you, like the needs_you list, but not as running', async () => {
    const p = (await createProject({})).json() as ProjectDto;
    const orgId = await aliceOrgId();
    const ins = (status: string, ref: string) =>
      asOrg(
        orgId,
        `insert into runs (org_id, project_id, command, skill_name, ticket_ref, ticket_kind, checkout_ref, status, trigger_source)
         values ($1,$2,'/x','x',$3,'issue','main',$4,'manual')`,
        [orgId, p.id, ref, status],
      );
    await ins('idle', 'a#1');
    await ins('paused', 'a#2');
    await ins('paused', 'a#3');
    const get = await t.app.inject({ method: 'GET', url: `/api/projects/${p.id}`, headers: { cookie: alice } });
    const dto = expectContract('projects.get', get) as ProjectDto;
    // A paused run has no pod: it waits for a person, but it is not a live job.
    expect(dto.counts).toEqual({ needsYou: 3, running: 1, queued: 0 });
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

    it.each(['queued', 'starting', 'running', 'idle', 'done', 'paused'])(
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

    describe('env entries', () => {
      async function seedEnv(projectId: string): Promise<{ secretIds: string[]; names: string[] }> {
        const orgId = await aliceOrgId();
        const secretIds: string[] = [];
        await asOrg(
          orgId,
          `insert into project_env_vars (org_id, project_id, name, kind, value, size_bytes, updated_by)
           values ($1, $2, 'PLAIN_ONE', 'plain', 'v', 10, 'u')`,
          [orgId, projectId],
        );
        for (const name of ['SECRET_ONE', 'SECRET_TWO']) {
          const r = await asOrg(
            orgId,
            `insert into project_env_vars (org_id, project_id, name, kind, value, size_bytes, updated_by)
             values ($1, $2, $3, 'secret', null, 10, 'u') returning id`,
            [orgId, projectId, name],
          );
          const id = String(r.rows[0]?.id);
          secretIds.push(id);
          await t.secrets.put(projectEnvSecretName(orgId, id), { type: 'api_key', value: 'sk-env-value' });
        }
        return { secretIds, names: secretIds.map((id) => projectEnvSecretName(orgId, id)) };
      }

      it('env: delete removes the rows and every per-entry Secret', async () => {
        const p = (await createProject({})).json() as ProjectDto;
        const orgId = await aliceOrgId();
        const { names } = await seedEnv(p.id);
        const res = await t.app.inject({ method: 'DELETE', url: `/api/projects/${p.id}`, headers: { cookie: alice } });
        expect(res.statusCode).toBe(204);
        const rows = await asOrg(orgId, 'select id from project_env_vars where project_id = $1', [p.id]);
        expect(rows.rows).toEqual([]);
        for (const n of names) expect(await t.secrets.get(n)).toBeNull();
      });

      it('env: a failing Secret delete does not fail the project delete or skip the other Secret', async () => {
        const p = (await createProject({})).json() as ProjectDto;
        const { names } = await seedEnv(p.id);
        const original = t.secrets.delete.bind(t.secrets);
        t.secrets.delete = async (name: string) => {
          if (name === names[0]) throw new Error('boom');
          return original(name);
        };
        try {
          const res = await t.app.inject({
            method: 'DELETE',
            url: `/api/projects/${p.id}`,
            headers: { cookie: alice },
          });
          expect(res.statusCode).toBe(204);
        } finally {
          t.secrets.delete = original;
        }
        const get = await t.app.inject({ method: 'GET', url: `/api/projects/${p.id}`, headers: { cookie: alice } });
        expect(get.statusCode).toBe(404);
        expect(await t.secrets.get(names[1] as string)).toBeNull();
      });
    });

    it('with a succeeded run that keeps its session: deletes the project and signals dropSession to that run', async () => {
      const p = (await createProject({})).json() as ProjectDto;
      const orgId = await aliceOrgId();
      const kept = await asOrg(
        orgId,
        `insert into runs (org_id, project_id, command, skill_name, ticket_ref, ticket_kind, checkout_ref, status,
                           trigger_source, session_expires_at)
         values ($1,$2,'fix','fix','1','issue','main','succeeded','manual', now() + interval '1 hour') returning id`,
        [orgId, p.id],
      );
      await asOrg(
        orgId,
        `insert into runs (org_id, project_id, command, skill_name, ticket_ref, ticket_kind, checkout_ref, status, trigger_source)
         values ($1,$2,'fix','fix','2','issue','main','succeeded','manual')`,
        [orgId, p.id],
      );
      t.temporal.reset();
      const res = await t.app.inject({ method: 'DELETE', url: `/api/projects/${p.id}`, headers: { cookie: alice } });
      expect(res.statusCode).toBe(204);
      expect(t.temporal.callsOfKind('signal')).toMatchObject([
        { workflowId: `run-${String(kept.rows[0]?.id)}`, args: [SIGNAL.dropSession] },
      ]);
    });

    it('a dropSession signal to a workflow that is gone does not fail the delete', async () => {
      const p = (await createProject({})).json() as ProjectDto;
      const orgId = await aliceOrgId();
      await asOrg(
        orgId,
        `insert into runs (org_id, project_id, command, skill_name, ticket_ref, ticket_kind, checkout_ref, status,
                           trigger_source, session_expires_at)
         values ($1,$2,'fix','fix','1','issue','main','succeeded','manual', now() + interval '1 hour')`,
        [orgId, p.id],
      );
      t.temporal.reset();
      t.temporal.signalFailure = (id) => new WorkflowNotFoundError('gone', id ?? '', undefined);
      const res = await t.app.inject({ method: 'DELETE', url: `/api/projects/${p.id}`, headers: { cookie: alice } });
      expect(res.statusCode).toBe(204);
    });

    it('sends dropSession only after the delete has committed, and a failed signal does not undo the delete', async () => {
      const p = (await createProject({})).json() as ProjectDto;
      const orgId = await aliceOrgId();
      await asOrg(
        orgId,
        `insert into runs (org_id, project_id, command, skill_name, ticket_ref, ticket_kind, checkout_ref, status,
                           trigger_source, session_expires_at)
         values ($1,$2,'fix','fix','1','issue','main','succeeded','manual', now() + interval '1 hour')`,
        [orgId, p.id],
      );
      t.temporal.reset();
      let projectRowsAtSignal: number | undefined;
      t.temporal.signalHook = async () => {
        projectRowsAtSignal = (await asOrg(orgId, 'select 1 from projects where id = $1', [p.id])).rows.length;
      };
      t.temporal.signalFailure = () => new Error('unavailable');
      const res = await t.app.inject({ method: 'DELETE', url: `/api/projects/${p.id}`, headers: { cookie: alice } });
      expect(res.statusCode).toBe(204);
      expect(projectRowsAtSignal).toBe(0);
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
    // The caller may read projects, so a malformed id is a target that does not exist (the guard looks the target up
    // before the pipe parses the param).
    const badId = await t.app.inject({ method: 'GET', url: '/api/projects/not-a-uuid', headers: { cookie: alice } });
    expect(badId.statusCode).toBe(404);
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

describe('POST /api/projects/:projectId/connection/poll (Check now)', () => {
  const checkNow = (id: string, cookie = alice) =>
    t.app.inject({ method: 'POST', url: `/api/projects/${id}/connection/poll`, headers: { cookie } });
  const pollingProject = async (cursor = ''): Promise<string> => {
    const p = (await createProject({ triggerMode: 'polling' })).json() as ProjectDto;
    if (cursor) await asOrg(await aliceOrgId(), `update poll_cursors set ${cursor} where project_id = $1`, [p.id]);
    t.temporal.reset();
    return p.id;
  };

  it('triggers the project poll schedule once and answers 202', async () => {
    const id = await pollingProject();
    const res = await checkNow(id);
    expect(res.statusCode).toBe(202);
    expectContract('projects.pollNow', res);
    expect(t.temporal.callsOfKind('scheduleTrigger').map((c) => c.scheduleId)).toEqual([`poll-${id}`]);
  });

  it.each([
    ['token_revoked', "paused_reason = 'token_revoked'", /token was revoked/],
    ['rate_limited', "paused_reason = 'rate_limited', next_poll_at = now() + interval '1 hour'", /rate limit/],
  ])('refuses with 409 and the reason while polling is paused (%s)', async (_name, cursor, reason) => {
    const id = await pollingProject(cursor);
    const res = await checkNow(id);
    expect(res.statusCode).toBe(409);
    expect((res.json() as { detail: string }).detail).toMatch(reason);
    expect(t.temporal.callsOfKind('scheduleTrigger')).toHaveLength(0);
  });

  it('refuses with 409 inside a back-off window, which a poll would skip', async () => {
    const id = await pollingProject("failures = 1, next_poll_at = now() + interval '10 minutes'");
    const res = await checkNow(id);
    expect(res.statusCode).toBe(409);
    expect((res.json() as { detail: string }).detail).toMatch(/backing off/);
    expect(t.temporal.callsOfKind('scheduleTrigger')).toHaveLength(0);
  });

  it('refuses with 409 for a webhook project', async () => {
    const p = (await createProject({})).json() as ProjectDto;
    t.temporal.reset();
    const res = await checkNow(p.id);
    expect(res.statusCode).toBe(409);
    expect(t.temporal.callsOfKind('scheduleTrigger')).toHaveLength(0);
  });

  it('answers 409 when the schedule is missing, and 404 for another org or an unknown project', async () => {
    const id = await pollingProject();
    t.temporal.triggerError = new ScheduleNotFoundError('gone', 'poll-x');
    expect((await checkNow(id)).statusCode).toBe(409);
    expect((await checkNow(id, bob)).statusCode).toBe(404);
    expect((await checkNow(randomUUID())).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'POST', url: `/api/projects/${id}/connection/poll` })).statusCode).toBe(401);
  });

  it('is 403 for a viewer, who lacks run:create on the project', async () => {
    const id = await pollingProject();
    const carol = await inviteAndLogin(t, aliceOrg, 'carol', 'viewer', { type: 'project', projectIds: [id] });
    expect((await checkNow(id, carol)).statusCode).toBe(403);
    expect(t.temporal.callsOfKind('scheduleTrigger')).toHaveLength(0);
  });

  it('runs for a member of the project who did not create it (BR-68)', async () => {
    const id = await pollingProject();
    const dave = await inviteAndLogin(t, aliceOrg, 'dave', 'member', { type: 'project', projectIds: [id] });
    expect((await checkNow(id, dave)).statusCode).toBe(202);
    expect(t.temporal.callsOfKind('scheduleTrigger').map((c) => c.scheduleId)).toEqual([`poll-${id}`]);
  });
});

describe('projects.list paging', () => {
  let a: string;
  let b: string;
  let aOrg: string;
  let bOrg: string;
  let aConn: string;
  let bConn: string;
  let empty: string;
  const aIds: string[] = [];
  const bIds: string[] = [];

  /** Inserts `count` projects straight into the org (the HTTP create needs a reachable repo), oldest first. */
  async function seed(orgId: string, conn: string, prefix: string, count: number, createdAt?: Date): Promise<string[]> {
    const res = await asOrg(
      orgId,
      `insert into projects (org_id, name, repo_path, code_connection_id, board_connection_id, created_at)
       select $1::uuid, $3 || g, $3 || g, $2::uuid, $2::uuid, coalesce($5::timestamptz, now() - interval '1 day' + g * interval '1 second')
       from generate_series(1, $4::int) g returning id`,
      [orgId, conn, prefix, count, createdAt ?? null],
    );
    return res.rows.map((r) => r.id as string);
  }
  const list = (cookie: string, qs = '') =>
    t.app.inject({ method: 'GET', url: `/api/projects${qs}`, headers: { cookie } });

  beforeAll(async () => {
    aOrg = (await createOrg(t, 'Paging A', 'paging-a')).id;
    bOrg = (await createOrg(t, 'Paging B', 'paging-b')).id;
    const emptyOrg = (await createOrg(t, 'Paging Empty', 'paging-empty')).id;
    a = await inviteAndLogin(t, aOrg, 'paging-a', 'owner', { type: 'org' });
    b = await inviteAndLogin(t, bOrg, 'paging-b', 'owner', { type: 'org' });
    empty = await inviteAndLogin(t, emptyOrg, 'paging-empty', 'owner', { type: 'org' });
    aConn = await installFakeConnection(a);
    bConn = await installFakeConnection(b);
    aIds.push(...(await seed(aOrg, aConn, 'paging-a/p', 26)));
    bIds.push(...(await seed(bOrg, bConn, 'paging-b/p', 30)));
  });

  async function installFakeConnection(cookie: string): Promise<string> {
    const inst = await t.app.inject({ method: 'POST', url: '/api/connections/fake/install', headers: { cookie } });
    const u = new URL((inst.json() as { url: string }).url);
    const cb = await t.app.inject({ method: 'GET', url: `${u.pathname}${u.search}`, headers: { cookie } });
    return new URL(String(cb.headers['location'])).searchParams.get('connection') ?? '';
  }

  it('returns the first 20 of 26 with the real total by default', async () => {
    const page = expectContract('projects.list', await list(a)) as Page<ProjectDto>;
    expect(page.items).toHaveLength(20);
    expect(page).toMatchObject({ total: 26, page: 1, pageSize: 20 });
    expect(page.items.map((p) => p.id)).toEqual(aIds.slice(0, 20));
  });

  it('TC-20.3: page 2 holds the last 6, oldest created first, and the pages cover every id once', async () => {
    const p1 = expectContract('projects.list', await list(a)) as Page<ProjectDto>;
    const p2 = expectContract('projects.list', await list(a, '?page=2')) as Page<ProjectDto>;
    expect(p2.items).toHaveLength(6);
    expect(p2.items.map((p) => p.id)).toEqual(aIds.slice(20));
    const all = [...p1.items, ...p2.items].map((p) => p.id);
    expect(new Set(all).size).toBe(26);
    expect([...all].sort()).toEqual([...aIds].sort());
  });

  it('orders rows with equal created_at by id, the same on every request', async () => {
    const orgId = (await createOrg(t, 'Paging Ties', 'paging-ties')).id;
    const cookie = await inviteAndLogin(t, orgId, 'paging-ties', 'owner', { type: 'org' });
    const conn = await installFakeConnection(cookie);
    const ids = await seed(orgId, conn, 'paging-ties/p', 22, new Date('2026-01-01T00:00:00Z'));
    const first = (expectContract('projects.list', await list(cookie)) as Page<ProjectDto>).items.map((p) => p.id);
    const second = (expectContract('projects.list', await list(cookie)) as Page<ProjectDto>).items.map((p) => p.id);
    expect(first).toEqual(second);
    expect(first).toEqual([...ids].sort().slice(0, 20));
  });

  it('a page past the last is 200 with no items and the real total', async () => {
    const res = await list(a, '?page=3');
    expect(res.statusCode).toBe(200);
    expect(expectContract('projects.list', res)).toMatchObject({ items: [], total: 26, page: 3 });
  });

  it.each(['?page=0', '?pageSize=0', '?pageSize=101', '?page=abc', '?page=2147483648'])('%s is a 400', async (qs) => {
    expect((await list(a, qs)).statusCode).toBe(400);
  });

  it('TC-37.1, TC-37.3: counts and lists only the caller org, and an org without projects gets total 0', async () => {
    const mine = expectContract('projects.list', await list(a, '?pageSize=100')) as Page<ProjectDto>;
    expect(mine.total).toBe(26);
    expect(mine.items.some((p) => bIds.includes(p.id))).toBe(false);
    const theirs = expectContract('projects.list', await list(b, '?pageSize=100')) as Page<ProjectDto>;
    expect(theirs.total).toBe(30);
    expect(theirs.items.some((p) => aIds.includes(p.id))).toBe(false);
    expect(expectContract('projects.list', await list(empty))).toMatchObject({ items: [], total: 0 });
  });
});

describe('projects: permission (BR-18, BR-33, BR-29)', () => {
  const list = async (cookie: string) =>
    expectContract(
      'projects.list',
      await t.app.inject({ method: 'GET', url: '/api/projects', headers: { cookie } }),
    ) as Page<ProjectDto>;
  const get = (id: string, cookie = alice) =>
    t.app.inject({ method: 'GET', url: `/api/projects/${id}`, headers: { cookie } });
  const remove = (id: string, cookie: string) =>
    t.app.inject({ method: 'DELETE', url: `/api/projects/${id}`, headers: { cookie } });

  it('TC-18.1, TC-18.2, TC-33.1: a member cannot create, delete or edit a project and nothing changes', async () => {
    const p1 = (await createProject({})).json() as ProjectDto;
    const member = await inviteAndLogin(t, aliceOrg, 'proj-member', 'member', { type: 'org' });
    const before = await list(member);
    expect((await get(p1.id, member)).statusCode).toBe(200);
    t.temporal.reset();

    expect((await createProject({}, member)).statusCode).toBe(403);
    expect((await remove(p1.id, member)).statusCode).toBe(403);
    expect((await patch(p1.id, { name: 'Renamed by a member' }, member)).statusCode).toBe(403);

    const after = await list(member);
    expect(after.total).toBe(before.total);
    expect(after.items.map((x) => x.id)).toEqual(before.items.map((x) => x.id));
    expect((await get(p1.id, member)).statusCode).toBe(200);
    const reread = expectContract('projects.get', await get(p1.id)) as ProjectDto;
    expect(reread.name).toBe(p1.name);
    expect(t.temporal.calls).toEqual([]);
  });

  it('TC-29.1, TC-29.5, TC-29.6: an admin on P1 edits P1 but cannot create or delete projects', async () => {
    const p1 = (await createProject({})).json() as ProjectDto;
    const admin = await inviteAndLogin(t, aliceOrg, 'proj-admin', 'admin', { type: 'project', projectIds: [p1.id] });
    const before = await list(admin);

    const edited = await patch(p1.id, { name: 'Renamed by P1 admin' }, admin);
    expect(edited.statusCode).toBe(200);
    expect((expectContract('projects.update', edited) as ProjectDto).name).toBe('Renamed by P1 admin');
    expect((await createProject({}, admin)).statusCode).toBe(403);
    expect((await remove(p1.id, admin)).statusCode).toBe(403);

    expect((await list(admin)).items.map((x) => x.id)).toEqual(before.items.map((x) => x.id));
    expect((await get(p1.id)).statusCode).toBe(200);
  });
});
