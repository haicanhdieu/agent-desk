import { Writable } from 'node:stream';
import { sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GuardedHttpError, credentialSecretName, type AgentHttpGet } from '@agentdesk/core';
import { withOrg } from '@agentdesk/db';
import type { AgentDto, Page } from '@agentdesk/contracts';
import { createTestApp, type TestApp } from './helpers/app';
import { createOrg, inviteAndLogin } from './helpers/auth';
import { expectContract } from './helpers/contract';
import { makeAgent } from './helpers/agents';
import { freshStateDir, installFake, makeProject, wideFakeRepos } from './helpers/fixtures';

const KEY = 'sk-open-secret-0001';
const ENDPOINT = 'https://llm.example.com/v1';
let t: TestApp;
let orgId: string;
let owner: string;
let projectId: string;
const logged: string[] = [];
const calls: { url: string; headers: Record<string, string> }[] = [];
const defaultHttp: AgentHttpGet = () => Promise.resolve({ status: 200, json: { data: [{ id: 'unused' }] } });
let httpImpl: AgentHttpGet = defaultHttp;
const agentHttp: AgentHttpGet = (url, headers, opts) => {
  calls.push({ url: url.toString(), headers });
  return httpImpl(url, headers, opts);
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
  orgId = (await createOrg(t, 'Open Org', 'open-org')).id;
  owner = await inviteAndLogin(t, orgId, 'open-owner', 'owner', { type: 'org' });
  projectId = (await makeProject(t, owner, await installFake(t, owner))).projectId;
});
afterAll(async () => {
  await t.close();
});

const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  t.app.inject({ method, url, headers: { cookie: owner }, ...(payload === undefined ? {} : { payload }) });
const putCred = (agentId: string, payload: object) => call('PUT', `/api/agents/${agentId}/credential`, payload);
const pointersOf = (res: { json: () => unknown }): string[] =>
  ((res.json() as { errors?: { pointer: string }[] }).errors ?? []).map((e) => e.pointer);
const one = async (id: string): Promise<AgentDto> => {
  const page = expectContract(
    'agents.list',
    await call('GET', `/api/projects/${projectId}/agents?pageSize=100`),
  ) as Page<AgentDto>;
  const found = page.items.find((a) => a.id === id);
  if (!found) throw new Error('agent not listed');
  return found;
};
const rowOf = async (id: string) =>
  (
    await withOrg(
      t.db,
      orgId,
      async (tx) => (await tx.execute(sql`select base_url, credential_type from agents where id = ${id}`)).rows,
    )
  )[0] as {
    base_url: string | null;
    credential_type: string | null;
  };

let seq = 0;
const newOpencode = (over: object = {}) =>
  makeAgent(t, owner, projectId, { provider: 'opencode', name: `OC ${(seq += 1)}`, ...over });

describe('opencode model (BR-5, BR-10, BR-16)', () => {
  it('create with no model is 201 with an empty model and a ready row; claude and codex with an empty model are refused', async () => {
    const a = await newOpencode();
    expect(a).toMatchObject({ provider: 'opencode', model: '', credential: { set: false } });
    for (const provider of ['claude', 'codex']) {
      const res = await call('POST', `/api/projects/${projectId}/agents`, {
        provider,
        name: `empty-${provider}`,
        model: '',
      });
      expect([400, 422]).toContain(res.statusCode);
      expect(pointersOf(res)).toContain('/model');
    }
  });

  it.each(['gpt-4.1', 'anthropic/claude-sonnet-4-5', 'a/b/c'])('accepts the model %s as typed', async (model) => {
    expect((await newOpencode({ model })).model).toBe(model);
  });

  it.each(['has space', 'ctrl\u0001char', 'x'.repeat(201)])('refuses a hostile model on /model', async (model) => {
    const res = await call('POST', `/api/projects/${projectId}/agents`, {
      provider: 'opencode',
      name: 'hostile',
      model,
    });
    expect(res.statusCode).toBe(400);
    expect(pointersOf(res)).toContain('/model');
  });
});

