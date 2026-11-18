import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FakeContinueAsNew,
  resetRuntime,
  runQuery,
  runtime,
  sendSignal,
  settle,
} from './helpers/fake-workflow-runtime';

vi.mock('@temporalio/workflow', () => import('./helpers/fake-workflow-runtime'));

import { PollOnceWorkflow, resumePollWorkflow } from '../src/workflows/poll.workflow';
import { OutboxSweepWorkflow, ReconcileWorkflow } from '../src/workflows/schedules.workflow';
import { SetupTestWorkflow } from '../src/workflows/setup-test.workflow';
import { CONTINUE_AS_NEW_AFTER, ProjectGateWorkflow } from '../src/workflows/gate.workflow';
import { endSetupTest, gateState, releaseSlot, requestSlot, setLimit, type GateState } from '../src/workflows/signals';
import type { PollOutcome } from '../src/activities/poll.activity';

beforeEach(() => {
  resetRuntime();
});
afterEach(() => {
  vi.useRealTimers();
});

const poll = { orgId: 'o1', projectId: 'p1' };

describe('PollOnceWorkflow', () => {
  const run = async (outcome: PollOutcome) => {
    const calls: unknown[] = [];
    runtime.activities.pollOnce = () => Promise.resolve(outcome);
    runtime.activities.pausePollSchedule = (input) => {
      calls.push(input);
      return Promise.resolve();
    };
    const result = await PollOnceWorkflow(poll);
    return { result, calls };
  };

  it.each<PollOutcome>(['ok', 'not_modified', 'skipped', { backoffSeconds: 30 }])(
    'does not pause the schedule after %j',
    async (outcome) => {
      const { result, calls } = await run(outcome);
      expect(result).toEqual(outcome);
      expect(calls).toEqual([]);
    },
  );

  it('pauses with the reset time and starts the resume timer on a rate limit', async () => {
    const until = '2026-01-01T00:10:00.000Z';
    const { result, calls } = await run({ pause: 'rate_limited', until });
    expect(result).toEqual({ pause: 'rate_limited', until });
    expect(calls).toEqual([{ ...poll, note: 'rate limited', resumeAt: until }]);
  });

  it('pauses without a resume time when the token was revoked', async () => {
    const { calls } = await run({ pause: 'token_revoked' });
    expect(calls).toEqual([{ ...poll, note: 'token revoked' }]);
  });
});

describe('resumePollWorkflow', () => {
  it('sleeps until the reset time, then unpauses once', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const resumed: unknown[] = [];
    runtime.activities.resumePollSchedule = (input) => {
      resumed.push(input);
      return Promise.resolve({ resumed: true });
    };
    await resumePollWorkflow({ ...poll, until: '2026-01-01T00:01:00.000Z' });
    expect(runtime.sleeps).toEqual([60_000]);
    expect(resumed).toEqual([poll]);
  });

  it('sleeps again when a later rate limit moved the reset time, and never for a negative span', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const answers = [{ waitUntil: '2026-01-01T00:05:00.000Z' }, { resumed: true }];
    runtime.activities.resumePollSchedule = () => Promise.resolve(answers.shift());
    // The first reset time is already past: the sleep is clamped to 0.
    await resumePollWorkflow({ ...poll, until: '2025-12-31T23:00:00.000Z' });
    expect(runtime.sleeps).toEqual([0, 300_000]);
    expect(answers).toEqual([]);
  });
});

describe('schedule workflows', () => {
  it('OutboxSweepWorkflow returns how many runs the sweep started', async () => {
    runtime.activities.sweepOutbox = () => Promise.resolve(3);
    expect(await OutboxSweepWorkflow()).toBe(3);
  });

  it('ReconcileWorkflow runs the reconcile activity', async () => {
    const reconcile = vi.fn(() => Promise.resolve());
    runtime.activities.reconcile = reconcile;
    await ReconcileWorkflow();
    expect(reconcile).toHaveBeenCalledOnce();
  });
});

describe('SetupTestWorkflow', () => {
  const ref = { orgId: 'o1', setupTestId: 's1' };
  const stub = (opts: {
    follow: () => Promise<{ status: 'passed' | 'failed' } | null>;
    create?: () => Promise<void>;
  }) => {
    const calls: string[] = [];
    runtime.activities.createSetupTestJob = async () => {
      calls.push('create');
      await opts.create?.();
    };
    runtime.activities.followSetupTestLogs = async () => {
      calls.push('follow');
      return opts.follow();
    };
    runtime.activities.finalizeSetupTest = () => {
      calls.push('finalize');
      return Promise.resolve();
    };
    return calls;
  };

  it('finalizes (deletes the pod) as soon as a passed result is recorded', async () => {
    const calls = stub({ follow: () => Promise.resolve({ status: 'passed' }) });
    await expect(SetupTestWorkflow(ref)).resolves.toEqual({ status: 'passed' });
    expect(calls).toEqual(['create', 'follow', 'finalize']);
  });

  it('finalizes at once on a failed result too, and keeps reporting it', async () => {
    const calls = stub({ follow: () => Promise.resolve({ status: 'failed' }) });
    await expect(SetupTestWorkflow(ref)).resolves.toEqual({ status: 'failed' });
    expect(calls).toEqual(['create', 'follow', 'finalize']);
  });

  it('finalizes at once when there is no result', async () => {
    const calls = stub({ follow: () => Promise.resolve(null) });
    await expect(SetupTestWorkflow(ref)).resolves.toEqual({ status: 'ended' });
    expect(calls).toEqual(['create', 'follow', 'finalize']);
  });

  it('endSetupTest while following cancels the follow, finalizes and ends without a result', async () => {
    const calls = stub({ follow: () => new Promise(() => undefined) });
    const done = SetupTestWorkflow(ref);
    await settle();
    sendSignal(endSetupTest);
    await expect(done).resolves.toEqual({ status: 'ended' });
    expect(calls).toEqual(['create', 'follow', 'finalize']);
  });

  it('finalizes and then rethrows when create fails', async () => {
    const calls = stub({ follow: () => Promise.resolve(null), create: () => Promise.reject(new Error('no cluster')) });
    await expect(SetupTestWorkflow(ref)).rejects.toThrow('no cluster');
    expect(calls).toEqual(['create', 'finalize']);
  });

  it('finalizes and then rethrows when following the logs fails', async () => {
    const calls = stub({ follow: () => Promise.reject(new Error('stream broke')) });
    await expect(SetupTestWorkflow(ref)).rejects.toThrow('stream broke');
    expect(calls).toEqual(['create', 'follow', 'finalize']);
  });
});

