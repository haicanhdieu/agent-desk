import { Writable } from 'node:stream';
import { sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { credentialSecretName, type AgentHttpGet } from '@agentdesk/core';
import { withOrg } from '@agentdesk/db';
import { AGENT_KINDS_COMING_SOON, type AgentDto, type AgentModelsDto, type Page } from '@agentdesk/contracts';
import { createTestApp, type TestApp } from './helpers/app';
import { createOrg, inviteAndLogin } from './helpers/auth';
import { expectContract } from './helpers/contract';
import { makeAgent } from './helpers/agents';
import { freshStateDir, installFake, makeProject, wideFakeRepos } from './helpers/fixtures';

const KEY = 'sk-multi-secret-0001';
let t: TestApp;
const logged: string[] = [];
const httpCalls: { url: string; headers: Record<string, string> }[] = [];
const agentHttp: AgentHttpGet = (url, headers) => {
  httpCalls.push({ url: url.toString(), headers });
  return Promise.resolve({ status: 200, json: { data: [{ id: `m-${headers['x-api-key'] ?? 'none'}` }] } });
};

beforeAll(async () => {
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      logged.push(chunk.toString());
      cb();
    },
  });
  t = await createTestApp({
    env: { FAKE_STATE_DIR: freshStateDir() },
    wrapAdapters: wideFakeRepos,
    logger: pino({ level: 'debug' }, stream),
    agentHttp,
  });
});
afterAll(async () => {
  await t.close();
});

interface World {
  orgId: string;
  owner: string;
  projectId: string;
  /** The placeholder default agent the project was created with. */
  placeholder: AgentDto;
}

let worldSeq = 0;
/** A fresh org with an owner and one project (with its placeholder default agent). */
async function world(): Promise<World> {
  worldSeq += 1;
  const org = await createOrg(t, `Multi ${worldSeq}`, `multi-${worldSeq}`);
  const owner = await inviteAndLogin(t, org.id, `multi-owner-${worldSeq}`, 'owner', { type: 'org' });
  const { projectId } = await makeProject(t, owner, await installFake(t, owner));
  const list = await listAgents(owner, projectId);
  return { orgId: org.id, owner, projectId, placeholder: list.items[0] as AgentDto };
}

const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, cookie: string, payload?: object) =>
  t.app.inject({ method, url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });
const create = (w: { owner: string; projectId: string }, payload: object, cookie = w.owner) =>
  call('POST', `/api/projects/${w.projectId}/agents`, cookie, payload);
const patch = (agentId: string, payload: object, cookie: string) =>
  call('PATCH', `/api/agents/${agentId}`, cookie, payload);
const setDefault = (agentId: string, cookie: string) => call('POST', `/api/agents/${agentId}/default`, cookie);
const putCred = (agentId: string, payload: object, cookie: string) =>
  call('PUT', `/api/agents/${agentId}/credential`, cookie, payload);
async function listAgents(cookie: string, projectId: string, query = 'pageSize=100'): Promise<Page<AgentDto>> {
  return expectContract(
    'agents.list',
    await call('GET', `/api/projects/${projectId}/agents?${query}`, cookie),
  ) as Page<AgentDto>;
}
const pointersOf = (res: { json: () => unknown }): string[] =>
  ((res.json() as { errors?: { pointer: string }[] }).errors ?? []).map((e) => e.pointer);
const rowsOf = (orgId: string, query: ReturnType<typeof sql>) =>
  withOrg(t.db, orgId, async (tx) => (await tx.execute(query)).rows as Record<string, unknown>[]);

