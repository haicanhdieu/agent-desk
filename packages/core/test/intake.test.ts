import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import { eq, sql } from 'drizzle-orm';
import { agents, connections, createDb, inboundEvents, projects, rules, runs, withOrg, type Db } from '@agentdesk/db';
import { startPg, type TestPg } from '@agentdesk/db/testing';
import type { AdapterRegistry, BoardAdapter, CodeHostAdapter, Ticket, TicketEvent } from '../src';
import {
  isUniqueViolation,
  processTicketEvent,
  startRunWorkflow,
  sweepOutbox,
  type IntakeDeps,
  type WorkflowStarter,
} from '../src';

let pgServer: TestPg;
let db: Db;
let admin: pg.Pool;

beforeAll(async () => {
  pgServer = await startPg();
  db = createDb(pgServer.appUrl);
  const u = new URL(pgServer.adminUrl);
  u.pathname = '/agentdesk';
  admin = new pg.Pool({ connectionString: u.toString() });
});
afterAll(async () => {
  await admin.end();
  await db.close();
  await pgServer.stop();
});

interface Seed {
  orgId: string;
  projectId: string;
  externalId: string;
  repoPath: string;
}

let seq = 0;
async function seed(over: { labelFilter?: string[]; maxRunsPerTicket?: number } = {}): Promise<Seed> {
  seq += 1;
  const orgId = randomUUID();
  const externalId = `fake-${orgId}`;
  const repoPath = `acme/app-${seq}`;
  const projectId = await withOrg(db, orgId, async (tx) => {
    const [conn] = await tx
      .insert(connections)
      .values({
        orgId,
        provider: 'fake',
        externalId,
        accountName: 'acme',
        capabilities: { code: true, board: true },
      })
      .returning({ id: connections.id });
    const [p] = await tx
      .insert(projects)
      .values({
        orgId,
        name: repoPath,
        repoPath,
        codeConnectionId: conn!.id,
        boardConnectionId: conn!.id,
        ...(over.maxRunsPerTicket ? { maxRunsPerTicket: over.maxRunsPerTicket } : {}),
      })
      .returning({ id: projects.id });
    const [a] = await tx
      .insert(agents)
      .values({ orgId, projectId: p!.id, name: 'default', model: 'sonnet' })
      .returning({ id: agents.id });
    await tx.insert(rules).values({
      orgId,
      projectId: p!.id,
      command: 'code-review',
      skillName: 'code-review',
      agentId: a!.id,
      target: 'any',
      labelFilter: over.labelFilter ?? [],
    });
    return p!.id;
  });
  return { orgId, projectId, externalId, repoPath };
}

const ticket = (n: number): Ticket => ({
  ref: String(n),
  kind: 'issue',
  number: n,
  title: `Ticket ${n}`,
  url: `http://fake.invalid/issues/${n}`,
  labels: [{ name: 'bug', color: 'ff0000' }],
});

function harness(over: Partial<IntakeDeps> = {}, getTicketImpl?: (ref: string) => Promise<Ticket>) {
  const getTicket = vi.fn(async (_p: unknown, ref: string) => (getTicketImpl ?? (async (r) => ticket(Number(r))))(ref));
  const board = { getTicket } as unknown as BoardAdapter; // only getTicket is exercised by the intake
  const host = {
    checkoutRef: (t: { kind: string; number: number }) => (t.kind === 'pr' ? `refs/pull/${t.number}/head` : 'main'),
  } as unknown as CodeHostAdapter; // only checkoutRef is exercised by the intake
  const registry: AdapterRegistry = { board: () => board, codeHost: () => host, providers: () => ['fake'] };
  const startRun = vi.fn(async (_orgId: string, _runId: string) => {});
  const deps: IntakeDeps = {
    db,
    registry,
    startRun,
    clock: { now: () => new Date('2026-11-12T00:00:00Z') },
    botLogin: 'agentdesk[bot]',
    ...over,
  };
  return { deps, startRun, getTicket };
}

const eventFor = (s: Seed, over: Partial<TicketEvent> = {}): TicketEvent => {
  const id = randomUUID();
  return {
    provider: 'fake',
    deliveryId: `d-${id}`,
    commentId: `c-${id}`,
    externalId: s.externalId,
    repoPath: s.repoPath,
    ticketRef: '7',
    ticketKind: 'issue',
    body: '/code-review fast',
    author: 'alice',
    authorAssociation: 'MEMBER',
    createdAt: '2026-11-12T00:00:00Z',
    ...over,
  };
};

