import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApplicationFailure, WorkflowNotFoundError, WorkflowUpdateFailedError } from '@temporalio/client';
import { eq, sql } from 'drizzle-orm';
import { UPDATE } from '@agentdesk/core';
import { agents, inboundEvents, runEvents, runTranscriptEntries, runs, withOrg } from '@agentdesk/db';
import type {
  IgnoredEventDto,
  RunDto,
  RunListResponse,
  RunLogResponse,
  RunTranscriptResponse,
} from '@agentdesk/contracts';
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
});
afterAll(async () => {
  await t.close();
});

let seq = 0;
async function insertRun(
  over: Partial<typeof runs.$inferInsert> = {},
  project = projectId,
): Promise<typeof runs.$inferSelect> {
  seq += 1;
  return withOrg(t.db, orgId, async (tx) => {
    const [row] = await tx
      .insert(runs)
      .values({
        orgId,
        projectId: project,
        command: 'fix',
        skillName: 'fix',
        ticketRef: `t-${seq}`,
        ticketKind: 'issue',
        checkoutRef: 'refs/heads/main',
        triggerSource: 'webhook',
        ...over,
      })
      .returning();
    if (!row) throw new Error('no row');
    return row;
  });
}

const get = (url: string, cookie = alice) => t.app.inject({ method: 'GET', url, headers: { cookie } });
const post = (url: string, cookie = alice) => t.app.inject({ method: 'POST', url, headers: { cookie } });
const listRuns = (query: string, id = projectId, cookie = alice) => get(`/api/projects/${id}/runs${query}`, cookie);

describe('runs list', () => {
  it('needs_you returns only idle runs; other filters partition by status', async () => {
    const pid = (await makeProject(t, alice, await installFake(t, alice))).projectId;
    for (const status of ['queued', 'starting', 'running', 'idle', 'succeeded', 'failed', 'cancelled', 'timed_out']) {
      await insertRun({ status }, pid);
    }
    const statuses = async (filter: string) =>
      (expectContract('runs.list', await listRuns(`?filter=${filter}`, pid)) as RunListResponse).items
        .map((r) => r.status)
        .sort();
    expect(await statuses('needs_you')).toEqual(['idle']);
    expect(await statuses('active')).toEqual(['idle', 'running', 'starting']);
    expect(await statuses('queued')).toEqual(['queued']);
    expect(await statuses('ended')).toEqual(['cancelled', 'failed', 'succeeded', 'timed_out']);
    expect(await statuses('all')).toHaveLength(8);
    expect((expectContract('runs.list', await listRuns('', pid)) as RunListResponse).items).toHaveLength(8);
  });

  it('filters by ticket and is scoped to the org', async () => {
    const pid = (await makeProject(t, alice, await installFake(t, alice))).projectId;
    await insertRun({ ticketRef: 'abc' }, pid);
    await insertRun({ ticketRef: 'def' }, pid);
    const res = expectContract('runs.list', await listRuns('?ticket=abc', pid)) as RunListResponse;
    expect(res.items.map((r) => r.ticket.ref)).toEqual(['abc']);
    expect((await listRuns('', pid, bob)).statusCode).toBe(404);
  });

  it('keyset pagination yields disjoint, complete pages even with identical queued_at', async () => {
    const pid = (await makeProject(t, alice, await installFake(t, alice))).projectId;
    const same = new Date('2026-01-01T00:00:00.123Z');
    const earlier = new Date('2025-12-31T00:00:00.000Z');
    const ids = new Set<string>();
    for (let i = 0; i < 7; i += 1) ids.add((await insertRun({ queuedAt: same }, pid)).id);
    for (let i = 0; i < 2; i += 1) ids.add((await insertRun({ queuedAt: earlier }, pid)).id);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await listRuns(`?limit=2${cursor ? `&cursor=${cursor}` : ''}`, pid);
      const page = expectContract('runs.list', res) as RunListResponse;
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((r) => r.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 20);
    expect(pages).toBe(5);
    expect(new Set(seen).size).toBe(seen.length);
    expect(new Set(seen)).toEqual(ids);
    // queued_at desc: the identical-timestamp rows come first, ties by id.
    const tied = seen.slice(0, 7);
    expect(tied).toEqual([...tied].sort());
  });

  it('tampered cursors with a valid shape but impossible date or bad uuid are 400 /cursor, never 500', async () => {
    const uuid = randomUUID();
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const bad = [
      { t: '2026-99-99T99:99:99.000000Z', i: uuid },
      { t: '2026-02-30T00:00:00.000000Z', i: uuid },
      { t: '2026-01-01T25:00:00.000000Z', i: uuid },
      { t: '2026-01-01T00:60:00.000000Z', i: uuid },
      { t: '2026-01-01T00:00:61.000000Z', i: uuid },
      { t: '2026-13-01T00:00:00.000000Z', i: uuid },
      { t: '2026-01-01T00:00:00.000000Z', i: 'not-a-uuid' },
      { t: '2026-01-01T00:00:00.000000Z', i: `${uuid}x` },
    ];
    for (const c of bad) {
      const res = await listRuns(`?cursor=${enc(c)}`);
      expect(res.statusCode, JSON.stringify(c)).toBe(400);
      expect((res.json() as { errors: { pointer: string }[] }).errors[0]?.pointer).toBe('/cursor');
    }
    const ok = await listRuns(`?cursor=${enc({ t: '2026-02-28T23:59:59.999999Z', i: uuid })}`);
    expect(ok.statusCode).toBe(200);
  });

  it('malformed cursor is 400 with pointer /cursor; limit above the max is rejected', async () => {
    for (const bad of ['!!!', 'e30', Buffer.from('{"t":"x","i":"y"}').toString('base64url')]) {
      const res = await listRuns(`?cursor=${bad}`);
      expect(res.statusCode).toBe(400);
      expect((res.json() as { errors: { pointer: string }[] }).errors[0]?.pointer).toBe('/cursor');
    }
    expect((await listRuns('?limit=1000')).statusCode).toBe(400);
  });
});

