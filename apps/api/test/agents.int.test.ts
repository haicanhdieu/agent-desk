import { Writable } from 'node:stream';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { credentialSecretName } from '@agentdesk/core';
import { withOrg } from '@agentdesk/db';
import type { AgentDto, AgentModelsDto } from '@agentdesk/contracts';
import type { AgentHttpGet } from '@agentdesk/core';
import { createTestApp, type TestApp } from './helpers/app';
import { createOrg, inviteAndLogin } from './helpers/auth';
import { expectContract } from './helpers/contract';
import { freshStateDir, installFake, makeProject, wideFakeRepos } from './helpers/fixtures';
import { makeAgent } from './helpers/agents';

const SECRET = 'sk-ant-secret123456';
let t: TestApp;
let alice: string;
let bob: string;
let projectId: string;
const logged: string[] = [];
const httpCalls: { url: string; headers: Record<string, string> }[] = [];
let httpReply: () => Promise<{ status: number; json: unknown }> = () =>
  Promise.resolve({ status: 200, json: { data: [] } });
const agentHttp: AgentHttpGet = (url, headers) => {
  httpCalls.push({ url: url.toString(), headers });
  return httpReply();
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
  const aliceOrg = (await createOrg(t, 'Alice', 'alice')).id;
  const bobOrg = (await createOrg(t, 'Bob', 'bob')).id;
  alice = await inviteAndLogin(t, aliceOrg, 'alice', 'owner', { type: 'org' });
  bob = await inviteAndLogin(t, bobOrg, 'bob', 'owner', { type: 'org' });
  projectId = (await makeProject(t, alice, await installFake(t, alice))).projectId;
});
afterAll(async () => {
  await t.close();
});

const getAgent = (id = projectId, cookie = alice) =>
  t.app.inject({ method: 'GET', url: `/api/projects/${id}/agent`, headers: { cookie } });
const putAgent = (payload: unknown, id = projectId, cookie = alice) =>
  t.app.inject({ method: 'PUT', url: `/api/projects/${id}/agent`, headers: { cookie }, payload: payload as object });
const putCred = (agentId: string, payload: unknown, cookie = alice) =>
  t.app.inject({
    method: 'PUT',
    url: `/api/agents/${agentId}/credential`,
    headers: { cookie },
    payload: payload as object,
  });