const runsOf = (s: Seed) => withOrg(db, s.orgId, (tx) => tx.select().from(runs).where(eq(runs.projectId, s.projectId)));
const inboundOf = (s: Seed) =>
  withOrg(db, s.orgId, (tx) => tx.select().from(inboundEvents).where(eq(inboundEvents.projectId, s.projectId)));

describe('processTicketEvent', () => {
  it('creates a queued run with ticket snapshot columns and starts it once', async () => {
    const s = await seed();
    const h = harness();
    const r = await processTicketEvent(h.deps, eventFor(s), 'webhook');
    expect(r.outcome).toBe('run_created');
    const [run] = await runsOf(s);
    expect(run).toMatchObject({
      id: r.runId,
      number: 1,
      status: 'queued',
      command: 'code-review',
      args: 'fast',
      skillName: 'code-review',
      ticketRef: '7',
      ticketKind: 'issue',
      ticketNumber: 7,
      ticketTitle: 'Ticket 7',
      ticketUrl: 'http://fake.invalid/issues/7',
      ticketLabels: [{ name: 'bug', color: 'ff0000' }],
      checkoutRef: 'main',
      triggerSource: 'webhook',
      triggeredBy: 'alice',
      workflowId: null,
    });
    expect(h.getTicket).toHaveBeenCalledTimes(1); // router had no need for it, the snapshot did
    expect(h.startRun).toHaveBeenCalledExactlyOnceWith(s.orgId, r.runId);
    expect((await inboundOf(s))[0]).toMatchObject({ outcome: 'run_created', orgId: s.orgId, projectId: s.projectId });
  });

  it('the same delivery twice is a duplicate with one run', async () => {
    const s = await seed();
    const h = harness();
    const e = eventFor(s);
    expect((await processTicketEvent(h.deps, e, 'webhook')).outcome).toBe('run_created');
    expect(await processTicketEvent(h.deps, e, 'webhook')).toEqual({ outcome: 'duplicate' });
    expect(await runsOf(s)).toHaveLength(1);
    expect(h.startRun).toHaveBeenCalledTimes(1);
  });

  it('Review Focus 1: same comment via webhook then poll yields one run and one start', async () => {
    const s = await seed();
    const h = harness();
    const first = eventFor(s, { commentId: 'shared-comment' });
    const second = eventFor(s, { commentId: 'shared-comment' });
    expect(first.deliveryId).not.toBe(second.deliveryId);
    expect((await processTicketEvent(h.deps, first, 'webhook')).outcome).toBe('run_created');
    expect((await processTicketEvent(h.deps, second, 'poll')).outcome).toBe('duplicate_comment');
    expect(await runsOf(s)).toHaveLength(1);
    expect(h.startRun).toHaveBeenCalledTimes(1);
    expect((await inboundOf(s)).map((r) => r.outcome).sort()).toEqual(['duplicate_comment', 'run_created']);
  });

  it('Review Focus 4: ignored events keep command, author and ticket_ref', async () => {
    const s = await seed();
    const h = harness();
    const noCmd = eventFor(s, { body: 'hi\n/code-review' });
    const contrib = eventFor(s, { authorAssociation: 'CONTRIBUTOR', author: 'mallory' });
    expect((await processTicketEvent(h.deps, noCmd, 'webhook')).outcome).toBe('ignored_no_command');
    expect((await processTicketEvent(h.deps, contrib, 'webhook')).outcome).toBe('ignored_unauthorized');
    const rows = await inboundOf(s);
    const byOutcome = (o: string) => rows.find((r) => r.outcome === o);
    expect(byOutcome('ignored_no_command')).toMatchObject({ author: 'alice', ticketRef: '7', command: 'hi' });
    expect(byOutcome('ignored_unauthorized')).toMatchObject({
      author: 'mallory',
      ticketRef: '7',
      command: 'code-review',
    });
    expect(byOutcome('ignored_unauthorized')?.detail).toContain('CONTRIBUTOR');
    expect(await runsOf(s)).toHaveLength(0);
    expect(h.startRun).not.toHaveBeenCalled();
  });

  it('records an unknown project once with a null org, and replays are duplicates', async () => {
    const s = await seed();
    const h = harness();
    const e = eventFor(s, { externalId: 'fake-nobody' });
    expect(await processTicketEvent(h.deps, e, 'webhook')).toEqual({ outcome: 'ignored_unknown_project' });
    expect(await processTicketEvent(h.deps, e, 'webhook')).toEqual({ outcome: 'duplicate' });
    const rows = await admin.query('select outcome, org_id, project_id from inbound_events where delivery_id = $1', [
      e.deliveryId,
    ]);
    expect(rows.rows).toEqual([{ outcome: 'ignored_unknown_project', org_id: null, project_id: null }]);
    // the same delivery arriving later for a now-known project still collides on the global unique key
    expect(
      await processTicketEvent(h.deps, { ...e, externalId: s.externalId, repoPath: s.repoPath }, 'webhook'),
    ).toEqual({
      outcome: 'duplicate',
    });
    expect(await runsOf(s)).toHaveLength(0);
  });

  it('a delivery id owned by another org is a duplicate, not an error', async () => {
    const a = await seed();
    const b = await seed();
    const h = harness();
    const e = eventFor(a);
    await processTicketEvent(h.deps, e, 'webhook');
    expect(
      await processTicketEvent(h.deps, { ...e, externalId: b.externalId, repoPath: b.repoPath }, 'webhook'),
    ).toEqual({ outcome: 'duplicate' });
    expect(await runsOf(b)).toHaveLength(0);
  });

  it('skips resolution when the project is known', async () => {
    const s = await seed();
    const h = harness();
    const e = eventFor(s, { externalId: 'whatever', repoPath: 'elsewhere/x' });
    const r = await processTicketEvent(h.deps, e, 'poll', { orgId: s.orgId, projectId: s.projectId });
    expect(r.outcome).toBe('run_created');
    expect((await runsOf(s))[0]?.triggerSource).toBe('polling');
  });

  it('guards: max runs per ticket and an active run of the same skill', async () => {
    const s = await seed({ maxRunsPerTicket: 1 });
    const h = harness();
    expect((await processTicketEvent(h.deps, eventFor(s), 'webhook')).outcome).toBe('run_created');
    expect((await processTicketEvent(h.deps, eventFor(s), 'webhook')).outcome).toBe('ignored_max_runs');
    const t = await seed();
    expect((await processTicketEvent(h.deps, eventFor(t), 'webhook')).outcome).toBe('run_created');
    expect((await processTicketEvent(h.deps, eventFor(t), 'webhook')).outcome).toBe('ignored_active_run');
    await withOrg(db, t.orgId, (tx) =>
      tx.update(runs).set({ status: 'succeeded' }).where(eq(runs.projectId, t.projectId)),
    );
    expect((await processTicketEvent(h.deps, eventFor(t), 'webhook')).outcome).toBe('run_created');
  });

  it('label-filtered rules use the fetched ticket', async () => {
    const s = await seed({ labelFilter: ['bug'] });
    const h = harness();
    expect((await processTicketEvent(h.deps, eventFor(s), 'webhook')).outcome).toBe('run_created');
    const t = await seed({ labelFilter: ['docs'] });
    expect((await processTicketEvent(h.deps, eventFor(t), 'webhook')).outcome).toBe('ignored_labels');
  });

  it('numbers runs 1..5 per project under concurrent inserts', async () => {
    const s = await seed();
    const h = harness();
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => processTicketEvent(h.deps, eventFor(s, { ticketRef: String(100 + n) }), 'webhook')),
    );
    expect(results.every((r) => r.outcome === 'run_created')).toBe(true);
    const numbers = (await runsOf(s)).map((r) => r.number).sort();
    expect(numbers).toEqual([1, 2, 3, 4, 5]);
    expect(h.startRun).toHaveBeenCalledTimes(5);
  });
});

