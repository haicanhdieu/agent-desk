import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { projects, runs, withOrg } from '@agentdesk/db';
import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { PROMPT_PREVIEW_ARGS, PROMPT_PREVIEW_TICKET, promptSystemLines } from '@agentdesk/core';
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

const valid = { kind: 'skill', command: 'fix', labelFilter: ['bug'], target: 'issue', skillName: 'fix', enabled: true };
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
    expect(dto.systemLines).toHaveLength(4);
    expect(dto.systemLines.at(-1)).toContain('agentdesk-status');
  });

  it('is 401 signed out and 404 for another org project', async () => {
    expect((await preview(projectId, '')).statusCode).toBe(401);
    expect((await preview(projectId, bob)).statusCode).toBe(404);
  });
});