describe('run reads', () => {
  it('get, byNumber and DTO mapping', async () => {
    const run = await insertRun({ args: 'extra text', costUsd: '1.2500', ticketNumber: 7, ticketTitle: 'Title' });
    const dto = expectContract('runs.get', await get(`/api/runs/${run.id}`)) as RunDto;
    expect(dto).toMatchObject({
      id: run.id,
      projectId,
      args: 'extra text',
      costUsd: 1.25,
      ticket: { ref: run.ticketRef, number: 7, title: 'Title' },
    });
    expect(dto.failureStage).toBeNull();
    expect(dto.setupScriptVersion).toBeNull();
    const byNum = expectContract('runs.byNumber', await get(`/api/projects/${projectId}/runs/${run.number}`)) as RunDto;
    expect(byNum.id).toBe(run.id);
    expect((await get(`/api/projects/${projectId}/runs/999999`)).statusCode).toBe(404);
  });

  it('a run DTO carries ruleKind, prompt and finalPrompt', async () => {
    const p = await insertRun({ skillName: null, prompt: 'p', finalPrompt: 'p\nTicket: x' });
    expect(expectContract('runs.get', await get(`/api/runs/${p.id}`))).toMatchObject({
      ruleKind: 'prompt',
      prompt: 'p',
      finalPrompt: 'p\nTicket: x',
    });
    const s = await insertRun();
    expect(expectContract('runs.get', await get(`/api/runs/${s.id}`))).toMatchObject({
      ruleKind: 'skill',
      prompt: null,
      finalPrompt: null,
    });
  });

  it('a run DTO carries its agent idle end, the default when the agent is gone', async () => {
    const agentId = (
      await withOrg(t.db, orgId, (tx) =>
        tx.select({ id: agents.id }).from(agents).where(eq(agents.projectId, projectId)).limit(1),
      )
    )[0]?.id;
    if (!agentId) throw new Error('no agent');
    await withOrg(t.db, orgId, (tx) => tx.update(agents).set({ idleEndSeconds: 600 }).where(eq(agents.id, agentId)));
    const r = await insertRun({ agentId });
    expect(expectContract('runs.get', await get(`/api/runs/${r.id}`))).toMatchObject({ idleEndSeconds: 600 });
    const orphan = await insertRun({ agentId: null });
    expect(expectContract('runs.get', await get(`/api/runs/${orphan.id}`))).toMatchObject({ idleEndSeconds: 1800 });
  });

  it('a run carries its agent paused keep time, or the default for a deleted agent', async () => {
    const agentId = (
      await withOrg(t.db, orgId, (tx) =>
        tx.select({ id: agents.id }).from(agents).where(eq(agents.projectId, projectId)).limit(1),
      )
    )[0]?.id;
    if (!agentId) throw new Error('no agent');
    await withOrg(t.db, orgId, (tx) =>
      tx.update(agents).set({ pausedKeepSeconds: 7200 }).where(eq(agents.id, agentId)),
    );
    const r = await insertRun({ agentId });
    expect(expectContract('runs.get', await get(`/api/runs/${r.id}`))).toMatchObject({ pausedKeepSeconds: 7200 });
    const orphan = await insertRun({ agentId: null });
    expect(expectContract('runs.get', await get(`/api/runs/${orphan.id}`))).toMatchObject({
      pausedKeepSeconds: 604800,
    });
  });

  it('list items omit the prompt texts that run detail carries', async () => {
    const pid = (await makeProject(t, alice, await installFake(t, alice))).projectId;
    const p = await insertRun({ skillName: null, prompt: 'p', finalPrompt: 'p\nTicket: x' }, pid);
    await insertRun({}, pid);
    const res = await listRuns('', pid);
    expectContract('runs.list', res);
    const raw = (res.json() as { items: Record<string, unknown>[] }).items;
    expect(raw).toHaveLength(2);
    for (const item of raw) {
      expect(item).not.toHaveProperty('prompt');
      expect(item).not.toHaveProperty('finalPrompt');
    }
    expect(raw.map((r) => r.ruleKind).sort()).toEqual(['prompt', 'skill']);
    expect(await get(`/api/runs/${p.id}`).then((r) => r.json())).toMatchObject({
      prompt: 'p',
      finalPrompt: 'p\nTicket: x',
    });
  });

  it("other org's resources are 404", async () => {
    const run = await insertRun();
    expect((await get(`/api/projects/${projectId}/runs/${run.number}`, bob)).statusCode).toBe(404);
    expect((await get(`/api/runs/${run.id}`, bob)).statusCode).toBe(404);
    expect((await get(`/api/runs/${run.id}/log`, bob)).statusCode).toBe(404);
    expect((await get(`/api/projects/${projectId}/ignored`, bob)).statusCode).toBe(404);
    expect((await post(`/api/runs/${run.id}/cancel`, bob)).statusCode).toBe(404);
    expect((await get(`/api/runs/${randomUUID()}`)).statusCode).toBe(404);
    expect((await get('/api/runs/not-a-uuid')).statusCode).toBe(400);
    expect((await get(`/api/runs/${run.id}`, '')).statusCode).toBe(401);
  });

  it('log returns stored events ascending by seq and is capped to the newest 5000', async () => {
    const run = await insertRun();
    await withOrg(t.db, orgId, async (tx) => {
      await tx.insert(runEvents).values([
        { orgId, runId: run.id, seq: 3, type: 'scrollback', payload: { text: 'c' } },
        { orgId, runId: run.id, seq: 1, type: 'lifecycle', payload: { phase: 'start' } },
        { orgId, runId: run.id, seq: 2, type: 'status', payload: { status: 'running' } },
      ]);
    });
    const log = expectContract('runs.log', await get(`/api/runs/${run.id}/log`)) as RunLogResponse;
    expect(log.items.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(log.items[0]).toMatchObject({ type: 'lifecycle', payload: { phase: 'start' } });

    const big = await insertRun();
    await withOrg(t.db, orgId, (tx) =>
      tx.execute(sql`insert into run_events (org_id, run_id, seq, type, payload)
        select ${orgId}::uuid, ${big.id}::uuid, g, 'scrollback', '{}'::jsonb from generate_series(1, 5003) g`),
    );
    const capped = expectContract('runs.log', await get(`/api/runs/${big.id}/log`)) as RunLogResponse;
    expect(capped.items).toHaveLength(5000);
    expect(capped.items[0]?.seq).toBe(4);
    expect(capped.items[4999]?.seq).toBe(5003);
  });
});

describe('resume, paused and kept sessions', () => {
  const later = () => new Date(Date.now() + 3_600_000);
  const earlier = () => new Date(Date.now() - 3_600_000);

  async function agentWithCredential(set: boolean): Promise<string> {
    const [row] = await withOrg(t.db, orgId, (tx) =>
      tx.select({ id: agents.id }).from(agents).where(eq(agents.projectId, projectId)).limit(1),
    );
    if (!row) throw new Error('no agent');
    await withOrg(t.db, orgId, (tx) =>
      tx
        .update(agents)
        .set(
          set
            ? { credentialSecretName: 'org-x-agent-y', credentialType: 'api_key' }
            : { credentialSecretName: null, credentialType: null },
        )
        .where(eq(agents.id, row.id)),
    );
    return row.id;
  }

  it('resume on a paused run is 204 and sends the resumeRun update', async () => {
    const agentId = await agentWithCredential(true);
    const run = await insertRun({ status: 'paused', workflowId: 'run-x', agentId, sessionExpiresAt: later() });
    t.temporal.reset();
    const res = await post(`/api/runs/${run.id}/resume`);
    expect(res.statusCode).toBe(204);
    expectContract('runs.resume', res);
    expect(t.temporal.callsOfKind('update')).toMatchObject([{ workflowId: `run-${run.id}`, args: [UPDATE.resumeRun] }]);
  });

  it('resume on a succeeded run with a kept session is 204', async () => {
    const agentId = await agentWithCredential(true);
    const run = await insertRun({ status: 'succeeded', workflowId: 'run-x', agentId, sessionExpiresAt: later() });
    t.temporal.reset();
    expect((await post(`/api/runs/${run.id}/resume`)).statusCode).toBe(204);
    expect(t.temporal.callsOfKind('update')).toHaveLength(1);
  });

  it.each([
    ['an idle run whose session is ending', { status: 'idle' }],
    ['a running run whose session is ending', { status: 'running' }],
  ])('resume on %s is 204 and sends the resumeRun update (the workflow queues it)', async (_name, over) => {
    const agentId = await agentWithCredential(true);
    const run = await insertRun({ ...over, workflowId: 'run-x', agentId, sessionEndingAt: new Date() });
    t.temporal.reset();
    const res = await post(`/api/runs/${run.id}/resume`);
    expect(res.statusCode).toBe(204);
    expect(t.temporal.callsOfKind('update')).toMatchObject([{ workflowId: `run-${run.id}`, args: [UPDATE.resumeRun] }]);
  });

  it('resume on a run whose session is ending but has no agent credential is still a 409', async () => {
    const agentId = await agentWithCredential(false);
    const run = await insertRun({ status: 'idle', workflowId: 'run-x', agentId, sessionEndingAt: new Date() });
    t.temporal.reset();
    const res = await post(`/api/runs/${run.id}/resume`);
    expect(res.statusCode).toBe(409);
    expect(t.temporal.calls).toHaveLength(0);
  });

  it.each([
    ['an expired session', { status: 'succeeded', sessionExpiresAt: earlier() }],
    ['no session', { status: 'succeeded', sessionExpiresAt: null }],
    ['a running run (session not ending)', { status: 'running', sessionExpiresAt: null }],
    ['an idle run (session not ending)', { status: 'idle', sessionExpiresAt: null }],
    ['a failed run whose sessionEndingAt is set', { status: 'failed', sessionEndingAt: new Date() }],
  ])('resume on %s is a 409 and sends nothing', async (_name, over) => {
    const agentId = await agentWithCredential(true);
    const run = await insertRun({ ...over, workflowId: 'run-x', agentId });
    t.temporal.reset();
    const res = await post(`/api/runs/${run.id}/resume`);
    expect(res.statusCode).toBe(409);
    expect((res.json() as { detail: string }).detail).toBe(
      'Only a paused run, or a finished run whose session is still kept, can be resumed',
    );
    expect(t.temporal.calls).toHaveLength(0);
  });

  it("resume on another org's run is 404 and without a session is 401", async () => {
    const agentId = await agentWithCredential(true);
    const run = await insertRun({ status: 'paused', workflowId: 'run-x', agentId, sessionExpiresAt: later() });
    t.temporal.reset();
    expect((await post(`/api/runs/${run.id}/resume`, bob)).statusCode).toBe(404);
    const anon = await t.app.inject({ method: 'POST', url: `/api/runs/${run.id}/resume` });
    expect(anon.statusCode).toBe(401);
    expect(t.temporal.calls).toHaveLength(0);
  });

  it('resume answered NotResumable by the workflow is a 409 with its message', async () => {
    const agentId = await agentWithCredential(true);
    const run = await insertRun({ status: 'paused', workflowId: 'run-x', agentId, sessionExpiresAt: later() });
    t.temporal.reset();
    const message = 'This run is already being resumed';
    t.temporal.updateFailure = () =>
      new WorkflowUpdateFailedError('Workflow Update failed', ApplicationFailure.nonRetryable(message, 'NotResumable'));
    const res = await post(`/api/runs/${run.id}/resume`);
    expect(res.statusCode).toBe(409);
    expect((res.json() as { detail: string }).detail).toBe(message);
  });

  it('resume with the workflow gone, or completed mid-update, is a 409 Run is no longer active', async () => {
    const agentId = await agentWithCredential(true);
    const run = await insertRun({ status: 'paused', workflowId: 'run-x', agentId, sessionExpiresAt: later() });
    for (const failure of [
      new WorkflowNotFoundError('gone', 'x', undefined),
      new WorkflowUpdateFailedError(
        'Workflow Update failed',
        ApplicationFailure.nonRetryable('completed', 'AcceptedUpdateCompletedWorkflow'),
      ),
    ]) {
      t.temporal.reset();
      t.temporal.updateFailure = () => failure;
      const res = await post(`/api/runs/${run.id}/resume`);
      expect(res.statusCode).toBe(409);
      expect((res.json() as { detail: string }).detail).toBe('Run is no longer active');
    }
  });

  it('resume failing for any other reason is not hidden as a 409', async () => {
    const agentId = await agentWithCredential(true);
    const run = await insertRun({ status: 'paused', workflowId: 'run-x', agentId, sessionExpiresAt: later() });
    t.temporal.reset();
    t.temporal.updateFailure = () => new Error('temporal is down');
    expect((await post(`/api/runs/${run.id}/resume`)).statusCode).toBe(500);
  });

  it('resume when the agent credential was removed is a 409 and sends nothing', async () => {
    const agentId = await agentWithCredential(false);
    const run = await insertRun({ status: 'paused', workflowId: 'run-x', agentId, sessionExpiresAt: later() });
    const noAgent = await insertRun({ status: 'paused', workflowId: 'run-x', sessionExpiresAt: later() });
    for (const id of [run.id, noAgent.id]) {
      t.temporal.reset();
      const res = await post(`/api/runs/${id}/resume`);
      expect(res.statusCode).toBe(409);
      expect((res.json() as { detail: string }).detail).toBe(
        'This project has no agent credential, so the run cannot be resumed',
      );
      expect(t.temporal.calls).toHaveLength(0);
    }
    await agentWithCredential(true);
  });

  it('finish on a paused run is 202 via the finish update', async () => {
    const run = await insertRun({ status: 'paused', workflowId: 'run-x' });
    t.temporal.reset();
    expect((await post(`/api/runs/${run.id}/finish`)).statusCode).toBe(202);
    expect(t.temporal.callsOfKind('update')).toMatchObject([{ workflowId: `run-${run.id}`, args: [UPDATE.finishRun] }]);
  });

  it('cancel on a succeeded run with a kept session stays a 409', async () => {
    const run = await insertRun({ status: 'succeeded', sessionExpiresAt: later() });
    t.temporal.reset();
    const res = await post(`/api/runs/${run.id}/cancel`);
    expect(res.statusCode).toBe(409);
    expect((res.json() as { detail: string }).detail).toBe('Run already succeeded');
  });

  it('list needs_you returns idle and paused runs; ended returns an expired run', async () => {
    const { projectId: pid } = await makeProject(t, alice, await installFake(t, alice));
    const idle = await insertRun({ status: 'idle' }, pid);
    const paused = await insertRun({ status: 'paused' }, pid);
    const expired = await insertRun({ status: 'expired' }, pid);
    await insertRun({ status: 'running' }, pid);
    const needs = (await listRuns('?filter=needs_you', pid)).json() as RunListResponse;
    expect(needs.items.map((r) => r.id).sort()).toEqual([idle.id, paused.id].sort());
    const ended = (await listRuns('?filter=ended', pid)).json() as RunListResponse;
    expect(ended.items.map((r) => r.id)).toEqual([expired.id]);
  });
});

describe('cancel and finish', () => {
  it('finish on a running run is a 409 problem and sends nothing', async () => {
    const run = await insertRun({ status: 'running', workflowId: 'x' });
    t.temporal.reset();
    const res = await post(`/api/runs/${run.id}/finish`);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ status: 409 });
    expect(t.temporal.calls).toHaveLength(0);
  });

  it('finish on an idle run is 202 and runs the finish update; status is untouched', async () => {
    const run = await insertRun({ status: 'idle', workflowId: `run-x` });
    t.temporal.reset();
    const res = await post(`/api/runs/${run.id}/finish`);
    expect(res.statusCode).toBe(202);
    expectContract('runs.finish', res);
    expect(t.temporal.callsOfKind('update')).toMatchObject([{ workflowId: `run-${run.id}`, args: [UPDATE.finishRun] }]);
    expect(t.temporal.callsOfKind('signal')).toHaveLength(0);
    expect(((await get(`/api/runs/${run.id}`)).json() as RunDto).status).toBe('idle');
  });

  it('finish in done → 202 (accepted) via the finish update', async () => {
    const run = await insertRun({ status: 'done', workflowId: `run-x` });
    t.temporal.reset();
    const res = await post(`/api/runs/${run.id}/finish`);
    expect(res.statusCode).toBe(202);
    expect(t.temporal.callsOfKind('update')).toMatchObject([{ workflowId: `run-${run.id}`, args: [UPDATE.finishRun] }]);
  });

  it('finish rejected by the workflow → 409 with its message', async () => {
    const run = await insertRun({ status: 'idle', workflowId: `run-x` });
    t.temporal.reset();
    const message = 'Only a run that needs you or is done can be finished (phase is running)';
    t.temporal.updateFailure = () =>
      new WorkflowUpdateFailedError(
        'Workflow Update failed',
        ApplicationFailure.nonRetryable(message, 'NotFinishable'),
      );
    const res = await post(`/api/runs/${run.id}/finish`);
    expect(res.statusCode).toBe(409);
    expect((res.json() as { detail: string }).detail).toBe(message);
  });

  it('finish when the workflow has just completed → 409 Run is no longer active', async () => {
    const run = await insertRun({ status: 'idle', workflowId: `run-x` });
    t.temporal.reset();
    t.temporal.updateFailure = (id) => new WorkflowNotFoundError('gone', id ?? '', undefined);
    const res = await post(`/api/runs/${run.id}/finish`);
    expect(res.statusCode).toBe(409);
    expect((res.json() as { detail: string }).detail).toBe('Run is no longer active');
  });

  it('finish accepted, then the workflow completes before answering → 409 Run is no longer active', async () => {
    const run = await insertRun({ status: 'idle', workflowId: `run-x` });
    t.temporal.reset();
    t.temporal.updateFailure = () =>
      new WorkflowUpdateFailedError(
        'Workflow Update failed',
        ApplicationFailure.nonRetryable('completed', 'AcceptedUpdateCompletedWorkflow'),
      );
    const res = await post(`/api/runs/${run.id}/finish`);
    expect(res.statusCode).toBe(409);
    expect((res.json() as { detail: string }).detail).toBe('Run is no longer active');
  });

  it('finish failing for any other reason is not hidden as a 409', async () => {
    const run = await insertRun({ status: 'idle', workflowId: `run-x` });
    for (const failure of [
      new WorkflowUpdateFailedError('Workflow Update failed', ApplicationFailure.nonRetryable('boom', 'SomethingElse')),
      new Error('temporal is down'),
    ]) {
      t.temporal.reset();
      t.temporal.updateFailure = () => failure;
      const res = await post(`/api/runs/${run.id}/finish`);
      expect(res.statusCode).toBe(500);
    }
  });

  it('cancel on a final run is 409', async () => {
    const run = await insertRun({ status: 'succeeded' });
    t.temporal.reset();
    expect((await post(`/api/runs/${run.id}/cancel`)).statusCode).toBe(409);
    expect(t.temporal.calls).toHaveLength(0);
  });

  it('cancel on a started run signals cancel to run-<id>', async () => {
    const run = await insertRun({ status: 'running', workflowId: 'w' });
    t.temporal.reset();
    const res = await post(`/api/runs/${run.id}/cancel`);
    expect(res.statusCode).toBe(202);
    expectContract('runs.cancel', res);
    expect(t.temporal.callsOfKind('signal')).toMatchObject([{ workflowId: `run-${run.id}`, args: ['cancel'] }]);
    expect(((await get(`/api/runs/${run.id}`)).json() as RunDto).status).toBe('running');
  });

  it('cancel on a queued run whose workflow is not started yet uses signalWithStart(cancel)', async () => {
    const run = await insertRun({ status: 'queued' });
    t.temporal.reset();
    const res = await post(`/api/runs/${run.id}/cancel`);
    expect(res.statusCode).toBe(202);
    const [call] = t.temporal.callsOfKind('signalWithStart');
    expect(call?.workflowId).toBe(`run-${run.id}`);
    expect(call?.args[0]).toBe('RunWorkflow');
    expect(call?.args[1]).toMatchObject({
      signal: 'cancel',
      args: [{ orgId, runId: run.id }],
      taskQueue: 'agentdesk',
    });
    expect(t.temporal.callsOfKind('signal')).toHaveLength(0);
  });

  it('cancel on a queued run with a started workflow is a plain signal', async () => {
    const run = await insertRun({ status: 'queued', workflowId: 'w' });
    t.temporal.reset();
    expect((await post(`/api/runs/${run.id}/cancel`)).statusCode).toBe(202);
    expect(t.temporal.callsOfKind('signal')).toHaveLength(1);
    expect(t.temporal.callsOfKind('signalWithStart')).toHaveLength(0);
  });

  it('a workflow that has just completed is reported as 409, not 500', async () => {
    const run = await insertRun({ status: 'running', workflowId: 'w' });
    const original = t.temporal.client.workflow.getHandle;
    t.temporal.client.workflow.getHandle = ((id: string) => ({
      ...original(id),
      signal: async () => {
        throw new WorkflowNotFoundError('gone', id, undefined);
      },
    })) as typeof original;
    try {
      expect((await post(`/api/runs/${run.id}/cancel`)).statusCode).toBe(409);
    } finally {
      t.temporal.client.workflow.getHandle = original;
    }
  });
});

