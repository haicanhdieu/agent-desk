import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestWorkflowEnvironment } from '@temporalio/testing';
import { createTimeSkippingTestEnv } from './helpers/temporal-env';
import { readFile, writeFile } from 'node:fs/promises';
import { Worker } from '@temporalio/worker';
import { historyToJSON } from '@temporalio/common/lib/proto-utils';
import { ApplicationFailure, CancelledFailure, Context } from '@temporalio/activity';
import { WorkflowNotFoundError, type WorkflowHandle } from '@temporalio/client';
import {
  ENDING_DEADLINE_SECONDS,
  IDLE_END_SECONDS,
  QUERY,
  TASK_QUEUE,
  WORKFLOW,
  gateWorkflowId,
  runWorkflowId,
} from '@agentdesk/core';
import type { RunStatus } from '@agentdesk/contracts';
import * as signals from '../src/workflows/signals';
import type { GateState, RunState } from '../src/workflows/signals';
import { ENDING_DEADLINE_SECONDS_DEFAULT, IDLE_END_SECONDS_DEFAULT } from '../src/workflows/run.workflow';
import {
  POD_PENDING_TIMEOUT,
  type CommentKind,
  type FinishDetails,
  type FollowPodLogsResult,
  type RunActivities,
  type RunContext,
} from '../src/activities/run.activities';
import type { SetRunStatusInput } from '../src/activities/run-status.activity';
import { requestSlot } from '../src/activities/slot.activity';

// Time-skipping cannot skip while an activity is in flight, and `followPodLogs` is in flight for most of a run. The
// timer tests therefore run on real time with short `timeoutSeconds` / `idleEndSeconds` supplied by `loadRun`.

interface Deferred<T> {
  promise: Promise<T>;
  resolve(v: T): void;
  reject(e: unknown): void;
  settled: boolean;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const d: Deferred<T> = {
    promise,
    settled: false,
    resolve: (v) => {
      d.settled = true;
      resolve(v);
    },
    reject: (e) => {
      d.settled = true;
      reject(e);
    },
  };
  promise.catch(() => undefined);
  return d;
}

interface Script {
  ctx: RunContext;
  calls: string[];
  statuses: SetRunStatusInput[];
  comments: { kind: CommentKind; details?: FinishDetails }[];
  /** Settles `followPodLogs`. */
  logs: Deferred<FollowPodLogsResult>;
  /** followPodLogs writes `running` (as the real one does on the first log line). */
  firstLine: boolean;
  /** endSession makes the pod exit with code 0 (as the runner entrypoint does). */
  endSessionExits: boolean;
  logsStarted: Deferred<void>;
  logsCancelled: boolean;
  jobCalled: Deferred<void>;
  /** When set, createRunSecretAndJob waits for it (or for cancellation). */
  jobHold?: Deferred<void>;
  /** What the mock "wrote" into the run Secret. */
  secretData?: Record<string, string>;
  /** When set, createRunSecretAndJob ignores cancellation and lands after this many ms (records 'create:done'). */
  createLandsAfterMs?: number;
  /** When set, postComment('start') ignores cancellation and lands after this many ms. */
  startCommentLandsAfterMs?: number;
  endSessionAt?: number;
  endSessionCalled: Deferred<void>;
  /** When set, the first loadRun waits for it (or for cancellation); later calls return at once. */
  loadHold?: Deferred<void>;
  /** When set, the next workflow-written `running` status blocks on it (then the hold is cleared). */
  holdNextRunning?: Deferred<void>;
  /** The first N refreshWorkspaceToken attempts throw a retryable error (the activity retry policy retries them). */
  refreshFailFirst?: number;
  /** Every refreshWorkspaceToken attempt throws a non-retryable error. */
  refreshFailsForGood?: boolean;
  /** How long parkRun says the session is kept (seconds from `at`); unset means nothing is kept (null expiry). */
  parkKeepSeconds?: number;
  /** What createRunSecretAndJob and refreshWorkspaceToken report as the next refresh delay (seconds). */
  plannedRefreshSeconds?: number;
  /** The options of every createRunSecretAndJob call, in order (undefined for the first pod). */
  createOpts: ({ resume?: boolean; deadlineSeconds?: number } | undefined)[];
  /** The options of every followPodLogs call, in order. */
  followOpts: ({ resume?: boolean } | undefined)[];
  /** Settles the current resumed pod's `followPodLogs` (a fresh one per resume). */
  resumeLogs: Deferred<FollowPodLogsResult>;
  /** The resumed pod's followPodLogs has started. */
  resumeFollowStarted: Deferred<void>;
  /** When set, a resumed pod's followPodLogs returns this at once. */
  resumeResult?: FollowPodLogsResult;
  /** When set, a resumed pod's createRunSecretAndJob throws a non-retryable failure of this type. */
  resumeCreateFailure?: string;
  /** The first N followPodLogs attempts throw a retryable cluster error (`fetch failed`). */
  followFailFirst?: number;
  /** Every followPodLogs attempt throws a non-retryable ClusterPermanentError. */
  followPermanent?: boolean;
  /** The next N deleteJob attempts throw a retryable cluster error. */
  deleteJobFailFirst?: number;
  /** Every deleteJob attempt throws a non-retryable ClusterPermanentError (a 403 from the cluster). */
  deleteJobPermanent?: boolean;
  /** The next N endSession attempts throw a retryable cluster error. */
  endSessionFailFirst?: number;
  /** Every resumed createRunSecretAndJob attempt throws a retryable cluster error. */
  resumeCreateFailsRetryable?: boolean;
  /** What endSession resolves: the current pod's logs. */
  currentLogs?: Deferred<FollowPodLogsResult>;
  /** The inputs of every restoreParked call. */
  restores: { kind: string; sessionExpiresAt: string; reason: string }[];
  /** The expiry the latest parkRun reported. */
  lastExpiry?: string;
  /** The pause reason of every parkRun call, in order. */
  parkReasons: string[];
  /** The input of every recordEndingDeadline call (without the timestamp). */
  endingDeadlines: { scrollbackSaved: boolean }[];
  /** Runs inside deleteJob, before it returns (stands in for the pod dying while the Job is being deleted). */
  onDeleteJob?: () => Promise<void>;
  /** When set, recordEndingDeadline throws a non-retryable failure. */
  recordEndingDeadlineFails?: boolean;
  /** Runs inside recordEndingDeadline, before it returns (a slow event write). */
  onRecordEndingDeadline?: () => Promise<void>;
}

const scripts = new Map<string, Script>();
let env: TestWorkflowEnvironment;
let worker: Worker;
let running: Promise<void>;
let lastSuccessHandle: WorkflowHandle | undefined;
/** Histories captured during the run, replayed (and, with UPDATE_REPLAY_FIXTURES=1, written as fixtures) at the end. */
const captured: Record<string, WorkflowHandle> = {};
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}-history.json`, import.meta.url));
const TOKEN = 'test-token-must-not-leak';
const workflowsPath = fileURLToPath(new URL('../src/workflows/index.ts', import.meta.url));

function script(runId: string): Script {
  const s = scripts.get(runId);
  if (!s) throw new Error(`no script for ${runId}`);
  return s;
}

/** Waits for the promise or for the activity to be cancelled, heartbeating so cancellation is delivered. */
async function untilSettledOrCancelled<T>(p: Promise<T>, onCancel: () => void): Promise<T> {
  const c = Context.current();
  const hb = setInterval(() => c.heartbeat(), 100);
  try {
    return await Promise.race([p, c.cancelled]);
  } catch (err) {
    if (err instanceof CancelledFailure) onCancel();
    throw err;
  } finally {
    clearInterval(hb);
  }
}

function activities(): RunActivities {
  return {
    async loadRun(_orgId, runId) {
      const s = script(runId);
      const first = count(s, 'loadRun') === 0;
      s.calls.push('loadRun');
      if (first && s.loadHold)
        await untilSettledOrCancelled(s.loadHold.promise, () => s.calls.push('loadRun:cancelled'));
      return s.ctx;
    },
    async requestSlot(input) {
      script(input.runId).calls.push('requestSlot');
      return requestSlot(env.client.workflow, input);
    },
    async setRunStatus(input) {
      const s = script(input.runId);
      if (input.status === 'running' && s.holdNextRunning) {
        const hold = s.holdNextRunning;
        s.holdNextRunning = undefined;
        await hold.promise;
      }
      s.statuses.push(input);
      return { seq: s.statuses.length };
    },
    async refreshWorkspaceToken(ctx) {
      const s = script(ctx.runId);
      s.calls.push('refreshWorkspaceToken');
      if (s.refreshFailsForGood) throw ApplicationFailure.nonRetryable('the run Secret is gone');
      if (s.refreshFailFirst !== undefined && count(s, 'refreshWorkspaceToken') <= s.refreshFailFirst) {
        throw new Error('transient');
      }
      return s.plannedRefreshSeconds === undefined ? undefined : { nextRefreshSeconds: s.plannedRefreshSeconds };
    },
    async createRunSecretAndJob(ctx, opts) {
      const s = script(ctx.runId);
      s.calls.push('createRunSecretAndJob');
      s.createOpts.push(opts);
      if (opts?.resume && s.resumeCreateFailsRetryable) throw new Error('fetch failed');
      if (opts?.resume && s.resumeCreateFailure !== undefined) {
        throw ApplicationFailure.nonRetryable('the agent or its credential is missing', s.resumeCreateFailure);
      }
      // Stands in for the real mint: the token is used here (written to the run Secret) and never returned.
      s.secretData = { REPO_CLONE_URL: `https://x-access-token:${TOKEN}@example.test/repo.git` };
      s.jobCalled.resolve();
      if (s.createLandsAfterMs !== undefined) {
        await sleepReal(s.createLandsAfterMs);
        s.calls.push('create:done');
      }
      if (s.jobHold)
        await untilSettledOrCancelled(s.jobHold.promise, () => s.calls.push('createRunSecretAndJob:cancelled'));
      return s.plannedRefreshSeconds === undefined ? undefined : { nextRefreshSeconds: s.plannedRefreshSeconds };
    },
    async postComment(ctx, kind, details) {
      const s = script(ctx.runId);
      s.calls.push(`postComment:${kind}`);
      if (kind === 'start' && s.startCommentLandsAfterMs !== undefined) {
        await sleepReal(s.startCommentLandsAfterMs);
        s.calls.push('postComment:start:done');
      }
      s.comments.push(details ? { kind, details } : { kind });
    },
    async followPodLogs(ctx, opts) {
      const s = script(ctx.runId);
      s.calls.push('followPodLogs');
      s.followOpts.push(opts);
      if (s.followPermanent) throw ApplicationFailure.nonRetryable('the cluster refused us', 'ClusterPermanentError');
      if (s.followFailFirst !== undefined && count(s, 'followPodLogs') <= s.followFailFirst) {
        throw new Error('fetch failed');
      }
      if (opts?.resume) {
        s.resumeFollowStarted.resolve();
        if (s.resumeResult) return s.resumeResult;
        s.resumeLogs = deferred();
        s.currentLogs = s.resumeLogs;
        return untilSettledOrCancelled(s.resumeLogs.promise, () => {
          s.logsCancelled = true;
        });
      }
      if (s.firstLine)
        s.statuses.push({ orgId: ctx.orgId, runId: ctx.runId, status: 'running', at: new Date().toISOString() });
      s.logsStarted.resolve();
      return untilSettledOrCancelled(s.logs.promise, () => {
        s.logsCancelled = true;
      });
    },
    async endSession(ctx) {
      const s = script(ctx.runId);
      s.calls.push('endSession');
      if (s.endSessionFailFirst) {
        s.endSessionFailFirst -= 1;
        throw new Error('fetch failed');
      }
      s.endSessionAt = Date.now();
      s.endSessionCalled.resolve();
      if (s.endSessionExits) (s.currentLogs ?? s.logs).resolve({ exitCode: 0 });
    },
    async deleteJob(ctx) {
      const s = script(ctx.runId);
      s.calls.push('deleteJob');
      if (s.deleteJobPermanent) throw ApplicationFailure.nonRetryable('cluster refused', 'ClusterPermanentError');
      if (s.deleteJobFailFirst) {
        s.deleteJobFailFirst -= 1;
        throw new Error('fetch failed');
      }
      await s.onDeleteJob?.();
    },
    async recordEndingDeadline(ctx, input) {
      const s = script(ctx.runId);
      s.calls.push('recordEndingDeadline');
      await s.onRecordEndingDeadline?.();
      if (s.recordEndingDeadlineFails) throw ApplicationFailure.nonRetryable('run not found');
      s.endingDeadlines.push({ scrollbackSaved: input.scrollbackSaved });
    },
    async ensureJobGone(ctx) {
      script(ctx.runId).calls.push('ensureJobGone');
    },
    async deleteRunVolume(ctx) {
      script(ctx.runId).calls.push('deleteRunVolume');
    },
    async parkRun(ctx, input) {
      const s = script(ctx.runId);
      s.calls.push(`parkRun:${input.kind}`);
      s.parkReasons.push(input.reason ?? 'idle_timeout');
      // Like the real activity, the expiry counts from the workflow's own `at`, so time skipping cannot make it stale.
      const sessionExpiresAt =
        s.parkKeepSeconds === undefined
          ? null
          : new Date(Date.parse(input.at) + s.parkKeepSeconds * 1000).toISOString();
      if (sessionExpiresAt !== null) s.lastExpiry = sessionExpiresAt;
      return { status: input.kind === 'done' ? 'succeeded' : 'paused', sessionExpiresAt };
    },
    async endKeptSession(ctx, reason) {
      script(ctx.runId).calls.push(`endKeptSession:${reason}`);
    },
    async restoreParked(ctx, input) {
      const s = script(ctx.runId);
      s.calls.push('restoreParked');
      s.restores.push({ kind: input.kind, sessionExpiresAt: input.sessionExpiresAt, reason: input.reason });
    },
  };
}

