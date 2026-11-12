import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import {
  FakeStore,
  TASK_QUEUE,
  WORKFLOW,
  createAdapterRegistry,
  parseConfig,
  pollScheduleId,
  type AdapterRegistry,
  type Clock,
  type Config,
  type PollCursor,
  type PollResult,
  type WorkflowStarter,
} from '@agentdesk/core';
import {
  agents,
  connections,
  createDb,
  inboundEvents,
  pollCursors,
  projects,
  rules,
  runs,
  withOrg,
  type Db,
} from '@agentdesk/db';
import { startPg, type TestPg } from '@agentdesk/db/testing';
import { pollScheduleOps } from '../src/activities/poll-ops';
import {
  pausePollSchedule,
  pollOnce,
  resumePollSchedule,
  type PollDeps,
  type PollInput,
  type PollScheduleOps,
} from '../src/activities/poll.activity';

let pgx: TestPg;
let db: Db;
let dir: string;
let config: Config;
let store: FakeStore;
let registry: AdapterRegistry;

/** A settable clock; starts at real time so comments created through the fake store stay "now". */
let nowMs = Date.now();
const clock: Clock = { now: () => new Date(nowMs) };
const advance = (seconds: number) => void (nowMs += seconds * 1000);

/** pollEvents override for the next calls; undefined = the real fake board. */
let pollImpl: ((cursor: PollCursor) => Promise<PollResult>) | undefined;
let pollCalls = 0;

const started: string[] = [];
const starter: WorkflowStarter = {
  start: async (_type, options) => {
    started.push(options.workflowId);
    return {};
  },
};

const scheduleCalls: string[] = [];
const schedules: PollScheduleOps = {
  pause: async (id, note) => void scheduleCalls.push(`pause:${id}:${note}`),
  unpause: async (id) => void scheduleCalls.push(`unpause:${id}`),
  remove: async (id) => void scheduleCalls.push(`remove:${id}`),
  startResume: async (i) => void scheduleCalls.push(`resume:${i.projectId}:${i.until}`),
};

const deps = (over: Partial<PollDeps> = {}): PollDeps => ({
  db,
  registry,
  starter,
  clock,
  config,
  schedules,
  ...over,
});

interface Seed extends PollInput {
  repoPath: string;
}

let seq = 0;
async function seed(over: { interval?: number; mode?: string } = {}): Promise<Seed> {
  seq += 1;
  const orgId = randomUUID();
  const repoPath = `acme/poll-${seq}`;
  const projectId = await withOrg(db, orgId, async (tx) => {
    const [conn] = await tx
      .insert(connections)
      .values({
        orgId,
        provider: 'fake',
        externalId: `fake-${orgId}`,
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
        triggerMode: over.mode ?? 'polling',
        pollIntervalSeconds: over.interval ?? 300,
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
      labelFilter: [],
    });
    await tx.insert(pollCursors).values({ projectId: p!.id, orgId, since: new Date(nowMs - 1000) });
    return p!.id;
  });
  await store.addTicket({ repoPath, number: 7, kind: 'issue', title: 'T', labels: [] });
  return { orgId, projectId, repoPath };
}

const comment = (s: Seed, body = '/code-review') =>
  store.addComment({ repoPath: s.repoPath, ticketRef: '7', body, author: 'alice', authorAssociation: 'MEMBER' });
const cursorOf = async (s: Seed) =>
  (await withOrg(db, s.orgId, (tx) => tx.select().from(pollCursors).where(eq(pollCursors.projectId, s.projectId))))[0]!;
const runsOf = (s: Seed) => withOrg(db, s.orgId, (tx) => tx.select().from(runs).where(eq(runs.projectId, s.projectId)));