describe('agents', () => {
  it('GET returns the default agent with no credential', async () => {
    const a = expectContract('agents.get', await getAgent()) as AgentDto;
    expect(a).toMatchObject({
      name: 'Claude',
      provider: 'claude',
      model: 'sonnet',
      baseUrl: null,
      maxTurns: 50,
      timeoutSeconds: 86400,
      idleEndSeconds: 1800,
      autoResumeMax: 5,
      credential: { set: false, type: null, updatedAt: null, setBy: null },
    });
  });

  it('PUT updates settings; omitted maxTurns becomes null', async () => {
    const res = await putAgent({ model: 'opus', timeoutSeconds: 604800 });
    const a = expectContract('agents.put', res) as AgentDto;
    expect(a).toMatchObject({ model: 'opus', maxTurns: null, timeoutSeconds: 604800 });
    const b = expectContract('agents.put', await putAgent({ model: 'sonnet', maxTurns: 10, timeoutSeconds: 60 }));
    expect(b).toMatchObject({ model: 'sonnet', maxTurns: 10, timeoutSeconds: 60 });
  });

  it('PUT saves the keep settings and omitting them keeps the stored values', async () => {
    const saved = expectContract(
      'agents.put',
      await putAgent({ model: 'sonnet', timeoutSeconds: 86400, pausedKeepSeconds: 86400, doneKeepSeconds: 0 }),
    );
    expect(saved).toMatchObject({ pausedKeepSeconds: 86400, doneKeepSeconds: 0 });
    const kept = expectContract('agents.put', await putAgent({ model: 'opus', timeoutSeconds: 86400 }));
    expect(kept).toMatchObject({ pausedKeepSeconds: 86400, doneKeepSeconds: 0 });
    expect(expectContract('agents.get', await getAgent())).toMatchObject({
      pausedKeepSeconds: 86400,
      doneKeepSeconds: 0,
    });
  });

  it('PUT saves the idle end, omitting it keeps the stored value, and GET returns it', async () => {
    const saved = expectContract(
      'agents.put',
      await putAgent({ model: 'sonnet', timeoutSeconds: 86400, idleEndSeconds: 900 }),
    );
    expect(saved).toMatchObject({ idleEndSeconds: 900 });
    const kept = expectContract('agents.put', await putAgent({ model: 'opus', timeoutSeconds: 86400 }));
    expect(kept).toMatchObject({ idleEndSeconds: 900 });
    expect(expectContract('agents.get', await getAgent())).toMatchObject({ idleEndSeconds: 900 });
  });

  it('PUT with an idle end under 5 minutes or over 7 days is a 400 with pointer /idleEndSeconds', async () => {
    for (const idleEndSeconds of [299, 604801]) {
      const res = await putAgent({ model: 'sonnet', timeoutSeconds: 86400, idleEndSeconds });
      expect(res.statusCode).toBe(400);
      const errors = (res.json() as { errors: { pointer: string; detail: string }[] }).errors;
      expect(errors.map((e) => e.pointer)).toContain('/idleEndSeconds');
      expect(errors.map((e) => e.detail).join(' ')).toMatch(/5 minutes and 7 days/);
    }
  });

  it('PUT saves autoResumeMax, omitting it keeps the stored value, and GET returns it', async () => {
    const saved = expectContract(
      'agents.put',
      await putAgent({ model: 'sonnet', timeoutSeconds: 86400, autoResumeMax: 2 }),
    );
    expect(saved).toMatchObject({ autoResumeMax: 2 });
    const kept = expectContract('agents.put', await putAgent({ model: 'opus', timeoutSeconds: 86400 }));
    expect(kept).toMatchObject({ autoResumeMax: 2 });
    expect(expectContract('agents.get', await getAgent())).toMatchObject({ autoResumeMax: 2 });
  });

  it('PUT with autoResumeMax under 0 or over 10 is a 400 with pointer /autoResumeMax', async () => {
    for (const autoResumeMax of [-1, 11]) {
      const res = await putAgent({ model: 'sonnet', timeoutSeconds: 86400, autoResumeMax });
      expect(res.statusCode).toBe(400);
      const errors = (res.json() as { errors: { pointer: string; detail: string }[] }).errors;
      expect(errors.map((e) => e.pointer)).toContain('/autoResumeMax');
    }
  });

  it('PUT accepts a limit over the old 3300 s cap, up to 7 days', async () => {
    const res = await putAgent({ model: 'sonnet', timeoutSeconds: 4000 });
    expect(res.statusCode).toBe(200);
    expect(expectContract('agents.put', res)).toMatchObject({ timeoutSeconds: 4000 });
  });

  it('PUT with timeoutSeconds above 7 days is a 400 with pointer /timeoutSeconds and a message naming the limit', async () => {
    const res = await putAgent({ model: 'sonnet', timeoutSeconds: 604801 });
    expect(res.statusCode).toBe(400);
    const errors = (res.json() as { errors: { pointer: string; detail: string }[] }).errors;
    expect(errors.map((e) => e.pointer)).toContain('/timeoutSeconds');
    expect(errors.map((e) => e.detail).join(' ')).toMatch(/7 days/);
    expect((await putAgent({ model: 'sonnet', timeoutSeconds: 59 })).statusCode).toBe(400);
  });

  it('is 404 across orgs', async () => {
    expect((await getAgent(projectId, bob)).statusCode).toBe(404);
    expect((await putAgent({ model: 'x', timeoutSeconds: 100 }, projectId, bob)).statusCode).toBe(404);
  });
});

