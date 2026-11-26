import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agents, projects, rules as rulesTable, runs, withOrg } from '@agentdesk/db';
import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { PROMPT_PREVIEW_ARGS, PROMPT_PREVIEW_TICKET, promptSystemLines } from '@agentdesk/core';
import type { Page, RuleDto } from '@agentdesk/contracts';
import { createTestApp, type TestApp } from './helpers/app';
import { createOrg, inviteAndLogin } from './helpers/auth';
import { expectContract } from './helpers/contract';
import { freshStateDir, installFake, makeProject, wideFakeRepos } from './helpers/fixtures';

let t: TestApp;
let alice: string;
let bob: string;
let projectId: string;
let orgId: string;
let bobOrgId: string;

beforeAll(async () => {
  t = await createTestApp({ env: { FAKE_STATE_DIR: freshStateDir() }, wrapAdapters: wideFakeRepos });
  orgId = (await createOrg(t, 'Alice', 'alice')).id;
  bobOrgId = (await createOrg(t, 'Bob', 'bob')).id;
  alice = await inviteAndLogin(t, orgId, 'alice', 'owner', { type: 'org' });
  bob = await inviteAndLogin(t, bobOrgId, 'bob', 'owner', { type: 'org' });
  projectId = (await makeProject(t, alice, await installFake(t, alice))).projectId;
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

const valid = { kind: 'skill', command: 'fix', labelFilter: ['bug'], target: 'issue', skillName: 'fix', enabled: true };
const promptRule = { kind: 'prompt', labelFilter: [], target: 'issue', enabled: true, prompt: 'p' };
const create = (payload: object, id = projectId, cookie = alice) =>
  t.app.inject({ method: 'POST', url: `/api/projects/${id}/rules`, headers: { cookie }, payload });
const patch = (id: string, payload: object, cookie = alice) =>
  t.app.inject({ method: 'PATCH', url: `/api/rules/${id}`, headers: { cookie }, payload });
const list = (id = projectId, cookie = alice, query = '') =>
  t.app.inject({ method: 'GET', url: `/api/projects/${id}/rules${query}`, headers: { cookie } });
/** Every rule of the project: page 1 at the largest page size. */
const allRules = async (id = projectId): Promise<RuleDto[]> =>
  (expectContract('rules.list', await list(id, alice, '?pageSize=100')) as Page<RuleDto>).items;
const errorsOf = (r: { json: () => unknown }) => (r.json() as { errors: { pointer: string; detail: string }[] }).errors;

describe('rules', () => {
  let rule: RuleDto;

  it('creates a rule that follows the project default (agentId null) with zero stats', async () => {
    const res = await create(valid);
    expect(res.statusCode).toBe(201);
    rule = expectContract('rules.create', res) as RuleDto;
    expect(rule).toMatchObject({
      ...valid,
      projectId,
      model: null,
      agentId: null,
      stats: { runs30d: 0, lastRunAt: null },
    });
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
    const rows = await allRules();
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
    expect((await allRules()).map((r) => r.command)).toEqual(['second']);
    const kept = await withOrg(t.db, orgId, (tx) => tx.select().from(runs));
    expect(kept).toHaveLength(2);
  });
});

describe('rule agent and model', () => {
  const agentOf = async (id: string): Promise<string> =>
    (
      (await t.app.inject({ method: 'GET', url: `/api/projects/${id}/agent`, headers: { cookie: alice } })).json() as {
        id: string;
      }
    ).id;
  const ruleCount = async (id: string): Promise<number> => (await allRules(id)).length;

  it('create stores model and returns it; absent model is null', async () => {
    const withModel = expectContract('rules.create', await create({ ...valid, command: 'm-set', model: 'haiku' }));
    expect(withModel).toMatchObject({ model: 'haiku' });
    const without = expectContract('rules.create', await create({ ...valid, command: 'm-none' }));
    expect(without).toMatchObject({ model: null });
  });

  it('create with agentId of another project is 422 on /agentId and creates nothing', async () => {
    const other = (await makeProject(t, alice, await installFake(t, alice))).projectId;
    const foreign = await agentOf(other);
    const before = await ruleCount(projectId);
    const res = await create({ ...valid, command: 'foreign', agentId: foreign });
    expect(res.statusCode).toBe(422);
    expect(errorsOf(res)).toEqual([{ pointer: '/agentId', detail: 'Agent not found in this project' }]);
    expect(await ruleCount(projectId)).toBe(before);
  });

  it('create with the project own agentId succeeds', async () => {
    const own = await agentOf(projectId);
    const res = await create({ ...valid, command: 'own-agent', agentId: own });
    expect(expectContract('rules.create', res)).toMatchObject({ agentId: own });
  });

  it('update sets model, null resets it, and agentId of another project is 422 on /agentId', async () => {
    const made = expectContract('rules.create', await create({ ...valid, command: 'm-upd' })) as RuleDto;
    expect(expectContract('rules.update', await patch(made.id, { model: 'opus' }))).toMatchObject({ model: 'opus' });
    expect(expectContract('rules.update', await patch(made.id, { enabled: false }))).toMatchObject({ model: 'opus' });
    expect(expectContract('rules.update', await patch(made.id, { model: null }))).toMatchObject({ model: null });
    const other = (await makeProject(t, alice, await installFake(t, alice))).projectId;
    const res = await patch(made.id, { agentId: await agentOf(other), model: 'haiku' });
    expect(res.statusCode).toBe(422);
    expect(errorsOf(res)).toEqual([{ pointer: '/agentId', detail: 'Agent not found in this project' }]);
    const after = (await allRules()).find((r) => r.id === made.id);
    expect(after).toMatchObject({ agentId: null, model: null });
  });

  it('update moves a rule to another agent of the same project, together with its model', async () => {
    const pid = (await makeProject(t, alice, await installFake(t, alice))).projectId;
    const [second] = await withOrg(t.db, orgId, (tx) =>
      tx.insert(agents).values({ orgId, projectId: pid, name: 'second', model: 'sonnet' }).returning({ id: agents.id }),
    );
    if (!second) throw new Error('no agent');
    const made = expectContract(
      'rules.create',
      await create(
        { kind: 'prompt', command: 'mover', labelFilter: [], target: 'issue', enabled: true, prompt: 'p' },
        pid,
      ),
    ) as RuleDto;
    expect(made.agentId).toBeNull();
    const res = await patch(made.id, { agentId: second.id, model: 'haiku' });
    expect(expectContract('rules.update', res)).toMatchObject({ agentId: second.id, model: 'haiku' });
  });

  it('a project that is not visible is 404 on create even when agentId is sent', async () => {
    const res = await create({ ...valid, command: 'hidden', agentId: await agentOf(projectId) }, projectId, bob);
    expect(res.statusCode).toBe(404);
  });

  it('a prompt rule posted to a project the org cannot see is 404 with an agentId, and nothing is written', async () => {
    const before = await ruleCount(projectId);
    const res = await create(
      {
        kind: 'prompt',
        command: 'hidden-prompt',
        labelFilter: [],
        target: 'issue',
        enabled: true,
        prompt: 'p',
        agentId: await agentOf(projectId),
      },
      projectId,
      bob,
    );
    expect(res.statusCode).toBe(404);
    expect(await ruleCount(projectId)).toBe(before);
  });

  it('an agentId from another org is 422 on /agentId for create and update, and nothing is written', async () => {
    const bobProject = (await makeProject(t, bob, await installFake(t, bob))).projectId;
    const foreign = (
      (
        await t.app.inject({ method: 'GET', url: `/api/projects/${bobProject}/agent`, headers: { cookie: bob } })
      ).json() as {
        id: string;
      }
    ).id;
    const before = await ruleCount(projectId);
    const res = await create({ ...valid, command: 'x-org', agentId: foreign, model: 'haiku' });
    expect(res.statusCode).toBe(422);
    expect(errorsOf(res)).toEqual([{ pointer: '/agentId', detail: 'Agent not found in this project' }]);
    expect(await ruleCount(projectId)).toBe(before);
    const made = expectContract('rules.create', await create({ ...valid, command: 'x-org-upd' })) as RuleDto;
    const upd = await patch(made.id, { agentId: foreign, model: 'haiku' });
    expect(upd.statusCode).toBe(422);
    expect(errorsOf(upd)).toEqual([{ pointer: '/agentId', detail: 'Agent not found in this project' }]);
    const after = (await allRules()).find((r) => r.id === made.id);
    expect(after).toMatchObject({ agentId: null, model: null });
  });

  it('BR-33: create and update with an agent of the project persist it and a reload shows it', async () => {
    const pid = (await makeProject(t, alice, await installFake(t, alice))).projectId;
    const [a, b] = await withOrg(t.db, orgId, (tx) =>
      tx
        .insert(agents)
        .values([
          { orgId, projectId: pid, name: 'rule-a', model: 'sonnet' },
          { orgId, projectId: pid, name: 'rule-b', model: 'sonnet' },
        ])
        .returning({ id: agents.id }),
    );
    if (!a || !b) throw new Error('no agents');
    const made = expectContract(
      'rules.create',
      await create({ ...promptRule, command: 'br33', agentId: a.id }, pid),
    ) as RuleDto;
    expect(made.agentId).toBe(a.id);
    expect((await allRules(pid)).find((r) => r.id === made.id)?.agentId).toBe(a.id);
    expect(expectContract('rules.update', await patch(made.id, { agentId: b.id }))).toMatchObject({ agentId: b.id });
    expect((await allRules(pid)).find((r) => r.id === made.id)?.agentId).toBe(b.id);
  });

  it('update to null makes the rule follow the default again', async () => {
    const own = await agentOf(projectId);
    const made = expectContract(
      'rules.create',
      await create({ ...valid, command: 'to-null', agentId: own }),
    ) as RuleDto;
    expect(made.agentId).toBe(own);
    const res = await patch(made.id, { agentId: null });
    expect(expectContract('rules.update', res)).toMatchObject({ agentId: null });
    expect((await allRules()).find((r) => r.id === made.id)?.agentId).toBeNull();
  });

  it('BR-41, BR-68: a rule naming an OpenCode agent with no credential is accepted, with no warning field', async () => {
    const pid = (await makeProject(t, alice, await installFake(t, alice))).projectId;
    const [oc] = await withOrg(t.db, orgId, (tx) =>
      tx
        .insert(agents)
        .values({ orgId, projectId: pid, name: 'oc', provider: 'opencode', model: 'x/y' })
        .returning({ id: agents.id }),
    );
    if (!oc) throw new Error('no agent');
    const res = await create({ ...promptRule, command: 'oc-rule', agentId: oc.id }, pid);
    expect(res.statusCode).toBe(201);
    const dto = expectContract('rules.create', res) as RuleDto;
    expect(dto.agentId).toBe(oc.id);
    expect(Object.keys(dto)).not.toContain('warning');
    expect(Object.keys(dto)).not.toContain('warnings');
  });

  it('a project-scoped admin on P1 cannot point a P1 rule at a P2 agent (422) and gets 404 on P2', async () => {
    const p1 = (await makeProject(t, alice, await installFake(t, alice))).projectId;
    const p2 = (await makeProject(t, alice, await installFake(t, alice))).projectId;
    const p2Agent = await agentOf(p2);
    const admin = await inviteAndLogin(t, orgId, 'rules-agent-admin-p1', 'admin', {
      type: 'project',
      projectIds: [p1],
    });
    const bad = await create({ ...promptRule, command: 'p2-agent', agentId: p2Agent }, p1, admin);
    expect(bad.statusCode).toBe(422);
    expect(errorsOf(bad)).toEqual([{ pointer: '/agentId', detail: 'Agent not found in this project' }]);
    expect((await create({ ...promptRule, command: 'p2-out', agentId: p2Agent }, p2, admin)).statusCode).toBe(404);
    const made = expectContract(
      'rules.create',
      await create({ ...promptRule, command: 'p1-ok' }, p1, admin),
    ) as RuleDto;
    const member = await inviteAndLogin(t, orgId, 'rules-agent-member', 'member', { type: 'org' });
    expect((await patch(made.id, { agentId: null }, member)).statusCode).toBe(403);
  });

  it('create with an invalid model is 400 on /model', async () => {
    const res = await create({ ...valid, command: 'm-bad', model: 'my model' });
    expect(res.statusCode).toBe(400);
    expect(errorsOf(res).map((e) => e.pointer)).toContain('/model');
  });
});

describe('rules of both kinds', () => {
  const promptRule = { kind: 'prompt', command: 'triage', labelFilter: [], target: 'issue', enabled: true };

  it('creates a prompt rule without checking skills, keeping line breaks', async () => {
    const res = await create({ ...promptRule, prompt: 'Triage.\nLabel it.' });
    expect(res.statusCode).toBe(201);
    expect(expectContract('rules.create', res)).toMatchObject({
      kind: 'prompt',
      prompt: 'Triage.\nLabel it.',
      skillName: null,
    });
  });

  it('a 4001-character prompt is 400 with pointer /prompt', async () => {
    const res = await create({ ...promptRule, command: 'long', prompt: 'x'.repeat(4001) });
    expect(res.statusCode).toBe(400);
    expect(errorsOf(res).map((e) => e.pointer)).toContain('/prompt');
  });

  it('switches a rule from skill to prompt and back', async () => {
    const made = expectContract('rules.create', await create({ ...valid, command: 'switcher' })) as RuleDto;
    const toPrompt = expectContract('rules.update', await patch(made.id, { kind: 'prompt', prompt: 'p' }));
    expect(toPrompt).toMatchObject({ kind: 'prompt', prompt: 'p', skillName: null });
    const toSkill = expectContract('rules.update', await patch(made.id, { kind: 'skill', skillName: 'fix' }));
    expect(toSkill).toMatchObject({ kind: 'skill', prompt: null, skillName: 'fix' });
    const unknown = await patch(made.id, { kind: 'skill', skillName: 'nope' });
    expect(unknown.statusCode).toBe(422);
    expect(errorsOf(unknown).map((e) => e.pointer)).toEqual(['/skillName']);
  });

  it('a field of the other kind without kind is 422, never 500', async () => {
    const skillRule = expectContract('rules.create', await create({ ...valid, command: 'sk-only' })) as RuleDto;
    const a = await patch(skillRule.id, { prompt: 'p' });
    expect(a.statusCode).toBe(422);
    expect(errorsOf(a).map((e) => e.pointer)).toEqual(['/prompt']);
    const pr = expectContract(
      'rules.create',
      await create({ ...promptRule, command: 'pr-only', prompt: 'p' }),
    ) as RuleDto;
    const b = await patch(pr.id, { skillName: 'fix' });
    expect(b.statusCode).toBe(422);
    expect(errorsOf(b).map((e) => e.pointer)).toEqual(['/skillName']);
  });

  it("edits a prompt rule's text", async () => {
    const pr = expectContract(
      'rules.create',
      await create({ ...promptRule, command: 'editme', prompt: 'old' }),
    ) as RuleDto;
    const res = await patch(pr.id, { prompt: 'new' });
    expect(res.statusCode).toBe(200);
    expect(expectContract('rules.update', res)).toMatchObject({ kind: 'prompt', prompt: 'new' });
  });
});

describe('rule prompt audit', () => {
  it('audit_log payload carries sha256 and bytes, never the prompt text', async () => {
    const promptText = 'use SECRET_PROMPT_DO_NOT_LOG';
    const made = expectContract(
      'rules.create',
      await create({
        kind: 'prompt',
        command: 'audited',
        labelFilter: [],
        target: 'issue',
        enabled: true,
        prompt: promptText,
      }),
    ) as RuleDto;
    const edited = 'edited SECRET_PROMPT_DO_NOT_LOG';
    expect((await patch(made.id, { prompt: edited })).statusCode).toBe(200);
    const rows = await withOrg(t.db, orgId, (tx) =>
      tx.execute(
        sql`select action, payload from audit_log where action in ('POST rules.create', 'PATCH rules.update')`,
      ),
    );
    expect(JSON.stringify(rows.rows)).not.toContain('SECRET_PROMPT_DO_NOT_LOG');
    const payloads = (rows.rows as { action: string; payload: Record<string, unknown> }[]).filter(
      (r) => r.action === 'PATCH rules.update',
    );
    expect(
      payloads.some((r) => r.payload['sha256'] === createHash('sha256').update(edited, 'utf8').digest('hex')),
    ).toBe(true);
  });
});

describe('prompt preview', () => {
  const preview = (id = projectId, cookie = alice) =>
    t.app.inject({ method: 'GET', url: `/api/projects/${id}/rules/prompt-preview`, headers: { cookie } });

  it('returns every appended line with the project repo and placeholders', async () => {
    const res = await preview();
    expect(res.statusCode).toBe(200);
    const dto = expectContract('rules.promptPreview', res) as { systemLines: string[] };
    const [row] = await withOrg(t.db, orgId, (tx) =>
      tx.select({ repoPath: projects.repoPath }).from(projects).where(eq(projects.id, projectId)),
    );
    expect(dto.systemLines).toEqual(
      promptSystemLines({ ticket: PROMPT_PREVIEW_TICKET, repoPath: row?.repoPath ?? '', args: PROMPT_PREVIEW_ARGS }),
    );
    expect(dto.systemLines).toHaveLength(5);
    expect(dto.systemLines.at(-1)).toContain('agentdesk-status');
  });

  it('is 401 signed out and 404 for another org project', async () => {
    expect((await preview(projectId, '')).statusCode).toBe(401);
    expect((await preview(projectId, bob)).statusCode).toBe(404);
  });
});

describe('paged rules', () => {
  const seed = async (pid: string, cookie: string, org: string, count: number, tieFrom: number) => {
    const agent = (
      (await t.app.inject({ method: 'GET', url: `/api/projects/${pid}/agent`, headers: { cookie } })).json() as {
        id: string;
      }
    ).id;
    const start = Date.parse('2026-01-01T00:00:00Z');
    await withOrg(t.db, org, (tx) =>
      tx.insert(rulesTable).values(
        Array.from({ length: count }, (_, i) => ({
          orgId: org,
          projectId: pid,
          command: `r${String(i + 1).padStart(2, '0')}`,
          labelFilter: [],
          target: 'issue',
          agentId: agent,
          prompt: 'p',
          // Rules from `tieFrom` on share one timestamp, so only the id breaks the tie.
          createdAt: new Date(start + Math.min(i, tieFrom) * 1000),
          enabled: true,
        })),
      ),
    );
  };
  let pid: string;

  beforeAll(async () => {
    pid = (await makeProject(t, alice, await installFake(t, alice))).projectId;
    await seed(pid, alice, orgId, 24, 20);
    // Another org's rules must not count towards alice's total.
    const bobProject = (await makeProject(t, bob, await installFake(t, bob))).projectId;
    await seed(bobProject, bob, bobOrgId, 5, 5);
  });

  const page = async (query: string) => expectContract('rules.list', await list(pid, alice, query)) as Page<RuleDto>;

  it('page 1 holds 20 rules, oldest created first, with the real total', async () => {
    const p = await page('');
    expect(p).toMatchObject({ page: 1, pageSize: 20, total: 24 });
    expect(p.items).toHaveLength(20);
    expect(p.items.slice(0, 3).map((r) => r.command)).toEqual(['r01', 'r02', 'r03']);
  });

  it('rules created in the same instant come in id order, and the pages cover every rule once', async () => {
    const first = await page('?pageSize=10');
    const second = await page('?pageSize=10&page=2');
    const third = await page('?pageSize=10&page=3');
    const all = [...first.items, ...second.items, ...third.items];
    expect(all).toHaveLength(24);
    expect(new Set(all.map((r) => r.id)).size).toBe(24);
    const tied = all.slice(20);
    expect(tied.map((r) => r.id)).toEqual([...tied.map((r) => r.id)].sort());
  });

  it('page 2 holds the last 4', async () => {
    const p = await page('?page=2');
    expect(p).toMatchObject({ page: 2, total: 24 });
    expect(p.items).toHaveLength(4);
  });

  it('a page past the last is 200 with no items and the real total', async () => {
    expect(await page('?page=9')).toMatchObject({ items: [], page: 9, total: 24 });
  });

  it('out-of-range page or pageSize is 400', async () => {
    for (const q of ['?page=0', '?page=2147483648', '?pageSize=0', '?pageSize=101', '?page=x'])
      expect((await list(pid, alice, q)).statusCode).toBe(400);
  });

  it('another org rules are not counted, and a foreign project is 404', async () => {
    expect((await page('')).total).toBe(24);
    expect((await list(pid, bob)).statusCode).toBe(404);
  });
});

describe('rules: permission (BR-33, BR-29)', () => {
  const putSkill = (id: string, cookie: string) =>
    t.app.inject({
      method: 'PUT',
      url: `/api/projects/${id}/skills/fix`,
      headers: { cookie },
      payload: { body: 'x', message: 'm' },
    });
  const remove = (id: string, cookie: string) =>
    t.app.inject({ method: 'DELETE', url: `/api/rules/${id}`, headers: { cookie } });

  /** A project of its own with the skill `fix` and one rule, so each test starts from a known list. */
  async function projectWithRule(): Promise<{ pid: string; rule: RuleDto }> {
    const pid = (await makeProject(t, alice, await installFake(t, alice))).projectId;
    expect((await putSkill(pid, alice)).statusCode).toBe(200);
    const rule = expectContract('rules.create', await create({ ...valid, command: 'seed' }, pid)) as RuleDto;
    return { pid, rule };
  }

  it('TC-33.3: a member cannot create a rule; the rule list is unchanged', async () => {
    const { pid, rule } = await projectWithRule();
    const member = await inviteAndLogin(t, orgId, 'rules-member-create', 'member', { type: 'org' });
    const before = await allRules(pid);
    const res = await create({ ...valid, command: 'member-made' }, pid, member);
    expect(res.statusCode).toBe(403);
    expect(await allRules(pid)).toEqual(before);
    expect(before.map((r) => r.id)).toEqual([rule.id]);
  });

  it('TC-33.4: a member cannot update a rule; it is unchanged on reread', async () => {
    const { pid, rule } = await projectWithRule();
    const member = await inviteAndLogin(t, orgId, 'rules-member-update', 'member', { type: 'org' });
    const res = await patch(rule.id, { enabled: false, labelFilter: ['x'] }, member);
    expect(res.statusCode).toBe(403);
    expect((await allRules(pid)).find((r) => r.id === rule.id)).toEqual(rule);
  });

  it('TC-33.5: a member cannot remove a rule; it is still in the list', async () => {
    const { pid, rule } = await projectWithRule();
    const member = await inviteAndLogin(t, orgId, 'rules-member-remove', 'member', { type: 'org' });
    const res = await remove(rule.id, member);
    expect(res.statusCode).toBe(403);
    expect((await allRules(pid)).map((r) => r.id)).toEqual([rule.id]);
  });

  it('TC-33.9: a member cannot list the rules (issue 216), an admin can', async () => {
    const { pid, rule } = await projectWithRule();
    const member = await inviteAndLogin(t, orgId, 'rules-member-list', 'member', { type: 'org' });
    expect((await list(pid, member)).statusCode).toBe(403);
    const res = await list(pid, alice);
    expect(res.statusCode).toBe(200);
    expect((expectContract('rules.list', res) as Page<RuleDto>).items.map((r) => r.id)).toEqual([rule.id]);
  });

  it('TC-29.2: an admin on P1 only can create a rule on P1 and gets 404 on a project out of scope', async () => {
    const { pid } = await projectWithRule();
    const other = (await makeProject(t, alice, await installFake(t, alice))).projectId;
    const admin = await inviteAndLogin(t, orgId, 'rules-admin-p1', 'admin', { type: 'project', projectIds: [pid] });
    const res = await create({ ...valid, command: 'admin-made' }, pid, admin);
    expect(res.statusCode).toBe(201);
    expect(expectContract('rules.create', res)).toMatchObject({ command: 'admin-made', projectId: pid });
    expect((await create({ ...valid, command: 'admin-made' }, other, admin)).statusCode).toBe(404);
  });
});