describe('processTicketEvent races and errors', () => {
  it('same comment, different deliveries, concurrently: exactly one run (20 rounds, both channel mixes)', async () => {
    const s = await seed();
    const h = harness();
    for (let i = 0; i < 20; i += 1) {
      const commentId = `race-${i}`;
      const a = eventFor(s, { commentId, ticketRef: String(500 + i) });
      const b = eventFor(s, { commentId, ticketRef: String(500 + i) });
      const channels: ['webhook' | 'poll', 'webhook' | 'poll'] =
        i % 2 === 0 ? ['webhook', 'poll'] : ['webhook', 'webhook'];
      const results = await Promise.all([
        processTicketEvent(h.deps, a, channels[0]),
        processTicketEvent(h.deps, b, channels[1]),
      ]);
      expect(results.map((r) => r.outcome).sort(), `round ${i}`).toEqual(['duplicate_comment', 'run_created']);
    }
    expect(await runsOf(s)).toHaveLength(20);
    expect(h.startRun).toHaveBeenCalledTimes(20);
  });

  it('isUniqueViolation only matches the named constraint when one is given', () => {
    const err = (constraint: string) => Object.assign(new Error('x'), { cause: { code: '23505', constraint } });
    expect(isUniqueViolation(err('runs_project_trigger_comment_key'), 'runs_project_trigger_comment_key')).toBe(true);
    expect(isUniqueViolation(err('runs_project_number_key'), 'runs_project_trigger_comment_key')).toBe(false);
    expect(isUniqueViolation(err('runs_project_number_key'))).toBe(true);
    expect(isUniqueViolation(new Error('nope'))).toBe(false);
  });

  it('a routing error is recorded as outcome error (name only), creates no run, and does not throw', async () => {
    const s = await seed({ labelFilter: ['bug'] });
    const log = { warn: vi.fn() };
    const h = harness({ log }, async () => {
      throw new TypeError('secret detail that must not be stored');
    });
    const e = eventFor(s);
    expect(await processTicketEvent(h.deps, e, 'webhook')).toEqual({ outcome: 'error' });
    const rows = await inboundOf(s);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: 'error', detail: 'TypeError', author: 'alice', ticketRef: '7' });
    expect(JSON.stringify(rows[0])).not.toContain('secret detail');
    expect(await runsOf(s)).toHaveLength(0);
    expect(h.startRun).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      { deliveryId: e.deliveryId, projectId: s.projectId, err: 'TypeError' },
      expect.any(String),
    );
    // a different delivery of the same comment (the poller) can still create the run once the board recovers
    const retry = harness();
    expect((await processTicketEvent(retry.deps, eventFor(s, { commentId: e.commentId }), 'poll')).outcome).toBe(
      'run_created',
    );
  });

  it('a pull request without a known number is not run against refs/pull/0/head', async () => {
    const s = await seed();
    const h = harness({}, async () => {
      throw new Error('board unavailable');
    });
    const r = await processTicketEvent(h.deps, eventFor(s, { ticketRef: 'abc', ticketKind: 'pr' }), 'webhook');
    expect(r.outcome).toBe('ignored_target');
    expect(await runsOf(s)).toHaveLength(0);
  });
});