describe('opencode credentials file (BR-14, BR-15, BR-68)', () => {
  it('stores a JSON object as one Secret with the exact text and leaks no part of it', async () => {
    const a = await newOpencode();
    const text = JSON.stringify({
      anthropic: { type: 'oauth', access: 'tok-ünï-\n-end', nested: { deep: 'canary-deep-77' } },
    });
    logged.length = 0;
    const res = await putCred(a.id, { type: 'auth_json', value: text });
    expect(res.statusCode).toBe(200);
    expect(await t.secrets.get(credentialSecretName(orgId, a.id))).toEqual({ type: 'auth_json', value: text });
    const audit = JSON.stringify(
      await withOrg(t.db, orgId, async (tx) => (await tx.execute(sql`select * from audit_log`)).rows),
    );
    const shown = JSON.stringify((await call('GET', `/api/projects/${projectId}/agents?pageSize=100`)).json());
    for (const part of ['canary-deep-77', 'tok-ünï']) {
      for (const where of [res.body, shown, audit, logged.join('')]) expect(where).not.toContain(part);
    }
    expect(await one(a.id)).toMatchObject({ credential: { set: true, type: 'auth_json' }, baseUrl: null });
  });

  it('refuses the seven bad values with 422 on /value and stores nothing', async () => {
    const a = await newOpencode();
    const before = t.secrets.names().length;
    const bad = ['[1,2]', '"text"', '12', 'null', '{not json', ' ', JSON.stringify({ pad: 'x'.repeat(65536) })];
    for (const value of bad) {
      const res = await putCred(a.id, { type: 'auth_json', value });
      expect(res.statusCode, value.slice(0, 20)).toBe(422);
      expect(pointersOf(res)).toContain('/value');
    }
    // the empty string never reaches the service: the contract refuses it
    const empty = await putCred(a.id, { type: 'auth_json', value: '' });
    expect(empty.statusCode).toBe(400);
    expect(t.secrets.names()).toHaveLength(before);
    expect((await one(a.id)).credential.set).toBe(false);
  });

  it('accepts exactly 65536 bytes and refuses 65537', async () => {
    const a = await newOpencode();
    const wrap = (n: number) => {
      const base = JSON.stringify({ k: '' });
      return JSON.stringify({ k: 'x'.repeat(n - Buffer.byteLength(base)) });
    };
    const ok = wrap(65536);
    expect(Buffer.byteLength(ok)).toBe(65536);
    expect((await putCred(a.id, { type: 'auth_json', value: ok })).statusCode).toBe(200);
    const big = wrap(65537);
    expect(Buffer.byteLength(big)).toBe(65537);
    const res = await putCred(a.id, { type: 'auth_json', value: big });
    expect(res.statusCode).toBe(422);
    expect(pointersOf(res)).toContain('/value');
  });

  it('an address with auth_json is 422 on /baseUrl; auth_json without an address stores a null address and clears a saved one', async () => {
    const a = await newOpencode();
    const refused = await putCred(a.id, { type: 'auth_json', value: '{"a":1}', baseUrl: ENDPOINT });
    expect(refused.statusCode).toBe(422);
    expect(pointersOf(refused)).toContain('/baseUrl');
    expect((await putCred(a.id, { type: 'api_key', value: KEY, baseUrl: ENDPOINT })).statusCode).toBe(200);
    expect((await rowOf(a.id)).base_url).toBe(ENDPOINT);
    expect((await putCred(a.id, { type: 'auth_json', value: '{"a":1}' })).statusCode).toBe(200);
    expect(await rowOf(a.id)).toEqual({ base_url: null, credential_type: 'auth_json' });
    expect(await t.secrets.get(credentialSecretName(orgId, a.id))).toEqual({ type: 'auth_json', value: '{"a":1}' });
  });
});