describe('create and default (BR-6, BR-62)', () => {
  it('a project made with a placeholder lists it as the default; a second agent is not the default', async () => {
    const w = await world();
    expect(w.placeholder).toMatchObject({ name: 'Claude', isDefault: true });
    const second = expectContract('agents.create', await create(w, { provider: 'claude', name: 'Work' })) as AgentDto;
    expect(second.isDefault).toBe(false);
    const list = await listAgents(w.owner, w.projectId);
    expect(list.items.map((a) => a.name)).toEqual(['Claude', 'Work']);
    expect(list.total).toBe(2);
  });

  it('a project with no default gives the new agent the default flag', async () => {
    const w = await world();
    await rowsOf(w.orgId, sql`update agents set is_default = false where project_id = ${w.projectId}`);
    const a = expectContract('agents.create', await create(w, { provider: 'codex', name: 'First' })) as AgentDto;
    expect(a.isDefault).toBe(true);
  });

  it('concurrent creates into a project with no default leave exactly one default', async () => {
    const w = await world();
    await rowsOf(w.orgId, sql`update agents set is_default = false where project_id = ${w.projectId}`);
    const results = await Promise.all(
      ['A', 'B', 'C', 'D'].map((name) => create(w, { provider: 'claude', name: `Racer ${name}` })),
    );
    for (const r of results) expect(r.statusCode).toBe(201);
    const rows = await rowsOf(w.orgId, sql`select id from agents where project_id = ${w.projectId} and is_default`);
    expect(rows).toHaveLength(1);
  });

  it('a rejected create writes nothing', async () => {
    const w = await world();
    const res = await create(w, { provider: 'claude', name: 'claude' });
    expect(res.statusCode).toBe(409);
    expect((await listAgents(w.owner, w.projectId)).total).toBe(1);
  });

  it('stores the model sent, else the first built-in (BR-6)', async () => {
    const w = await world();
    const sent = expectContract(
      'agents.create',
      await create(w, { provider: 'claude', name: 'Sent', model: 'claude-opus-4-1' }),
    ) as AgentDto;
    expect(sent.model).toBe('claude-opus-4-1');
    const none = expectContract('agents.create', await create(w, { provider: 'claude', name: 'Absent' })) as AgentDto;
    expect(none.model).toBe('opus');
  });

  it('keeps each agent of one kind with its own fields and credential status (BR-7)', async () => {
    const w = await world();
    const a = await makeAgent(t, w.owner, w.projectId, {
      name: 'Personal',
      accountLabel: 'me@example.com',
      model: 'opus',
    });
    const b = await makeAgent(t, w.owner, w.projectId, { name: 'Work', accountLabel: 'team', model: 'haiku' });
    expect((await putCred(a.id, { type: 'api_key', value: KEY }, w.owner)).statusCode).toBe(200);
    const list = await listAgents(w.owner, w.projectId);
    const [pa, pb] = [a, b].map((x) => list.items.find((i) => i.id === x.id) as AgentDto);
    expect(pa).toMatchObject({ name: 'Personal', accountLabel: 'me@example.com', model: 'opus' });
    expect(pa?.credential.set).toBe(true);
    expect(pb).toMatchObject({ name: 'Work', accountLabel: 'team', model: 'haiku' });
    expect(pb?.credential.set).toBe(false);
  });

  it('accepts a 256 character name and label and refuses 257 (BR-8)', async () => {
    const w = await world();
    const ok = await create(w, { provider: 'claude', name: 'n'.repeat(256), accountLabel: 'l'.repeat(256) });
    expect(ok.statusCode).toBe(201);
    const longName = await create(w, { provider: 'claude', name: 'n'.repeat(257) });
    expect(longName.statusCode).toBe(400);
    expect(pointersOf(longName)).toContain('/name');
    const longLabel = await create(w, { provider: 'claude', name: 'ok', accountLabel: 'l'.repeat(257) });
    expect(longLabel.statusCode).toBe(400);
    expect(pointersOf(longLabel)).toContain('/accountLabel');
  });

  it('a duplicate name ignoring case, with a trailing space, Straße or İ, is 409 on /name, never 500 (BR-9)', async () => {
    const w = await world();
    for (const [first, second] of [
      ['Work', 'WORK'],
      ['Spaced', 'spaced '],
      ['Straße', 'Straße'],
      ['İ', 'İ'],
    ] as const) {
      expect((await create(w, { provider: 'claude', name: first })).statusCode).toBe(201);
      const dup = await create(w, { provider: 'claude', name: second });
      expect(dup.statusCode, `${first} / ${second}`).toBe(409);
      expect(pointersOf(dup)).toContain('/name');
    }
  });

  it('the same name in another project is fine', async () => {
    const w = await world();
    const other = await makeProject(t, w.owner, await installFake(t, w.owner));
    expect((await create(w, { provider: 'claude', name: 'Shared' })).statusCode).toBe(201);
    expect(
      (await create({ owner: w.owner, projectId: other.projectId }, { provider: 'claude', name: 'Shared' })).statusCode,
    ).toBe(201);
  });

  it('refuses each Coming-soon and unknown provider with 422 on /provider, and opencode is 201 (BR-51)', async () => {
    const w = await world();
    const names = [...AGENT_KINDS_COMING_SOON.map((k) => k.id), 'antigravity', 'nope'];
    expect(names.length).toBeGreaterThanOrEqual(10);
    for (const provider of names) {
      const res = await create(w, { provider, name: `x-${provider}` });
      expect(res.statusCode, provider).toBe(422);
      expect(pointersOf(res)).toContain('/provider');
      const p = await patch(w.placeholder.id, { provider }, w.owner);
      expect(p.statusCode, `PATCH ${provider}`).toBe(422);
      expect(pointersOf(p)).toContain('/provider');
      const put = await call('PUT', `/api/projects/${w.projectId}/agent`, w.owner, {
        provider,
        model: 'sonnet',
        timeoutSeconds: 3600,
      });
      expect(put.statusCode, `PUT ${provider}`).toBe(422);
    }
    expect((await listAgents(w.owner, w.projectId)).total).toBe(1);
    expect((await create(w, { provider: 'opencode', name: 'Open' })).statusCode).toBe(201);
  });

  it('blockingRuns counts non-final runs and succeeded runs with a reopenable kept session only', async () => {
    const w = await world();
    const a = await makeAgent(t, w.owner, w.projectId, { name: 'Blocked' });
    const future = sql`now() + interval '1 hour'`;
    const past = sql`now() - interval '1 hour'`;
    const none = sql`null`;
    const cases: [string, ReturnType<typeof sql>, boolean][] = [
      ['queued', none, true],
      ['running', none, true],
      ['idle', none, true],
      ['paused', none, true],
      ['succeeded', future, true],
      ['succeeded', past, false],
      ['succeeded', none, false],
      ['failed', future, false],
      ['cancelled', future, false],
    ];
    for (const [i, [status, expires]] of cases.entries()) {
      await rowsOf(
        w.orgId,
        sql`insert into runs (org_id, project_id, agent_id, command, skill_name, ticket_ref, ticket_kind, checkout_ref, trigger_source, status, session_expires_at) values (${w.orgId}, ${w.projectId}, ${a.id}, 'fix', 'fix', ${`t${i}`}, 'issue', 'refs/heads/main', 'webhook', ${status}, ${expires})`,
      );
    }
    const dto = (await listAgents(w.owner, w.projectId)).items.find((x) => x.name === 'Blocked');
    expect(dto?.usage.blockingRuns).toBe(cases.filter((c) => c[2]).length);
  });

  it('refuses an empty model for claude and codex on /model', async () => {
    const w = await world();
    for (const provider of ['claude', 'codex']) {
      const res = await create(w, { provider, name: `e-${provider}`, model: '' });
      expect([400, 422]).toContain(res.statusCode);
      expect(pointersOf(res)).toContain('/model');
    }
  });

  it('the list is ordered default first, then by lower name, with usage from the rules and runs of each agent', async () => {
    const w = await world();
    const zed = await makeAgent(t, w.owner, w.projectId, { name: 'Zed' });
    await makeAgent(t, w.owner, w.projectId, { name: 'alpha' });
    await rowsOf(
      w.orgId,
      sql`insert into rules (org_id, project_id, agent_id, command, prompt, target) values (${w.orgId}, ${w.projectId}, ${zed.id}, 'r1', 'p', 'issue')`,
    );
    await rowsOf(
      w.orgId,
      sql`insert into runs (org_id, project_id, agent_id, command, skill_name, ticket_ref, ticket_kind, checkout_ref, trigger_source, status) values
        (${w.orgId}, ${w.projectId}, ${zed.id}, 'fix', 'fix', '1', 'issue', 'refs/heads/main', 'webhook', 'queued'),
        (${w.orgId}, ${w.projectId}, ${zed.id}, 'fix', 'fix', '2', 'issue', 'refs/heads/main', 'webhook', 'succeeded')`,
    );
    const list = await listAgents(w.owner, w.projectId);
    expect(list.items.map((a) => a.name)).toEqual(['Claude', 'alpha', 'Zed']);
    expect(list.items.find((a) => a.name === 'Zed')?.usage).toEqual({ rules: 1, blockingRuns: 1 });
    expect(list.items.find((a) => a.name === 'alpha')?.usage).toEqual({ rules: 0, blockingRuns: 0 });
    const page2 = await listAgents(w.owner, w.projectId, 'pageSize=2&page=2');
    expect(page2.items.map((a) => a.name)).toEqual(['Zed']);
    expect(page2.total).toBe(3);
  });
});