describe('ProjectGateWorkflow', () => {
  const start = (input: Parameters<typeof ProjectGateWorkflow>[0]) => {
    const failed: unknown[] = [];
    void ProjectGateWorkflow(input).catch((e: unknown) => failed.push(e));
    return failed;
  };
  const snapshot = () => runQuery<GateState>(gateState);

  it('grants FIFO up to the limit and hands a released slot to the next in line', async () => {
    start({ projectId: 'p1', limit: 1 });
    sendSignal(requestSlot, 'a');
    sendSignal(requestSlot, 'b');
    await settle();
    expect(runtime.externalSignals).toEqual(['run-a:granted']);
    expect(snapshot()).toMatchObject({ limit: 1, active: ['a'], queue: ['b'], settled: true });

    sendSignal(releaseSlot, 'a');
    await settle();
    expect(runtime.externalSignals).toEqual(['run-a:granted', 'run-b:granted']);
    expect(snapshot()).toMatchObject({ active: ['b'], queue: [] });
  });

  it('re-sends granted to an active run that asks again, and ignores a duplicate queue request', async () => {
    start({ projectId: 'p1', limit: 1 });
    sendSignal(requestSlot, 'a');
    sendSignal(requestSlot, 'b');
    await settle();
    sendSignal(requestSlot, 'a');
    sendSignal(requestSlot, 'a');
    sendSignal(requestSlot, 'b');
    await settle();
    expect(runtime.externalSignals).toEqual(['run-a:granted', 'run-a:granted']);
    expect(snapshot()).toMatchObject({ active: ['a'], queue: ['b'] });
  });

  it('release drops a queued run and forgets a pending re-grant', async () => {
    start({ projectId: 'p1', limit: 1 });
    sendSignal(requestSlot, 'a');
    sendSignal(requestSlot, 'b');
    await settle();
    // b leaves the queue; a asks again and then releases before the grant goes out.
    sendSignal(releaseSlot, 'b');
    sendSignal(requestSlot, 'a');
    sendSignal(releaseSlot, 'a');
    await settle();
    expect(runtime.externalSignals).toEqual(['run-a:granted']);
    expect(snapshot()).toMatchObject({ active: [], queue: [] });
  });

  it('setLimit grants the waiting runs; a bad limit is ignored or treated as zero', async () => {
    start({ projectId: 'p1', limit: Number.NaN });
    sendSignal(requestSlot, 'a');
    await settle();
    expect(snapshot()).toMatchObject({ limit: 0, active: [], queue: ['a'] });

    sendSignal(setLimit, Number.NaN);
    sendSignal(setLimit, 2.9);
    await settle();
    expect(snapshot()).toMatchObject({ limit: 2, active: ['a'] });
    sendSignal(setLimit, -4);
    expect(runQuery<GateState>(gateState).limit).toBe(0);
  });

  it('frees the slot of a run whose workflow is gone, so the next one is granted', async () => {
    runtime.externalGone.add('run-ghost');
    start({ projectId: 'p1', limit: 1 });
    sendSignal(requestSlot, 'ghost');
    sendSignal(requestSlot, 'b');
    await settle();
    expect(runtime.externalSignals).toEqual(['run-b:granted']);
    expect(snapshot()).toMatchObject({ active: ['b'], queue: [] });
  });

  it('resumes from the queue and active set it was handed', async () => {
    start({ projectId: 'p1', limit: 2, queue: ['c'], active: ['a'] });
    await settle();
    expect(runtime.externalSignals).toEqual(['run-c:granted']);
    expect(snapshot()).toMatchObject({ active: ['a', 'c'], queue: [] });
  });

  it('continues as new with its state after many signals', async () => {
    const failed = start({ projectId: 'p1', limit: 1 });
    for (let i = 0; i < CONTINUE_AS_NEW_AFTER; i++) sendSignal(requestSlot, `r${i}`);
    expect(snapshot().settled).toBe(false);
    await settle();
    const next = failed[0];
    expect(next).toBeInstanceOf(FakeContinueAsNew);
    const [carried] = (next as FakeContinueAsNew).args;
    expect(carried).toMatchObject({ projectId: 'p1', limit: 1, active: ['r0'] });
    expect((carried as { queue: string[] }).queue).toHaveLength(CONTINUE_AS_NEW_AFTER - 1);
  });
});