describe('opencode own endpoint and key (BR-14, ADR 0026)', () => {
  it('stores the key in the Secret and the address in base_url, and GET shows the address and never the key', async () => {
    const a = await newOpencode();
    expect((await putCred(a.id, { type: 'api_key', value: KEY, baseUrl: ENDPOINT })).statusCode).toBe(200);
    expect(await t.secrets.get(credentialSecretName(orgId, a.id))).toEqual({
      type: 'api_key',
      value: KEY,
      baseUrl: ENDPOINT,
    });
    expect(await rowOf(a.id)).toEqual({ base_url: ENDPOINT, credential_type: 'api_key' });
    const list = await call('GET', `/api/projects/${projectId}/agents?pageSize=100`);
    expect(list.body).not.toContain(KEY);
    expect(await one(a.id)).toMatchObject({ baseUrl: ENDPOINT, credential: { set: true, type: 'api_key' } });
  });

  it('api_key with no address sent and none saved is 422 on /baseUrl; a saved address is enough', async () => {
    const a = await newOpencode();
    const res = await putCred(a.id, { type: 'api_key', value: KEY });
    expect(res.statusCode).toBe(422);
    expect(pointersOf(res)).toContain('/baseUrl');
    expect((await one(a.id)).credential.set).toBe(false);
    expect((await putCred(a.id, { type: 'api_key', value: KEY, baseUrl: ENDPOINT })).statusCode).toBe(200);
    expect((await putCred(a.id, { type: 'api_key', value: 'sk-open-rotated' })).statusCode).toBe(200);
    expect(await t.secrets.get(credentialSecretName(orgId, a.id))).toMatchObject({
      value: 'sk-open-rotated',
      baseUrl: ENDPOINT,
    });
  });

  it('a new address with a new key replaces the credential and resets the stored test', async () => {
    const a = await newOpencode();
    await putCred(a.id, { type: 'api_key', value: KEY, baseUrl: ENDPOINT });
    await withOrg(t.db, orgId, (tx) =>
      tx.execute(sql`update agents set last_test_status = 'ok', last_test_at = now() where id = ${a.id}`),
    );
    expect((await one(a.id)).lastTest?.status).toBe('ok');
    const other = 'https://other.example.com/v1';
    expect((await putCred(a.id, { type: 'api_key', value: 'sk-open-next', baseUrl: other })).statusCode).toBe(200);
    expect(await t.secrets.get(credentialSecretName(orgId, a.id))).toEqual({
      type: 'api_key',
      value: 'sk-open-next',
      baseUrl: other,
    });
    expect((await one(a.id)).lastTest).toBeNull();
  });

  it('two opencode agents with different endpoints and keys keep their own', async () => {
    const a = await newOpencode();
    const b = await newOpencode();
    await putCred(a.id, { type: 'api_key', value: 'key-a-0001', baseUrl: 'https://a.example.com/v1' });
    await putCred(b.id, { type: 'api_key', value: 'key-b-0001', baseUrl: 'https://b.example.com/v1' });
    expect(await t.secrets.get(credentialSecretName(orgId, a.id))).toMatchObject({
      value: 'key-a-0001',
      baseUrl: 'https://a.example.com/v1',
    });
    expect(await t.secrets.get(credentialSecretName(orgId, b.id))).toMatchObject({
      value: 'key-b-0001',
      baseUrl: 'https://b.example.com/v1',
    });
  });
});

