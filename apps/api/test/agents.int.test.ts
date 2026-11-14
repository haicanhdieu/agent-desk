import { Writable } from 'node:stream';
import { sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { credentialSecretName } from '@agentdesk/core';
import { withOrg } from '@agentdesk/db';
import type { AgentDto } from '@agentdesk/contracts';
import { createTestApp, type TestApp } from './helpers/app';
import { loginAs } from './helpers/auth';
import { expectContract } from './helpers/contract';
import { freshStateDir, installFake, makeProject, wideFakeRepos } from './helpers/fixtures';

const SECRET = 'sk-ant-secret123456';
let t: TestApp;
let alice: string;
let bob: string;
let projectId: string;
const logged: string[] = [];

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
  });
  alice = await loginAs(t, 'alice');
  bob = await loginAs(t, 'bob');
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
      maxTurns: 50,
      timeoutSeconds: 1800,
      credential: { set: false, type: null, updatedAt: null, setBy: null },
    });
  });

  it('PUT updates settings; omitted maxTurns becomes null', async () => {
    const res = await putAgent({ model: 'opus', timeoutSeconds: 3300 });
    const a = expectContract('agents.put', res) as AgentDto;
    expect(a).toMatchObject({ model: 'opus', maxTurns: null, timeoutSeconds: 3300 });
    const b = expectContract('agents.put', await putAgent({ model: 'sonnet', maxTurns: 10, timeoutSeconds: 60 }));
    expect(b).toMatchObject({ model: 'sonnet', maxTurns: 10, timeoutSeconds: 60 });
  });

  it('PUT with timeoutSeconds 4000 is a 400 with pointer /timeoutSeconds', async () => {
    const res = await putAgent({ model: 'sonnet', timeoutSeconds: 4000 });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { errors: { pointer: string }[] }).errors.map((e) => e.pointer)).toContain('/timeoutSeconds');
    expect((await putAgent({ model: 'sonnet', timeoutSeconds: 3301 })).statusCode).toBe(400);
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