describe('update (BR-11, BR-16, BR-17)', () => {
  it('persists name, label and model; an empty body is a no-op; null clears the label and max turns', async () => {
    const w = await world();
    const a = await makeAgent(t, w.owner, w.projectId, { name: 'Edit me', accountLabel: 'old', maxTurns: 7 });
    const saved = expectContract(
      'agents.update',
      await patch(a.id, { name: 'Edited', accountLabel: 'new', model: 'haiku' }, w.owner),
    ) as AgentDto;
    expect(saved).toMatchObject({ name: 'Edited', accountLabel: 'new', model: 'haiku', maxTurns: 7 });
    expect(expectContract('agents.update', await patch(a.id, {}, w.owner))).toEqual(saved);
    const cleared = expectContract('agents.update', await patch(a.id, { accountLabel: null, maxTurns: null }, w.owner));
    expect(cleared).toMatchObject({ accountLabel: null, maxTurns: null, name: 'Edited' });
    const reloaded = (await listAgents(w.owner, w.projectId)).items.find((x) => x.id === a.id);
    expect(reloaded).toMatchObject({ name: 'Edited', model: 'haiku', accountLabel: null });
  });

  it('refuses a provider change, an invalid model on /model and a duplicate name with 409', async () => {
    const w = await world();
    const a = await makeAgent(t, w.owner, w.projectId, { name: 'One' });
    const p = await patch(a.id, { provider: 'codex' }, w.owner);
    expect(p.statusCode).toBe(400);
    expect(((await listAgents(w.owner, w.projectId)).items.find((x) => x.id === a.id) as AgentDto).provider).toBe(
      'claude',
    );
    const bad = await patch(a.id, { model: 'has space' }, w.owner);
    expect(bad.statusCode).toBe(400);
    expect(pointersOf(bad)).toContain('/model');
    const empty = await patch(a.id, { model: '' }, w.owner);
    expect([400, 422]).toContain(empty.statusCode);
    expect(pointersOf(empty)).toContain('/model');
    const dup = await patch(a.id, { name: 'CLAUDE' }, w.owner);
    expect(dup.statusCode).toBe(409);
    expect(pointersOf(dup)).toContain('/name');
    expect((await patch(a.id, { name: 'ONE' }, w.owner)).statusCode).toBe(200);
  });

  it('an invalid model on create is 400 on /model (BR-11)', async () => {
    const w = await world();
    for (const model of ['a b', 'x'.repeat(201), 'bad\u0007char']) {
      const res = await create(w, { provider: 'claude', name: 'm', model });
      expect(res.statusCode).toBe(400);
      expect(pointersOf(res)).toContain('/model');
    }
  });

  it('opencode can set and clear its model, and a PATCH never moves a credential', async () => {
    const w = await world();
    const o = await makeAgent(t, w.owner, w.projectId, { provider: 'opencode', name: 'Open' });
    expect(o.model).toBe('');
    const set = expectContract('agents.update', await patch(o.id, { model: 'anthropic/claude-sonnet-4-5' }, w.owner));
    expect(set).toMatchObject({ model: 'anthropic/claude-sonnet-4-5' });
    const cleared = expectContract('agents.update', await patch(o.id, { model: '' }, w.owner));
    expect(cleared).toMatchObject({ model: '' });
  });
});