describe('opencode with no credential (BR-41, BR-68)', () => {
  it('appears with credential.set false and a rule naming it is created with no warning field', async () => {
    const a = await newOpencode();
    expect((await one(a.id)).credential).toEqual({ set: false, type: null, updatedAt: null, setBy: null });
    const res = await call('POST', `/api/projects/${projectId}/rules`, {
      kind: 'prompt',
      command: `oc-rule-${a.id.slice(0, 8)}`,
      labelFilter: [],
      target: 'issue',
      enabled: true,
      prompt: 'Hi.',
      agentId: a.id,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(body['agentId']).toBe(a.id);
    expect(Object.keys(body).filter((k) => /warn/i.test(k))).toEqual([]);
  });
});

describe('opencode test connection (BR-20, BR-22, BR-68)', () => {
  const testConn = (id: string) => call('POST', `/api/agents/${id}/test`);
  const withHttp = async (impl: AgentHttpGet, run: () => Promise<void>): Promise<void> => {
    httpImpl = impl;
    try {
      await run();
    } finally {
      httpImpl = defaultHttp;
    }
  };
  const endpointAgent = async (baseUrl = ENDPOINT, key = KEY) => {
    const a = await newOpencode();
    expect((await putCred(a.id, { type: 'api_key', value: key, baseUrl })).statusCode).toBe(200);
    return a;
  };

  it('no credential and a credentials file answer unsupported with zero outbound calls, and store it', async () => {
    const none = await newOpencode();
    const file = await newOpencode();
    expect((await putCred(file.id, { type: 'auth_json', value: '{"a":{"b":"c"}}' })).statusCode).toBe(200);
    calls.length = 0;
    for (const a of [none, file]) {
      const body = expectContract('agents.test', await testConn(a.id)) as { status: string; message: string };
      expect(body).toMatchObject({ status: 'unsupported', message: 'This agent has no connection check.' });
      expect((await one(a.id)).lastTest?.status).toBe('unsupported');
    }
    expect(calls).toEqual([]);
  });

  it('asks GET <baseUrl>/models with the bearer key and answers ok for a list', async () => {
    const a = await endpointAgent();
    calls.length = 0;
    await withHttp(
      () => Promise.resolve({ status: 200, json: { data: [{ id: 'm1' }] } }),
      async () => {
        const body = expectContract('agents.test', await testConn(a.id)) as { status: string };
        expect(body.status).toBe('ok');
      },
    );
    expect(calls).toEqual([{ url: `${ENDPOINT}/models`, headers: { authorization: `Bearer ${KEY}` } }]);
    expect((await one(a.id)).lastTest?.status).toBe('ok');
  });

  it.each([
    ['401', () => Promise.resolve({ status: 401, json: {} }), 'rejected'],
    ['403', () => Promise.resolve({ status: 403, json: {} }), 'rejected'],
    ['a transport error', () => Promise.reject(new Error('ECONNRESET')), 'unreachable'],
    ['a redirect', () => Promise.reject(new GuardedHttpError('redirect')), 'unreachable'],
    ['a stall', () => Promise.reject(new GuardedHttpError('timeout')), 'unreachable'],
    ['a 500', () => Promise.resolve({ status: 500, json: {} }), 'invalid'],
    ['an HTML body', () => Promise.reject(new GuardedHttpError('bad_json')), 'invalid'],
    ['an oversized body', () => Promise.reject(new GuardedHttpError('too_large')), 'invalid'],
    ['a body that is not a list', () => Promise.resolve({ status: 200, json: { data: 'x' } }), 'invalid'],
  ] as [string, AgentHttpGet, string][])(
    'maps %s to %s with a fixed message and keeps the agent saved',
    async (_n, impl, status) => {
      const a = await endpointAgent();
      logged.length = 0;
      await withHttp(impl, async () => {
        const res = await testConn(a.id);
        const body = expectContract('agents.test', res) as { status: string; message: string };
        expect(body.status).toBe(status);
        expect(res.body).not.toContain(KEY);
        expect(res.body).not.toContain('ECONNRESET');
      });
      expect(logged.join('')).not.toContain(KEY);
      const after = await one(a.id);
      expect(after.credential.set).toBe(true);
      expect(after.lastTest?.status).toBe(status);
    },
  );

  it('two agents with different endpoints and keys never cross', async () => {
    const a = await endpointAgent('https://a.example.com/v1', 'key-a-test');
    const b = await endpointAgent('https://b.example.com/v1', 'key-b-test');
    calls.length = 0;
    await withHttp(
      (url, headers) =>
        Promise.resolve({
          status: url.host === 'a.example.com' && headers['authorization'] === 'Bearer key-a-test' ? 200 : 401,
          json: { data: [{ id: 'm' }] },
        }),
      async () => {
        expect(((await testConn(a.id)).json() as { status: string }).status).toBe('ok');
        expect(((await testConn(b.id)).json() as { status: string }).status).toBe('rejected');
      },
    );
    expect(calls.map((c) => [c.url, c.headers['authorization']])).toEqual([
      ['https://a.example.com/v1/models', 'Bearer key-a-test'],
      ['https://b.example.com/v1/models', 'Bearer key-b-test'],
    ]);
  });
});
