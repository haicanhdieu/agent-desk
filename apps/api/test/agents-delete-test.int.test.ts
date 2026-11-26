import { Writable } from 'node:stream';
import { sql } from 'drizzle-orm';
import pino from 'pino';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { credentialSecretName, type AgentHttpGet } from '@agentdesk/core';
import { withOrg } from '@agentdesk/db';
import type { AgentDto, Page } from '@agentdesk/contracts';
import { createTestApp, type TestApp } from './helpers/app';
import { createOrg, inviteAndLogin } from './helpers/auth';
import { expectContract } from './helpers/contract';
import { makeAgent, swapAgent } from './helpers/agents';
import { freshStateDir, installFake, makeProject, wideFakeRepos } from './helpers/fixtures';

const KEY = 'sk-multi-secret-0001';
let t: TestApp;
const logged: string[] = [];
const httpCalls: { url: string; headers: Record<string, string> }[] = [];
const defaultHttp: AgentHttpGet = (url, headers) => {
  httpCalls.push({ url: url.toString(), headers });
  return Promise.resolve({ status: 200, json: { data: [{ id: `m-${headers['x-api-key'] ?? 'none'}` }] } });
};
/** Swapped per case to script the provider's answer; every case that sets it resets it. */
let httpImpl: AgentHttpGet = defaultHttp;
const agentHttp: AgentHttpGet = (url, headers, opts) => httpImpl(url, headers, opts);
const FIXED_NOW = new Date('2026-11-25T10:00:00.000Z');

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
    clock: { now: () => FIXED_NOW },
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
const remove = (agentId: string, cookie: string) => call('DELETE', `/api/agents/${agentId}`, cookie);
const testConn = (agentId: string, cookie: string) => call('POST', `/api/agents/${agentId}/test`, cookie);
const putCred = (agentId: string, payload: object, cookie: string) =>
  call('PUT', `/api/agents/${agentId}/credential`, cookie, payload);
async function listAgents(cookie: string, projectId: string, query = 'pageSize=100'): Promise<Page<AgentDto>> {
  return expectContract(
    'agents.list',
    await call('GET', `/api/projects/${projectId}/agents?${query}`, cookie),
  ) as Page<AgentDto>;
}
const rowsOf = (orgId: string, query: ReturnType<typeof sql>) =>
  withOrg(t.db, orgId, async (tx) => (await tx.execute(query)).rows as Record<string, unknown>[]);

const ONLY_AGENT = 'A project needs at least one agent. Add another agent first.';
const DEFAULT_TEXT = 'Set another agent as default first';
const detailOf = (res: { json: () => unknown }): string => (res.json() as { detail?: string }).detail ?? '';
const agentRow = (orgId: string, id: string) => rowsOf(orgId, sql`select * from agents where id = ${id}`);
const insertRule = (w: World, agentId: string | null, command: string) =>
  rowsOf(
    w.orgId,
    sql`insert into rules (org_id, project_id, agent_id, command, prompt, target) values (${w.orgId}, ${w.projectId}, ${agentId}, ${command}, 'p', 'issue')`,
  );
const insertRun = (w: World, agentId: string, status: string, expires: ReturnType<typeof sql>, name = 'Queued name') =>
  rowsOf(
    w.orgId,
    sql`insert into runs (org_id, project_id, agent_id, agent_name, command, skill_name, ticket_ref, ticket_kind, checkout_ref, trigger_source, status, session_expires_at) values (${w.orgId}, ${w.projectId}, ${agentId}, ${name}, 'fix', 'fix', ${`r-${Math.random()}`}, 'issue', 'refs/heads/main', 'webhook', ${status}, ${expires})`,
  );