describe('set default (BR-2, BR-23, BR-24)', () => {
  it('moves the flag and leaves exactly one default', async () => {
    const w = await world();
    const b = await makeAgent(t, w.owner, w.projectId, { name: 'B' });
    const made = expectContract('agents.setDefault', await setDefault(b.id, w.owner)) as AgentDto;
    expect(made.isDefault).toBe(true);
    const list = await listAgents(w.owner, w.projectId);
    expect(list.items.filter((a) => a.isDefault).map((a) => a.name)).toEqual(['B']);
    expect(list.items[0]?.name).toBe('B');
    // setting the current default again is fine
    expect((await setDefault(b.id, w.owner)).statusCode).toBe(200);
  });

  it('two concurrent calls leave one default', async () => {
    const w = await world();
    const b = await makeAgent(t, w.owner, w.projectId, { name: 'B' });
    const c = await makeAgent(t, w.owner, w.projectId, { name: 'C' });
    const res = await Promise.all([setDefault(b.id, w.owner), setDefault(c.id, w.owner)]);
    for (const r of res) expect(r.statusCode).toBe(200);
    const rows = await rowsOf(w.orgId, sql`select id from agents where project_id = ${w.projectId} and is_default`);
    expect(rows).toHaveLength(1);
  });
});

describe('credential rules (BR-12, BR-13, BR-14, BR-15)', () => {
  it('replacing the credential of A leaves B untouched, and the value is in no response, audit row or log', async () => {
    const w = await world();
    const a = await makeAgent(t, w.owner, w.projectId, { name: 'A' });
    const b = await makeAgent(t, w.owner, w.projectId, { name: 'B' });
    expect((await putCred(b.id, { type: 'oauth_token', value: 'b-token-0001' }, w.owner)).statusCode).toBe(200);
    logged.length = 0;
    const res = await putCred(a.id, { type: 'api_key', value: KEY }, w.owner);
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(KEY);
    expect(await t.secrets.get(credentialSecretName(w.orgId, b.id))).toEqual({
      type: 'oauth_token',
      value: 'b-token-0001',
    });
    expect(await t.secrets.get(credentialSecretName(w.orgId, a.id))).toEqual({ type: 'api_key', value: KEY });
    const list = await listAgents(w.owner, w.projectId);
    expect(JSON.stringify(list)).not.toContain(KEY);
    for (const x of list.items) expect(Object.keys(x.credential).sort()).toEqual(['set', 'setBy', 'type', 'updatedAt']);
    const dump = JSON.stringify(await rowsOf(w.orgId, sql`select * from audit_log`));
    expect(dump).not.toContain(KEY);
    expect(logged.join('')).not.toContain(KEY);
  });

  it('refuses a type the kind does not list with 422 on /type and an address a kind or type cannot take on /baseUrl', async () => {
    const w = await world();
    const claude = await makeAgent(t, w.owner, w.projectId, { name: 'Cl' });
    const codex = await makeAgent(t, w.owner, w.projectId, { provider: 'codex', name: 'Cx' });
    const open = await makeAgent(t, w.owner, w.projectId, { provider: 'opencode', name: 'Op' });
    const before = t.secrets.names().length;
    const typeRes = await putCred(claude.id, { type: 'auth_json', value: '{}' }, w.owner);
    expect(typeRes.statusCode).toBe(422);
    expect(pointersOf(typeRes)).toContain('/type');
    expect((await putCred(codex.id, { type: 'oauth_token', value: 'x' }, w.owner)).statusCode).toBe(422);
    for (const type of ['api_key', 'auth_json']) {
      const value = type === 'auth_json' ? '{"a":1}' : 'k';
      const res = await putCred(codex.id, { type, value, baseUrl: 'https://llm.example.com/v1' }, w.owner);
      expect(res.statusCode, `codex ${type}`).toBe(422);
      expect(pointersOf(res)).toContain('/baseUrl');
    }
    const fileWithAddress = await putCred(
      open.id,
      { type: 'auth_json', value: '{"a":1}', baseUrl: 'https://llm.example.com/v1' },
      w.owner,
    );
    expect(fileWithAddress.statusCode).toBe(422);
    expect(pointersOf(fileWithAddress)).toContain('/baseUrl');
    expect(t.secrets.names()).toHaveLength(before);
  });

  it('a Claude address is optional and an address change resets the stored test', async () => {
    const w = await world();
    const a = await makeAgent(t, w.owner, w.projectId, { name: 'A' });
    const res = await putCred(a.id, { type: 'api_key', value: KEY, baseUrl: 'https://gateway.example.com' }, w.owner);
    expect(res.statusCode).toBe(200);
    const row = (await listAgents(w.owner, w.projectId)).items.find((x) => x.id === a.id);
    expect(row).toMatchObject({ baseUrl: 'https://gateway.example.com', lastTest: null });
    await rowsOf(w.orgId, sql`update agents set last_test_status = 'ok', last_test_at = now() where id = ${a.id}`);
    expect(
      ((await listAgents(w.owner, w.projectId)).items.find((x) => x.id === a.id) as AgentDto).lastTest?.status,
    ).toBe('ok');
    expect((await putCred(a.id, { type: 'api_key', value: KEY }, w.owner)).statusCode).toBe(200);
    expect(((await listAgents(w.owner, w.projectId)).items.find((x) => x.id === a.id) as AgentDto).lastTest).toBeNull();
  });

  it('per-agent models use that agent own credential and address (BR-18, BR-19)', async () => {
    const w = await world();
    const a = await makeAgent(t, w.owner, w.projectId, { name: 'MA' });
    const b = await makeAgent(t, w.owner, w.projectId, { name: 'MB' });
    await putCred(a.id, { type: 'api_key', value: 'key-for-a' }, w.owner);
    await putCred(b.id, { type: 'api_key', value: 'key-for-b', baseUrl: 'https://b.example.com' }, w.owner);
    httpCalls.length = 0;
    const ma = expectContract(
      'agents.models',
      await call('GET', `/api/agents/${a.id}/models`, w.owner),
    ) as AgentModelsDto;
    const mb = expectContract(
      'agents.models',
      await call('GET', `/api/agents/${b.id}/models`, w.owner),
    ) as AgentModelsDto;
    expect(ma.models[0]?.id).toBe('m-key-for-a');
    expect(mb.models[0]?.id).toBe('m-key-for-b');
    expect(httpCalls[1]?.url).toContain('b.example.com');
    expect(httpCalls[0]?.url).not.toContain('b.example.com');
    const none = await makeAgent(t, w.owner, w.projectId, { name: 'MC' });
    const mc = expectContract(
      'agents.models',
      await call('GET', `/api/agents/${none.id}/models`, w.owner),
    ) as AgentModelsDto;
    expect(mc).toMatchObject({ source: 'builtin', reason: 'no_credential' });
  });
});

