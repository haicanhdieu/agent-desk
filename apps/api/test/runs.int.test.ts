import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApplicationFailure, WorkflowNotFoundError, WorkflowUpdateFailedError } from '@temporalio/client';
import { eq, sql } from 'drizzle-orm';
import { UPDATE } from '@agentdesk/core';
import { agents, inboundEvents, runEvents, runTranscriptEntries, runs, withOrg } from '@agentdesk/db';
import type {
  IgnoredEventDto,
  Page,
  RunDto,
  RunListResponse,
  RunLogResponse,
  RunStatsDto,
  RunTranscriptResponse,
} from '@agentdesk/contracts';
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

  async function seedRuns(n: number, over: Partial<typeof runs.$inferInsert> = {}) {
    const pid = (await makeProject(t, alice, await installFake(t, alice))).projectId;
    const base = Date.parse('2026-01-01T00:00:00.000Z');
    // One bulk insert: distinct queued_at, the newest last inserted (so the list order is the reverse of insertion).
    await withOrg(t.db, orgId, (tx) =>
      tx.insert(runs).values(
        Array.from({ length: n }, (_, i) => ({
          orgId,
          projectId: pid,
          command: 'fix',
          skillName: 'fix',
          ticketRef: `bulk-${i}`,
          ticketKind: 'issue' as const,
          checkoutRef: 'refs/heads/main',
          triggerSource: 'webhook' as const,
          queuedAt: new Date(base + i * 1000),
          ...over,
        })),
      ),
    );
    return pid;
  }
  const pageOf = async (query: string, pid: string, cookie = alice) =>
    expectContract('runs.list', await listRuns(query, pid, cookie)) as RunListResponse;

  it('pages runs: defaults, total, past the end', async () => {
    const pid = await seedRuns(45);
    const first = await pageOf('', pid);
    expect(first).toMatchObject({ page: 1, pageSize: 20, total: 45 });
    expect(first.items).toHaveLength(20);
    expect((await pageOf('?page=3', pid)).items).toHaveLength(5);
    const past = await listRuns('?page=4', pid);
    expect(past.statusCode).toBe(200);
    expect(past.json()).toMatchObject({ items: [], page: 4, total: 45 });
  });

  it('pages are disjoint and complete with identical queued_at, ordered by id', async () => {
    const pid = (await makeProject(t, alice, await installFake(t, alice))).projectId;
    const same = new Date('2026-01-01T00:00:00.123Z');
    const ids = new Set<string>();
    for (let i = 0; i < 7; i += 1) ids.add((await insertRun({ queuedAt: same }, pid)).id);
    const seen: string[] = [];
    for (let page = 1; page <= 4; page += 1) {
      const res = await pageOf(`?pageSize=2&page=${page}`, pid);
      expect(res.items.length).toBe(page === 4 ? 1 : 2);
      seen.push(...res.items.map((r) => r.id));
    }
    expect(seen).toHaveLength(7);
    expect(new Set(seen)).toEqual(ids);
    expect(seen).toEqual([...seen].sort());
  });

  it('rejects page and pageSize out of bounds', async () => {
    for (const q of ['?page=0', '?pageSize=101', '?pageSize=0', '?page=2147483648', '?limit=1000']) {
      const res = await listRuns(q);
      expect(res.statusCode, q).toBe(400);
    }
  });

  it('total counts the filter and the ticket', async () => {
    const pid = (await makeProject(t, alice, await installFake(t, alice))).projectId;
    for (const status of ['succeeded', 'failed', 'running', 'queued']) await insertRun({ status, ticketRef: 'T' }, pid);
    await insertRun({ status: 'failed', ticketRef: 'U' }, pid);
    const res = await pageOf('?filter=ended&ticket=T', pid);
    expect(res.total).toBe(2);
    expect(res.items.map((r) => r.ticket.ref)).toEqual(['T', 'T']);
    expect((await pageOf('?filter=ended', pid)).total).toBe(3);
  });

  it("another org's runs are never counted", async () => {
    const pid = (await makeProject(t, alice, await installFake(t, alice))).projectId;
    await insertRun({}, pid);
    expect((await pageOf('', pid)).total).toBe(1);
    const bobProject = (await makeProject(t, bob, await installFake(t, bob))).projectId;
    expect((await pageOf('', bobProject, bob)).total).toBe(0);
  });
});

