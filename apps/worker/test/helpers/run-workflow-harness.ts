import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { TestWorkflowEnvironment } from '@temporalio/testing';
import { createTimeSkippingTestEnv } from './temporal-env';
import { Worker } from '@temporalio/worker';
import { ApplicationFailure, CancelledFailure, Context } from '@temporalio/activity';
import type { WorkflowHandle } from '@temporalio/client';
import { QUERY, TASK_QUEUE, WORKFLOW, gateWorkflowId, runWorkflowId } from '@agentdesk/core';
import type { RunStatus } from '@agentdesk/contracts';
import type { GateState, RunState } from '../../src/workflows/signals';
import {
  type CommentKind,
  type FinishDetails,
  type FollowPodLogsResult,
  type RunActivities,
  type RunContext,
} from '../../src/activities/run.activities';
import type { SetRunStatusInput } from '../../src/activities/run-status.activity';
import { requestSlot } from '../../src/activities/slot.activity';

// Time-skipping cannot skip while an activity is in flight, and `followPodLogs` is in flight for most of a run. The
// timer tests therefore run on real time with short `timeoutSeconds` / `idleEndSeconds` supplied by `loadRun`.

interface Deferred<T> {
  promise: Promise<T>;
  resolve(v: T): void;
  reject(e: unknown): void;
  settled: boolean;
}
export function deferred<T>(): Deferred<T> {
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

export interface Script {
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

export const scripts = new Map<string, Script>();
export let env: TestWorkflowEnvironment;
let worker: Worker;
let running: Promise<void>;
/** Histories captured during the run, replayed (and, with UPDATE_REPLAY_FIXTURES=1, written as fixtures) at the end. */
export const captured: Record<string, WorkflowHandle> = {};
export const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}-history.json`, import.meta.url));
export const TOKEN = 'test-token-must-not-leak';
export const workflowsPath = fileURLToPath(new URL('../../src/workflows/index.ts', import.meta.url));

export function script(runId: string): Script {
  const s = scripts.get(runId);
  if (!s) throw new Error(`no script for ${runId}`);
  return s;
}

/** Waits for the promise or for the activity to be cancelled, heartbeating so cancellation is delivered. */
export async function untilSettledOrCancelled<T>(p: Promise<T>, onCancel: () => void): Promise<T> {
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

export function activities(): RunActivities {
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

export function newRun(
  over: Partial<RunContext> = {},
  opts: Partial<Pick<Script, 'firstLine' | 'endSessionExits'>> = {},
) {
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

export async function start(s: Script): Promise<WorkflowHandle> {
  return env.client.workflow.start(WORKFLOW.run, {
    taskQueue: TASK_QUEUE,
    workflowId: runWorkflowId(s.ctx.runId),
    args: [{ orgId: s.ctx.orgId, runId: s.ctx.runId }],
  });
}

export const statuses = (s: Script): RunStatus[] => s.statuses.map((x) => x.status);
export const count = (s: Script, call: string): number => s.calls.filter((c) => c === call).length;
export const state = (h: WorkflowHandle) => h.query<RunState>(QUERY.runState);
export const sleepReal = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Completed workflow tasks (proto EventType 7) whose scheduled event (5) is a first attempt; a missing attempt, or a
// scheduled event outside the list, counts as the first so the count errs on the strict side. Retried rounds (attempt
// above 1) are left out. Pure, so the history-cost test below can be checked on synthetic event lists.
export interface TaskEvent {
  eventId?: { toString(): string } | number | null;
  eventType?: number | null;
  workflowTaskScheduledEventAttributes?: { attempt?: number | null } | null;
  workflowTaskCompletedEventAttributes?: { scheduledEventId?: { toString(): string } | number | null } | null;
}
export function firstAttemptCompletedTasks(events: readonly TaskEvent[]): number {
  const retried = new Set(
    events
      .filter((e) => e.eventType === 5 && (e.workflowTaskScheduledEventAttributes?.attempt ?? 1) > 1)
      .map((e) => String(e.eventId)),
  );
  return events.filter(
    (e) => e.eventType === 7 && !retried.has(String(e.workflowTaskCompletedEventAttributes?.scheduledEventId)),
  ).length;
}

export async function waitFor(pred: () => boolean | Promise<boolean>, what: string, ms = 15_000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await pred()) return;
    await sleepReal(25);
  }
  throw new Error(`timed out waiting for ${what}`);
}

export async function waitPhase(h: WorkflowHandle, phase: RunState['phase']): Promise<void> {
  await waitFor(async () => (await state(h)).phase === phase, `phase ${phase}`);
}

/** The gate holds no trace of the run (released, or never queued). */
export async function gateForgot(s: Script): Promise<void> {
  const gate = env.client.workflow.getHandle(gateWorkflowId(s.ctx.projectId));
  await waitFor(async () => {
    const g = await gate.query<GateState>(QUERY.gateState);
    return g.settled && !g.active.includes(s.ctx.runId) && !g.queue.includes(s.ctx.runId);
  }, 'gate release');
}

export function expectFinishOnce(s: Script): FinishDetails | undefined {
  expect(count(s, 'postComment:finish')).toBe(1);
  return s.comments.find((c) => c.kind === 'finish')?.details;
}

/**
 * Polls while letting the test server skip time: the retry backoff (1, 2, 4, 8, 16 s) is a server timer, and
 * real waiting would pass the 60 s test timeout. While the log follower is still in flight the server cannot skip,
 * so a test that needs the whole 31 s of backoff in real time sets its own, longer timeout.
 */
export async function skipUntil(pred: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (await pred()) return;
    await env.sleep(2_000);
    await sleepReal(25);
  }
  throw new Error(`timed out waiting for ${what}`);
}
export const waitParked = (h: WorkflowHandle) =>
  skipUntil(async () => (await state(h)).phase === 'parked', 'phase parked');

export async function startHarness(): Promise<void> {
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
}

export async function stopHarness(): Promise<void> {
  worker.shutdown();
  await running;
  await env.teardown();
}