describe('compat routes (BR-45, BR-50)', () => {
  it('PUT writes the agent and the five project limits, and GET reads them back', async () => {
    const w = await world();
    const res = await call('PUT', `/api/projects/${w.projectId}/agent`, w.owner, {
      model: 'opus',
      maxTurns: 9,
      timeoutSeconds: 7200,
      pausedKeepSeconds: 7200,
      doneKeepSeconds: 100,
      idleEndSeconds: 600,
      autoResumeMax: 3,
    });
    expect(expectContract('agents.put', res)).toMatchObject({ model: 'opus', maxTurns: 9, timeoutSeconds: 7200 });
    const project = await rowsOf(
      w.orgId,
      sql`select timeout_seconds, paused_keep_seconds, done_keep_seconds, idle_end_seconds, auto_resume_max from projects where id = ${w.projectId}`,
    );
    expect(project[0]).toEqual({
      timeout_seconds: 7200,
      paused_keep_seconds: 7200,
      done_keep_seconds: 100,
      idle_end_seconds: 600,
      auto_resume_max: 3,
    });
    // every agent of the project shows the project limits
    const other = await makeAgent(t, w.owner, w.projectId, { name: 'Other' });
    expect(other).toMatchObject({ timeoutSeconds: 7200, idleEndSeconds: 600, autoResumeMax: 3 });
  });

  it('GET and PUT act on the default agent, whatever its position', async () => {
    const w = await world();
    const b = await makeAgent(t, w.owner, w.projectId, { name: 'Aaa' });
    await setDefault(b.id, w.owner);
    const got = expectContract(
      'agents.get',
      await call('GET', `/api/projects/${w.projectId}/agent`, w.owner),
    ) as AgentDto;
    expect(got.id).toBe(b.id);
    const put = expectContract(
      'agents.put',
      await call('PUT', `/api/projects/${w.projectId}/agent`, w.owner, { model: 'haiku', timeoutSeconds: 3600 }),
    ) as AgentDto;
    expect(put.id).toBe(b.id);
  });
});