describe('credential', () => {
  it('stores the value only in the SecretStore and never leaks it', async () => {
    const agent = (await getAgent().then((r) => r.json())) as AgentDto;
    logged.length = 0;
    const out: string[] = [];
    const spies = [
      vi.spyOn(process.stdout, 'write').mockImplementation((c: string | Uint8Array) => (out.push(String(c)), true)),
      vi.spyOn(process.stderr, 'write').mockImplementation((c: string | Uint8Array) => (out.push(String(c)), true)),
    ];
    let res;
    try {
      res = await putCred(agent.id, { type: 'api_key', value: SECRET });
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['updatedAt']);
    expectContract('agents.putCredential', res);

    const orgId = (
      (await t.db.pool.query("select id from organization where slug = 'alice'")).rows[0] as { id: string }
    ).id;
    const name = credentialSecretName(orgId, agent.id);
    expect(await t.secrets.get(name)).toEqual({ type: 'api_key', value: SECRET });

    const got = await getAgent();
    expect(got.body).not.toContain(SECRET);
    const dto = expectContract('agents.get', got) as AgentDto;
    expect(dto.credential).toMatchObject({ set: true, type: 'api_key', updatedAt: body['updatedAt'] });
    expect(dto.credential.setBy).toEqual(expect.any(String));
    expect(Object.keys(dto.credential).sort()).toEqual(['set', 'setBy', 'type', 'updatedAt']);

    // Postgres: only type/updated_at/set_by (+ secret *name*), never the value.
    const dump = await withOrg(t.db, orgId, async (tx) => {
      const a = await tx.execute(sql`select * from agents`);
      const l = await tx.execute(sql`select * from audit_log`);
      const e = await tx.execute(sql`select * from run_events`);
      return JSON.stringify([a.rows, l.rows, e.rows]);
    });
    expect(dump).not.toContain(SECRET);
    expect(dump).toContain('PUT agents.putCredential');

    expect(logged.join('')).not.toContain(SECRET);
    expect(out.join('')).not.toContain(SECRET);
  });

  it('replaces the previous value', async () => {
    const agent = (await getAgent().then((r) => r.json())) as AgentDto;
    expect((await putCred(agent.id, { type: 'oauth_token', value: 'tok-2' })).statusCode).toBe(200);
    const orgId = (
      (await t.db.pool.query("select id from organization where slug = 'alice'")).rows[0] as { id: string }
    ).id;
    expect(await t.secrets.get(credentialSecretName(orgId, agent.id))).toEqual({ type: 'oauth_token', value: 'tok-2' });
    expect(((await getAgent().then((r) => r.json())) as AgentDto).credential.type).toBe('oauth_token');
  });

  it('a bad type is 400 and does not echo the value', async () => {
    const agent = (await getAgent().then((r) => r.json())) as AgentDto;
    const res = await putCred(agent.id, { type: 'nope', value: SECRET });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain(SECRET);
    expect(logged.join('')).not.toContain(SECRET);
    const res2 = await putCred(agent.id, { type: 'api_key', value: 12345 });
    expect(res2.statusCode).toBe(400);
  });

  it('is 404 for another org agent and writes nothing', async () => {
    const agent = (await getAgent().then((r) => r.json())) as AgentDto;
    const before = t.secrets.names().length;
    const res = await putCred(agent.id, { type: 'api_key', value: SECRET }, bob);
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain(SECRET);
    expect(t.secrets.names()).toHaveLength(before);
  });

  it('a store failure is a generic 500 without the value', async () => {
    const agent = (await getAgent().then((r) => r.json())) as AgentDto;
    const spy = vi.spyOn(t.secrets, 'put').mockRejectedValueOnce(new Error(`boom ${SECRET}`));
    const res = await putCred(agent.id, { type: 'api_key', value: SECRET });
    spy.mockRestore();
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain(SECRET);
    expect(logged.join('')).not.toContain(SECRET);
  });
});

const models = (agentId: string, cookie = alice) =>
  t.app.inject({ method: 'GET', url: `/api/agents/${agentId}/models`, headers: { cookie } });
const BUILTIN = [
  { id: 'opus', label: 'opus' },
  { id: 'sonnet', label: 'sonnet' },
  { id: 'haiku', label: 'haiku' },
];
const orgIdOf = async (slug: string) =>
  ((await t.db.pool.query('select id from organization where slug = $1', [slug])).rows[0] as { id: string }).id;
const agentOf = async () => (await getAgent().then((r) => r.json())) as AgentDto;