beforeAll(async () => {
  pgx = await startPg();
  db = createDb(pgx.appUrl);
  dir = await mkdtemp(join(tmpdir(), 'poll-'));
  config = parseConfig({
    NODE_ENV: 'test',
    PUBLIC_ORIGIN: 'http://localhost:5173',
    DATABASE_APP_URL: 'x',
    DATABASE_OWNER_URL: 'x',
    DATABASE_ADMIN_URL: 'x',
    TEMPORAL_ADDRESS: 'x',
    TEMPORAL_NAMESPACE: 'default',
    BETTER_AUTH_SECRET: 'x'.repeat(32),
    RUNNER_IMAGE: 'agentdesk/runner-claude:test',
    ENABLE_FAKE_PROVIDER: 'true',
    FAKE_STATE_DIR: join(dir, 'fake'),
  });
  store = new FakeStore(config.FAKE_STATE_DIR);
  const real = createAdapterRegistry(config, clock);
  registry = {
    ...real,
    board: (provider) => {
      const board = real.board(provider);
      return Object.assign(Object.create(board), {
        pollEvents: async (project: Parameters<typeof board.pollEvents>[0], cursor: PollCursor) => {
          pollCalls += 1;
          return pollImpl ? pollImpl(cursor) : board.pollEvents(project, cursor);
        },
      });
    },
  };
}, 180_000);
afterAll(async () => {
  await db?.close();
  await pgx?.stop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

const reset = () => {
  pollImpl = undefined;
  pollCalls = 0;
  started.length = 0;
  scheduleCalls.length = 0;
};

describe('pollOnce', () => {
  it('a new comment creates one run and advances the cursor', async () => {
    reset();
    const s = await seed();
    const c = await comment(s);
    expect(await pollOnce(deps(), s)).toBe('ok');
    const rs = await runsOf(s);
    expect(rs).toHaveLength(1);
    expect(started).toHaveLength(1);
    const cur = await cursorOf(s);
    expect(cur.since?.toISOString()).toBe(c.createdAt);
    expect(cur.lastPolledAt?.getTime()).toBe(nowMs);
    const inbound = await withOrg(db, s.orgId, (tx) => tx.select().from(inboundEvents));
    expect(inbound.map((e) => [e.channel, e.deliveryId])).toEqual([['poll', `poll-${c.id}`]]);
  });

  it('the same tick twice still creates one run', async () => {
    reset();
    const s = await seed();
    await comment(s);
    await pollOnce(deps(), s);
    // Rewind the cursor so the next tick re-reads the same comment (a crash between processing and persisting).
    await withOrg(db, s.orgId, (tx) =>
      tx
        .update(pollCursors)
        .set({ since: new Date(nowMs - 1000) })
        .where(eq(pollCursors.projectId, s.projectId)),
    );
    expect(await pollOnce(deps(), s)).toBe('ok');
    expect(await runsOf(s)).toHaveLength(1);
    expect(started).toHaveLength(1);
  });

  it('not_modified updates last_polled_at only (cursor kept, no events)', async () => {
    reset();
    const s = await seed();
    await withOrg(db, s.orgId, (tx) =>
      tx.update(pollCursors).set({ etag: 'W/"abc"' }).where(eq(pollCursors.projectId, s.projectId)),
    );
    const before = await cursorOf(s);
    advance(300);
    pollImpl = async () => ({ kind: 'not_modified' });
    expect(await pollOnce(deps(), s)).toBe('not_modified');
    const after = await cursorOf(s);
    expect(after.since?.getTime()).toBe(before.since?.getTime());
    expect(after.etag).toBe('W/"abc"');
    expect(after.lastPolledAt?.getTime()).toBe(nowMs);
    expect(await runsOf(s)).toHaveLength(0);
  });

  it('revoked credentials set paused_reason, ask for a pause, and later ticks do not poll', async () => {
    reset();
    const s = await seed();
    pollImpl = async () => ({ kind: 'revoked' });
    expect(await pollOnce(deps(), s)).toEqual({ pause: 'token_revoked' });
    expect((await cursorOf(s)).pausedReason).toBe('token_revoked');
    expect(pollCalls).toBe(1);
    expect(await pollOnce(deps(), s)).toEqual({ pause: 'token_revoked' });
    expect(pollCalls).toBe(1);
  });

  it('rate limiting returns the reset time and holds ticks until then', async () => {
    reset();
    const s = await seed();
    const resetAt = new Date(nowMs + 120_000);
    pollImpl = async () => ({ kind: 'rate_limited', resetAt });
    expect(await pollOnce(deps(), s)).toEqual({ pause: 'rate_limited', until: resetAt.toISOString() });
    const cur = await cursorOf(s);
    expect([cur.pausedReason, cur.nextPollAt?.getTime()]).toEqual(['rate_limited', resetAt.getTime()]);
    advance(60);
    expect(await pollOnce(deps(), s)).toBe('not_modified');
    expect(pollCalls).toBe(1);
  });

  it('network errors back off 600, 1200, 2400 s at a 300 s interval, capped at 3600, and a tick too early is skipped', async () => {
    reset();
    const s = await seed();
    pollImpl = async () => {
      throw new Error('ECONNRESET https://api.example/?token=SECRET');
    };
    const next = async () => (await cursorOf(s)).nextPollAt!.getTime() - nowMs;
    expect(await pollOnce(deps(), s)).toEqual({ backoffSeconds: 600 });
    expect(await next()).toBe(600_000);
    advance(300);
    expect(await pollOnce(deps(), s)).toBe('not_modified'); // before next_poll_at
    expect(pollCalls).toBe(1);
    advance(300);
    expect(await pollOnce(deps(), s)).toEqual({ backoffSeconds: 1200 });
    advance(1200);
    expect(await pollOnce(deps(), s)).toEqual({ backoffSeconds: 2400 });
    expect(await next()).toBe(2_400_000);
    advance(2400);
    expect(await pollOnce(deps(), s)).toEqual({ backoffSeconds: 3600 });
    const cur = await cursorOf(s);
    expect(cur.failures).toBe(4);
    expect(cur.lastError).toBe('poll failed (network or provider error)');
    expect(cur.lastError).not.toContain('SECRET');
  });

  it('a success clears last_error, failures and next_poll_at', async () => {
    reset();
    const s = await seed();
    pollImpl = async () => {
      throw new Error('boom');
    };
    await pollOnce(deps(), s);
    advance(600);
    pollImpl = undefined;
    expect(await pollOnce(deps(), s)).toBe('ok');
    const cur = await cursorOf(s);
    expect([cur.failures, cur.lastError, cur.nextPollAt]).toEqual([0, null, null]);
  });

  it('is a no-op and deletes its own schedule when the project is gone or no longer polling', async () => {
    reset();
    const gone = { orgId: randomUUID(), projectId: randomUUID() };
    expect(await pollOnce(deps(), gone)).toBe('ok');
    const webhook = await seed({ mode: 'webhook' });
    await comment(webhook);
    expect(await pollOnce(deps(), webhook)).toBe('ok');
    expect(await runsOf(webhook)).toHaveLength(0);
    expect(pollCalls).toBe(0);
    expect(scheduleCalls).toEqual([`remove:${gone.projectId}`, `remove:${webhook.projectId}`]);
    // Deleting the schedule failing is tolerated.
    const failing = deps({ schedules: { ...schedules, remove: async () => Promise.reject(new Error('down')) } });
    expect(await pollOnce(failing, gone)).toBe('ok');
  });
});

describe('pause helpers', () => {
  it('pausePollSchedule pauses and starts the resume timer only for rate limits', async () => {
    reset();
    const s = await seed();
    await pausePollSchedule(deps(), { ...s, note: 'token revoked' });
    await pausePollSchedule(deps(), { ...s, note: 'rate limited', resumeAt: '2030-01-01T00:00:00.000Z' });
    expect(scheduleCalls).toEqual([
      `pause:${s.projectId}:token revoked`,
      `pause:${s.projectId}:rate limited`,
      `resume:${s.projectId}:2030-01-01T00:00:00.000Z`,
    ]);
  });

  it('resumePollSchedule unpauses and clears a rate-limit pause, but never a token_revoked one', async () => {
    reset();
    const rl = await seed();
    await withOrg(db, rl.orgId, (tx) =>
      tx.update(pollCursors).set({ pausedReason: 'rate_limited', nextPollAt: new Date(nowMs + 5000) }),
    );
    await resumePollSchedule(deps(), rl);
    expect(await cursorOf(rl)).toMatchObject({ pausedReason: null, nextPollAt: null });
    const rv = await seed();
    await withOrg(db, rv.orgId, (tx) => tx.update(pollCursors).set({ pausedReason: 'token_revoked' }));
    await resumePollSchedule(deps(), rv);
    expect((await cursorOf(rv)).pausedReason).toBe('token_revoked');
    expect(scheduleCalls).toEqual([`unpause:${rl.projectId}`, `unpause:${rv.projectId}`]);
  });
});

describe('PollOnceWorkflow against a Temporal server', () => {
  let env: TestWorkflowEnvironment;
  let worker: Worker;
  let done: Promise<void>;
  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createLocal();
    const d = deps({ clock: { now: () => new Date() }, schedules: pollScheduleOps(env.client) });
    worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: fileURLToPath(new URL('../src/workflows/index.ts', import.meta.url)),
      activities: {
        pollOnce: (i: PollInput) => pollOnce(d, i),
        pausePollSchedule: (i: Parameters<typeof pausePollSchedule>[1]) => pausePollSchedule(d, i),
        resumePollSchedule: (i: PollInput) => resumePollSchedule(d, i),
      },
    });
    done = worker.run();
  }, 240_000);
  afterAll(async () => {
    worker?.shutdown();
    await done;
    await env?.teardown();
  });

  const makeSchedule = async (s: Seed) =>
    env.client.schedule.create({
      scheduleId: pollScheduleId(s.projectId),
      spec: { intervals: [{ every: 3_600_000 }] },
      state: { paused: false },
      action: {
        type: 'startWorkflow',
        workflowType: WORKFLOW.pollOnce,
        taskQueue: TASK_QUEUE,
        args: [{ orgId: s.orgId, projectId: s.projectId }],
      },
    });
  const paused = async (s: Seed) =>
    (await env.client.schedule.getHandle(pollScheduleId(s.projectId)).describe()).state.paused;
  const until = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean): Promise<T> => {
    for (let i = 0; i < 100; i++) {
      const v = await fn();
      if (ok(v)) return v;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('timed out');
  };

  it('revoked credentials pause the Schedule and record paused_reason', async () => {
    reset();
    const s = await seed();
    await makeSchedule(s);
    pollImpl = async () => ({ kind: 'revoked' });
    const outcome = await env.client.workflow.execute(WORKFLOW.pollOnce, {
      taskQueue: TASK_QUEUE,
      workflowId: `t-revoked-${s.projectId}`,
      args: [s],
    });
    expect(outcome).toEqual({ pause: 'token_revoked' });
    expect(await paused(s)).toBe(true);
    expect((await cursorOf(s)).pausedReason).toBe('token_revoked');
  });

  it('rate limiting pauses the Schedule and the one-shot timer unpauses it at the reset time', async () => {
    reset();
    const s = await seed();
    await makeSchedule(s);
    const resetAt = new Date(Date.now() + 2000);
    pollImpl = async () => ({ kind: 'rate_limited', resetAt });
    await env.client.workflow.execute(WORKFLOW.pollOnce, {
      taskQueue: TASK_QUEUE,
      workflowId: `t-rl-${s.projectId}`,
      args: [s],
    });
    expect(await paused(s)).toBe(true);
    await until(
      () => paused(s),
      (p) => !p,
    );
    expect((await cursorOf(s)).pausedReason).toBeNull();
  });
});