describe('access: owner, project admin, member, viewer, other project and other org', () => {
  let a: World;
  let b: World;
  let admin: string;
  let member: string;
  let viewer: string;
  let p2: string;
  let agentP2: AgentDto;
  let agentOther: AgentDto;
  let own: AgentDto;

  beforeAll(async () => {
    a = await world();
    b = await world();
    admin = await inviteAndLogin(t, a.orgId, 'multi-acc-adm', 'admin', { type: 'project', projectIds: [a.projectId] });
    member = await inviteAndLogin(t, a.orgId, 'multi-acc-mem', 'member', { type: 'org' });
    viewer = await inviteAndLogin(t, a.orgId, 'multi-acc-vw', 'viewer', { type: 'org' });
    p2 = (await makeProject(t, a.owner, await installFake(t, a.owner))).projectId;
    agentP2 = await makeAgent(t, a.owner, p2, { name: 'P2 only' });
    agentOther = await makeAgent(t, b.owner, b.projectId, { name: 'Other org' });
    own = await makeAgent(t, a.owner, a.projectId, { name: 'Mine' });
  });

  const routes = (
    agentId: string,
    projectId: string,
  ): [string, 'GET' | 'POST' | 'PATCH', string, object | undefined][] => [
    ['list', 'GET', `/api/projects/${projectId}/agents`, undefined],
    ['create', 'POST', `/api/projects/${projectId}/agents`, { provider: 'claude', name: 'Denied' }],
    ['update', 'PATCH', `/api/agents/${agentId}`, { name: 'Renamed by test' }],
    ['setDefault', 'POST', `/api/agents/${agentId}/default`, undefined],
  ];

  it('allows the owner and a project admin', async () => {
    for (const cookie of [a.owner, admin]) {
      const names = cookie === a.owner ? 'owner' : 'admin';
      const [list, , update, def] = routes(own.id, a.projectId);
      expect((await call('GET', list[2], cookie)).statusCode, `${names} list`).toBe(200);
      expect((await call('PATCH', update[2], cookie, { name: `Mine ${names}` })).statusCode, `${names} update`).toBe(
        200,
      );
      expect((await call('POST', def[2], cookie)).statusCode, `${names} default`).toBe(200);
    }
    expect(
      (await create({ owner: a.owner, projectId: a.projectId }, { provider: 'claude', name: 'By admin' }, admin))
        .statusCode,
    ).toBe(201);
    await setDefault(a.placeholder.id, a.owner);
  });

  it('refuses a member and a viewer with 403 before any id lookup, whatever the id', async () => {
    const RANDOM = '5b0f5d6e-8f4e-4c55-9d52-0c2f3a9a1e11';
    for (const cookie of [member, viewer]) {
      for (const id of [own.id, RANDOM, agentOther.id]) {
        for (const [key, method, url, payload] of routes(id, a.projectId)) {
          const res = await call(method, url, cookie, payload);
          expect(res.statusCode, `${key} ${id}`).toBe(403);
        }
      }
    }
    expect((await listAgents(a.owner, a.projectId)).items.map((x) => x.name)).not.toContain('Denied');
  });

  it('answers 404 for another project and another org agent, never 403, and the list never shows them', async () => {
    for (const [key, method, url, payload] of [
      routes(agentP2.id, p2).filter((r) => r[0] !== 'update' && r[0] !== 'setDefault'),
      routes(agentP2.id, a.projectId).filter((r) => r[0] === 'update' || r[0] === 'setDefault'),
    ].flat()) {
      const res = await call(method, url, admin, payload);
      expect(res.statusCode, `admin on P1 ${key}`).toBe(404);
    }
    for (const [key, method, url, payload] of [routes(agentOther.id, b.projectId)].flat()) {
      const res = await call(method, url, a.owner, payload);
      expect(res.statusCode, `cross-org ${key}`).toBe(404);
    }
    const list = await listAgents(admin, a.projectId);
    expect(list.items.map((x) => x.id)).not.toContain(agentP2.id);
    expect(list.items.map((x) => x.id)).not.toContain(agentOther.id);
    // P2's agent is untouched
    const p2list = await listAgents(a.owner, p2);
    expect(p2list.items.find((x) => x.id === agentP2.id)?.name).toBe('P2 only');
  });

  it('refuses the credential route to a member and answers 404 to an admin on P1 for a P2 agent', async () => {
    expect((await putCred(own.id, { type: 'api_key', value: KEY }, member)).statusCode).toBe(403);
    expect((await putCred(agentP2.id, { type: 'api_key', value: KEY }, admin)).statusCode).toBe(404);
    expect((await putCred(agentOther.id, { type: 'api_key', value: KEY }, a.owner)).statusCode).toBe(404);
  });
});