describe('delete (BR-27 to BR-31, BR-66)', () => {
  it('removes an unused agent and its Secret, and a failing Secret delete still succeeds and logs the class only', async () => {
    const w = await world();
    const a = await makeAgent(t, w.owner, w.projectId, { name: 'Unused' });
    expect((await putCred(a.id, { type: 'api_key', value: KEY }, w.owner)).statusCode).toBe(200);
    const name = credentialSecretName(w.orgId, a.id);
    expect(await t.secrets.get(name)).not.toBeNull();
    expect((await remove(a.id, w.owner)).statusCode).toBe(204);
    expect(await agentRow(w.orgId, a.id)).toHaveLength(0);
    expect(await t.secrets.get(name)).toBeNull();
    expect((await listAgents(w.owner, w.projectId)).items.map((x) => x.name)).toEqual(['Claude']);

    const b = await makeAgent(t, w.owner, w.projectId, { name: 'Orphaned' });
    expect((await putCred(b.id, { type: 'api_key', value: KEY }, w.owner)).statusCode).toBe(200);
    const errors = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const spy = vi.spyOn(t.secrets, 'delete').mockRejectedValueOnce(new TypeError(`store said ${KEY}`));
    const res = await remove(b.id, w.owner);
    spy.mockRestore();
    const lines = JSON.stringify(errors.mock.calls);
    errors.mockRestore();
    expect(res.statusCode).toBe(204);
    expect(await agentRow(w.orgId, b.id)).toHaveLength(0);
    expect(lines).toContain('TypeError');
    expect(lines).not.toContain(KEY);
  });

  it('refuses the only agent with the BR-66 text: unused, with a credential, and named by a rule', async () => {
    const w = await world();
    const unused = await remove(w.placeholder.id, w.owner);
    expect(unused.statusCode).toBe(409);
    expect(detailOf(unused)).toBe(ONLY_AGENT);
    expect(await agentRow(w.orgId, w.placeholder.id)).toHaveLength(1);

    expect((await putCred(w.placeholder.id, { type: 'api_key', value: KEY }, w.owner)).statusCode).toBe(200);
    const withCred = await remove(w.placeholder.id, w.owner);
    expect(detailOf(withCred)).toBe(ONLY_AGENT);
    expect(await t.secrets.get(credentialSecretName(w.orgId, w.placeholder.id))).not.toBeNull();

    await insertRule(w, w.placeholder.id, 'named');
    expect(detailOf(await remove(w.placeholder.id, w.owner))).toBe(ONLY_AGENT);
    const list = await listAgents(w.owner, w.projectId);
    expect(list.items.map((x) => [x.id, x.isDefault])).toEqual([[w.placeholder.id, true]]);
  });

  it('refuses the default while another agent exists, and allows it after set-default (BR-28)', async () => {
    const w = await world();
    const other = await makeAgent(t, w.owner, w.projectId, { name: 'Other' });
    const refused = await remove(w.placeholder.id, w.owner);
    expect(refused.statusCode).toBe(409);
    expect(detailOf(refused)).toBe(DEFAULT_TEXT);
    expect(await agentRow(w.orgId, w.placeholder.id)).toHaveLength(1);
    expect((await setDefault(other.id, w.owner)).statusCode).toBe(200);
    expect((await remove(w.placeholder.id, w.owner)).statusCode).toBe(204);
    const list = await listAgents(w.owner, w.projectId);
    expect(list.items.map((x) => [x.id, x.isDefault])).toEqual([[other.id, true]]);
  });

  it('refuses an agent a rule names, lists up to 5 commands and reassigns nothing (BR-29)', async () => {
    const w = await world();
    const a = await makeAgent(t, w.owner, w.projectId, { name: 'Named' });
    for (let i = 1; i <= 7; i += 1) await insertRule(w, a.id, `cmd${i}`);
    const res = await remove(a.id, w.owner);
    expect(res.statusCode).toBe(409);
    const text = detailOf(res);
    expect(text).toBe(
      '7 rules name it: /cmd1, /cmd2, /cmd3, /cmd4, /cmd5 and 2 more. Point it at another agent first, then delete.',
    );
    expect(await agentRow(w.orgId, a.id)).toHaveLength(1);
    const left = await rowsOf(w.orgId, sql`select count(*)::int as n from rules where agent_id = ${a.id}`);
    expect(left[0]?.n).toBe(7);
  });

  it('names the one rule in the singular (BR-29)', async () => {
    const w = await world();
    const a = await makeAgent(t, w.owner, w.projectId, { name: 'Named once' });
    await insertRule(w, a.id, 'fix');
    const res = await remove(a.id, w.owner);
    expect(res.statusCode).toBe(409);
    expect(detailOf(res)).toBe('1 rule names it: /fix. Point it at another agent first, then delete.');
  });

  it.each([
    ['queued', sql`null`, 'is queued. Finish it first, then delete.'],
    ['running', sql`null`, 'is running. Finish it first, then delete.'],
    ['idle', sql`null`, 'is idle. Finish it first, then delete.'],
    ['paused', sql`null`, 'is paused and can be resumed. Finish it first, then delete.'],
    [
      'succeeded',
      sql`now() + interval '1 hour'`,
      'has a kept session that can be reopened. Close it first, then delete.',
    ],
  ])('refuses an agent with a %s run (BR-30)', async (status, expires, tail) => {
    const w = await world();
    const a = await makeAgent(t, w.owner, w.projectId, { name: 'Busy' });
    await insertRun(w, a.id, status, expires);
    const res = await remove(a.id, w.owner);
    expect(res.statusCode).toBe(409);
    const [run] = await rowsOf(w.orgId, sql`select number from runs where agent_id = ${a.id}`);
    expect(detailOf(res)).toBe(`Run ${String(run?.number)} ${tail}`);
    expect(await agentRow(w.orgId, a.id)).toHaveLength(1);
  });

  it('names the lowest-numbered blocking run when several block (BR-30)', async () => {
    const w = await world();
    const a = await makeAgent(t, w.owner, w.projectId, { name: 'Busy' });
    // Many finished runs of another agent keep the planner on an index whose order is
    // not the run number.
    const other = await makeAgent(t, w.owner, w.projectId, { name: 'Other' });
    await rowsOf(
      w.orgId,
      sql`insert into runs (org_id, project_id, agent_id, agent_name, command, skill_name, ticket_ref, ticket_kind, checkout_ref, trigger_source, status) select ${w.orgId}, ${w.projectId}, ${other.id}, 'Done', 'fix', 'fix', 'f-' || g, 'issue', 'refs/heads/main', 'webhook', 'succeeded' from generate_series(1, 400) g`,
    );
    await insertRun(w, a.id, 'running', sql`null`);
    await insertRun(w, a.id, 'idle', sql`null`);
    // The second run gets a finish time, so the planner's index on (project, finished_at) lists it before the first
    // (nulls last): only ORDER BY number answers with the first run.
    const [first] = await rowsOf(w.orgId, sql`select min(number) as n from runs where agent_id = ${a.id}`);
    await rowsOf(w.orgId, sql`update runs set finished_at = now() where agent_id = ${a.id} and number > ${first?.n}`);
    await rowsOf(w.orgId, sql`analyze runs`);
    const res = await remove(a.id, w.owner);
    expect(res.statusCode).toBe(409);
    expect(detailOf(res)).toBe(`Run ${String(first?.n)} is running. Finish it first, then delete.`);
    expect(await agentRow(w.orgId, a.id)).toHaveLength(1);
  });

  it('a rule that follows the default does not block, and finished runs keep the queue-time name (BR-31)', async () => {
    const w = await world();
    const a = await makeAgent(t, w.owner, w.projectId, { name: 'Done' });
    await insertRule(w, null, 'follows');
    await insertRun(w, a.id, 'succeeded', sql`now() - interval '1 hour'`, 'Done');
    await insertRun(w, a.id, 'failed', sql`null`, 'Done');
    expect((await remove(a.id, w.owner)).statusCode).toBe(204);
    const runsLeft = await rowsOf(
      w.orgId,
      sql`select agent_id, agent_name from runs where project_id = ${w.projectId}`,
    );
    expect(runsLeft).toHaveLength(2);
    for (const r of runsLeft) expect(r).toEqual({ agent_id: null, agent_name: 'Done' });
  });

  it('delete versus rule create and versus run insert never answers 500 and never leaves a dangling reference', async () => {
    const w = await world();
    for (let i = 0; i < 4; i += 1) {
      const a = await makeAgent(t, w.owner, w.projectId, { name: `Race ${i}` });
      const [del, rule] = await Promise.all([
        remove(a.id, w.owner),
        call('POST', `/api/projects/${w.projectId}/rules`, w.owner, {
          kind: 'prompt',
          command: `race${i}`,
          labelFilter: [],
          target: 'issue',
          prompt: 'p',
          enabled: true,
          agentId: a.id,
        }),
      ]);
      expect([204, 409]).toContain(del.statusCode);
      expect([201, 404, 409, 422]).toContain(rule.statusCode);
      const dangling = await rowsOf(
        w.orgId,
        sql`select count(*)::int as n from rules r where r.agent_id is not null and not exists (select 1 from agents a where a.id = r.agent_id)`,
      );
      expect(dangling[0]?.n).toBe(0);
    }
    for (let i = 0; i < 4; i += 1) {
      const a = await makeAgent(t, w.owner, w.projectId, { name: `Run race ${i}` });
      const [del, run] = await Promise.allSettled([remove(a.id, w.owner), insertRun(w, a.id, 'queued', sql`null`)]);
      expect(del.status === 'fulfilled' && [204, 409].includes(del.value.statusCode)).toBe(true);
      if (run.status === 'rejected') expect(JSON.stringify(run.reason)).toContain('23503');
    }
  });

  /**
   * Holds a lock on the agent row in its own transaction, sends the request without awaiting it, waits until
   * its write is blocked on that lock, then deletes the agent and commits: the blocked write must hit the
   * foreign key and answer 409, not 500.
   */
  async function writeBlockedByDelete(
    w: World,
    agentId: string,
    fire: () => ReturnType<typeof call>,
    writeSql: string,
  ) {
    const client = await t.db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`select set_config('app.org_id', $1, true)`, [w.orgId]);
      await client.query('select id from agents where id = $1 for update', [agentId]);
      // inject() is lazy until awaited: Promise.resolve starts it now. pg_stat_activity is read on another
      // connection: inside this transaction it would show a frozen snapshot.
      const pending = Promise.resolve(fire());
      for (let i = 0; ; i += 1) {
        const waiting = await t.db.pool.query(
          `select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query ilike $1`,
          [`%${writeSql}%`],
        );
        if ((waiting.rows[0] as { n: number }).n > 0) break;
        if (i > 200) throw new Error('the write never blocked on the agent row');
        await new Promise((r) => setTimeout(r, 25));
      }
      await client.query('delete from agents where id = $1', [agentId]);
      await client.query('COMMIT');
      return await pending;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  it('a rule create whose agent is deleted before the insert lands answers 409, not 500', async () => {
    const w = await world();
    const a = await makeAgent(t, w.owner, w.projectId, { name: 'Gone on create' });
    const res = await writeBlockedByDelete(
      w,
      a.id,
      () =>
        call('POST', `/api/projects/${w.projectId}/rules`, w.owner, {
          kind: 'prompt',
          command: 'goneonce',
          labelFilter: [],
          target: 'issue',
          prompt: 'p',
          enabled: true,
          agentId: a.id,
        }),
      'insert into "rules"',
    );
    expect(res.statusCode).toBe(409);
    expect(detailOf(res)).toBe('The agent was deleted. Choose another agent.');
  });

  it('a rule update whose new agent is deleted before the update lands answers 409, not 500', async () => {
    const w = await world();
    const a = await makeAgent(t, w.owner, w.projectId, { name: 'Gone on patch' });
    const made = await call('POST', `/api/projects/${w.projectId}/rules`, w.owner, {
      kind: 'prompt',
      command: 'gonepatch',
      labelFilter: [],
      target: 'issue',
      prompt: 'p',
      enabled: true,
    });
    expect(made.statusCode).toBe(201);
    const ruleId = (made.json() as { id: string }).id;
    const res = await writeBlockedByDelete(
      w,
      a.id,
      () => call('PATCH', `/api/rules/${ruleId}`, w.owner, { agentId: a.id }),
      'update "rules"',
    );
    expect(res.statusCode).toBe(409);
    expect(detailOf(res)).toBe('The agent was deleted. Choose another agent.');
  });

  it('two deletes of a two-agent project at once leave at least one agent', async () => {
    const w = await world();
    const b = await makeAgent(t, w.owner, w.projectId, { name: 'Second' });
    await rowsOf(w.orgId, sql`update agents set is_default = false where project_id = ${w.projectId}`);
    await rowsOf(w.orgId, sql`update agents set is_default = true where id = ${b.id}`);
    const results = await Promise.all([remove(w.placeholder.id, w.owner), remove(b.id, w.owner)]);
    for (const r of results) expect([204, 409]).toContain(r.statusCode);
    const left = await rowsOf(w.orgId, sql`select is_default from agents where project_id = ${w.projectId}`);
    expect(left.length).toBeGreaterThanOrEqual(1);
    expect(left.filter((r) => r.is_default === true)).toHaveLength(1);
  });

  it('delete versus set-default and versus create at once give 409 or success, never 500', async () => {
    const w = await world();
    for (let i = 0; i < 3; i += 1) {
      const a = await makeAgent(t, w.owner, w.projectId, { name: `SD ${i}` });
      const [del, def] = await Promise.all([remove(a.id, w.owner), setDefault(a.id, w.owner)]);
      expect([204, 409]).toContain(del.statusCode);
      expect([200, 404]).toContain(def.statusCode);
      const [del2, made] = await Promise.all([
        remove(w.placeholder.id, w.owner),
        create(w, { provider: 'claude', name: `After ${i}` }),
      ]);
      expect([204, 409, 404]).toContain(del2.statusCode);
      expect(made.statusCode).toBe(201);
      const defaults = await rowsOf(
        w.orgId,
        sql`select id from agents where project_id = ${w.projectId} and is_default`,
      );
      expect(defaults).toHaveLength(1);
      if (del2.statusCode === 204) w.placeholder = (await listAgents(w.owner, w.projectId)).items[0] as AgentDto;
    }
  });
});