describe('stop session', () => {
  const updateCall = (id: string) => [{ workflowId: `run-${id}`, args: [UPDATE.stopSession] }];
  const failWith = (type: string, message: string) => () =>
    new WorkflowUpdateFailedError('Workflow Update failed', ApplicationFailure.nonRetryable(message, type));

  it.each(['running', 'idle', 'done'])('stop on a %s run is 202 via the stopSession update', async (status) => {
    const run = await insertRun({ status, workflowId: 'x' });
    t.temporal.reset();
    const res = await post(`/api/runs/${run.id}/stop`);
    expect(res.statusCode).toBe(202);
    expectContract('runs.stop', res);
    expect(t.temporal.callsOfKind('update')).toMatchObject(updateCall(run.id));
    expect(t.temporal.callsOfKind('signal')).toHaveLength(0);
    expect(((await get(`/api/runs/${run.id}`)).json() as RunDto).status).toBe(status);
  });

  it.each(['paused', 'queued', 'starting', 'succeeded', 'failed', 'cancelled'])(
    'stop on a %s run is a 409 "Only a live session can be stopped" and sends nothing',
    async (status) => {
      const run = await insertRun({ status, workflowId: 'x' });
      t.temporal.reset();
      const res = await post(`/api/runs/${run.id}/stop`);
      expect(res.statusCode).toBe(409);
      expect((res.json() as { detail: string }).detail).toBe('Only a live session can be stopped');
      expect(t.temporal.calls).toHaveLength(0);
    },
  );

  it('stop while sessionEndingAt is set is a 409 "The session is already ending" and sends nothing', async () => {
    const run = await insertRun({ status: 'idle', workflowId: 'x', sessionEndingAt: new Date() });
    t.temporal.reset();
    const res = await post(`/api/runs/${run.id}/stop`);
    expect(res.statusCode).toBe(409);
    expect((res.json() as { detail: string }).detail).toBe('The session is already ending');
    expect(t.temporal.calls).toHaveLength(0);
  });

  it('stop answered NotStoppable is a 409 with its message', async () => {
    const run = await insertRun({ status: 'running', workflowId: 'x' });
    t.temporal.reset();
    t.temporal.updateFailure = failWith('NotStoppable', 'The agent has not started yet');
    const res = await post(`/api/runs/${run.id}/stop`);
    expect(res.statusCode).toBe(409);
    expect((res.json() as { detail: string }).detail).toBe('The agent has not started yet');
  });

  it.each([
    ['the workflow is gone', (id?: string) => new WorkflowNotFoundError('gone', id ?? '', undefined)],
    ['it completed mid-update', () => failWith('AcceptedUpdateCompletedWorkflow', 'completed')()],
  ])('stop when %s is a 409 Run is no longer active', async (_name, failure) => {
    const run = await insertRun({ status: 'running', workflowId: 'x' });
    t.temporal.reset();
    t.temporal.updateFailure = failure;
    const res = await post(`/api/runs/${run.id}/stop`);
    expect(res.statusCode).toBe(409);
    expect((res.json() as { detail: string }).detail).toBe('Run is no longer active');
  });

  it('stop failing for any other reason is not hidden as a 409', async () => {
    const run = await insertRun({ status: 'running', workflowId: 'x' });
    for (const failure of [failWith('SomethingElse', 'boom')(), new Error('temporal is down')]) {
      t.temporal.reset();
      t.temporal.updateFailure = () => failure;
      expect((await post(`/api/runs/${run.id}/stop`)).statusCode).toBe(500);
    }
  });

  it("stop on another org's run is 404 and without a session is 401", async () => {
    const run = await insertRun({ status: 'running', workflowId: 'x' });
    t.temporal.reset();
    expect((await post(`/api/runs/${run.id}/stop`, bob)).statusCode).toBe(404);
    expect((await post(`/api/runs/${run.id}/stop`, '')).statusCode).toBe(401);
    expect(t.temporal.calls).toHaveLength(0);
  });
});