describe('models', () => {
  it('models: live list in provider order', async () => {
    const agent = await agentOf();
    expect((await putCred(agent.id, { type: 'api_key', value: SECRET, baseUrl: null })).statusCode).toBe(200);
    httpCalls.length = 0;
    httpReply = () =>
      Promise.resolve({
        status: 200,
        json: { data: [{ id: 'claude-z-1', display_name: 'Z one' }, { id: 'claude-a-2' }], has_more: false },
      });
    const dto = expectContract('agents.models', await models(agent.id)) as AgentModelsDto;
    expect(dto).toEqual({
      source: 'live',
      reason: null,
      models: [
        { id: 'claude-z-1', label: 'Z one' },
        { id: 'claude-a-2', label: 'claude-a-2' },
      ],
    });
    expect(httpCalls[0]?.headers['x-api-key']).toBe(SECRET);
  });

  it('models: no_credential before a credential is saved', async () => {
    const agent = await agentOf();
    const orgId = await orgIdOf('alice');
    await t.secrets.delete(credentialSecretName(orgId, agent.id));
    await withOrg(t.db, orgId, (tx) =>
      tx.execute(
        sql`update agents set credential_secret_name = null, credential_type = null, credential_updated_at = null, credential_set_by = null`,
      ),
    );
    httpCalls.length = 0;
    const dto = expectContract('agents.models', await models(agent.id)) as AgentModelsDto;
    expect(dto).toEqual({ source: 'builtin', reason: 'no_credential', models: BUILTIN });
    expect(httpCalls).toHaveLength(0);
  });

  it('models: rejected, unreachable and empty fall back to opus, sonnet, haiku and are never a 5xx', async () => {
    const agent = await agentOf();
    expect((await putCred(agent.id, { type: 'api_key', value: SECRET })).statusCode).toBe(200);
    const cases: [() => Promise<{ status: number; json: unknown }>, string][] = [
      [() => Promise.resolve({ status: 401, json: { error: `invalid x-api-key ${SECRET}` } }), 'rejected'],
      [() => Promise.resolve({ status: 403, json: { error: 'upstream-text-403' } }), 'rejected'],
      [() => Promise.reject(new Error(`connect failed ${SECRET}`)), 'unreachable'],
      [() => Promise.resolve({ status: 404, json: { error: 'upstream-text-404' } }), 'unreachable'],
      [() => Promise.resolve({ status: 200, json: { nope: true } }), 'unreachable'],
      [() => Promise.resolve({ status: 200, json: { data: [] } }), 'empty'],
    ];
    for (const [reply, reason] of cases) {
      httpReply = reply;
      logged.length = 0;
      const res = await models(agent.id);
      expect(res.statusCode).toBe(200);
      expect(expectContract('agents.models', res)).toEqual({ source: 'builtin', reason, models: BUILTIN });
      for (const text of [SECRET, 'upstream-text-403', 'upstream-text-404']) {
        expect(res.body).not.toContain(text);
        expect(logged.join('')).not.toContain(text);
      }
    }
  });

  it('models: a secret store read failure is a generic 500 without the value', async () => {
    const agent = await agentOf();
    const spy = vi.spyOn(t.secrets, 'get').mockRejectedValueOnce(new Error(`boom ${SECRET}`));
    const res = await models(agent.id);
    spy.mockRestore();
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain(SECRET);
    expect(logged.join('')).not.toContain(SECRET);
  });

  it('models: metadata says set but the Secret is missing or unusable is no_credential without an upstream call', async () => {
    const agent = await agentOf();
    const name = credentialSecretName(await orgIdOf('alice'), agent.id);
    expect((await putCred(agent.id, { type: 'api_key', value: SECRET, baseUrl: null })).statusCode).toBe(200);
    const stored: (Record<string, string> | null)[] = [
      null,
      { type: 'bogus', value: '' },
      { type: 'api_key', value: '' },
    ];
    for (const value of stored) {
      const spy = vi.spyOn(t.secrets, 'get').mockResolvedValueOnce(value);
      httpCalls.length = 0;
      const dto = expectContract('agents.models', await models(agent.id)) as AgentModelsDto;
      spy.mockRestore();
      expect(dto).toEqual({ source: 'builtin', reason: 'no_credential', models: BUILTIN });
      expect(httpCalls).toHaveLength(0);
    }
    expect(await t.secrets.get(name)).not.toBeNull();
  });

  it('models: another org agent is 404 and nothing is fetched', async () => {
    const agent = await agentOf();
    httpCalls.length = 0;
    expect((await models(agent.id, bob)).statusCode).toBe(404);
    expect(httpCalls).toHaveLength(0);
  });

  it('models: an unauthenticated caller is 401', async () => {
    const agent = await agentOf();
    const res = await t.app.inject({ method: 'GET', url: `/api/agents/${agent.id}/models` });
    expect(res.statusCode).toBe(401);
  });

  it('models: sends the saved credential only to the saved address', async () => {
    const agent = await agentOf();
    expect(
      (await putCred(agent.id, { type: 'api_key', value: 'sk-gw-1', baseUrl: 'https://gw.example.com/anthropic/' }))
        .statusCode,
    ).toBe(200);
    httpReply = () => Promise.resolve({ status: 200, json: { data: [{ id: 'gw-model' }] } });
    httpCalls.length = 0;
    const dto = expectContract('agents.models', await models(agent.id)) as AgentModelsDto;
    expect(dto.models).toEqual([{ id: 'gw-model', label: 'gw-model' }]);
    expect(httpCalls).toHaveLength(1);
    const url = new URL(httpCalls[0]?.url ?? '');
    expect(url.host).toBe('gw.example.com');
    expect(url.pathname).toBe('/anthropic/v1/models');
    expect(httpCalls[0]?.headers['x-api-key']).toBe('sk-gw-1');
    await putCred(agent.id, { type: 'api_key', value: SECRET, baseUrl: null });
  });

  it('models: builtin with reason disabled when the source is builtin, without reading the credential', async () => {
    const off = await createTestApp({
      env: { FAKE_STATE_DIR: freshStateDir(), AGENT_MODELS_SOURCE: 'builtin' },
      wrapAdapters: wideFakeRepos,
      agentHttp: () => Promise.reject(new Error('must not be called')),
    });
    try {
      const carolOrg = (await createOrg(off, 'Carol', 'carol')).id;
      const cookie = await inviteAndLogin(off, carolOrg, 'carol', 'owner', { type: 'org' });
      const pid = (await makeProject(off, cookie, await installFake(off, cookie))).projectId;
      const agent = (await off.app
        .inject({ method: 'GET', url: `/api/projects/${pid}/agent`, headers: { cookie } })
        .then((r) => r.json())) as AgentDto;
      const getSpy = vi.spyOn(off.secrets, 'get');
      const res = await off.app.inject({ method: 'GET', url: `/api/agents/${agent.id}/models`, headers: { cookie } });
      expect(res.statusCode).toBe(200);
      expect(expectContract('agents.models', res)).toEqual({ source: 'builtin', reason: 'disabled', models: BUILTIN });
      expect(getSpy).not.toHaveBeenCalled();
    } finally {
      await off.close();
    }
  });
});