describe('test connection (BR-20, BR-21, BR-22)', () => {
  const rejectAll: AgentHttpGet = () => Promise.resolve({ status: 401, json: { error: 'bad key sk-leak' } });
  const scripted = async (impl: AgentHttpGet, run: () => Promise<void>): Promise<void> => {
    httpImpl = impl;
    try {
      await run();
    } finally {
      httpImpl = defaultHttp;
    }
  };
  const lastTest = async (w: World, id: string) =>
    (await listAgents(w.owner, w.projectId)).items.find((x) => x.id === id)?.lastTest ?? null;

  it('answers ok for a working credential and stores the status and the clock time', async () => {
    const w = await world();
    expect((await putCred(w.placeholder.id, { type: 'api_key', value: KEY }, w.owner)).statusCode).toBe(200);
    const res = await testConn(w.placeholder.id, w.owner);
    expect(res.statusCode).toBe(200);
    expect(expectContract('agents.test', res)).toEqual({
      status: 'ok',
      message: 'Connected',
      testedAt: FIXED_NOW.toISOString(),
    });
    expect(await lastTest(w, w.placeholder.id)).toEqual({ status: 'ok', at: FIXED_NOW.toISOString() });
  });

  it.each(['claude', 'codex'] as const)(
    '%s with no credential answers no_credential and stores nothing',
    async (provider) => {
      const w = await world();
      const a = await makeAgent(t, w.owner, w.projectId, { provider, name: 'Bare' });
      const before = httpCalls.length;
      const res = await testConn(a.id, w.owner);
      expect(expectContract('agents.test', res)).toEqual({
        status: 'no_credential',
        message: 'No credential is saved for this agent.',
        testedAt: null,
      });
      expect(httpCalls.length).toBe(before);
      expect(await lastTest(w, a.id)).toBeNull();
    },
  );

  it.each([
    ['rejected', rejectAll, 'The credential was rejected. Check it and save it again.'],
    [
      'unreachable',
      () => Promise.reject(new Error(`connect refused ${KEY}`)),
      'The address could not be reached. Check it and try again.',
    ],
    [
      'invalid',
      () => Promise.resolve({ status: 200, json: '<html>nope</html>' }),
      'The answer could not be understood, so the connection could not be verified.',
    ],
  ] as const)(
    'stores %s with its fixed message and never echoes the provider or the credential',
    async (status, impl, message) => {
      const w = await world();
      expect((await putCred(w.placeholder.id, { type: 'api_key', value: KEY }, w.owner)).statusCode).toBe(200);
      logged.length = 0;
      await scripted(impl, async () => {
        const res = await testConn(w.placeholder.id, w.owner);
        expect(res.statusCode).toBe(200);
        const body = expectContract('agents.test', res) as { status: string; message: string };
        expect(body.status).toBe(status);
        expect(body.message).toBe(message);
        expect(res.body).not.toContain(KEY);
        expect(res.body).not.toContain('sk-leak');
      });
      expect(logged.join('')).not.toContain(KEY);
      expect(await lastTest(w, w.placeholder.id)).toEqual({ status, at: FIXED_NOW.toISOString() });
      // BR-21: the agent stays saved.
      expect(
        (await listAgents(w.owner, w.projectId)).items.find((x) => x.id === w.placeholder.id)?.credential.set,
      ).toBe(true);
    },
  );

  it('appends only the host to the unreachable message of an agent with its own address', async () => {
    const w = await world();
    const a = await makeAgent(t, w.owner, w.projectId, { name: 'Gateway' });
    expect(
      (await putCred(a.id, { type: 'api_key', value: KEY, baseUrl: 'https://gw.example.com/v1' }, w.owner)).statusCode,
    ).toBe(200);
    await scripted(
      () => Promise.reject(new Error('down')),
      async () => {
        const body = (await testConn(a.id, w.owner)).json<{ status: string; message: string }>();
        expect(body.status).toBe('unreachable');
        expect(body.message).toBe('The address could not be reached. Check it and try again. (gw.example.com)');
      },
    );
  });

  it('answers unsupported for a Codex credentials file and stores it', async () => {
    const w = await world();
    const a = await makeAgent(t, w.owner, w.projectId, { provider: 'codex', name: 'Sign-in file' });
    expect((await putCred(a.id, { type: 'auth_json', value: '{"tokens":{}}' }, w.owner)).statusCode).toBe(200);
    const before = httpCalls.length;
    const body = (await testConn(a.id, w.owner)).json<{ status: string }>();
    expect(body.status).toBe('unsupported');
    expect(httpCalls.length).toBe(before);
    expect((await lastTest(w, a.id))?.status).toBe('unsupported');
  });

  it('a credential change resets the stored result to Not tested', async () => {
    const w = await world();
    expect((await putCred(w.placeholder.id, { type: 'api_key', value: KEY }, w.owner)).statusCode).toBe(200);
    await testConn(w.placeholder.id, w.owner);
    expect(await lastTest(w, w.placeholder.id)).not.toBeNull();
    expect((await putCred(w.placeholder.id, { type: 'api_key', value: `${KEY}-2` }, w.owner)).statusCode).toBe(200);
    expect(await lastTest(w, w.placeholder.id)).toBeNull();
  });

  it('holds no transaction while the provider hangs, and a refused caller never reaches the provider', async () => {
    const w = await world();
    expect((await putCred(w.placeholder.id, { type: 'api_key', value: KEY }, w.owner)).statusCode).toBe(200);
    const member = await inviteAndLogin(t, w.orgId, `multi-tm-${worldSeq}`, 'member', { type: 'org' });
    let release: () => void = () => undefined;
    let entered: () => void = () => undefined;
    const reached = new Promise<void>((r) => {
      entered = r;
    });
    const hang: AgentHttpGet = () =>
      new Promise((resolve) => {
        entered();
        release = () => resolve({ status: 200, json: { data: [{ id: 'm' }] } });
      });
    httpImpl = hang;
    try {
      const pending = testConn(w.placeholder.id, w.owner);
      await reached;
      const idle = await rowsOf(
        w.orgId,
        sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and state like 'idle in transaction%'`,
      );
      expect(idle[0]?.n).toBe(0);
      // another write to the same agent is not blocked while the provider hangs
      expect((await patch(w.placeholder.id, { name: 'Renamed while testing' }, w.owner)).statusCode).toBe(200);
      release();
      expect((await pending).statusCode).toBe(200);
      const calls = httpCalls.length;
      let reachedAgain = false;
      httpImpl = () => {
        reachedAgain = true;
        return defaultHttp(new URL('https://x.example.com'), {});
      };
      expect((await testConn(w.placeholder.id, member)).statusCode).toBe(403);
      expect(reachedAgain).toBe(false);
      expect(httpCalls.length).toBe(calls);
    } finally {
      httpImpl = defaultHttp;
    }
  });
});

describe('wizard swap keeps the invariants', () => {
  const invariant = async (w: World): Promise<AgentDto[]> => {
    const items = (await listAgents(w.owner, w.projectId)).items;
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.filter((a) => a.isDefault)).toHaveLength(1);
    return items;
  };
  const addAgentDone = async (w: World): Promise<boolean> => {
    const res = await call('GET', `/api/orgs/${w.orgId}/checklist`, w.owner);
    return (res.json() as { steps: { key: string; done: boolean }[] }).steps.some(
      (s) => s.key === 'add_agent' && s.done,
    );
  };

  it.each(['codex', 'opencode'] as const)(
    'swaps the placeholder for a %s agent with a credential',
    async (provider) => {
      const w = await world();
      const credential =
        provider === 'opencode'
          ? { type: 'api_key', value: KEY, baseUrl: 'https://llm.example.com/v1' }
          : { type: 'api_key', value: KEY };
      const done = await swapAgent(t, w.owner, w.projectId, provider, credential);
      const items = await invariant(w);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ id: done.id, provider, isDefault: true });
      expect(items[0]?.credential.set).toBe(true);
      expect(items.map((a) => a.name)).not.toContain('Claude');
      expect(await addAgentDone(w)).toBe(true);
      expect((await call('GET', `/api/agents/${w.placeholder.id}/models`, w.owner)).statusCode).toBe(404);
    },
  );

  it('swaps in an OpenCode agent with no credential: ready, one default, add_agent done', async () => {
    const w = await world();
    await swapAgent(t, w.owner, w.projectId, 'opencode', null);
    const items = await invariant(w);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ provider: 'opencode', isDefault: true });
    expect(items[0]?.credential.set).toBe(false);
    expect(items[0]?.lastTest?.status).toBe('unsupported');
    expect(await addAgentDone(w)).toBe(true);
  });

  it('configures Claude Code in place and compat GET and PUT act on the new default', async () => {
    const w = await world();
    expect((await putCred(w.placeholder.id, { type: 'api_key', value: KEY }, w.owner)).statusCode).toBe(200);
    expect((await testConn(w.placeholder.id, w.owner)).statusCode).toBe(200);
    const items = await invariant(w);
    expect(items.map((a) => a.id)).toEqual([w.placeholder.id]);
    const swapped = await swapAgent(t, w.owner, w.projectId, 'codex');
    const got = expectContract(
      'agents.get',
      await call('GET', `/api/projects/${w.projectId}/agent`, w.owner),
    ) as AgentDto;
    expect(got.id).toBe(swapped.id);
    const put = await call('PUT', `/api/projects/${w.projectId}/agent`, w.owner, {
      model: 'gpt-6-sol',
      timeoutSeconds: 3600,
    });
    expect(put.statusCode).toBe(200);
    expect((put.json() as AgentDto).id).toBe(swapped.id);
    for (const [method, url] of [
      ['PATCH', `/api/agents/${w.placeholder.id}`],
      ['POST', `/api/agents/${w.placeholder.id}/default`],
      ['PUT', `/api/agents/${w.placeholder.id}/credential`],
      ['GET', `/api/agents/${w.placeholder.id}/models`],
      ['POST', `/api/agents/${w.placeholder.id}/test`],
      ['DELETE', `/api/agents/${w.placeholder.id}`],
    ] as const) {
      const res = await call(
        method,
        url,
        w.owner,
        method === 'PATCH' ? { name: 'x' } : method === 'PUT' ? { type: 'api_key', value: KEY } : undefined,
      );
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
  });

  it('a partial failure keeps one default and a retry reuses the created agent', async () => {
    const w = await world();
    const created = await makeAgent(t, w.owner, w.projectId, { provider: 'codex', name: 'Swap codex' });
    await invariant(w);
    // the wizard stopped after create: a retry finds the agent by name and continues with it
    expect((await setDefault(created.id, w.owner)).statusCode).toBe(200);
    await invariant(w);
    const again = await create(w, { provider: 'codex', name: 'Swap codex' });
    expect(again.statusCode).toBe(409);
    expect((await remove(w.placeholder.id, w.owner)).statusCode).toBe(204);
    const items = await invariant(w);
    expect(items.map((a) => a.id)).toEqual([created.id]);
  });
});

describe('access for delete and test', () => {
  let a: World;
  let b: World;
  let admin: string;
  let member: string;
  let viewer: string;
  let p2: string;
  let agentP2: AgentDto;
  let agentOther: AgentDto;

  beforeAll(async () => {
    a = await world();
    b = await world();
    admin = await inviteAndLogin(t, a.orgId, 'multi-del-adm', 'admin', { type: 'project', projectIds: [a.projectId] });
    member = await inviteAndLogin(t, a.orgId, 'multi-del-mem', 'member', { type: 'org' });
    viewer = await inviteAndLogin(t, a.orgId, 'multi-del-vw', 'viewer', { type: 'org' });
    p2 = (await makeProject(t, a.owner, await installFake(t, a.owner))).projectId;
    agentP2 = await makeAgent(t, a.owner, p2, { name: 'P2 only' });
    agentOther = await makeAgent(t, b.owner, b.projectId, { name: 'Other org' });
  });

  it('allows the owner and a project admin to delete and test', async () => {
    for (const cookie of [a.owner, admin]) {
      const x = await makeAgent(t, a.owner, a.projectId, {});
      expect((await testConn(x.id, cookie)).statusCode).toBe(200);
      expect((await remove(x.id, cookie)).statusCode).toBe(204);
    }
  });

  it('refuses a member and a viewer with 403 before any id lookup, whatever the id', async () => {
    const RANDOM = '5b0f5d6e-8f4e-4c55-9d52-0c2f3a9a1e11';
    const own = await makeAgent(t, a.owner, a.projectId, { name: 'Kept' });
    for (const cookie of [member, viewer]) {
      for (const id of [own.id, RANDOM, agentOther.id]) {
        expect((await remove(id, cookie)).statusCode, `delete ${id}`).toBe(403);
        expect((await testConn(id, cookie)).statusCode, `test ${id}`).toBe(403);
      }
    }
    expect(await agentRow(a.orgId, own.id)).toHaveLength(1);
  });

  it('answers 404 to an admin on P1 for a P2 agent and to the owner for another org agent, never 403', async () => {
    expect((await remove(agentP2.id, admin)).statusCode).toBe(404);
    expect((await testConn(agentP2.id, admin)).statusCode).toBe(404);
    expect((await remove(agentOther.id, a.owner)).statusCode).toBe(404);
    expect((await testConn(agentOther.id, a.owner)).statusCode).toBe(404);
    expect(await agentRow(a.orgId, agentP2.id)).toHaveLength(1);
    expect(await agentRow(b.orgId, agentOther.id)).toHaveLength(1);
  });
});
