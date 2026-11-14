import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runs, withOrg } from '@agentdesk/db';
import type { RuleDto } from '@agentdesk/contracts';
import { createTestApp, type TestApp } from './helpers/app';
import { loginAs } from './helpers/auth';
import { expectContract } from './helpers/contract';
import { freshStateDir, installFake, makeProject, wideFakeRepos } from './helpers/fixtures';

let t: TestApp;
let alice: string;
let bob: string;
let projectId: string;
let orgId: string;

beforeAll(async () => {
  t = await createTestApp({ env: { FAKE_STATE_DIR: freshStateDir() }, wrapAdapters: wideFakeRepos });
  alice = await loginAs(t, 'alice');
  bob = await loginAs(t, 'bob');
  projectId = (await makeProject(t, alice, await installFake(t, alice))).projectId;
  orgId = ((await t.db.pool.query("select id from organization where slug = 'alice'")).rows[0] as { id: string }).id;
  await t.app.inject({
    method: 'PUT',
    url: `/api/projects/${projectId}/skills/fix`,
    headers: { cookie: alice },
    payload: { body: 'x', message: 'm' },
  });
});
afterAll(async () => {
  await t.close();
});

const valid = { command: 'fix', labelFilter: ['bug'], target: 'issue', skillName: 'fix', enabled: true };
const create = (payload: object, id = projectId, cookie = alice) =>
  t.app.inject({ method: 'POST', url: `/api/projects/${id}/rules`, headers: { cookie }, payload });
const patch = (id: string, payload: object, cookie = alice) =>
  t.app.inject({ method: 'PATCH', url: `/api/rules/${id}`, headers: { cookie }, payload });
const list = (id = projectId, cookie = alice) =>
  t.app.inject({ method: 'GET', url: `/api/projects/${id}/rules`, headers: { cookie } });
const errorsOf = (r: { json: () => unknown }) => (r.json() as { errors: { pointer: string; detail: string }[] }).errors;

describe('rules', () => {
  let rule: RuleDto;

  it('creates a rule bound to the project agent with zero stats', async () => {
    const res = await create(valid);
    expect(res.statusCode).toBe(201);
    rule = expectContract('rules.create', res) as RuleDto;
    expect(rule).toMatchObject({ ...valid, projectId, stats: { runs30d: 0, lastRunAt: null } });
    const agent = (
      await t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/agent`, headers: { cookie: alice } })
    ).json() as { id: string };
    expect(rule.agentId).toBe(agent.id);
  });

  it('duplicate command is 409 with pointer /command', async () => {
    const res = await create({ ...valid, labelFilter: [] });
    expect(res.statusCode).toBe(409);
    expect(errorsOf(res)).toEqual([{ pointer: '/command', detail: 'Command already used' }]);
  });

  it('unknown skill is 422 with pointer /skillName (create and patch)', async () => {
    const res = await create({ ...valid, command: 'other', skillName: 'nope' });
    expect(res.statusCode).toBe(422);
    expect(errorsOf(res).map((e) => e.pointer)).toEqual(['/skillName']);
    const p = await patch(rule.id, { skillName: 'nope' });
    expect(p.statusCode).toBe(422);
    expect(errorsOf(p).map((e) => e.pointer)).toEqual(['/skillName']);
  });

  it('invalid command is 400 with pointer /command', async () => {
    const res = await create({ ...valid, command: 'Bad Cmd' });
    expect(res.statusCode).toBe(400);
    expect(errorsOf(res).map((e) => e.pointer)).toContain('/command');
  });

  it('patch updates fields; duplicate on patch is 409', async () => {
    const res = await patch(rule.id, { enabled: false, labelFilter: [] });
    expect(expectContract('rules.update', res)).toMatchObject({ enabled: false, labelFilter: [], command: 'fix' });
    expect(expectContract('rules.update', await patch(rule.id, {}))).toMatchObject({ enabled: false });
    const second = expectContract('rules.create', await create({ ...valid, command: 'second' })) as RuleDto;
    const dup = await patch(second.id, { command: 'fix' });
    expect(dup.statusCode).toBe(409);
    expect(errorsOf(dup)).toEqual([{ pointer: '/command', detail: 'Command already used' }]);
  });

  it('stats count runs in the last 30 days and report the latest queuedAt', async () => {
    const day = 24 * 3600 * 1000;
    const recent = new Date(Date.now() - 2 * day);
    const old = new Date(Date.now() - 40 * day);
    const base = {
      orgId,
      projectId,
      ruleId: rule.id,
      command: 'fix',
      skillName: 'fix',
      ticketRef: 'dev/x#1',
      ticketKind: 'issue',
      checkoutRef: 'main',
      triggerSource: 'webhook',
    };
    await withOrg(t.db, orgId, async (tx) => {
      await tx.insert(runs).values([
        { ...base, queuedAt: recent, triggerCommentId: 'c1' },
        { ...base, queuedAt: old, triggerCommentId: 'c2' },
      ]);
    });
    const rows = expectContract('rules.list', await list()) as RuleDto[];
    const r = rows.find((x) => x.id === rule.id);
    expect(r?.stats.runs30d).toBe(1);
    expect(r?.stats.lastRunAt).toBe(recent.toISOString());
    expect(rows.find((x) => x.command === 'second')?.stats).toEqual({ runs30d: 0, lastRunAt: null });
  });

  it('cross-org access is 404', async () => {
    expect((await patch(rule.id, { enabled: true }, bob)).statusCode).toBe(404);
    expect(
      (await t.app.inject({ method: 'DELETE', url: `/api/rules/${rule.id}`, headers: { cookie: bob } })).statusCode,
    ).toBe(404);
    expect((await list(projectId, bob)).statusCode).toBe(404);
    expect((await create(valid, projectId, bob)).statusCode).toBe(404);
  });

  it('delete is 204, then 404; runs keep their history', async () => {
    const del = await t.app.inject({ method: 'DELETE', url: `/api/rules/${rule.id}`, headers: { cookie: alice } });
    expect(del.statusCode).toBe(204);
    expect(
      (await t.app.inject({ method: 'DELETE', url: `/api/rules/${rule.id}`, headers: { cookie: alice } })).statusCode,
    ).toBe(404);
    expect(((await list().then((r) => r.json())) as RuleDto[]).map((r) => r.command)).toEqual(['second']);
    const kept = await withOrg(t.db, orgId, (tx) => tx.select().from(runs));
    expect(kept).toHaveLength(2);
  });
});