function newRun(over: Partial<RunContext> = {}, opts: Partial<Pick<Script, 'firstLine' | 'endSessionExits'>> = {}) {
  const runId = randomUUID();
  const ctx: RunContext = {
    orgId: randomUUID(),
    runId,
    projectId: randomUUID(),
    agentId: randomUUID(),
    status: 'queued',
    timeoutSeconds: 1800,
    maxConcurrentRuns: 2,
    ...over,
  };
  const s: Script = {
    ctx,
    calls: [],
    statuses: [],
    comments: [],
    logs: deferred(),
    firstLine: opts.firstLine ?? true,
    endSessionExits: opts.endSessionExits ?? true,
    logsStarted: deferred(),
    logsCancelled: false,
    jobCalled: deferred(),
    endSessionCalled: deferred(),
    createOpts: [],
    followOpts: [],
    resumeLogs: deferred(),
    resumeFollowStarted: deferred(),
    restores: [],
    endingDeadlines: [],
    parkReasons: [],
  };
  scripts.set(runId, s);
  return s;
}

async function start(s: Script): Promise<WorkflowHandle> {
  return env.client.workflow.start(WORKFLOW.run, {
    taskQueue: TASK_QUEUE,
    workflowId: runWorkflowId(s.ctx.runId),
    args: [{ orgId: s.ctx.orgId, runId: s.ctx.runId }],
  });
}

const statuses = (s: Script): RunStatus[] => s.statuses.map((x) => x.status);
const count = (s: Script, call: string): number => s.calls.filter((c) => c === call).length;
const state = (h: WorkflowHandle) => h.query<RunState>(QUERY.runState);
const sleepReal = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Completed workflow tasks (proto EventType 7) whose scheduled event (5) is a first attempt; a missing attempt, or a
// scheduled event outside the list, counts as the first so the count errs on the strict side. Retried rounds (attempt
// above 1) are left out. Pure, so the history-cost test below can be checked on synthetic event lists.
interface TaskEvent {
  eventId?: { toString(): string } | number | null;
  eventType?: number | null;
  workflowTaskScheduledEventAttributes?: { attempt?: number | null } | null;
  workflowTaskCompletedEventAttributes?: { scheduledEventId?: { toString(): string } | number | null } | null;
}
function firstAttemptCompletedTasks(events: readonly TaskEvent[]): number {
  const retried = new Set(
    events
      .filter((e) => e.eventType === 5 && (e.workflowTaskScheduledEventAttributes?.attempt ?? 1) > 1)
      .map((e) => String(e.eventId)),
  );
  return events.filter(
    (e) => e.eventType === 7 && !retried.has(String(e.workflowTaskCompletedEventAttributes?.scheduledEventId)),
  ).length;
}

async function waitFor(pred: () => boolean | Promise<boolean>, what: string, ms = 15_000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await pred()) return;
    await sleepReal(25);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function waitPhase(h: WorkflowHandle, phase: RunState['phase']): Promise<void> {
  await waitFor(async () => (await state(h)).phase === phase, `phase ${phase}`);
}

/** The gate holds no trace of the run (released, or never queued). */
async function gateForgot(s: Script): Promise<void> {
  const gate = env.client.workflow.getHandle(gateWorkflowId(s.ctx.projectId));
  await waitFor(async () => {
    const g = await gate.query<GateState>(QUERY.gateState);
    return g.settled && !g.active.includes(s.ctx.runId) && !g.queue.includes(s.ctx.runId);
  }, 'gate release');
}

function expectFinishOnce(s: Script): FinishDetails | undefined {
  expect(count(s, 'postComment:finish')).toBe(1);
  return s.comments.find((c) => c.kind === 'finish')?.details;
}

beforeAll(async () => {
  env = await createTimeSkippingTestEnv();
  worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath,
    activities: activities(),
    // Heartbeats are throttled to 0.8 × heartbeatTimeout (48 s) by default; cancellation rides on them.
    maxHeartbeatThrottleInterval: 200,
    defaultHeartbeatThrottleInterval: 200,
  });
  running = worker.run();
}, 240_000);

afterAll(async () => {
  worker.shutdown();
  await running;
  await env.teardown();
});

describe('firstAttemptCompletedTasks (history-cost counter)', () => {
  let id = 0;
  type E = Parameters<typeof firstAttemptCompletedTasks>[0][number];
  const signal = (): E => ({ eventId: ++id, eventType: 26 });
  const scheduled = (attempt?: number): E => ({
    eventId: ++id,
    eventType: 5,
    workflowTaskScheduledEventAttributes: attempt === undefined ? {} : { attempt },
  });
  const started = (): E => ({ eventId: ++id, eventType: 6 });
  const completed = (of: E): E => ({
    eventId: ++id,
    eventType: 7,
    workflowTaskCompletedEventAttributes: { scheduledEventId: of.eventId },
  });
  const round = (attempt?: number): E[] => {
    const sch = scheduled(attempt);
    return [sch, started(), completed(sch)];
  };

  it('counts one per signal round, and a missing attempt counts as the first', () => {
    expect(firstAttemptCompletedTasks([signal(), ...round(1), signal(), ...round()])).toBe(2);
  });

  it('a sticky timeout (orphan scheduled, timed out, fresh attempt-1 task) still counts once', () => {
    const orphan = scheduled(1);
    const timedOut: E = { eventId: ++id, eventType: 8 };
    expect(firstAttemptCompletedTasks([signal(), orphan, timedOut, ...round(1)])).toBe(1);
  });

  it('a retried round (attempt above 1, no trace of the failed attempt) is not counted', () => {
    expect(firstAttemptCompletedTasks([signal(), ...round(1), ...round(2), ...round(3)])).toBe(1);
  });

  it('an extra first-attempt task for one signal is counted, so it can exceed the signal count', () => {
    expect(firstAttemptCompletedTasks([signal(), ...round(1), ...round(1)])).toBe(2);
  });
});

