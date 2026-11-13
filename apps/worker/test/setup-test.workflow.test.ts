import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { ApplicationFailure, CancelledFailure, Context } from '@temporalio/activity';
import { WorkflowFailedError, type WorkflowHandle } from '@temporalio/client';
import { SIGNAL, TASK_QUEUE, WORKFLOW, setupTestWorkflowId } from '@agentdesk/core';
import * as signals from '../src/workflows/signals';
import type { SetupTestActivities, SetupTestRef, SetupTestResult } from '../src/activities/setup-test.activities';

let env: TestWorkflowEnvironment;
let worker: Worker;
let running: Promise<void>;
const workflowsPath = fileURLToPath(new URL('../src/workflows/index.ts', import.meta.url));

interface Script {
  calls: string[];
  args: unknown[][];
  ttlSeconds: number;
  /** `block`: `followSetupTestLogs` waits until cancelled (no result yet). */
  follow: 'result' | 'block' | 'throw';
  result: SetupTestResult;
  createThrows: boolean;
  followCancelled: boolean;
}
const scripts = new Map<string, Script>();
const script = (id: string): Script => {
  const s = scripts.get(id);
  if (!s) throw new Error('no script');
  return s;
};

function activities(): SetupTestActivities {
  const note = (ref: SetupTestRef, name: string, args: unknown[]): Script => {
    const s = script(ref.setupTestId);
    s.calls.push(name);
    s.args.push(args);
    return s;
  };
  return {
    async createSetupTestJob(...args) {
      const s = note(args[0], 'create', args);
      if (s.createThrows) throw ApplicationFailure.nonRetryable('boom');
      return { ttlSeconds: s.ttlSeconds };
    },
    async followSetupTestLogs(...args) {
      const s = note(args[0], 'follow', args);
      if (s.follow === 'throw') throw ApplicationFailure.nonRetryable('pod never started');
      if (s.follow === 'block') {
        const c = Context.current();
        const hb = setInterval(() => c.heartbeat(), 100);
        try {
          await c.cancelled;
        } catch (err) {
          if (err instanceof CancelledFailure) s.followCancelled = true;
          throw err;
        } finally {
          clearInterval(hb);
        }
      }
      return s.result;
    },
    async finalizeSetupTest(...args) {
      note(args[0], 'finalize', args);
    },
  };
}

function newTest(over: Partial<Script> = {}) {
  const ref: SetupTestRef = { orgId: randomUUID(), setupTestId: randomUUID() };
  const s: Script = {
    calls: [],
    args: [],
    ttlSeconds: 900,
    follow: 'result',
    result: { status: 'passed' },
    createThrows: false,
    followCancelled: false,
    ...over,
  };
  scripts.set(ref.setupTestId, s);
  return { ref, s };
}

const start = (ref: SetupTestRef): Promise<WorkflowHandle> =>
  env.client.workflow.start(WORKFLOW.setupTest, {
    taskQueue: TASK_QUEUE,
    workflowId: setupTestWorkflowId(ref.setupTestId),
    args: [ref],
  });

const sleepReal = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred: () => boolean, what: string, ms = 15_000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (pred()) return;
    await sleepReal(25);
  }
  throw new Error(`timed out waiting for ${what}`);
}

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
  worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath,
    activities: activities(),
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