describe('runs.stats', () => {
  const stats = (query: string, id = projectId, cookie = alice) =>
    get(`/api/projects/${id}/runs/stats${query}`, cookie);
  const SINCE = '2026-03-10T00:00:00.000Z';

  async function seedMixed() {
    const pid = (await makeProject(t, alice, await installFake(t, alice))).projectId;
    const old = new Date('2026-01-01T00:00:00.000Z');
    const statuses = [
      'queued',
      'starting',
      'running',
      'idle',
      'paused',
      'done',
      'succeeded',
      'succeeded',
      'succeeded',
      'failed',
      'failed',
      'expired',
    ];
    const made: (typeof runs.$inferSelect)[] = [];
    for (const status of statuses) made.push(await insertRun({ status, queuedAt: old }, pid));
    await withOrg(t.db, orgId, (tx) =>
      tx.execute(sql`insert into inbound_events (provider, channel, delivery_id, org_id, project_id, outcome)
        select 'fake', 'poll', 'st-' || ${pid}::text || g, ${orgId}::uuid, ${pid}::uuid, 'ignored_no_command' from generate_series(1, 3) g`),
    );
    return { pid, made };
  }

  it('counts match the runs.list totals of each filter, plus the ignored events', async () => {
    const { pid } = await seedMixed();
    const res = expectContract('runs.stats', await stats(`?since=${SINCE}`, pid)) as RunStatsDto;
    expect(res.counts).toEqual({ needs_you: 2, active: 4, queued: 1, ended: 6, all: 12, ignored: 3 });
    for (const [filter, n] of [
      ['needs_you', 2],
      ['active', 4],
      ['queued', 1],
      ['ended', 6],
      ['all', 12],
    ] as const) {
      const list = expectContract('runs.list', await listRuns(`?filter=${filter}`, pid)) as RunListResponse;
      expect(list.items, filter).toHaveLength(n);
    }
  });

  it('today counts runs queued at or after since, and failed ones among them', async () => {
    const pid = (await makeProject(t, alice, await installFake(t, alice))).projectId;
    await insertRun({ status: 'succeeded', queuedAt: new Date('2026-03-10T00:00:00.000Z') }, pid);
    await insertRun({ status: 'failed', queuedAt: new Date('2026-03-10T00:00:01.000Z') }, pid);
    await insertRun({ status: 'failed', queuedAt: new Date('2026-03-09T23:59:59.000Z') }, pid);
    const res = expectContract('runs.stats', await stats(`?since=${SINCE}`, pid)) as RunStatsDto;
    expect(res.today).toEqual({ total: 2, failed: 1 });
    // 2026-03-10T02:00:00+02:00 is 2026-03-10T00:00:00Z, the same instant.
    const offset = expectContract('runs.stats', await stats('?since=2026-03-10T02:00:00%2B02:00', pid)) as RunStatsDto;
    expect(offset.today).toEqual({ total: 2, failed: 1 });
    const later = expectContract('runs.stats', await stats('?since=2026-03-10T01:00:00%2B02:00', pid)) as RunStatsDto;
    expect(later.today.total).toBe(3);
  });

  it('idleRun is the newest idle run as a list item, and null when none is idle', async () => {
    const pid = (await makeProject(t, alice, await installFake(t, alice))).projectId;
    const none = expectContract('runs.stats', await stats(`?since=${SINCE}`, pid)) as RunStatsDto;
    expect(none.idleRun).toBeNull();
    expect(none.nextQueuedNumber).toBeNull();
    await insertRun({ status: 'idle', queuedAt: new Date('2026-01-01T00:00:00Z') }, pid);
    const newest = await insertRun(
      { status: 'idle', queuedAt: new Date('2026-02-01T00:00:00Z'), ticketRef: 'tk' },
      pid,
    );
    await insertRun({ status: 'succeeded', queuedAt: new Date('2026-02-02T00:00:00Z'), ticketRef: 'tk' }, pid);
    const res = expectContract('runs.stats', await stats(`?since=${SINCE}`, pid)) as RunStatsDto;
    expect(res.idleRun).toMatchObject({ id: newest.id, ticketRunCount: 2 });
    expect(res.idleRun).not.toHaveProperty('prompt');
  });

  it('nextQueuedNumber is the number of the oldest queued run', async () => {
    const pid = (await makeProject(t, alice, await installFake(t, alice))).projectId;
    await insertRun({ status: 'queued', queuedAt: new Date('2026-02-01T00:00:00Z') }, pid);
    const oldest = await insertRun({ status: 'queued', queuedAt: new Date('2026-01-01T00:00:00Z') }, pid);
    const res = expectContract('runs.stats', await stats(`?since=${SINCE}`, pid)) as RunStatsDto;
    expect(res.nextQueuedNumber).toBe(oldest.number);
  });

  it('a missing or malformed since is 400', async () => {
    expect((await stats('')).statusCode).toBe(400);
    expect((await stats('?since=yesterday')).statusCode).toBe(400);
  });

  it("another org's project is 404 and its runs never change this org's counts", async () => {
    const { pid } = await seedMixed();
    expect((await stats(`?since=${SINCE}`, pid, bob)).statusCode).toBe(404);
    const bobProject = (await makeProject(t, bob, await installFake(t, bob))).projectId;
    const before = expectContract('runs.stats', await stats(`?since=${SINCE}`, pid)) as RunStatsDto;
    const bobOrg = ((await t.db.pool.query("select id from organization where slug = 'bob'")).rows[0] as { id: string })
      .id;
    await withOrg(t.db, bobOrg, (tx) =>
      tx.insert(runs).values({
        orgId: bobOrg,
        projectId: bobProject,
        command: 'fix',
        skillName: 'fix',
        ticketRef: 'b-1',
        ticketKind: 'issue',
        checkoutRef: 'refs/heads/main',
        triggerSource: 'webhook',
        status: 'idle',
      }),
    );
    const after = expectContract('runs.stats', await stats(`?since=${SINCE}`, pid)) as RunStatsDto;
    expect(after).toEqual(before);
  });

  it('GET .../runs/stats is not taken by runs.byNumber', async () => {
    const res = await stats(`?since=${SINCE}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('counts');
  });

  it('runs.list items carry ticketRunCount across all statuses, whatever the filter', async () => {
    const pid = (await makeProject(t, alice, await installFake(t, alice))).projectId;
    await insertRun({ ticketRef: 'T', status: 'succeeded' }, pid);
    await insertRun({ ticketRef: 'T', status: 'queued' }, pid);
    await insertRun({ ticketRef: 'T', status: 'queued' }, pid);
    await insertRun({ ticketRef: 'U', status: 'queued' }, pid);
    const res = expectContract('runs.list', await listRuns('?filter=queued', pid)) as RunListResponse;
    const byTicket = new Map(res.items.map((r) => [r.ticket.ref, r.ticketRunCount]));
    expect(res.items.filter((r) => r.ticket.ref === 'T').map((r) => r.ticketRunCount)).toEqual([3, 3]);
    expect(byTicket.get('U')).toBe(1);
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

  it('agent.model is the run model when recorded', async () => {
    const agentId = (
      await withOrg(t.db, orgId, (tx) =>
        tx.select({ id: agents.id }).from(agents).where(eq(agents.projectId, projectId)).limit(1),
      )
    )[0]?.id;
    if (!agentId) throw new Error('no agent');
    await withOrg(t.db, orgId, (tx) => tx.update(agents).set({ model: 'sonnet' }).where(eq(agents.id, agentId)));
    const r = await insertRun({ agentId, model: 'haiku' });
    expect(expectContract('runs.get', await get(`/api/runs/${r.id}`))).toMatchObject({ agent: { model: 'haiku' } });
  });

  it('a run without a model shows the agent current default, and "unknown" when the agent is gone', async () => {
    const agentId = (
      await withOrg(t.db, orgId, (tx) =>
        tx.select({ id: agents.id }).from(agents).where(eq(agents.projectId, projectId)).limit(1),
      )
    )[0]?.id;
    if (!agentId) throw new Error('no agent');
    await withOrg(t.db, orgId, (tx) => tx.update(agents).set({ model: 'opus' }).where(eq(agents.id, agentId)));
    const r = await insertRun({ agentId, model: null });
    expect(expectContract('runs.get', await get(`/api/runs/${r.id}`))).toMatchObject({ agent: { model: 'opus' } });
    const orphan = await insertRun({ agentId: null, model: null });
    expect(expectContract('runs.get', await get(`/api/runs/${orphan.id}`))).toMatchObject({
      agent: { model: 'unknown' },
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
  it('returns only ignored_* outcomes for the project, newest first', async () => {
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
    const items = (
      expectContract('projects.ignored', await get(`/api/projects/${pid}/ignored`)) as Page<IgnoredEventDto>
    ).items;
    expect(items.map((i) => i.outcome)).toEqual(['ignored_unauthorized', 'ignored_no_command']);
    expect(items[0]).toMatchObject({ ticketRef: '10', author: 'mallory', command: 'fix', detail: 'not allowed' });
    expect(items[0]?.ticketKind).toBeNull();
  });

  async function seedIgnored(count: number): Promise<string> {
    const pid = (await makeProject(t, alice, await installFake(t, alice))).projectId;
    await withOrg(t.db, orgId, (tx) =>
      tx.execute(sql`insert into inbound_events (provider, channel, delivery_id, org_id, project_id, outcome, received_at)
        select 'fake', 'poll', 'bulk-' || ${pid} || '-' || g, ${orgId}::uuid, ${pid}::uuid, 'ignored_no_command',
          timestamptz '2026-01-01T00:00:00Z' + ((g / 2) || ' seconds')::interval from generate_series(1, ${count}) g`),
    );
    return pid;
  }
  const ignoredPage = (query: string, pid: string, cookie = alice) =>
    get(`/api/projects/${pid}/ignored${query}`, cookie);

  it('pages the ignored list with a total and no 100 cap', async () => {
    const pid = await seedIgnored(130);
    const first = expectContract('projects.ignored', await ignoredPage('', pid)) as Page<IgnoredEventDto>;
    expect(first).toMatchObject({ page: 1, pageSize: 20, total: 130 });
    expect(first.items).toHaveLength(20);
    const seventh = expectContract('projects.ignored', await ignoredPage('?page=7', pid)) as Page<IgnoredEventDto>;
    expect(seventh.items).toHaveLength(10);
    const past = await ignoredPage('?page=8', pid);
    expect(past.statusCode).toBe(200);
    expect(past.json()).toMatchObject({ items: [], page: 8, total: 130 });
  });

  it('orders newest received first with id ascending on ties, pages disjoint', async () => {
    const pid = await seedIgnored(9);
    const seen: IgnoredEventDto[] = [];
    for (let page = 1; page <= 5; page += 1) {
      const res = expectContract(
        'projects.ignored',
        await ignoredPage(`?pageSize=2&page=${page}`, pid),
      ) as Page<IgnoredEventDto>;
      seen.push(...res.items);
    }
    expect(seen).toHaveLength(9);
    expect(new Set(seen.map((i) => i.id)).size).toBe(9);
    for (let i = 1; i < seen.length; i += 1) {
      const a = seen[i - 1];
      const b = seen[i];
      if (!a || !b) throw new Error('missing row');
      expect(a.receivedAt >= b.receivedAt).toBe(true);
      if (a.receivedAt === b.receivedAt) expect(a.id < b.id).toBe(true);
    }
  });

  it('rejects page and pageSize out of bounds on the ignored list', async () => {
    for (const q of ['?page=0', '?pageSize=101', '?pageSize=0', '?page=2147483648']) {
      expect((await ignoredPage(q, projectId)).statusCode, q).toBe(400);
    }
  });

  it('counts only the project events, not another org or project', async () => {
    const pid = await seedIgnored(3);
    expect((await ignoredPage('', pid, bob)).statusCode).toBe(404);
    const before = (await ignoredPage('', pid)).json();
    const sibling = await seedIgnored(5);
    const bobProject = (await makeProject(t, bob, await installFake(t, bob))).projectId;
    const bobOrg = ((await t.db.pool.query("select id from organization where slug = 'bob'")).rows[0] as { id: string })
      .id;
    await withOrg(t.db, bobOrg, (tx) =>
      tx.execute(sql`insert into inbound_events (provider, channel, delivery_id, org_id, project_id, outcome, received_at)
        select 'fake', 'poll', 'bob-' || g, ${bobOrg}::uuid, ${bobProject}::uuid, 'ignored_no_command',
          timestamptz '2026-01-01T00:00:00Z' from generate_series(1, 4) g`),
    );
    expect((await ignoredPage('', sibling)).json()).toMatchObject({ total: 5 });
    expect((await ignoredPage('', bobProject, bob)).json()).toMatchObject({ total: 4 });
    const after = (await ignoredPage('', pid)).json();
    expect(after).toMatchObject({ total: 3 });
    expect(after).toEqual(before);
  });
});

describe('runs list linkedTickets', () => {
  const T0 = Date.parse('2026-04-01T00:00:00.000Z');
  const SINCE = '2026-03-10T00:00:00.000Z';
  const pageOf = async (query: string, pid: string) =>
    expectContract('runs.list', await listRuns(query, pid)) as RunListResponse;
  const stats = (query: string, id: string) => get(`/api/projects/${id}/runs/stats${query}`);
  let tick = 0;
  /** Distinct, increasing queuedAt values so "newest" is never a tie. */
  const at = () => new Date(T0 + (tick += 1) * 1000);
  const newProject = async () => (await makeProject(t, alice, await installFake(t, alice))).projectId;
  const issue = (pid: string, n: number, over: Partial<typeof runs.$inferInsert> = {}) =>
    insertRun(
      {
        ticketRef: String(n),
        ticketKind: 'issue',
        ticketNumber: n,
        ticketTitle: `Issue ${n}`,
        ticketUrl: `https://example.test/issues/${n}`,
        queuedAt: at(),
        ...over,
      },
      pid,
    );
  const pr = (pid: string, n: number, linked: string[], over: Partial<typeof runs.$inferInsert> = {}) =>
    insertRun(
      {
        ticketRef: String(n),
        ticketKind: 'pr',
        ticketNumber: n,
        ticketTitle: `PR ${n}`,
        ticketUrl: `https://example.test/pull/${n}`,
        linkedIssueRefs: linked,
        queuedAt: at(),
        ...over,
      },
      pid,
    );
  const items = async (pid: string, query = '') => (await pageOf(query, pid)).items;
  const linkedOf = async (pid: string, id: string, query = '') =>
    (await items(pid, query)).find((i) => i.id === id)?.linkedTickets;
  const refs = (l: { ref: string }[] | undefined) => l?.map((x) => x.ref);

  it('a PR run linked to an issue with runs lists the lead issue, and the issue run lists the PR', async () => {
    const pid = await newProject();
    const i = await issue(pid, 142);
    const p = await pr(pid, 148, ['142']);
    expect(await linkedOf(pid, p.id)).toEqual([
      {
        ref: '142',
        kind: 'issue',
        number: 142,
        title: 'Issue 142',
        url: 'https://example.test/issues/142',
        labels: [],
        ticketRunCount: 1,
      },
    ]);
    expect(await linkedOf(pid, i.id)).toEqual([
      {
        ref: '148',
        kind: 'pr',
        number: 148,
        title: 'PR 148',
        url: 'https://example.test/pull/148',
        labels: [],
        ticketRunCount: 1,
      },
    ]);
  });

  it('a linked entry takes kind, number, title, url and labels from the newest snapshot and counts every status, whatever the filter', async () => {
    const pid = await newProject();
    await issue(pid, 142, { ticketTitle: 'Old' });
    await issue(pid, 142, {
      ticketTitle: 'New',
      status: 'failed',
      ticketLabels: [{ name: 'bug', color: 'd73a4a' }],
    });
    const p = await pr(pid, 148, ['142'], { status: 'idle' });
    const list = await items(pid, '?filter=needs_you');
    expect(list.map((x) => x.id)).toEqual([p.id]);
    expect(list[0]?.linkedTickets).toEqual([
      {
        ref: '142',
        kind: 'issue',
        number: 142,
        title: 'New',
        url: 'https://example.test/issues/142',
        labels: [{ name: 'bug', color: 'd73a4a' }],
        ticketRunCount: 2,
      },
    ]);
  });

  it('a page holding only PR runs still lists the issue', async () => {
    const pid = await newProject();
    await issue(pid, 142);
    await pr(pid, 148, ['142']);
    await pr(pid, 150, ['142']);
    const list = await items(pid, '?pageSize=2&page=1');
    expect(list).toHaveLength(2);
    for (const item of list) {
      expect(item.ticket.kind).toBe('pr');
      expect(item.linkedTickets[0]?.ref).toBe('142');
    }
  });

  it('an issue with two PRs: each PR run lists the issue then the other PR, and the issue run lists both PRs by number', async () => {
    const pid = await newProject();
    const i = await issue(pid, 142);
    const p150a = await pr(pid, 150, ['142']);
    const p148 = await pr(pid, 148, ['142']);
    const p150b = await pr(pid, 150, ['142']);
    expect(refs(await linkedOf(pid, p150a.id))).toEqual(['142', '148']);
    expect(refs(await linkedOf(pid, p150b.id))).toEqual(['142', '148']);
    expect(refs(await linkedOf(pid, p148.id))).toEqual(['142', '150']);
    expect(refs(await linkedOf(pid, i.id))).toEqual(['148', '150']);
    const counts = (await linkedOf(pid, i.id))?.map((x) => x.ticketRunCount);
    expect(counts).toEqual([1, 2]);
    expect((await linkedOf(pid, p148.id))?.map((x) => x.ticketRunCount)).toEqual([1, 2]);
  });

  it('a page holding only the issue run lists a PR whose run is on another page', async () => {
    const pid = await newProject();
    await pr(pid, 148, ['142']);
    const i = await issue(pid, 142);
    const list = await items(pid, '?pageSize=1&page=1');
    expect(list.map((x) => x.id)).toEqual([i.id]);
    expect(refs(list[0]?.linkedTickets)).toEqual(['148']);
  });

  it("a page holding only one PR run lists the lead's other PR from another page", async () => {
    const pid = await newProject();
    await issue(pid, 142);
    await pr(pid, 150, ['142']);
    const p = await pr(pid, 148, ['142']);
    const list = await items(pid, '?pageSize=1&page=1');
    expect(list.map((x) => x.id)).toEqual([p.id]);
    expect(refs(list[0]?.linkedTickets)).toEqual(['142', '150']);
  });

  it('a linked issue with no runs in the project is dropped', async () => {
    const pid = await newProject();
    const p = await pr(pid, 148, ['142']);
    expect(await linkedOf(pid, p.id)).toEqual([]);
  });

  it('a run with an empty snapshot gets [] even when a newer run of the same PR is linked', async () => {
    const pid = await newProject();
    await issue(pid, 142);
    const old = await pr(pid, 148, []);
    const newer = await pr(pid, 148, ['142']);
    expect(await linkedOf(pid, old.id)).toEqual([]);
    expect(refs(await linkedOf(pid, newer.id))).toEqual(['142']);
  });

  it('the newest linked run decides for all linked runs of the PR', async () => {
    const pid = await newProject();
    await issue(pid, 142);
    await issue(pid, 150);
    const a = await pr(pid, 148, ['150']);
    const b = await pr(pid, 148, ['142']);
    expect(refs(await linkedOf(pid, a.id))).toEqual(['142']);
    expect(refs(await linkedOf(pid, b.id))).toEqual(['142']);
    const c = await pr(pid, 148, []);
    expect(await linkedOf(pid, c.id)).toEqual([]);
    expect(refs(await linkedOf(pid, a.id))).toEqual(['142']);
    expect(refs(await linkedOf(pid, b.id))).toEqual(['142']);
  });

  it('a PR linked to two issues with runs joins the lower-numbered one', async () => {
    const pid = await newProject();
    const i142 = await issue(pid, 142);
    const i150 = await issue(pid, 150);
    const p = await pr(pid, 148, ['150', '142']);
    expect(refs(await linkedOf(pid, p.id))).toEqual(['142']);
    expect(refs(await linkedOf(pid, i142.id))).toEqual(['148']);
    expect(await linkedOf(pid, i150.id)).toEqual([]);
  });

  it('a ref that names a PR, or the PR itself, is never a lead', async () => {
    const pid = await newProject();
    const self = await pr(pid, 148, ['148']);
    expect(await linkedOf(pid, self.id)).toEqual([]);
    const pid2 = await newProject();
    await pr(pid2, 150, []);
    const toPr = await pr(pid2, 148, ['150']);
    expect(await linkedOf(pid2, toPr.id)).toEqual([]);
    const pid3 = await newProject();
    await pr(pid3, 150, []);
    await issue(pid3, 142);
    const mixed = await pr(pid3, 148, ['150', '142']);
    expect(refs(await linkedOf(pid3, mixed.id))).toEqual(['142']);
  });

  it("each item's own ticketRunCount is unchanged", async () => {
    const pid = await newProject();
    await issue(pid, 142);
    await issue(pid, 142);
    const p = await pr(pid, 148, ['142']);
    const item = (await items(pid)).find((x) => x.id === p.id);
    expect(item?.ticketRunCount).toBe(1);
    expect(item?.linkedTickets[0]?.ticketRunCount).toBe(2);
  });

  it('links stay inside the project', async () => {
    const p1 = await newProject();
    const p2 = await newProject();
    const prRun = await pr(p1, 148, ['142']);
    const otherIssue = await issue(p2, 142);
    expect(await linkedOf(p1, prRun.id)).toEqual([]);
    expect(await linkedOf(p2, otherIssue.id)).toEqual([]);
    expect((await listRuns('', p1, bob)).statusCode).toBe(404);
  });

  it('stats.idleRun carries linkedTickets', async () => {
    const pid = await newProject();
    await issue(pid, 142);
    await pr(pid, 148, ['142'], { status: 'idle' });
    const res = expectContract('runs.stats', await stats(`?since=${SINCE}`, pid)) as RunStatsDto;
    expect(res.idleRun?.linkedTickets[0]?.ref).toBe('142');
  });
});
