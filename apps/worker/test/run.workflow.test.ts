import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { readFile, writeFile } from 'node:fs/promises';
import { Worker } from '@temporalio/worker';
import { historyToJSON } from '@temporalio/common/lib/proto-utils';
import { ApplicationFailure, CancelledFailure, Context } from '@temporalio/activity';
import type { WorkflowHandle } from '@temporalio/client';
import { IDLE_END_SECONDS, QUERY, TASK_QUEUE, WORKFLOW, gateWorkflowId, runWorkflowId } from '@agentdesk/core';
import type { RunStatus } from '@agentdesk/contracts';
import * as signals from '../src/workflows/signals';
import type { GateState, RunState } from '../src/workflows/signals';
import { IDLE_END_SECONDS_DEFAULT } from '../src/workflows/run.workflow';
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
      s.calls.push('loadRun');
      return s.ctx;
    },
    async requestSlot(input) {
      script(input.runId).calls.push('requestSlot');
      await requestSlot(env.client.workflow, input);
    },
    async setRunStatus(input) {
      const s = script(input.runId);
      s.statuses.push(input);
      return { seq: s.statuses.length };
    },
    async createRunSecretAndJob(ctx) {
      const s = script(ctx.runId);
      s.calls.push('createRunSecretAndJob');
      // Stands in for the real mint: the token is used here (written to the run Secret) and never returned.
      s.secretData = { REPO_CLONE_URL: `https://x-access-token:${TOKEN}@example.test/repo.git` };
      s.jobCalled.resolve();
      if (s.createLandsAfterMs !== undefined) {
        await sleepReal(s.createLandsAfterMs);
        s.calls.push('create:done');
      }
      if (s.jobHold)
        await untilSettledOrCancelled(s.jobHold.promise, () => s.calls.push('createRunSecretAndJob:cancelled'));
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
    async followPodLogs(ctx) {
      const s = script(ctx.runId);
      s.calls.push('followPodLogs');
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
      s.endSessionAt = Date.now();
      s.endSessionCalled.resolve();
      if (s.endSessionExits) s.logs.resolve({ exitCode: 0 });
    },
    async deleteJob(ctx) {
      script(ctx.runId).calls.push('deleteJob');
    },
    async ensureJobGone(ctx) {
      script(ctx.runId).calls.push('ensureJobGone');
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
  env = await TestWorkflowEnvironment.createTimeSkipping();
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

describe('RunWorkflow', () => {
  it('constants: idle end defaults to 10 minutes; the state query name is shared', () => {
    expect(IDLE_END_SECONDS_DEFAULT).toBe(IDLE_END_SECONDS);
    expect(IDLE_END_SECONDS).toBe(600);
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
    expectFinishOnce(s);
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

  it('exit code 2 → failed with exitCode 2; finish comment carries the scrollback tail', async () => {
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

  it('replay: histories from this run and the checked-in fixtures replay without nondeterminism', async () => {
    expect(Object.keys(captured).sort()).toEqual(['run-cancel-starting', 'run-idle-finish', 'run-success']);
    for (const [name, h] of Object.entries(captured)) {
      const history = await h.fetchHistory();
      await Worker.runReplayHistory({ workflowsPath }, history, h.workflowId);
      if (process.env.UPDATE_REPLAY_FIXTURES === '1') {
        // Worker identities are "pid@hostname": keep machine names out of the repo.
        const json = historyToJSON(history).replace(/"identity": "[^"]*"/g, '"identity": "replay-fixture"');
        await writeFile(fixture(name), json + '\n');
      }
    }
    for (const name of Object.keys(captured)) {
      const json: unknown = JSON.parse(await readFile(fixture(name), 'utf8'));
      await Worker.runReplayHistory({ workflowsPath }, json, `fixture-${name}`);
    }
  });
});