describe('SetupTestWorkflow', () => {
  it('names are shared with the api', () => {
    expect(signals.endSetupTest.name).toBe(SIGNAL.endSetupTest);
    expect(WORKFLOW.setupTest).toBe('SetupTestWorkflow');
    expect(setupTestWorkflowId('abc')).toBe('setup-test-abc');
  });

  it('passes then ends after TTL', async () => {
    const { ref, s } = newTest({ ttlSeconds: 900 });
    const h = await start(ref);
    const before = Date.now();
    expect(await h.result()).toEqual({ status: 'passed' });
    expect(s.calls).toEqual(['create', 'follow', 'finalize']);
    // 15 minutes of workflow time passed in (much) less real time: the TTL timer ran, then finalize.
    expect(Date.now() - before).toBeLessThan(60_000);
  });

  it('a failed setup is reported as failed and still waits out the TTL', async () => {
    const { ref, s } = newTest({ result: { status: 'failed' } });
    const h = await start(ref);
    expect(await h.result()).toEqual({ status: 'failed' });
    expect(s.calls).toEqual(['create', 'follow', 'finalize']);
  });

  it('a test that ends with no result (pod died before a result marker) finalizes at once, with no TTL wait', async () => {
    const { ref, s } = newTest({ ttlSeconds: 900, result: null });
    const h = await start(ref);
    expect(await h.result()).toEqual({ status: 'ended' });
    expect(s.calls).toEqual(['create', 'follow', 'finalize']);
    const timers = ((await h.fetchHistory()).events ?? []).filter((e) => e.timerStartedEventAttributes);
    expect(timers).toHaveLength(0);
  });

  it('a test with a result starts the TTL timer', async () => {
    const { ref } = newTest({ ttlSeconds: 900 });
    const h = await start(ref);
    await h.result();
    const timers = ((await h.fetchHistory()).events ?? []).filter((e) => e.timerStartedEventAttributes);
    expect(timers).toHaveLength(1);
  });

  it('only the ids reach the activities: no script, no token in any argument', async () => {
    const { ref, s } = newTest();
    const h = await start(ref);
    await h.result();
    expect(s.args).toHaveLength(3);
    for (const a of s.args) expect(a).toEqual([{ orgId: ref.orgId, setupTestId: ref.setupTestId }]);
    // Workflow input and activity-scheduled inputs in the history carry the ids and nothing else.
    const payloads: string[] = [];
    for (const e of (await h.fetchHistory()).events ?? []) {
      const input = e.workflowExecutionStartedEventAttributes?.input ?? e.activityTaskScheduledEventAttributes?.input;
      for (const p of input?.payloads ?? []) payloads.push(Buffer.from(p.data ?? new Uint8Array()).toString('utf8'));
    }
    expect(payloads).toHaveLength(4); // workflow start + create + follow + finalize
    for (const p of payloads) expect(JSON.parse(p)).toEqual({ orgId: ref.orgId, setupTestId: ref.setupTestId });
  });

  it('end signal before result ends immediately and finalizes once', async () => {
    const { ref, s } = newTest({ follow: 'block', result: null });
    const h = await start(ref);
    await waitFor(() => s.calls.includes('follow'), 'follow to start');
    await h.signal(signals.endSetupTest);
    expect(await h.result()).toEqual({ status: 'ended' });
    expect(s.calls.filter((c) => c === 'finalize')).toHaveLength(1);
    expect(s.calls.at(-1)).toBe('finalize');
    // The follower is told to stop (it may notice just after the workflow moved on to finalize).
    await waitFor(() => s.followCancelled, 'follow cancellation');
  });

  it('end signal during the TTL wait finalizes at once and keeps the recorded result', async () => {
    const { ref, s } = newTest({ ttlSeconds: 3600 });
    const h = await start(ref);
    await waitFor(() => s.calls.includes('follow'), 'follow');
    await h.signal(signals.endSetupTest);
    expect(await h.result()).toEqual({ status: 'passed' });
    expect(s.calls.filter((c) => c === 'finalize')).toHaveLength(1);
  });

  it('finalize runs even when create throws', async () => {
    const { ref, s } = newTest({ createThrows: true });
    const h = await start(ref);
    await expect(h.result()).rejects.toBeInstanceOf(WorkflowFailedError);
    expect(s.calls).toEqual(['create', 'finalize']);
  });

  it('finalize runs even when following the logs fails', async () => {
    const { ref, s } = newTest({ follow: 'throw' });
    const h = await start(ref);
    await expect(h.result()).rejects.toBeInstanceOf(WorkflowFailedError);
    expect(s.calls).toEqual(['create', 'follow', 'finalize']);
  });

  it('a workflow cancellation finalizes too', async () => {
    const { ref, s } = newTest({ follow: 'block', result: null });
    const h = await start(ref);
    await waitFor(() => s.calls.includes('follow'), 'follow');
    await h.cancel();
    await expect(h.result()).rejects.toBeInstanceOf(WorkflowFailedError);
    expect(s.calls.filter((c) => c === 'finalize')).toHaveLength(1);
  });
});