describe('credential with an address', () => {
  it('putCredential with baseUrl saves the address and the new credential together', async () => {
    const agent = await agentOf();
    const res = await putCred(agent.id, { type: 'api_key', value: 'sk-new', baseUrl: 'https://gw.example.com' });
    expect(res.statusCode).toBe(200);
    const dto = expectContract('agents.get', await getAgent()) as AgentDto;
    expect(dto.baseUrl).toBe('https://gw.example.com');
    expect(dto.credential).toMatchObject({ set: true, type: 'api_key' });
    expect(await t.secrets.get(credentialSecretName(await orgIdOf('alice'), agent.id))).toEqual({
      type: 'api_key',
      value: 'sk-new',
      baseUrl: 'https://gw.example.com',
    });
  });

  it('putCredential without baseUrl keeps the address', async () => {
    const agent = await agentOf();
    expect(agent.baseUrl).toBe('https://gw.example.com');
    expect((await putCred(agent.id, { type: 'oauth_token', value: 'tok-9' })).statusCode).toBe(200);
    expect(((await agentOf()) as AgentDto).baseUrl).toBe('https://gw.example.com');
  });

  it('PUT agent has no way to change the address', async () => {
    const res = await putAgent({ model: 'sonnet', timeoutSeconds: 86400, baseUrl: 'https://evil.example.com' });
    expect(res.statusCode).toBe(200);
    expect(((await agentOf()) as AgentDto).baseUrl).toBe('https://gw.example.com');
  });

  it('PUT agent with an invalid model is 400 on /model', async () => {
    const res = await putAgent({ model: 'bad model!', timeoutSeconds: 86400 });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('/model');
  });

  it('putCredential with an invalid baseUrl is 400 on /baseUrl and changes nothing', async () => {
    const agent = await agentOf();
    const before = await t.secrets.get(credentialSecretName(await orgIdOf('alice'), agent.id));
    for (const baseUrl of ['http://gw.example.com', 'https://127.0.0.1', 'https://localhost']) {
      const res = await putCred(agent.id, { type: 'api_key', value: SECRET, baseUrl });
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('/baseUrl');
      expect(res.body).not.toContain(SECRET);
    }
    expect(((await agentOf()) as AgentDto).baseUrl).toBe('https://gw.example.com');
    expect(await t.secrets.get(credentialSecretName(await orgIdOf('alice'), agent.id))).toEqual(before);
  });

  it('a failed Secret write during an address change leaves the new address with no credential', async () => {
    const agent = await agentOf();
    const name = credentialSecretName(await orgIdOf('alice'), agent.id);
    expect((await putCred(agent.id, { type: 'api_key', value: 'sk-old', baseUrl: null })).statusCode).toBe(200);
    const spy = vi.spyOn(t.secrets, 'put').mockRejectedValueOnce(new Error(`boom ${SECRET}`));
    logged.length = 0;
    const res = await putCred(agent.id, { type: 'api_key', value: SECRET, baseUrl: 'https://gw2.example.com' });
    spy.mockRestore();
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain(SECRET);
    expect(res.body).not.toContain('gw2.example.com');
    expect(logged.join('')).not.toContain(SECRET);
    const dto = expectContract('agents.get', await getAgent()) as AgentDto;
    expect(dto.baseUrl).toBe('https://gw2.example.com');
    expect(dto.credential).toEqual({ set: false, type: null, updatedAt: null, setBy: null });
    expect(await t.secrets.get(name)).toBeNull();
    // TC-16.3: a plain save afterwards makes the credential set and usable at the new address.
    httpReply = () => Promise.resolve({ status: 200, json: { data: [{ id: 'm-new' }] } });
    expect((await putCred(agent.id, { type: 'api_key', value: 'sk-after' })).statusCode).toBe(200);
    const after = expectContract('agents.get', await getAgent()) as AgentDto;
    expect(after).toMatchObject({ baseUrl: 'https://gw2.example.com', credential: { set: true, type: 'api_key' } });
    expect(await t.secrets.get(name)).toEqual({
      type: 'api_key',
      value: 'sk-after',
      baseUrl: 'https://gw2.example.com',
    });
    httpCalls.length = 0;
    expect(((await models(agent.id).then((r) => r.json())) as AgentModelsDto).source).toBe('live');
    expect(new URL(httpCalls[0]?.url ?? '').host).toBe('gw2.example.com');
    await putCred(agent.id, { type: 'api_key', value: SECRET, baseUrl: null });
  });

  it('a failed Secret delete during an address change leaves the new address, not set, and the old Secret unusable', async () => {
    const agent = await agentOf();
    const name = credentialSecretName(await orgIdOf('alice'), agent.id);
    expect((await putCred(agent.id, { type: 'api_key', value: 'sk-old', baseUrl: null })).statusCode).toBe(200);
    const spy = vi.spyOn(t.secrets, 'delete').mockRejectedValueOnce(new Error(`boom ${SECRET}`));
    logged.length = 0;
    const res = await putCred(agent.id, { type: 'api_key', value: SECRET, baseUrl: 'https://gw3.example.com' });
    spy.mockRestore();
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain(SECRET);
    expect(res.body).not.toContain('gw3.example.com');
    expect(logged.join('')).not.toContain(SECRET);
    const dto = expectContract('agents.get', await getAgent()) as AgentDto;
    expect(dto.baseUrl).toBe('https://gw3.example.com');
    expect(dto.credential.set).toBe(false);
    // The old Secret is still there but belongs to the old address: it is no credential.
    expect(await t.secrets.get(name)).toEqual({ type: 'api_key', value: 'sk-old' });
    httpCalls.length = 0;
    expect(expectContract('agents.models', await models(agent.id))).toEqual({
      source: 'builtin',
      reason: 'no_credential',
      models: BUILTIN,
    });
    expect(httpCalls).toHaveLength(0);
    await putCred(agent.id, { type: 'api_key', value: SECRET, baseUrl: null });
  });

  it('the Secret carries the address it was saved for, and a legacy Secret works only with the default address', async () => {
    const agent = await agentOf();
    const name = credentialSecretName(await orgIdOf('alice'), agent.id);
    httpReply = () => Promise.resolve({ status: 200, json: { data: [{ id: 'm-1' }] } });
    // Default address: a legacy Secret (no address) is usable.
    expect((await putCred(agent.id, { type: 'api_key', value: 'sk-legacy', baseUrl: null })).statusCode).toBe(200);
    await t.secrets.put(name, { type: 'api_key', value: 'sk-legacy' });
    httpCalls.length = 0;
    expect(((await models(agent.id).then((r) => r.json())) as AgentModelsDto).source).toBe('live');
    expect(httpCalls).toHaveLength(1);
    // Custom address: the Secret holds it; a legacy Secret is not usable with it.
    expect(
      (await putCred(agent.id, { type: 'api_key', value: 'sk-gw', baseUrl: 'https://gw.example.com' })).statusCode,
    ).toBe(200);
    expect(await t.secrets.get(name)).toEqual({ type: 'api_key', value: 'sk-gw', baseUrl: 'https://gw.example.com' });
    expect(((await models(agent.id).then((r) => r.json())) as AgentModelsDto).source).toBe('live');
    await t.secrets.put(name, { type: 'api_key', value: 'sk-legacy' });
    httpCalls.length = 0;
    const dto = expectContract('agents.models', await models(agent.id)) as AgentModelsDto;
    expect(dto).toEqual({ source: 'builtin', reason: 'no_credential', models: BUILTIN });
    expect(httpCalls).toHaveLength(0);
    // Re-saving with the same address (keeping it) stores the address with the new credential.
    expect((await putCred(agent.id, { type: 'api_key', value: 'sk-kept' })).statusCode).toBe(200);
    expect(await t.secrets.get(name)).toEqual({ type: 'api_key', value: 'sk-kept', baseUrl: 'https://gw.example.com' });
    expect(((await agentOf()) as AgentDto).baseUrl).toBe('https://gw.example.com');
    await putCred(agent.id, { type: 'api_key', value: SECRET, baseUrl: null });
  });

  it('models: a Secret saved for another address is no_credential and is never sent', async () => {
    const agent = await agentOf();
    const name = credentialSecretName(await orgIdOf('alice'), agent.id);
    expect((await putCred(agent.id, { type: 'api_key', value: SECRET, baseUrl: null })).statusCode).toBe(200);
    await t.secrets.put(name, { type: 'api_key', value: 'sk-elsewhere', baseUrl: 'https://old.example.com' });
    httpCalls.length = 0;
    const res = await models(agent.id);
    expect(expectContract('agents.models', res)).toEqual({
      source: 'builtin',
      reason: 'no_credential',
      models: BUILTIN,
    });
    expect(res.body).not.toContain('sk-elsewhere');
    expect(httpCalls).toHaveLength(0);
    await putCred(agent.id, { type: 'api_key', value: SECRET, baseUrl: null });
  });

  it('overlapping saves never leave a usable mispaired credential', async () => {
    const agent = await agentOf();
    const name = credentialSecretName(await orgIdOf('alice'), agent.id);
    const realPut = t.secrets.put.bind(t.secrets);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let aAtWrite: () => void = () => undefined;
    const aReachedWrite = new Promise<void>((resolve) => (aAtWrite = resolve));
    let first = true;
    // A stalls just before its Secret write; B saves completely in between, then A's write lands over B's.
    const spy = vi.spyOn(t.secrets, 'put').mockImplementation(async (n, data) => {
      if (first) {
        first = false;
        aAtWrite();
        await gate;
      }
      await realPut(n, data);
    });
    try {
      const a = putCred(agent.id, { type: 'api_key', value: 'cred-a', baseUrl: 'https://a.example.com' });
      await aReachedWrite;
      expect(
        (await putCred(agent.id, { type: 'api_key', value: 'cred-b', baseUrl: 'https://b.example.com' })).statusCode,
      ).toBe(200);
      release();
      expect((await a).statusCode).toBe(200);
    } finally {
      spy.mockRestore();
    }
    // The database says B's address, the Secret holds A's credential for A's address: that must read as no credential.
    expect(((await agentOf()) as AgentDto).baseUrl).toBe('https://b.example.com');
    expect(await t.secrets.get(name)).toEqual({ type: 'api_key', value: 'cred-a', baseUrl: 'https://a.example.com' });
    httpCalls.length = 0;
    const dto = expectContract('agents.models', await models(agent.id)) as AgentModelsDto;
    expect(dto).toEqual({ source: 'builtin', reason: 'no_credential', models: BUILTIN });
    expect(httpCalls).toHaveLength(0);
    // Saving again recovers.
    expect((await putCred(agent.id, { type: 'api_key', value: SECRET, baseUrl: null })).statusCode).toBe(200);
  });

  it('a database failure after the Secret write leaves the credential not set', async () => {
    const agent = await agentOf();
    const name = credentialSecretName(await orgIdOf('alice'), agent.id);
    expect((await putCred(agent.id, { type: 'api_key', value: SECRET, baseUrl: null })).statusCode).toBe(200);
    const owner = new pg.Pool({ connectionString: t.pg.ownerUrl, max: 1 });
    // Fails the final metadata write only (the first write of an address change leaves the metadata null).
    await owner.query(
      `create function fail_agent_update_test() returns trigger language plpgsql as $$ begin
         if new.base_url = 'https://dbfail.example.com' and new.credential_updated_at is not null then
           raise exception 'forced failure'; end if; return new; end $$`,
    );
    await owner.query(
      'create trigger fail_agent_update_test before update on agents for each row execute function fail_agent_update_test()',
    );
    try {
      logged.length = 0;
      const res = await putCred(agent.id, {
        type: 'api_key',
        value: 'cred-new',
        baseUrl: 'https://dbfail.example.com',
      });
      expect(res.statusCode).toBe(500);
      for (const text of ['cred-new', 'dbfail.example.com', 'forced failure']) expect(res.body).not.toContain(text);
      expect(logged.join('')).not.toContain('cred-new');
    } finally {
      await owner.query('drop trigger fail_agent_update_test on agents');
      await owner.query('drop function fail_agent_update_test()');
      await owner.end();
    }
    const dto = (await agentOf()) as AgentDto;
    expect(dto.baseUrl).toBe('https://dbfail.example.com');
    expect(dto.credential.set).toBe(false);
    expect(await t.secrets.get(name)).toEqual({
      type: 'api_key',
      value: 'cred-new',
      baseUrl: 'https://dbfail.example.com',
    });
    httpCalls.length = 0;
    expect(expectContract('agents.models', await models(agent.id))).toEqual({
      source: 'builtin',
      reason: 'no_credential',
      models: BUILTIN,
    });
    expect(httpCalls).toHaveLength(0);
    expect((await putCred(agent.id, { type: 'api_key', value: SECRET, baseUrl: null })).statusCode).toBe(200);
  });

  it('a slow Secret store holds no transaction or lock: other writes and reads go through', async () => {
    const agent = await agentOf();
    const realPut = t.secrets.put.bind(t.secrets);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let entered: () => void = () => undefined;
    const inPut = new Promise<void>((resolve) => (entered = resolve));
    const spy = vi.spyOn(t.secrets, 'put').mockImplementation(async (n, data) => {
      entered();
      await gate;
      return realPut(n, data);
    });
    const owner = new pg.Pool({ connectionString: t.pg.ownerUrl, max: 1 });
    try {
      const slow = putCred(agent.id, { type: 'api_key', value: SECRET, baseUrl: 'https://slow.example.com' });
      await inPut;
      // Same agent row: a lock held across the Secret call would block this write.
      const write = await Promise.race([
        putAgent({ model: 'sonnet', timeoutSeconds: 86400 }),
        new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 3000)),
      ]);
      expect(write).not.toBe('blocked');
      expect((write as { statusCode: number }).statusCode).toBe(200);
      expect((await getAgent()).statusCode).toBe(200);
      const open = await owner.query(
        "select count(*)::int as n from pg_stat_activity where datname = current_database() and state like 'idle in transaction%'",
      );
      expect((open.rows[0] as { n: number }).n).toBe(0);
      release();
      expect((await slow).statusCode).toBe(200);
    } finally {
      release();
      spy.mockRestore();
      await owner.end();
    }
    await putCred(agent.id, { type: 'api_key', value: SECRET, baseUrl: null });
  });

  it('putCredential with baseUrl null clears the address', async () => {
    const agent = await agentOf();
    expect((await putCred(agent.id, { type: 'api_key', value: SECRET, baseUrl: null })).statusCode).toBe(200);
    const dto = expectContract('agents.get', await getAgent()) as AgentDto;
    expect(dto.baseUrl).toBeNull();
    expect(dto.credential.set).toBe(true);
  });

  it('putCredential with baseUrl for another org agent is 404 and changes nothing', async () => {
    const agent = await agentOf();
    const res = await putCred(agent.id, { type: 'api_key', value: SECRET, baseUrl: 'https://gw.example.com' }, bob);
    expect(res.statusCode).toBe(404);
    expect(((await agentOf()) as AgentDto).baseUrl).toBeNull();
  });
});