describe('startRunWorkflow and sweepOutbox', () => {
  const starter = (impl: WorkflowStarter['start']) => {
    const start = vi.fn(impl);
    return { start, starter: { start } satisfies WorkflowStarter };
  };

  it('start failure leaves the run queued; the sweep starts it later and records workflow_id', async () => {
    const s = await seed();
    const failing = starter(async () => {
      throw new Error('temporal down');
    });
    const log = { warn: vi.fn() };
    const h = harness({ startRun: (o, r) => startRunWorkflow(failing.starter, db, o, r, log).then(() => {}) });
    const r = await processTicketEvent(h.deps, eventFor(s), 'webhook');
    expect(r.outcome).toBe('run_created');
    expect((await runsOf(s))[0]).toMatchObject({ status: 'queued', workflowId: null });
    expect(log.warn).toHaveBeenCalledTimes(1);

    const ok = starter(async () => ({}));
    // too young: nothing to do (the cut-off is evaluated by the database clock)
    expect(await sweepOutbox({ db, starter: ok.starter })).toBe(0);
    // "+31 s": age the run in the database instead of sleeping
    await withOrg(db, s.orgId, (tx) =>
      tx
        .update(runs)
        .set({ queuedAt: sql`queued_at - interval '31 seconds'` })
        .where(eq(runs.id, r.runId ?? '')),
    );
    expect(await sweepOutbox({ db, starter: ok.starter })).toBe(1);
    expect(ok.start).toHaveBeenCalledWith('RunWorkflow', {
      taskQueue: 'agentdesk',
      workflowId: `run-${r.runId}`,
      args: [{ orgId: s.orgId, runId: r.runId }],
    });
    expect((await runsOf(s))[0]?.workflowId).toBe(`run-${r.runId}`);
    expect(await sweepOutbox({ db, starter: ok.starter })).toBe(0);
  });

  it('a failing workflow_id update is logged, not thrown', async () => {
    const ok = starter(async () => ({}));
    const log = { warn: vi.fn() };
    // a db whose transactions fail; only withOrg's db.orm.transaction is reached
    const broken = { orm: { transaction: async () => Promise.reject(new Error('db down')) } } as unknown as Db;
    expect(await startRunWorkflow(ok.starter, broken, randomUUID(), randomUUID(), log)).toBe(true);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('treats WorkflowExecutionAlreadyStarted as success and records workflow_id', async () => {
    const s = await seed();
    const h = harness();
    const r = await processTicketEvent(h.deps, eventFor(s), 'webhook');
    const dup = starter(async () => {
      throw new WorkflowExecutionAlreadyStartedError('exists', `run-${r.runId}`, 'RunWorkflow');
    });
    expect(await startRunWorkflow(dup.starter, db, s.orgId, r.runId ?? '')).toBe(true);
    expect((await runsOf(s))[0]?.workflowId).toBe(`run-${r.runId}`);
  });
});