describe('transcript', () => {
  async function addEntries(runId: string, count: number, org = orgId): Promise<void> {
    await withOrg(t.db, org, async (tx) => {
      await tx.insert(runTranscriptEntries).values(
        Array.from({ length: count }, (_v, i) => ({
          orgId: org,
          runId,
          seq: i + 1,
          sourceId: `${org}-m${i + 1}`,
          at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
          kind: i % 2 === 0 ? 'user' : 'tool',
          tool: i % 2 === 0 ? null : 'Bash',
          text: `entry ${i + 1}`,
        })),
      );
    });
  }
  const read = async (id: string, query = '', cookie = alice) =>
    expectContract('runs.transcript', await get(`/api/runs/${id}/transcript${query}`, cookie)) as RunTranscriptResponse;

  it('returns the newest page oldest first with nextBefore, then the older page', async () => {
    const run = await insertRun();
    await addEntries(run.id, 5);
    const newest = await read(run.id, '?limit=2');
    expect(newest.items.map((e) => e.seq)).toEqual([4, 5]);
    expect(newest.nextBefore).toBe(4);
    expect(newest.items[1]).toMatchObject({ kind: 'user', tool: null, text: 'entry 5', truncated: false });
    expect(newest.items[0]).toMatchObject({ kind: 'tool', tool: 'Bash' });
    const older = await read(run.id, '?limit=2&before=4');
    expect(older.items.map((e) => e.seq)).toEqual([2, 3]);
    expect(older.nextBefore).toBe(2);
  });

  it('nextBefore is null on the oldest page and for a run with no entries', async () => {
    const run = await insertRun();
    await addEntries(run.id, 3);
    const oldest = await read(run.id, '?limit=2&before=3');
    expect(oldest.items.map((e) => e.seq)).toEqual([1, 2]);
    expect(oldest.nextBefore).toBeNull();
    const all = await read(run.id);
    expect(all.items).toHaveLength(3);
    expect(all.nextBefore).toBeNull();
    const empty = await insertRun();
    expect(await read(empty.id)).toEqual({ items: [], nextBefore: null });
  });

  it.each(['?limit=0', '?limit=501', '?before=0'])('rejects %s with a 400', async (query) => {
    const run = await insertRun();
    expect((await get(`/api/runs/${run.id}/transcript${query}`)).statusCode).toBe(400);
  });

  it("another org's run is 404 and without a session is 401", async () => {
    const run = await insertRun();
    expect((await get(`/api/runs/${run.id}/transcript`, bob)).statusCode).toBe(404);
    expect((await get(`/api/runs/${run.id}/transcript`, '')).statusCode).toBe(401);
  });

  it('rows of another org on the same run id are never returned', async () => {
    const run = await insertRun();
    await addEntries(run.id, 2);
    const bobOrg = ((await t.db.pool.query("select id from organization where slug = 'bob'")).rows[0] as { id: string })
      .id;
    await withOrg(t.db, bobOrg, (tx) =>
      tx.insert(runTranscriptEntries).values({
        orgId: bobOrg,
        runId: run.id,
        seq: 3,
        sourceId: 'bob-only',
        at: new Date(),
        kind: 'user',
        text: 'not for alice',
      }),
    );
    const page = await read(run.id);
    expect(page.items.map((e) => e.text)).toEqual(['entry 1', 'entry 2']);
  });
});