describe('agents: permission (BR-17, BR-33, BR-29)', () => {
  it('TC-17.1, TC-33.2: a member cannot put the agent or its credential; nothing is stored or leaked', async () => {
    const orgId = await orgIdOf('alice');
    const member = await inviteAndLogin(t, orgId, 'agent-member', 'member', { type: 'org' });
    const agent = await agentOf();
    const namesBefore = t.secrets.names();

    const cred = await putCred(agent.id, { type: 'api_key', value: SECRET }, member);
    expect(cred.statusCode).toBe(403);
    expect(cred.body).not.toContain(SECRET);
    expect(t.secrets.names()).toEqual(namesBefore);

    const put = await putAgent({ model: 'haiku', maxTurns: 3, timeoutSeconds: 120 }, projectId, member);
    expect(put.statusCode).toBe(403);
    expect(await agentOf()).toEqual(agent);
    expect(logged.join('')).not.toContain(SECRET);
  });

  it('TC-29.1: an admin on P1 can put the agent and its credential', async () => {
    const orgId = await orgIdOf('alice');
    const admin = await inviteAndLogin(t, orgId, 'agent-admin', 'admin', { type: 'project', projectIds: [projectId] });
    const agent = await agentOf();

    const put = await putAgent({ model: 'opus', timeoutSeconds: 3600 }, projectId, admin);
    expect(expectContract('agents.put', put)).toMatchObject({ model: 'opus', timeoutSeconds: 3600 });
    const cred = await putCred(agent.id, { type: 'api_key', value: 'sk-ant-admin-value-1' }, admin);
    expect(cred.statusCode).toBe(200);
    expectContract('agents.putCredential', cred);
    expect(await t.secrets.get(credentialSecretName(orgId, agent.id))).toEqual({
      type: 'api_key',
      value: 'sk-ant-admin-value-1',
    });
  });
});

describe('compat GET after a second agent exists', () => {
  it('GET /agent returns the default agent when the project has two agents, whatever their creation order (BR-50)', async () => {
    const first = await agentOf();
    const second = await makeAgent(t, alice, projectId, { name: 'Created later' });
    expect(second.isDefault).toBe(false);
    // The default is the newer row: the compat route must not return "the first agent it finds".
    await withOrg(t.db, await orgIdOf('alice'), async (tx) => {
      await tx.execute(sql`update agents set is_default = false where project_id = ${projectId}`);
      await tx.execute(sql`update agents set is_default = true where id = ${second.id}`);
    });
    const got = expectContract('agents.get', await getAgent()) as AgentDto;
    expect(got.id).toBe(second.id);
    await withOrg(t.db, await orgIdOf('alice'), async (tx) => {
      await tx.execute(sql`update agents set is_default = false where project_id = ${projectId}`);
      await tx.execute(sql`update agents set is_default = true where id = ${first.id}`);
    });
    expect(((await getAgent().then((r) => r.json())) as AgentDto).id).toBe(first.id);
  });
});