describe('RunWorkflow', () => {
  it('ENDING_DEADLINE_SECONDS_DEFAULT mirrors core', () => {
    expect(ENDING_DEADLINE_SECONDS_DEFAULT).toBe(ENDING_DEADLINE_SECONDS);
    expect(ENDING_DEADLINE_SECONDS).toBe(90);
  });

  it('constants: idle end defaults to 30 minutes; the state query name is shared', () => {
    expect(IDLE_END_SECONDS_DEFAULT).toBe(IDLE_END_SECONDS);
    expect(IDLE_END_SECONDS).toBe(1800);
    expect(signals.runState.name).toBe(QUERY.runState);
    expect(signals.gateState.name).toBe(QUERY.gateState);
  });

  it('success: exit 0 → starting, running, succeeded; one finish comment; slot released', async () => {
    const s = newRun();
    const h = await start(s);
    await s.logsStarted.promise;
    s.logs.resolve({ exitCode: 0 });
    const out = await h.result();
    expect(out).toMatchObject({ status: 'succeeded', exitCode: 0 });
    expect(statuses(s)).toEqual(['starting', 'running', 'succeeded']);
    expect(s.statuses.at(-1)).toMatchObject({ status: 'succeeded', exitCode: 0 });
    expect(s.calls).toEqual([
      'loadRun',
      'requestSlot',
      'createRunSecretAndJob',
      'postComment:start',
      'followPodLogs',
      'ensureJobGone',
      'deleteRunVolume',
      'postComment:finish',
    ]);
    expect(expectFinishOnce(s)).toMatchObject({ status: 'succeeded', exitCode: 0 });
    expect(count(s, 'deleteJob')).toBe(0);
    await gateForgot(s);
    expect((await state(h)).phase).toBe('done');
    lastSuccessHandle = h;
    captured['run-success'] = h;
  });

  it('idle → finish → endSession → logs complete 0 → succeeded; finish while running is ignored', async () => {
    const s = newRun();
    const h = await start(s);
    await s.logsStarted.promise;
    await waitPhase(h, 'running');
    await h.signal(signals.finish);
    await sleepReal(300);
    expect(count(s, 'endSession')).toBe(0);

    await h.signal(signals.turnFinished);
    await waitPhase(h, 'idle');
    await h.signal(signals.finish);
    const out = await h.result();
    expect(out.status).toBe('succeeded');
    expect(count(s, 'endSession')).toBe(1);
    expect(statuses(s)).toEqual(['starting', 'running', 'succeeded']);
    expectFinishOnce(s);
    await gateForgot(s);
  });

  it('resumed while idle writes running and stops the idle timer', async () => {
    const s = newRun({ idleEndSeconds: 1 });
    const h = await start(s);
    await s.logsStarted.promise;
    await h.signal(signals.turnFinished);
    await waitPhase(h, 'idle');
    await h.signal(signals.resumed);
    await waitPhase(h, 'running');
    await sleepReal(1800);
    expect(count(s, 'endSession')).toBe(0);
    expect(statuses(s)).toEqual(['starting', 'running', 'running']);
    s.logs.resolve({ exitCode: 0 });
    expect((await h.result()).status).toBe('succeeded');
  });

  it('idle timeout with no terminal attached → endSession → succeeded', async () => {
    const s = newRun({ idleEndSeconds: 1 });
    const h = await start(s);
    await s.logsStarted.promise;
    const t0 = Date.now();
    await h.signal(signals.turnFinished);
    const out = await h.result();
    expect(out.status).toBe('succeeded');
    expect(count(s, 'endSession')).toBe(1);
    expect((s.endSessionAt ?? 0) - t0).toBeGreaterThanOrEqual(900);
    // Nothing kept: the run closes as succeeded; a person-needed run gets the paused note, not a finish comment.
    expect(count(s, 'postComment:paused')).toBe(1);
  });

  it('idle timer does not fire while a terminal is attached; fires idle-end after the last detach', async () => {
    const s = newRun({ idleEndSeconds: 1 });
    const h = await start(s);
    await s.logsStarted.promise;
    await h.signal(signals.terminalAttached);
    await h.signal(signals.terminalAttached);
    await h.signal(signals.turnFinished);
    await waitPhase(h, 'idle');
    expect((await state(h)).terminalAttached).toBe(2);
    await sleepReal(1800);
    expect(count(s, 'endSession')).toBe(0);
    await h.signal(signals.terminalDetached);
    await sleepReal(1500);
    expect(count(s, 'endSession')).toBe(0);
    const detachedAt = Date.now();
    await h.signal(signals.terminalDetached);
    expect((await h.result()).status).toBe('succeeded');
    expect(count(s, 'endSession')).toBe(1);
    expect((s.endSessionAt ?? 0) - detachedAt).toBeGreaterThanOrEqual(900);
  });

  it('refreshes the workspace token on an interval while the pod runs, and stops when the run ends', async () => {
    const s = newRun({ tokenRefreshSeconds: 1 });
    const h = await start(s);
    await s.logsStarted.promise;
    await waitFor(() => count(s, 'refreshWorkspaceToken') >= 2, 'two refreshes');
    s.logs.resolve({ exitCode: 0 });
    expect((await h.result()).status).toBe('succeeded');
    const after = count(s, 'refreshWorkspaceToken');
    await sleepReal(1600);
    expect(count(s, 'refreshWorkspaceToken')).toBe(after);
    expect(statuses(s)).toEqual(['starting', 'running', 'succeeded']);
    await gateForgot(s);
    captured['run-token-refresh'] = h;
  });

  it('a transient refresh failure is retried and the run is untouched', async () => {
    const s = newRun({ tokenRefreshSeconds: 1 });
    s.refreshFailFirst = 1;
    const h = await start(s);
    await s.logsStarted.promise;
    await waitFor(() => count(s, 'refreshWorkspaceToken') >= 2, 'a retry after the failure');
    expect((await state(h)).phase).toBe('running');
    s.logs.resolve({ exitCode: 0 });
    expect((await h.result()).status).toBe('succeeded');
  });

  it('a refresh that fails for good ends the loop but not the run', async () => {
    const s = newRun({ tokenRefreshSeconds: 1 });
    s.refreshFailsForGood = true;
    const h = await start(s);
    await s.logsStarted.promise;
    await waitFor(() => count(s, 'refreshWorkspaceToken') === 1, 'the failing refresh');
    await sleepReal(2500);
    expect(count(s, 'refreshWorkspaceToken')).toBe(1);
    expect((await state(h)).phase).toBe('running');
    s.logs.resolve({ exitCode: 0 });
    expect((await h.result()).status).toBe('succeeded');
  });

  it('the workspace token never appears in refresh calls or history', async () => {
    const s = newRun({ tokenRefreshSeconds: 1 });
    const h = await start(s);
    await s.logsStarted.promise;
    await waitFor(() => count(s, 'refreshWorkspaceToken') >= 1, 'a refresh');
    s.logs.resolve({ exitCode: 0 });
    await h.result();
    expect(JSON.stringify(await h.fetchHistory())).not.toContain(TOKEN);
  });

  it('uses the refresh delay the activities report when no override is set', async () => {
    const s = newRun();
    s.plannedRefreshSeconds = 1;
    const h = await start(s);
    await s.logsStarted.promise;
    await waitFor(() => count(s, 'refreshWorkspaceToken') >= 2, 'two refreshes at the reported delay');
    s.logs.resolve({ exitCode: 0 });
    expect((await h.result()).status).toBe('succeeded');
  });

  it('a 7 day limit is used as is: the hard timer and the log follower both take it, and the run is not cut short', async () => {
    const week = 604_800;
    const s = newRun({ timeoutSeconds: week });
    const h = await start(s);
    await s.logsStarted.promise;
    await waitPhase(h, 'running');
    // Past the old 3300 s cap's worth of margin in every timeout: nothing was clamped.
    await sleepReal(1500);
    expect((await state(h)).phase).toBe('running');
    expect(statuses(s)).toEqual(['starting', 'running']);
    const events = (await h.fetchHistory()).events ?? [];
    const timers = events
      .map((e) => e.timerStartedEventAttributes?.startToFireTimeout?.seconds)
      .filter((x) => x != null);
    expect(timers.map(String)).toContain(String(week));
    const logsScheduled = events.find(
      (e) => e.activityTaskScheduledEventAttributes?.activityType?.name === 'followPodLogs',
    );
    expect(String(logsScheduled?.activityTaskScheduledEventAttributes?.startToCloseTimeout?.seconds)).toBe(
      String(week + 300),
    );
    s.logs.resolve({ exitCode: 0 });
    expect((await h.result()).status).toBe('succeeded');
  });

  it('a history near the limit ends the run as failed with a plain reason, and cleanup runs', async () => {
    const s = newRun({ historyEventLimit: 52 });
    const h = await start(s);
    await s.logsStarted.promise;
    await waitPhase(h, 'running');
    let done = false;
    const outcome = h.result().finally(() => {
      done = true;
    });
    // Each signal adds events; the run must end on its own once the (lowered) limit is reached.
    for (let i = 0; i < 100 && !done; i++) {
      try {
        await h.signal(signals.terminalAttached);
      } catch (err) {
        // The run ended on its own between the `done` check and the signal: that is the outcome under test.
        if (!(err instanceof WorkflowNotFoundError)) throw err;
        break;
      }
      await sleepReal(20);
    }
    const out = await outcome;
    expect(out.status).toBe('failed');
    expect(out.failureReason).toContain('grew too long');
    expect(count(s, 'deleteJob')).toBe(1);
    expect(expectFinishOnce(s)).toMatchObject({ status: 'failed' });
    expect(s.statuses.at(-1)).toMatchObject({ status: 'failed' });
    await gateForgot(s);
  });

  it('hard timeout at timeoutSeconds → deleteJob, timed_out', async () => {
    const s = newRun({ timeoutSeconds: 2 });
    const h = await start(s);
    await s.logsStarted.promise;
    const out = await h.result();
    expect(out.status).toBe('timed_out');
    expect(statuses(s)).toEqual(['starting', 'running', 'timed_out']);
    expect(count(s, 'deleteJob')).toBe(1);
    expect(count(s, 'ensureJobGone')).toBe(0);
    await waitFor(() => s.logsCancelled, 'followPodLogs cancelled');
    expect(expectFinishOnce(s)).toMatchObject({ status: 'timed_out' });
    await gateForgot(s);
  });

  it('cancel while waiting for a slot → cancelled, no Job, slot released, late grant ignored', async () => {
    const s = newRun({ maxConcurrentRuns: 0 });
    const h = await start(s);
    await waitPhase(h, 'waiting_slot');
    await h.signal(signals.cancel);
    const out = await h.result();
    expect(out.status).toBe('cancelled');
    expect(statuses(s)).toEqual(['cancelled']);
    expect(count(s, 'createRunSecretAndJob')).toBe(0);
    expect(count(s, 'deleteJob')).toBe(0);
    expect(count(s, 'ensureJobGone')).toBe(0);
    expectFinishOnce(s);
    await gateForgot(s);
    // A slot opening up later must not grant (or start) anything for this run.
    await env.client.workflow.getHandle(gateWorkflowId(s.ctx.projectId)).signal(signals.setLimit, 1);
    await gateForgot(s);
    expect(count(s, 'createRunSecretAndJob')).toBe(0);
  });

  it('a run that finds the project gate full posts the queued comment while it waits, then starts when a slot frees', async () => {
    const projectId = randomUUID();
    const first = newRun({ projectId, maxConcurrentRuns: 1 });
    const h1 = await start(first);
    await first.logsStarted.promise;

    const second = newRun({ projectId, maxConcurrentRuns: 1 });
    const h2 = await start(second);
    await waitFor(() => count(second, 'postComment:queued') === 1, 'queued comment');
    expect((await state(h2)).phase).toBe('waiting_slot');
    expect(count(second, 'createRunSecretAndJob')).toBe(0);
    expect(count(first, 'postComment:queued')).toBe(0);

    first.logs.resolve({ exitCode: 0 });
    await h1.result();
    await second.logsStarted.promise;
    expect(second.calls.slice(0, 5)).toEqual([
      'loadRun',
      'requestSlot',
      'postComment:queued',
      'createRunSecretAndJob',
      'postComment:start',
    ]);
    second.logs.resolve({ exitCode: 0 });
    await h2.result();
  });

  it('Review Focus 2: cancel after the Job is created, before the first log line → deleteJob, cancelled, one finish comment', async () => {
    const s = newRun({}, { firstLine: false });
    const h = await start(s);
    await s.logsStarted.promise;
    expect((await state(h)).phase).toBe('running');
    await h.signal(signals.cancel);
    await h.signal(signals.cancel);
    const out = await h.result();
    expect(out.status).toBe('cancelled');
    expect(statuses(s)).toEqual(['starting', 'cancelled']);
    expect(count(s, 'deleteJob')).toBe(1);
    expect(count(s, 'ensureJobGone')).toBe(0);
    await waitFor(() => s.logsCancelled, 'followPodLogs cancelled');
    captured['run-cancel-starting'] = h;
    expect(expectFinishOnce(s)).toMatchObject({ status: 'cancelled' });
    await gateForgot(s);
  });

  it('cancel while createRunSecretAndJob is in flight → deleteJob, cancelled, no start comment', async () => {
    const s = newRun();
    s.jobHold = deferred();
    const h = await start(s);
    await s.jobCalled.promise;
    expect((await state(h)).phase).toBe('starting');
    await h.signal(signals.cancel);
    const out = await h.result();
    expect(out.status).toBe('cancelled');
    expect(statuses(s)).toEqual(['starting', 'cancelled']);
    expect(count(s, 'deleteJob')).toBe(1);
    expect(count(s, 'postComment:start')).toBe(0);
    expect(count(s, 'followPodLogs')).toBe(0);
    expectFinishOnce(s);
    await gateForgot(s);
  });

  it('a result without agentStarted (the old shape) and exit code 2 → failed with exitCode 2; finish comment carries the scrollback tail', async () => {
    const s = newRun();
    const h = await start(s);
    await s.logsStarted.promise;
    s.logs.resolve({ exitCode: 2, scrollbackTail: 'Error: tests failed\n' });
    const out = await h.result();
    expect(out).toMatchObject({ status: 'failed', exitCode: 2 });
    expect(s.statuses.at(-1)).toMatchObject({ status: 'failed', exitCode: 2 });
    expect(expectFinishOnce(s)).toMatchObject({
      status: 'failed',
      exitCode: 2,
      scrollbackTail: 'Error: tests failed\n',
    });
    expect(count(s, 'ensureJobGone')).toBe(1);
    await gateForgot(s);
  });

  it('failed in setup → setRunStatus carries failureStage setup; finish details carry it with no tail', async () => {
    const s = newRun({}, { firstLine: false });
    const h = await start(s);
    await s.logsStarted.promise;
    s.logs.resolve({ exitCode: 78, failureStage: 'setup', setupExitCode: 1, scrollbackTail: 'should be dropped' });
    const out = await h.result();
    expect(out).toMatchObject({ status: 'failed', exitCode: 1, failureReason: 'setup failed (exit 1)' });
    expect(s.statuses.at(-1)).toMatchObject({
      status: 'failed',
      exitCode: 1,
      failureReason: 'setup failed (exit 1)',
      failureStage: 'setup',
    });
    const details = expectFinishOnce(s);
    expect(details).toMatchObject({ status: 'failed', failureReason: 'setup failed (exit 1)', failureStage: 'setup' });
    expect(details?.scrollbackTail).toBeUndefined();
    await gateForgot(s);
  });

  it('setup timed out → failed with reason "setup timed out" and stage setup', async () => {
    const s = newRun({}, { firstLine: false });
    const h = await start(s);
    await s.logsStarted.promise;
    s.logs.resolve({ exitCode: 78, failureStage: 'setup' });
    await h.result();
    expect(s.statuses.at(-1)).toMatchObject({
      status: 'failed',
      failureReason: 'setup timed out',
      failureStage: 'setup',
    });
    await gateForgot(s);
  });

  it('a pre-session exit (agentStarted false) carries no stage; a result lacking the field keeps agent', async () => {
    const pre = newRun({}, { firstLine: false });
    const h1 = await start(pre);
    await pre.logsStarted.promise;
    pre.logs.resolve({ exitCode: 137, agentStarted: false });
    await h1.result();
    expect(pre.statuses.at(-1)?.failureStage).toBeUndefined();
    expect(pre.statuses.at(-1)).toMatchObject({ status: 'failed', exitCode: 137 });
    expect(expectFinishOnce(pre)?.failureStage).toBeUndefined();

    const old = newRun();
    const h2 = await start(old);
    await old.logsStarted.promise;
    old.logs.resolve({ exitCode: 137 });
    await h2.result();
    expect(old.statuses.at(-1)).toMatchObject({ failureStage: 'agent' });
  });

  it('infra failure carries no failure stage; a non-zero exit in a result without agentStarted carries agent', async () => {
    const infra = newRun({}, { firstLine: false });
    const h1 = await start(infra);
    await infra.logsStarted.promise;
    infra.logs.reject(ApplicationFailure.nonRetryable('no node', POD_PENDING_TIMEOUT));
    await h1.result();
    expect(infra.statuses.at(-1)?.failureStage).toBeUndefined();
    expect(expectFinishOnce(infra)?.failureStage).toBeUndefined();

    const agent = newRun();
    const h2 = await start(agent);
    await agent.logsStarted.promise;
    agent.logs.resolve({ exitCode: 3 });
    await h2.result();
    expect(agent.statuses.at(-1)).toMatchObject({ status: 'failed', failureStage: 'agent' });
    expect(expectFinishOnce(agent)).toMatchObject({ failureStage: 'agent' });
  });

  it('followPodLogs fails non-retryably (PodPendingTimeout) → failed with the reason, Job deleted', async () => {
    const s = newRun({}, { firstLine: false });
    const h = await start(s);
    await s.logsStarted.promise;
    const reason = '0/1 nodes are available: 1 Insufficient memory.';
    s.logs.reject(ApplicationFailure.nonRetryable(reason, POD_PENDING_TIMEOUT));
    const out = await h.result();
    expect(out).toMatchObject({ status: 'failed', failureReason: reason });
    expect(s.statuses.at(-1)).toMatchObject({ status: 'failed', failureReason: reason });
    expect(statuses(s)).toEqual(['starting', 'failed']);
    expect(count(s, 'followPodLogs')).toBe(1);
    expect(count(s, 'deleteJob')).toBe(1);
    expect(expectFinishOnce(s)).toMatchObject({ status: 'failed', failureReason: reason });
    await gateForgot(s);
  });

  it('cancel while loadRun is in flight → cancelled, one finish comment, no Job, no slot', async () => {
    const s = newRun();
    s.loadHold = deferred();
    const h = await start(s);
    await waitFor(() => count(s, 'loadRun') === 1, 'loadRun started');
    await h.signal(signals.cancel);
    const out = await h.result();
    expect(out.status).toBe('cancelled');
    expect(statuses(s)).toEqual(['cancelled']);
    expect(expectFinishOnce(s)).toMatchObject({ status: 'cancelled' });
    expect(count(s, 'createRunSecretAndJob')).toBe(0);
    expect(count(s, 'requestSlot')).toBe(0);
    expect(count(s, 'deleteJob') + count(s, 'ensureJobGone')).toBe(0);
    s.loadHold.resolve();
    captured['run-cancel-loading'] = h;
  });

  it('cancel while loadRun is in flight for a run that is already final → no status write, no comment', async () => {
    const s = newRun({ status: 'succeeded' });
    s.loadHold = deferred();
    const h = await start(s);
    await waitFor(() => count(s, 'loadRun') === 1, 'loadRun started');
    await h.signal(signals.cancel);
    expect((await h.result()).status).toBe('succeeded');
    expect(s.statuses).toEqual([]);
    expect(count(s, 'postComment:finish')).toBe(0);
    s.loadHold.resolve();
  });

  it('a run that is already final does nothing', async () => {
    const s = newRun({ status: 'succeeded' });
    const h = await start(s);
    expect((await h.result()).status).toBe('succeeded');
    expect(s.calls).toEqual(['loadRun']);
    expect(s.statuses).toEqual([]);
  });

  it('R19: the workspace token never appears in workflow history', async () => {
    expect(lastSuccessHandle).toBeDefined();
    if (!lastSuccessHandle) return;
    const json = historyToJSON(await lastSuccessHandle.fetchHistory());
    expect(json).toContain('createRunSecretAndJob');
    expect(script(lastSuccessHandle.workflowId.slice('run-'.length)).secretData?.REPO_CLONE_URL).toContain(TOKEN);
    expect(json).not.toContain(TOKEN);
    // Payloads are base64 JSON: check the decoded form too.
    expect(json).not.toContain(Buffer.from(JSON.stringify(TOKEN)).toString('base64').slice(0, 20));
  });

  it('cancel while createRunSecretAndJob is in flight: deleteJob runs only after the create landed', async () => {
    const s = newRun();
    s.createLandsAfterMs = 300;
    const h = await start(s);
    await s.jobCalled.promise;
    await h.signal(signals.cancel);
    const out = await h.result();
    expect(out.status).toBe('cancelled');
    expect(s.calls.indexOf('create:done')).toBeGreaterThanOrEqual(0);
    expect(s.calls.indexOf('create:done')).toBeLessThan(s.calls.indexOf('deleteJob'));
    expect(count(s, 'deleteJob')).toBe(1);
    expect(count(s, 'postComment:start')).toBe(0);
    expect(statuses(s)).toEqual(['starting', 'cancelled']);
    expectFinishOnce(s);
    await gateForgot(s);
  });

  it('hard timeout while postComment(start) is in flight: deleteJob runs only after it landed', async () => {
    const s = newRun({ timeoutSeconds: 1 });
    s.startCommentLandsAfterMs = 1800;
    const h = await start(s);
    const out = await h.result();
    expect(out.status).toBe('timed_out');
    expect(s.calls.indexOf('postComment:start:done')).toBeGreaterThanOrEqual(0);
    expect(s.calls.indexOf('postComment:start:done')).toBeLessThan(s.calls.indexOf('deleteJob'));
    expect(count(s, 'followPodLogs')).toBe(0);
    expect(statuses(s)).toEqual(['starting', 'timed_out']);
    expectFinishOnce(s);
  });

  it('a turn that ends after the workflow wrote running (resumed) gets idle written again', async () => {
    const s = newRun();
    const h = await start(s);
    await s.logsStarted.promise;
    await h.signal(signals.turnFinished);
    await waitPhase(h, 'idle');
    await h.signal(signals.resumed);
    await waitFor(() => statuses(s).length === 3, 'running written after resumed');
    await h.signal(signals.turnFinished);
    await waitFor(() => statuses(s).length === 4, 'idle re-written');
    expect(statuses(s)).toEqual(['starting', 'running', 'running', 'idle']);
    // A plain turn with no resume in between writes nothing from the workflow.
    await h.signal(signals.resumed);
    await waitFor(() => statuses(s).length === 5, 'running');
    await h.signal(signals.turnFinished);
    await waitFor(() => statuses(s).length === 6, 'idle');
    s.logs.resolve({ exitCode: 0 });
    expect((await h.result()).status).toBe('succeeded');
    expect(statuses(s)).toEqual(['starting', 'running', 'running', 'idle', 'running', 'idle', 'succeeded']);
  });

  it('Temporal cancellation (handle.cancel) lands in the same finalize: deleteJob, cancelled, one finish comment', async () => {
    const s = newRun();
    const h = await start(s);
    await s.logsStarted.promise;
    await h.cancel();
    const out = await h.result();
    expect(out.status).toBe('cancelled');
    expect(statuses(s)).toEqual(['starting', 'running', 'cancelled']);
    expect(count(s, 'deleteJob')).toBe(1);
    await waitFor(() => s.logsCancelled, 'followPodLogs cancelled');
    expectFinishOnce(s);
    await gateForgot(s);
  });

  it('finish while ending is ignored', async () => {
    const s = newRun({}, { endSessionExits: false });
    const h = await start(s);
    await s.logsStarted.promise;
    await h.signal(signals.turnFinished);
    await waitPhase(h, 'idle');
    await h.signal(signals.finish);
    await s.endSessionCalled.promise;
    await waitPhase(h, 'ending');
    await h.signal(signals.finish);
    await h.signal(signals.resumed);
    await sleepReal(300);
    expect(count(s, 'endSession')).toBe(1);
    expect((await state(h)).phase).toBe('ending');
    s.logs.resolve({ exitCode: 0 });
    expect((await h.result()).status).toBe('succeeded');
    expect(count(s, 'endSession')).toBe(1);
    expect(statuses(s)).toEqual(['starting', 'running', 'succeeded']);
    captured['run-idle-finish'] = h;
  });

  it('agentState done → done status; idle timer → endSession → succeeded', async () => {
    const s = newRun({ idleEndSeconds: 1 });
    const h = await start(s);
    await s.logsStarted.promise;
    await h.signal(signals.agentState, 'needs_input');
    await waitPhase(h, 'idle');
    await h.signal(signals.agentState, 'working');
    await waitPhase(h, 'running');
    await waitFor(() => statuses(s).length === 3, 'running written');
    await h.signal(signals.agentState, 'done');
    await waitPhase(h, 'agent_done');
    expect((await h.result()).status).toBe('succeeded');
    expect(count(s, 'endSession')).toBe(1);
    // Nothing kept: parkRun writes the final status, so the workflow writes no `succeeded` of its own.
    expect(statuses(s)).toEqual(['starting', 'running', 'running', 'done']);
    expect(count(s, 'parkRun:done')).toBe(1);
  });

  it('agentState waiting keeps running and never starts the idle timer', async () => {
    const s = newRun({ idleEndSeconds: 1 });
    const h = await start(s);
    await s.logsStarted.promise;
    await h.signal(signals.agentState, 'waiting');
    await sleepReal(1800);
    expect((await state(h)).phase).toBe('running');
    expect(count(s, 'endSession')).toBe(0);
    s.logs.resolve({ exitCode: 0 });
    expect((await h.result()).status).toBe('succeeded');
  });

  it('agentState waiting while idle returns to running without a status write (the activity owns that row)', async () => {
    const s = newRun({ idleEndSeconds: 1 });
    const h = await start(s);
    await s.logsStarted.promise;
    await h.signal(signals.agentState, 'needs_input');
    await waitPhase(h, 'idle');
    await h.signal(signals.agentState, 'waiting');
    await waitPhase(h, 'running');
    await sleepReal(1800);
    expect(statuses(s)).toEqual(['starting', 'running']);
    expect(count(s, 'endSession')).toBe(0);
    // A later turn end is still honoured.
    await h.signal(signals.agentState, 'needs_input');
    await waitPhase(h, 'idle');
    s.logs.resolve({ exitCode: 0 });
    expect((await h.result()).status).toBe('succeeded');
  });

  it('agentState waiting while done returns to running without a status write', async () => {
    const s = newRun();
    const h = await start(s);
    await s.logsStarted.promise;
    await h.signal(signals.agentState, 'done');
    await waitPhase(h, 'agent_done');
    await h.signal(signals.agentState, 'waiting');
    await waitPhase(h, 'running');
    await sleepReal(300);
    expect(statuses(s)).toEqual(['starting', 'running']);
    s.logs.resolve({ exitCode: 0 });
    expect((await h.result()).status).toBe('succeeded');
  });

  it('finishRun accepted, then the run is finalized before the session ends → NotFinishable, not a hang', async () => {
    const s = newRun();
    const h = await start(s);
    await s.logsStarted.promise;
    await h.signal(signals.agentState, 'needs_input');
    await waitPhase(h, 'idle');
    // Keep the main loop busy writing `running` so it cannot reach `ending = true` before the cancel lands.
    const hold = deferred<void>();
    s.holdNextRunning = hold;
    await h.signal(signals.agentState, 'working');
    await waitPhase(h, 'running');
    await h.signal(signals.agentState, 'needs_input');
    await waitPhase(h, 'idle');
    const update = await h.startUpdate(signals.finishRun, { waitForStage: 'ACCEPTED' });
    await h.signal(signals.cancel);
    await expect(update.result()).rejects.toMatchObject({ cause: { type: 'NotFinishable' } });
    hold.resolve();
    expect((await h.result()).status).toBe('cancelled');
  });

  it('agentState working while done writes running and stops the idle timer', async () => {
    const s = newRun({ idleEndSeconds: 1 });
    const h = await start(s);
    await s.logsStarted.promise;
    await h.signal(signals.agentState, 'done');
    await waitPhase(h, 'agent_done');
    await h.signal(signals.agentState, 'working');
    await waitPhase(h, 'running');
    await waitFor(() => statuses(s).length === 3, 'running written');
    await sleepReal(1800);
    expect(count(s, 'endSession')).toBe(0);
    expect(statuses(s)).toEqual(['starting', 'running', 'running']);
    await expect(h.executeUpdate(signals.finishRun)).rejects.toThrow();
    s.logs.resolve({ exitCode: 0 });
    expect((await h.result()).status).toBe('succeeded');
  });

  it('finishRun in idle and in done → accepted, endSession, succeeded', async () => {
    for (const first of ['needs_input', 'done'] as const) {
      const s = newRun();
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, first);
      await waitPhase(h, first === 'done' ? 'agent_done' : 'idle');
      expect(await h.executeUpdate(signals.finishRun)).toEqual({ accepted: true });
      expect((await h.result()).status).toBe('succeeded');
      expect(count(s, 'endSession')).toBe(1);
    }
  });

  it('finishRun while running is rejected with NotFinishable and the run keeps going', async () => {
    const s = newRun();
    const h = await start(s);
    await s.logsStarted.promise;
    await waitPhase(h, 'running');
    await expect(h.executeUpdate(signals.finishRun)).rejects.toMatchObject({
      cause: { type: 'NotFinishable', message: expect.stringContaining('phase is running') as unknown },
    });
    await sleepReal(300);
    expect(count(s, 'endSession')).toBe(0);
    expect((await state(h)).phase).toBe('running');
    s.logs.resolve({ exitCode: 0 });
    expect((await h.result()).status).toBe('succeeded');
  });

  it('hard timeout while done → succeeded; while idle → timed_out', async () => {
    const d = newRun({ timeoutSeconds: 2 });
    const hd = await start(d);
    await d.logsStarted.promise;
    await hd.signal(signals.agentState, 'done');
    await waitPhase(hd, 'agent_done');
    expect((await hd.result()).status).toBe('succeeded');
    expect(count(d, 'deleteJob')).toBe(1);

    const i = newRun({ timeoutSeconds: 2 });
    const hi = await start(i);
    await i.logsStarted.promise;
    await hi.signal(signals.agentState, 'needs_input');
    await waitPhase(hi, 'idle');
    expect((await hi.result()).status).toBe('timed_out');
  });

  it('finalize deletes the run volume once, after the Job is gone', async () => {
    const s = newRun({ timeoutSeconds: 1 });
    const h = await start(s);
    await s.logsStarted.promise;
    expect((await h.result()).status).toBe('timed_out');
    expect(count(s, 'deleteRunVolume')).toBe(1);
    expect(s.calls.indexOf('deleteJob')).toBeLessThan(s.calls.indexOf('deleteRunVolume'));
  });

  describe('parking (pause-resume)', () => {
    /** Idle (or done) run whose idle timer fires after 1 s; resolves once the workflow is parked. */
    async function parkedRun(
      kind: 'needs_input' | 'done',
      over: Partial<RunContext> = {},
      keep: number | undefined = 3600,
    ) {
      const s = newRun({ idleEndSeconds: 1, ...over });
      s.parkKeepSeconds = keep;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, kind);
      await waitPhase(h, 'parked');
      return { s, h };
    }

    it('idle: ends the session, frees the slot, parks as needs_input, posts the paused comment, keeps the volume', async () => {
      const { s, h } = await parkedRun('needs_input');
      expect(s.calls.slice(s.calls.indexOf('followPodLogs') + 1)).toEqual([
        'endSession',
        'deleteJob',
        'parkRun:needs_input',
        'postComment:paused',
      ]);
      // A finished Job must not survive the park: a resume would otherwise follow its exited pod (ensureJob keeps it).
      expect(count(s, 'ensureJobGone')).toBe(0);
      await gateForgot(s);
      expect(count(s, 'deleteRunVolume')).toBe(0);
      expect(count(s, 'postComment:finish')).toBe(0);
      expect(statuses(s)).toEqual(['starting', 'running']);
      expect((await state(h)).phase).toBe('parked');
      await h.signal(signals.cancel);
      expect((await h.result()).status).toBe('cancelled');
    });

    it('done: parks as done and posts the normal finish comment as succeeded', async () => {
      const { s, h } = await parkedRun('done');
      expect(count(s, 'parkRun:done')).toBe(1);
      expect(count(s, 'postComment:paused')).toBe(0);
      expect(expectFinishOnce(s)).toMatchObject({ status: 'succeeded' });
      expect(count(s, 'deleteRunVolume')).toBe(0);
      expect((await state(h)).phase).toBe('parked');
      await h.signal(signals.dropSession);
      expect((await h.result()).status).toBe('succeeded');
    });

    it('a parked needs_input run whose keep time passes expires: session ended, volume deleted, finish comment expired', async () => {
      // Real seconds, not 3600: other tests leave activities in flight, which stops the test server skipping time.
      const { s, h } = await parkedRun('needs_input', {}, 2);
      const out = await h.result();
      expect(out).toEqual({ status: 'expired' });
      expect(count(s, 'endKeptSession:expired')).toBe(1);
      expect(count(s, 'deleteRunVolume')).toBe(1);
      expect(count(s, 'postComment:finish')).toBe(1);
      expect(s.comments.find((c) => c.kind === 'finish')?.details).toMatchObject({ status: 'expired' });
      expect((await state(h)).phase).toBe('done');
      captured['run-park-expire'] = h;
    });

    it('a parked done run whose keep time passes ends its session without a second comment and stays succeeded', async () => {
      const { s, h } = await parkedRun('done', {}, 2);
      expect((await h.result()).status).toBe('succeeded');
      expect(count(s, 'endKeptSession:expired')).toBe(1);
      expect(count(s, 'deleteRunVolume')).toBe(1);
      expect(count(s, 'postComment:finish')).toBe(1);
    });

    it('dropSession on a parked done run ends the session as dropped and deletes the volume', async () => {
      const { s, h } = await parkedRun('done');
      await h.signal(signals.dropSession);
      expect((await h.result()).status).toBe('succeeded');
      expect(count(s, 'endKeptSession:dropped')).toBe(1);
      expect(count(s, 'endKeptSession:expired')).toBe(0);
      expect(count(s, 'deleteRunVolume')).toBe(1);
      expect(count(s, 'postComment:finish')).toBe(1);
    });

    it('dropSession on a parked needs_input run is ignored', async () => {
      const { s, h } = await parkedRun('needs_input');
      await h.signal(signals.dropSession);
      await sleepReal(300);
      expect((await state(h)).phase).toBe('parked');
      expect(count(s, 'endKeptSession:dropped')).toBe(0);
      expect(count(s, 'deleteRunVolume')).toBe(0);
      await h.signal(signals.cancel);
      await h.result();
    });

    it('finishRun on a parked needs_input run is accepted: volume deleted, succeeded with no session, finish comment', async () => {
      const { s, h } = await parkedRun('needs_input');
      expect(await h.executeUpdate(signals.finishRun)).toEqual({ accepted: true });
      expect((await h.result()).status).toBe('succeeded');
      expect(count(s, 'deleteRunVolume')).toBe(1);
      expect(s.statuses.at(-1)).toMatchObject({ status: 'succeeded', session: null });
      expect(expectFinishOnce(s)).toMatchObject({ status: 'succeeded' });
      expect(count(s, 'endKeptSession:expired')).toBe(0);
    });

    it('finishRun on a parked done run is rejected with NotFinishable', async () => {
      const { h } = await parkedRun('done');
      await expect(h.executeUpdate(signals.finishRun)).rejects.toMatchObject({ cause: { type: 'NotFinishable' } });
      expect((await state(h)).phase).toBe('parked');
      await h.signal(signals.dropSession);
      await h.result();
    });

    it('cancel on a parked needs_input run ends it as cancelled and deletes the volume', async () => {
      const { s, h } = await parkedRun('needs_input');
      await h.signal(signals.cancel);
      expect((await h.result()).status).toBe('cancelled');
      expect(s.statuses.at(-1)).toMatchObject({ status: 'cancelled', session: null });
      expect(count(s, 'deleteRunVolume')).toBe(1);
      expectFinishOnce(s);
    });

    it('cancel on a parked done run changes nothing', async () => {
      const { s, h } = await parkedRun('done');
      await h.signal(signals.cancel);
      await sleepReal(300);
      expect((await state(h)).phase).toBe('parked');
      expect(statuses(s)).toEqual(['starting', 'running']);
      expect(count(s, 'deleteRunVolume')).toBe(0);
      await h.signal(signals.dropSession);
      await h.result();
    });

    it('nothing kept (null expiry): the volume is deleted and the run closes as succeeded without finalize', async () => {
      const { s, h } = await parkedRunOrClosed('done');
      expect((await h.result()).status).toBe('succeeded');
      expect(count(s, 'deleteRunVolume')).toBe(1);
      expect(count(s, 'deleteJob')).toBe(1);
      expect(count(s, 'ensureJobGone')).toBe(0);
      expect(expectFinishOnce(s)).toMatchObject({ status: 'succeeded' });
      expect(statuses(s)).toEqual(['starting', 'running']);
    });

    async function parkedRunOrClosed(kind: 'needs_input' | 'done') {
      const s = newRun({ idleEndSeconds: 1 });
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, kind);
      return { s, h };
    }

    it('Review Focus 1: attach and working after the session end began still park; no running status after the park', async () => {
      const s = newRun({ idleEndSeconds: 1 }, { endSessionExits: false });
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'needs_input');
      await s.endSessionCalled.promise;
      await h.signal(signals.terminalAttached);
      await h.signal(signals.agentState, 'working');
      await sleepReal(200);
      expect((await state(h)).phase).toBe('ending');
      s.logs.resolve({ exitCode: 0 });
      await waitPhase(h, 'parked');
      expect(statuses(s)).toEqual(['starting', 'running']);
      expect((await state(h)).terminalAttached).toBe(0);
      expect(count(s, 'parkRun:needs_input')).toBe(1);
      await h.signal(signals.cancel);
      await h.result();
    });

    it('a person pressing Finish on a live idle run ends it: volume deleted, succeeded, never parked', async () => {
      const s = newRun();
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'needs_input');
      await waitPhase(h, 'idle');
      await h.executeUpdate(signals.finishRun);
      expect((await h.result()).status).toBe('succeeded');
      expect(count(s, 'parkRun:needs_input')).toBe(0);
      expect(count(s, 'deleteRunVolume')).toBe(1);
      expect(s.statuses.at(-1)).toMatchObject({ status: 'succeeded', session: null });
    });
  });

  describe('resuming (pause-resume)', () => {
    /** A run parked after 1 s idle (kept `keep` s); resolves once parked. */
    async function parked(kind: 'needs_input' | 'done', over: Partial<RunContext> = {}, keep = 3600) {
      const s = newRun({ idleEndSeconds: 1, ...over });
      s.parkKeepSeconds = keep;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, kind);
      await waitPhase(h, 'parked');
      return { s, h };
    }
    /** Presses Resume and waits until the resumed pod's Job is requested. */
    async function resume(s: Script, h: WorkflowHandle) {
      expect(await h.executeUpdate(signals.resumeRun)).toEqual({ accepted: true });
      await waitFor(() => count(s, 'createRunSecretAndJob') >= 2, 'resume Job');
    }
    /** A resumed run that is up and held live: a terminal is attached so the idle timer stays off. */
    async function live(kind: 'needs_input' | 'done', over: Partial<RunContext> = {}) {
      const { s, h } = await parked(kind, over);
      await resume(s, h);
      await h.signal(signals.sessionStarted);
      await waitFor(() => statuses(s).at(-1) === (kind === 'done' ? 'done' : 'idle'), 'resumed status');
      await h.signal(signals.terminalAttached);
      return { s, h };
    }

    it('needs_input: queued, starting, then idle after sessionStarted; Job and logs started in resume mode', async () => {
      const { s, h } = await parked('needs_input');
      await resume(s, h);
      expect((await state(h)).phase).toBe('resuming');
      await h.signal(signals.sessionStarted);
      await waitFor(() => statuses(s).at(-1) === 'idle', 'idle after resume');
      expect(statuses(s)).toEqual(['starting', 'running', 'queued', 'starting', 'idle']);
      expect(s.statuses[2]).toMatchObject({ status: 'queued', reopen: true, keepAgentNote: true });
      expect(s.statuses[4]).toMatchObject({ status: 'idle', keepAgentNote: true, session: null });
      expect(count(s, 'requestSlot')).toBe(2);
      expect(s.createOpts[1]).toEqual({ resume: true, deadlineSeconds: 3600 });
      expect(s.followOpts[1]).toEqual({ resume: true });
      await h.signal(signals.terminalAttached);
      expect((await state(h)).phase).toBe('idle');
      // A repeated sessionStarted changes nothing.
      await h.signal(signals.sessionStarted);
      await sleepReal(200);
      expect(statuses(s)).toHaveLength(5);
      await h.signal(signals.cancel);
      expect((await h.result()).status).toBe('cancelled');
      captured['run-park-resume'] = h;
    });

    it('done: the queued write re-opens and the run ends the resume in done, not idle', async () => {
      const { s, h } = await live('done');
      expect(s.statuses.find((x) => x.status === 'queued')).toMatchObject({ reopen: true, keepAgentNote: true });
      expect(statuses(s).at(-1)).toBe('done');
      expect((await state(h)).phase).toBe('agent_done');
      await h.signal(signals.cancel);
      expect((await h.result()).status).toBe('cancelled');
    });

    it('a resumed run left unattended parks again with a fresh keep time', async () => {
      const { s, h } = await parked('needs_input');
      await resume(s, h);
      await h.signal(signals.sessionStarted);
      await waitFor(() => count(s, 'parkRun:needs_input') === 2, 'second park');
      await waitPhase(h, 'parked');
      expect(count(s, 'endSession')).toBe(2);
      expect(count(s, 'deleteRunVolume')).toBe(0);
      await h.signal(signals.cancel);
      expect((await h.result()).status).toBe('cancelled');
    });

    it('Review Focus 2: a second resume while resuming is rejected and asks for one slot only', async () => {
      const { s, h } = await parked('needs_input');
      s.jobHold = deferred();
      expect(await h.executeUpdate(signals.resumeRun)).toEqual({ accepted: true });
      await waitFor(() => count(s, 'createRunSecretAndJob') >= 2, 'resume Job');
      await expect(h.executeUpdate(signals.resumeRun)).rejects.toMatchObject({
        cause: { type: 'NotResumable', message: 'This run is already being resumed' },
      });
      expect(count(s, 'requestSlot')).toBe(2);
      s.jobHold.resolve();
      await h.signal(signals.sessionStarted);
      await waitFor(() => statuses(s).at(-1) === 'idle', 'idle');
      await h.executeUpdate(signals.resumeRun).then(
        () => {
          throw new Error('a live run must not be resumable');
        },
        () => undefined,
      );
      await h.signal(signals.terminalAttached);
      await h.signal(signals.cancel);
      await h.result();
    });

    it('Review Focus 3: the keep time runs out while the resume waits for a slot; the resume still wins', async () => {
      const projectId = randomUUID();
      const { s, h } = await parked('needs_input', { projectId, maxConcurrentRuns: 1 }, 2);
      // Another run takes the only slot, so the resume has to queue.
      const other = newRun({ projectId, maxConcurrentRuns: 1 });
      const ho = await start(other);
      await other.logsStarted.promise;
      expect(await h.executeUpdate(signals.resumeRun)).toEqual({ accepted: true });
      await sleepReal(3000);
      expect(count(s, 'endKeptSession:expired')).toBe(0);
      expect((await state(h)).phase).toBe('resuming');
      expect(count(s, 'createRunSecretAndJob')).toBe(1);
      other.logs.resolve({ exitCode: 0 });
      await ho.result();
      await waitFor(() => count(s, 'createRunSecretAndJob') === 2, 'resume Job after the slot');
      await h.signal(signals.sessionStarted);
      await waitFor(() => statuses(s).at(-1) === 'idle', 'idle');
      expect(count(s, 'endKeptSession:expired')).toBe(0);
      await h.signal(signals.terminalAttached);
      await h.signal(signals.cancel);
      expect((await h.result()).status).toBe('cancelled');
    });

    it('Review Focus 4: exit 79 before the session started puts the run back; nothing is retried, volume kept', async () => {
      const { s, h } = await parked('needs_input');
      s.resumeResult = { exitCode: 79, resumeFailed: true };
      expect(await h.executeUpdate(signals.resumeRun)).toEqual({ accepted: true });
      await waitFor(() => count(s, 'restoreParked') === 1, 'restoreParked');
      await waitPhase(h, 'parked');
      expect(s.restores).toEqual([
        { kind: 'needs_input', sessionExpiresAt: s.lastExpiry, reason: 'no saved session was found' },
      ]);
      expect(count(s, 'deleteJob')).toBe(2); // the park's, and the failed resume's
      expect(count(s, 'deleteRunVolume')).toBe(0);
      expect(count(s, 'createRunSecretAndJob')).toBe(2);
      expect(statuses(s)).toEqual(['starting', 'running', 'queued', 'starting']);
      await gateForgot(s);
      await h.signal(signals.cancel);
      expect((await h.result()).status).toBe('cancelled');
    });

    it('a missing agent credential puts the run back with a plain reason', async () => {
      const { s, h } = await parked('needs_input');
      s.resumeCreateFailure = 'NoAgentCredential';
      expect(await h.executeUpdate(signals.resumeRun)).toEqual({ accepted: true });
      await waitFor(() => count(s, 'restoreParked') === 1, 'restoreParked');
      expect(s.restores[0]?.reason).toBe('the agent or its credential is missing');
      await waitPhase(h, 'parked');
      expect(count(s, 'deleteJob')).toBe(2); // the park's, and the failed resume's
      await gateForgot(s);
      await h.signal(signals.cancel);
      await h.result();
    });

    it('a pod that exits before the session started puts the run back with a plain reason', async () => {
      const { s, h } = await parked('done');
      s.resumeResult = { exitCode: 1 };
      expect(await h.executeUpdate(signals.resumeRun)).toEqual({ accepted: true });
      await waitFor(() => count(s, 'restoreParked') === 1, 'restoreParked');
      expect(s.restores[0]).toMatchObject({ kind: 'done', reason: 'the pod could not start' });
      await waitPhase(h, 'parked');
      await h.signal(signals.dropSession);
      await h.result();
    });

    it('cancel while resuming, before the session started, cancels only the resume', async () => {
      const { s, h } = await parked('needs_input');
      s.jobHold = deferred();
      expect(await h.executeUpdate(signals.resumeRun)).toEqual({ accepted: true });
      await waitFor(() => count(s, 'createRunSecretAndJob') >= 2, 'resume Job');
      await h.signal(signals.cancel);
      await waitFor(() => count(s, 'restoreParked') === 1, 'restoreParked');
      expect(s.restores[0]?.reason).toBe('the resume was cancelled');
      await waitPhase(h, 'parked');
      expect(statuses(s)).not.toContain('cancelled');
      expect(count(s, 'deleteRunVolume')).toBe(0);
      await gateForgot(s);
      await h.signal(signals.cancel);
      expect((await h.result()).status).toBe('cancelled');
    });

    it('cancel after the session started ends the run as cancelled and deletes the volume', async () => {
      const { s, h } = await live('needs_input');
      await h.signal(signals.cancel);
      expect((await h.result()).status).toBe('cancelled');
      expect(s.statuses.at(-1)).toMatchObject({ status: 'cancelled', session: null });
      expect(count(s, 'deleteRunVolume')).toBe(1);
      expect(count(s, 'restoreParked')).toBe(0);
    });

    it('a fallback after the original expiry has passed restores the run and then expires it at once', async () => {
      const { s, h } = await parked('needs_input', {}, 2);
      s.jobHold = deferred();
      expect(await h.executeUpdate(signals.resumeRun)).toEqual({ accepted: true });
      await waitFor(() => count(s, 'createRunSecretAndJob') >= 2, 'resume Job');
      await sleepReal(2500);
      expect(count(s, 'endKeptSession:expired')).toBe(0);
      await h.signal(signals.cancel);
      expect(await h.result()).toEqual({ status: 'expired' });
      expect(s.calls.indexOf('restoreParked')).toBeLessThan(s.calls.indexOf('endKeptSession:expired'));
      expect(count(s, 'deleteRunVolume')).toBe(1);
    });

    it('time limit: the resumed pod gets the rest of the limit, never less than an hour; parked time is not counted', async () => {
      const big = await parked('needs_input', { timeoutSeconds: 7200 });
      await sleepReal(2500);
      await resume(big.s, big.h);
      const allowance = big.s.createOpts[1]?.deadlineSeconds ?? 0;
      // Used time is the first pod's ~1 s idle wait; the 2.5 s spent parked must not be in it.
      expect(allowance).toBeGreaterThanOrEqual(7197);
      expect(allowance).toBeLessThanOrEqual(7199);
      await big.h.signal(signals.sessionStarted);
      await waitFor(() => statuses(big.s).at(-1) === 'idle', 'idle');
      await big.h.signal(signals.terminalAttached);
      await big.h.signal(signals.cancel);
      await big.h.result();

      const small = await parked('needs_input', { timeoutSeconds: 100 });
      await resume(small.s, small.h);
      expect(small.s.createOpts[1]?.deadlineSeconds).toBe(3600);
      await small.h.signal(signals.sessionStarted);
      await waitFor(() => statuses(small.s).at(-1) === 'idle', 'idle');
      await small.h.signal(signals.terminalAttached);
      await small.h.signal(signals.cancel);
      await small.h.result();
    });

    it('the hard timer fires in a resumed pod: timed_out, volume deleted (succeeded when it had declared done)', async () => {
      // `resumeMinSeconds` is the test seam for the one-hour floor, so the allowance (limit 5 s, ~1 s used) is real seconds.
      const over = { timeoutSeconds: 5, resumeMinSeconds: 1 };
      const a = await live('needs_input', over);
      expect(a.s.createOpts[1]?.deadlineSeconds).toBeGreaterThanOrEqual(3);
      expect(a.s.createOpts[1]?.deadlineSeconds).toBeLessThanOrEqual(4);
      expect((await a.h.result()).status).toBe('timed_out');
      expect(count(a.s, 'deleteRunVolume')).toBe(1);
      expect(a.s.statuses.at(-1)).toMatchObject({ status: 'timed_out', session: null });

      const b = await live('done', over);
      expect((await b.h.result()).status).toBe('succeeded');
      expect(count(b.s, 'deleteRunVolume')).toBe(1);
    });
  });

  describe('ending deadline', () => {
    it('a pod that never exits is deleted and the run parks', async () => {
      const s = newRun({ idleEndSeconds: 1, endingDeadlineSeconds: 2 }, { endSessionExits: false });
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      const t0 = Date.now();
      await h.signal(signals.agentState, 'needs_input');
      await s.endSessionCalled.promise;
      await waitPhase(h, 'parked');
      expect(Date.now() - t0).toBeGreaterThanOrEqual(2900);
      expect(count(s, 'deleteJob')).toBeGreaterThanOrEqual(1);
      // The activity hears about the cancel on its next heartbeat.
      await waitFor(() => s.logsCancelled, 'followPodLogs cancelled');
      expect(count(s, 'parkRun:needs_input')).toBe(1);
      expect(s.endingDeadlines).toEqual([{ scrollbackSaved: false }]);
      expect(statuses(s)).toEqual(['starting', 'running']);
      captured['run-ending-deadline'] = h;
      await h.signal(signals.cancel);
      await h.result();
    });

    it('after Finish the deadline ends the run succeeded, not parked', async () => {
      const s = newRun({ endingDeadlineSeconds: 1 }, { endSessionExits: false });
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'needs_input');
      await waitPhase(h, 'idle');
      await h.executeUpdate(signals.finishRun);
      expect((await h.result()).status).toBe('succeeded');
      expect(count(s, 'deleteJob')).toBeGreaterThanOrEqual(1);
      expect(count(s, 'parkRun:needs_input')).toBe(0);
      expect(s.endingDeadlines).toEqual([{ scrollbackSaved: false }]);
    });

    it('a pod that exits before the deadline does not delete the Job early or record the event', async () => {
      const s = newRun({ idleEndSeconds: 1, endingDeadlineSeconds: 5 }, { endSessionExits: false });
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'needs_input');
      await s.endSessionCalled.promise;
      await sleepReal(300);
      expect(count(s, 'deleteJob')).toBe(0);
      s.logs.resolve({ exitCode: 0 });
      await waitPhase(h, 'parked');
      expect(s.endingDeadlines).toEqual([]);
      expect(s.logsCancelled).toBe(false);
      // park() deletes the Job once; the deadline did not.
      expect(count(s, 'deleteJob')).toBe(1);
      await h.signal(signals.cancel);
      await h.result();
    });

    it('a pod that disappears while its Job is being deleted does not fail the run', async () => {
      const s = newRun({ idleEndSeconds: 1, endingDeadlineSeconds: 1 }, { endSessionExits: false });
      s.parkKeepSeconds = 3600;
      s.onDeleteJob = async () => {
        // followPodLogs rejects (non-retryable) while deleteJob is still running, then deleteJob takes a while longer.
        if (count(s, 'deleteJob') === 1) {
          s.logs.reject(ApplicationFailure.nonRetryable('run pod disappeared'));
          await sleepReal(500);
        }
      };
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'needs_input');
      await waitPhase(h, 'parked');
      expect(count(s, 'parkRun:needs_input')).toBe(1);
      await h.signal(signals.cancel);
      expect((await h.result()).status).not.toBe('failed');
    });

    it('a failing recordEndingDeadline does not fail the run', async () => {
      const s = newRun({ idleEndSeconds: 1, endingDeadlineSeconds: 1 }, { endSessionExits: false });
      s.parkKeepSeconds = 3600;
      s.recordEndingDeadlineFails = true;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'needs_input');
      await waitPhase(h, 'parked');
      expect(count(s, 'recordEndingDeadline')).toBe(1);
      expect(count(s, 'parkRun:needs_input')).toBe(1);
      await h.signal(signals.cancel);
      await h.result();
    });

    it('a cancel while the deadline event is being recorded still ends the run cancelled', async () => {
      // Nothing kept: without the cancel the run would end succeeded.
      const s = newRun({ idleEndSeconds: 1, endingDeadlineSeconds: 1 }, { endSessionExits: false });
      const recording = deferred<void>();
      s.onRecordEndingDeadline = async () => {
        recording.resolve();
        await sleepReal(3000);
      };
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'needs_input');
      await recording.promise;
      await h.cancel();
      expect((await h.result()).status).toBe('cancelled');
      expect(count(s, 'parkRun:needs_input')).toBe(0);
    });

    it('other wakes during ending do not reset the deadline', async () => {
      const s = newRun({ idleEndSeconds: 1, endingDeadlineSeconds: 6 }, { endSessionExits: false });
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'needs_input');
      await s.endSessionCalled.promise;
      const t0 = Date.now();
      // Two wakes, 1.2 s and 2.4 s in. The stuck follower is given up on 5 s (ABANDON_GRACE_MS) after the delete, so
      // the park lands that much after the deadline. Without a reset it lands at about 11.16 s (6 s + 5 s plus about
      // 0.16 s of overhead measured here). A reset by the first wake alone would land at about 12.4 s, by the second
      // alone at about 13.6 s. The 11.8 s ceiling therefore fails if either wake restarts the deadline, with 0.6 s of
      // slack on each side; the 10.6 s floor catches an early park.
      await sleepReal(1200);
      await h.signal(signals.terminalAttached);
      await sleepReal(1200);
      await h.signal(signals.terminalDetached);
      await waitPhase(h, 'parked');
      const took = Date.now() - t0;
      expect(took).toBeGreaterThanOrEqual(10600);
      expect(took).toBeLessThan(11800);
      expect(count(s, 'deleteJob')).toBeGreaterThanOrEqual(1);
      await h.signal(signals.cancel);
      await h.result();
    });
  });

  describe('pod lost and agent crash (pod-lost-parks)', () => {
    it('a pod killed while idle parks as pod_lost: paused, the volume kept', async () => {
      const s = newRun({}, { endSessionExits: false });
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'needs_input');
      await waitPhase(h, 'idle');
      // The pod is killed (OOM, eviction): no end line, an exit code.
      s.logs.resolve({ exitCode: 137, agentStarted: true });
      await waitPhase(h, 'parked');
      expect(s.parkReasons).toEqual(['pod_lost']);
      expect(count(s, 'parkRun:needs_input')).toBe(1);
      expect(count(s, 'deleteRunVolume')).toBe(0);
      expect(count(s, 'endSession')).toBe(0);
      expect(statuses(s)).toEqual(['starting', 'running']);
      captured['run-pod-lost'] = h;
      await h.signal(signals.cancel);
      expect((await h.result()).status).toBe('cancelled');
      expect(count(s, 'deleteRunVolume')).toBe(1);
    });

    it('a pod that vanished while the agent worked parks as pod_lost', async () => {
      const s = newRun();
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      s.logs.resolve({ exitCode: -1, agentStarted: true, podLost: true });
      await waitPhase(h, 'parked');
      expect(s.parkReasons).toEqual(['pod_lost']);
      expect(count(s, 'deleteRunVolume')).toBe(0);
      await h.signal(signals.cancel);
      await h.result();
    });

    it('an agent that exits non-zero parks as agent_crashed (D1): paused, the volume kept, not failed', async () => {
      const s = newRun();
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      s.logs.resolve({ exitCode: 1, endReason: 'agent_exit', agentStarted: true });
      await waitPhase(h, 'parked');
      expect(s.parkReasons).toEqual(['agent_crashed']);
      expect(count(s, 'parkRun:needs_input')).toBe(1);
      expect(count(s, 'deleteRunVolume')).toBe(0);
      expect(statuses(s)).not.toContain('failed');
      await h.signal(signals.cancel);
      await h.result();
    });

    it('an agent that exits non-zero after declaring done parks as a kept done run with agent_crashed', async () => {
      const s = newRun();
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'done');
      await waitPhase(h, 'agent_done');
      s.logs.resolve({ exitCode: 2, endReason: 'agent_exit', agentStarted: true });
      await waitPhase(h, 'parked');
      expect(s.parkReasons).toEqual(['agent_crashed']);
      expect(count(s, 'parkRun:done')).toBe(1);
      expect(count(s, 'deleteRunVolume')).toBe(0);
      await h.signal(signals.dropSession);
      expect((await h.result()).status).toBe('succeeded');
    });

    it('an agent that exits 0 still succeeds', async () => {
      const s = newRun();
      const h = await start(s);
      await s.logsStarted.promise;
      s.logs.resolve({ exitCode: 0, endReason: 'agent_exit', agentStarted: true });
      expect(await h.result()).toMatchObject({ status: 'succeeded', exitCode: 0 });
      expect(count(s, 'parkRun:needs_input')).toBe(0);
      expect(count(s, 'deleteRunVolume')).toBe(1);
    });

    it('the idle timer parks with the idle_timeout reason', async () => {
      const s = newRun({ idleEndSeconds: 1 });
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'needs_input');
      await waitPhase(h, 'parked');
      expect(s.parkReasons).toEqual(['idle_timeout']);
      await h.signal(signals.cancel);
      await h.result();
    });

    it('a resume sent while the session is ending is accepted and a new pod starts after the park', async () => {
      const s = newRun({ idleEndSeconds: 1, endingDeadlineSeconds: 30 }, { endSessionExits: false });
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'needs_input');
      await s.endSessionCalled.promise;
      expect((await state(h)).phase).toBe('ending');
      expect(await h.executeUpdate(signals.resumeRun)).toEqual({ accepted: true });
      // Still ending: the queued resume starts nothing before the park.
      expect((await state(h)).phase).toBe('ending');
      expect(count(s, 'createRunSecretAndJob')).toBe(1);
      await expect(h.executeUpdate(signals.resumeRun)).rejects.toMatchObject({
        cause: { type: 'NotResumable', message: 'This run is already being resumed' },
      });
      s.logs.resolve({ exitCode: 0, agentStarted: true });
      await waitFor(() => count(s, 'createRunSecretAndJob') >= 2, 'resume Job');
      expect(count(s, 'parkRun:needs_input')).toBe(1);
      await h.signal(signals.sessionStarted);
      await waitFor(() => statuses(s).at(-1) === 'idle', 'idle after resume');
      await h.signal(signals.terminalAttached);
      await h.signal(signals.cancel);
      expect((await h.result()).status).toBe('cancelled');
    });

    it('a resume is refused while a person Finish is ending the session', async () => {
      const s = newRun({ endingDeadlineSeconds: 30 }, { endSessionExits: false });
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'needs_input');
      await waitPhase(h, 'idle');
      await h.executeUpdate(signals.finishRun);
      await expect(h.executeUpdate(signals.resumeRun)).rejects.toMatchObject({
        cause: { type: 'NotResumable', message: 'This run is being finished' },
      });
      s.logs.resolve({ exitCode: 0, agentStarted: true });
      expect((await h.result()).status).toBe('succeeded');
    });

    it('a cancel while the session is ending still wins: cancelled, the volume deleted, no new pod', async () => {
      const s = newRun({ idleEndSeconds: 1, endingDeadlineSeconds: 30 }, { endSessionExits: false });
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'needs_input');
      await s.endSessionCalled.promise;
      expect(await h.executeUpdate(signals.resumeRun)).toEqual({ accepted: true });
      await h.signal(signals.cancel);
      expect((await h.result()).status).toBe('cancelled');
      expect(count(s, 'deleteRunVolume')).toBe(1);
      expect(count(s, 'createRunSecretAndJob')).toBe(1);
      expect(count(s, 'parkRun:needs_input')).toBe(0);
    });
  });

  describe('attach leases (attach-leases)', () => {
    const ID = '11111111-1111-4111-8111-111111111111';

    it('an id that stops renewing stops holding the idle timer: renewed ids hold it, then the run parks', async () => {
      // Wide margins (real time, loaded machine): the first lease would run out at 8 s; renewals at ~3, 6 and 9 s keep it
      // to ~17 s, and the state is read at ~11 s (3 s after the first expiry, 6 s before the renewed one).
      const s = newRun({ idleEndSeconds: 1, leaseTtlSeconds: 8 });
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.terminalAttached, ID);
      await h.signal(signals.agentState, 'needs_input');
      await waitPhase(h, 'idle');
      expect((await state(h)).terminalAttached).toBe(1);
      for (let i = 0; i < 3; i++) {
        await sleepReal(3000);
        await h.signal(signals.terminalLease, [ID]);
      }
      await sleepReal(2000);
      expect((await state(h)).terminalAttached).toBe(1);
      expect(count(s, 'endSession')).toBe(0);
      // No more renewals: the lease runs out, then the idle timer parks the run.
      await waitPhase(h, 'parked');
      expect(s.parkReasons).toEqual(['idle_timeout']);
      expect((await state(h)).terminalAttached).toBe(0);
      captured['run-attach-leases'] = h;
      await h.signal(signals.cancel);
      await h.result();
    });

    it('history cost: a lease signal adds one signal event and at most one workflow task, and starts no timer', async () => {
      const s = newRun({ idleEndSeconds: 1000, leaseTtlSeconds: 600 });
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'needs_input');
      await waitPhase(h, 'idle');
      await h.signal(signals.terminalAttached, ID);
      // proto EventType numbers: 5 WORKFLOW_TASK_SCHEDULED, 6 STARTED, 7 COMPLETED, 8 TIMED_OUT, 9 FAILED, 17 TIMER_STARTED,
      // 18 TIMER_FIRED, 19 TIMER_CANCELED, 26 WORKFLOW_EXECUTION_SIGNALED.
      const events = async () => (await h.fetchHistory()).events ?? [];
      // Settled: the newest workflow-task event is a completed one, so no task is in flight and the count is not mid-task
      // (a task's own commands, such as a timer, are recorded after its completed event).
      const settled = async () => {
        const tasks = (await events()).map((e) => Number(e.eventType)).filter((t) => t >= 5 && t <= 9);
        return tasks[tasks.length - 1] === 7;
      };
      await waitFor(settled, 'the attach workflow task to complete');
      const before = (await events()).length;
      const SIGNALS = 5;
      for (let i = 0; i < SIGNALS; i++) {
        await h.signal(signals.terminalLease, [ID]);
        await sleepReal(300);
      }
      await waitFor(settled, 'the lease workflow tasks to complete');
      const added = (await events()).slice(before);
      const ofType = (...types: number[]) => added.filter((e) => types.includes(Number(e.eventType)));
      // Each lease signal is exactly one signal event.
      expect(ofType(26)).toHaveLength(SIGNALS);
      // A renewal must not restart the lease timer.
      expect(ofType(17, 18, 19)).toEqual([]);
      // Nothing but signals and workflow-task events (no activity, timer, child or marker).
      expect(ofType(5, 6, 7, 8, 9, 26)).toHaveLength(added.length);
      // One signal needs at most one first-attempt workflow task (a task can carry several signals). Retries are server and
      // worker noise on a loaded machine, not a cost of the signal: a failed attempt leaves no trace in the history, so its
      // retry shows up as its own scheduled, started, completed round with `attempt` above 1 and no signal before it. A
      // sticky-queue timeout leaves an orphan scheduled event that is never started plus a fresh attempt-1 task, which still
      // completes once. So first-attempt completions are at most one per signal; an extra task per signal, or any command,
      // timer or activity that needs its own task, would push this over the bound and fail the test.
      expect(firstAttemptCompletedTasks(added)).toBeLessThanOrEqual(SIGNALS);
      await h.signal(signals.cancel);
      await h.result();
    });

    it('a detach with the id releases the idle timer, and an id-less attach still counts as before', async () => {
      const s = newRun({ idleEndSeconds: 1, leaseTtlSeconds: 60 });
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.terminalAttached);
      await h.signal(signals.terminalAttached, ID);
      await h.signal(signals.agentState, 'needs_input');
      await waitPhase(h, 'idle');
      expect((await state(h)).terminalAttached).toBe(2);
      await h.signal(signals.terminalDetached, ID);
      await h.signal(signals.terminalDetached, ID);
      await sleepReal(1800);
      expect((await state(h)).terminalAttached).toBe(1);
      expect(count(s, 'endSession')).toBe(0);
      await h.signal(signals.terminalDetached);
      await waitPhase(h, 'parked');
      await h.signal(signals.cancel);
      await h.result();
    });
  });

  describe('follower reconnect (follower-reconnect)', () => {
    /**
     * Polls while letting the test server skip time: the retry backoff (1, 2, 4, 8, 16 s) is a server timer, and
     * real waiting would pass the 60 s test timeout. While the log follower is still in flight the server cannot skip,
     * so a test that needs the whole 31 s of backoff in real time sets its own, longer timeout.
     */
    async function skipUntil(pred: () => boolean | Promise<boolean>, what: string): Promise<void> {
      for (let i = 0; i < 50; i++) {
        if (await pred()) return;
        await env.sleep(2_000);
        await sleepReal(25);
      }
      throw new Error(`timed out waiting for ${what}`);
    }
    const waitParked = (h: WorkflowHandle) =>
      skipUntil(async () => (await state(h)).phase === 'parked', 'phase parked');

    it('follower returns contactLost after session_started: parks as pod_lost, volume kept, no failed status', async () => {
      const s = newRun({}, { endSessionExits: false });
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      s.logs.resolve({ exitCode: -1, agentStarted: true, podLost: true, contactLost: true });
      await waitParked(h);
      expect(s.parkReasons).toEqual(['pod_lost']);
      expect(count(s, 'deleteRunVolume')).toBe(0);
      expect(statuses(s)).not.toContain('failed');
      captured['run-follower-reconnect'] = h;
      await h.signal(signals.cancel);
      expect((await h.result()).status).toBe('cancelled');
    });

    it('followPodLogs throws a retryable error 5 times, then returns exit 0: succeeded (no 5-attempt cap)', async () => {
      const s = newRun();
      s.followFailFirst = 5;
      s.logs.resolve({ exitCode: 0 });
      const h = await start(s);
      expect((await h.result()).status).toBe('succeeded');
      expect(count(s, 'followPodLogs')).toBe(6);
      expect(statuses(s)).not.toContain('failed');
    }, 90_000);

    it('followPodLogs throws ClusterPermanentError: failed at once, Job and volume cleaned up', async () => {
      const s = newRun();
      s.followPermanent = true;
      const h = await start(s);
      expect((await h.result()).status).toBe('failed');
      expect(count(s, 'followPodLogs')).toBe(1);
      expect(count(s, 'deleteJob')).toBe(1);
      expect(count(s, 'deleteRunVolume')).toBe(1);
    });

    it('deleteJob inside park fails 5 times, then succeeds: parked, volume kept', async () => {
      const s = newRun({ idleEndSeconds: 1 });
      s.parkKeepSeconds = 3600;
      s.deleteJobFailFirst = 5;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'needs_input');
      await waitParked(h);
      expect(count(s, 'deleteJob')).toBe(6);
      expect(count(s, 'deleteRunVolume')).toBe(0);
      expect(statuses(s)).not.toContain('failed');
      await h.signal(signals.cancel);
      await h.result();
    }, 90_000);

    it('idle timer fires and endSession fails 5 times, then succeeds: parks, not failed', async () => {
      const s = newRun({ idleEndSeconds: 1 });
      s.parkKeepSeconds = 3600;
      s.endSessionFailFirst = 5;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'needs_input');
      await waitParked(h);
      expect(count(s, 'endSession')).toBe(6);
      expect(count(s, 'deleteRunVolume')).toBe(0);
      expect(statuses(s)).not.toContain('failed');
      await h.signal(signals.cancel);
      await h.result();
    }, 90_000);

    it('resume: createRunSecretAndJob and the rollback deleteJob fail retryably: back to parked with the same expiry, volume kept', async () => {
      const s = newRun({ idleEndSeconds: 1 });
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'needs_input');
      await waitParked(h);
      const expiry = s.lastExpiry;
      s.resumeCreateFailsRetryable = true;
      s.deleteJobFailFirst = 5;
      expect(await h.executeUpdate(signals.resumeRun)).toEqual({ accepted: true });
      await skipUntil(() => count(s, 'restoreParked') === 1, 'restoreParked');
      expect(s.restores[0]?.sessionExpiresAt).toBe(expiry);
      await waitParked(h);
      expect(count(s, 'deleteRunVolume')).toBe(0);
      expect(statuses(s)).not.toContain('failed');
      await gateForgot(s);
      await h.signal(signals.cancel);
      await h.result();
    }, 90_000);

    it('hard timer during an outage: finalize deleteJob fails 5 times, then succeeds: timed_out, then deleteRunVolume', async () => {
      const s = newRun({ timeoutSeconds: 1 });
      s.deleteJobFailFirst = 5;
      const h = await start(s);
      expect((await h.result()).status).toBe('timed_out');
      expect(count(s, 'deleteJob')).toBe(6);
      expect(statuses(s).at(-1)).toBe('timed_out');
      expect(s.calls.indexOf('deleteRunVolume')).toBeGreaterThan(s.calls.lastIndexOf('deleteJob'));
    }, 90_000);

    it('finalize deleteJob refused with ClusterPermanentError: tried once, the run still ends timed_out', async () => {
      const s = newRun({ timeoutSeconds: 1 });
      s.deleteJobPermanent = true;
      const h = await start(s);
      expect((await h.result()).status).toBe('timed_out');
      expect(count(s, 'deleteJob')).toBe(1);
      expect(statuses(s).at(-1)).toBe('timed_out');
    });
  });

  it('replay: histories from this run and the checked-in fixtures replay without nondeterminism', async () => {
    expect(Object.keys(captured).sort()).toEqual([
      'run-attach-leases',
      'run-cancel-loading',
      'run-cancel-starting',
      'run-ending-deadline',
      'run-follower-reconnect',
      'run-idle-finish',
      'run-park-expire',
      'run-park-resume',
      'run-pod-lost',
      'run-success',
      'run-token-refresh',
    ]);
    for (const [name, h] of Object.entries(captured)) {
      const history = await h.fetchHistory();
      await Worker.runReplayHistory({ workflowsPath }, history, h.workflowId);
      if (process.env.UPDATE_REPLAY_FIXTURES === '1') {
        // Worker identities are "pid@hostname": keep machine names out of the repo.
        const json = historyToJSON(history).replace(/"identity": "[^"]*"/g, '"identity": "replay-fixture"');
        await writeFile(fixture(name), json + '\n');
      }
    }
    // Review Focus 5: `run-idle-timer` was recorded before the pause-resume patch (idle timer, succeeded, no park). A run
    // like it must replay on the old path: parking it now would be a non-determinism error.
    for (const name of [...Object.keys(captured), 'run-idle-timer']) {
      const json: unknown = JSON.parse(await readFile(fixture(name), 'utf8'));
      await Worker.runReplayHistory({ workflowsPath }, json, `fixture-${name}`);
    }
  });
});