describe('ignored list', () => {
  it('returns only ignored_* outcomes for the project, newest first, max 100', async () => {
    const pid = (await makeProject(t, alice, await installFake(t, alice))).projectId;
    await withOrg(t.db, orgId, async (tx) => {
      const base = { provider: 'fake', channel: 'webhook', orgId, projectId: pid };
      await tx.insert(inboundEvents).values([
        {
          ...base,
          deliveryId: `d-${randomUUID()}`,
          outcome: 'ignored_no_command',
          ticketRef: '9',
          author: 'carol',
          detail: 'no command',
          receivedAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          ...base,
          deliveryId: `d-${randomUUID()}`,
          outcome: 'ignored_unauthorized',
          ticketRef: '10',
          author: 'mallory',
          command: 'fix',
          detail: 'not allowed',
          receivedAt: new Date('2026-01-02T00:00:00Z'),
        },
        {
          ...base,
          deliveryId: `d-${randomUUID()}`,
          outcome: 'run_created',
          receivedAt: new Date('2026-01-03T00:00:00Z'),
        },
        {
          ...base,
          deliveryId: `d-${randomUUID()}`,
          outcome: 'duplicate',
          receivedAt: new Date('2026-01-04T00:00:00Z'),
        },
        { ...base, deliveryId: `d-${randomUUID()}`, outcome: 'ignoredX', receivedAt: new Date('2026-01-05T00:00:00Z') },
        { ...base, projectId: projectId, deliveryId: `d-${randomUUID()}`, outcome: 'ignored_no_rule' },
      ]);
    });
    const items = expectContract('projects.ignored', await get(`/api/projects/${pid}/ignored`)) as IgnoredEventDto[];
    expect(items.map((i) => i.outcome)).toEqual(['ignored_unauthorized', 'ignored_no_command']);
    expect(items[0]).toMatchObject({ ticketRef: '10', author: 'mallory', command: 'fix', detail: 'not allowed' });
    expect(items[0]?.ticketKind).toBeNull();

    const many = (await makeProject(t, alice, await installFake(t, alice))).projectId;
    await withOrg(t.db, orgId, (tx) =>
      tx.execute(sql`insert into inbound_events (provider, channel, delivery_id, org_id, project_id, outcome)
        select 'fake', 'poll', 'bulk-' || g, ${orgId}::uuid, ${many}::uuid, 'ignored_no_command' from generate_series(1, 120) g`),
    );
    const capped = expectContract('projects.ignored', await get(`/api/projects/${many}/ignored`)) as IgnoredEventDto[];
    expect(capped).toHaveLength(100);
  });
});
