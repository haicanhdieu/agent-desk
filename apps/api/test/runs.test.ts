import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkflowNotFoundError } from '@temporalio/client';
import { sql } from 'drizzle-orm';
import { inboundEvents, runEvents, runs, withOrg } from '@agentdesk/db';
import type { IgnoredEventDto, RunDto, RunListResponse, RunLogResponse } from '@agentdesk/contracts';
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
    const byNum = expectContract('runs.byNumber', await get(`/api/projects/${projectId}/runs/${run.number}`)) as RunDto;
    expect(byNum.id).toBe(run.id);
    expect((await get(`/api/projects/${projectId}/runs/999999`)).statusCode).toBe(404);
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

describe('cancel and finish', () => {
  it('finish on a running run is a 409 problem and sends nothing', async () => {
    const run = await insertRun({ status: 'running', workflowId: 'x' });
    t.temporal.reset();
    const res = await post(`/api/runs/${run.id}/finish`);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ status: 409 });
    expect(t.temporal.calls).toHaveLength(0);
  });

  it('finish on an idle run is 202 and signals finish; status is untouched', async () => {
    const run = await insertRun({ status: 'idle', workflowId: `run-x` });
    t.temporal.reset();
    const res = await post(`/api/runs/${run.id}/finish`);
    expect(res.statusCode).toBe(202);
    expectContract('runs.finish', res);
    expect(t.temporal.callsOfKind('signal')).toMatchObject([{ workflowId: `run-${run.id}`, args: ['finish'] }]);
    expect(((await get(`/api/runs/${run.id}`)).json() as RunDto).status).toBe('idle');
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
