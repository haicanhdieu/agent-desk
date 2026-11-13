import { ApplicationFailure, CancelledFailure } from '@temporalio/common';
import { MockActivityEnvironment } from '@temporalio/testing';
import { describe, expect, it } from 'vitest';
import { createAdapterRegistry, parseConfig, type KubeGateway, type RunPod } from '@agentdesk/core';
import { createDb } from '@agentdesk/db';
import { followPodLog, waitForPod, type FollowHooks } from '../src/activities/follow-core';
import { POD_PENDING_TIMEOUT } from '../src/activities/run.activities';
import { createRunActivities } from '../src/activities/run.activities.impl';

const pod = (phase: RunPod['phase'], pendingSince: Date | null = null): RunPod => ({
  name: 'p',
  phase,
  pendingSince,
  reason: phase === 'Pending' ? 'Unschedulable' : null,
  exitCode: null,
});

function kubeWith(over: Partial<KubeGateway>): KubeGateway {
  const unused = async (): Promise<never> => {
    throw new Error('unused');
  };
  return {
    ensureSecret: unused,
    readSecret: async () => null,
    deleteSecret: unused,
    ensureJob: unused,
    getRunPod: async () => null,
    streamLogs: () => ({ [Symbol.asyncIterator]: () => ({ next: unused }) }),
    exec: unused,
    deleteJob: unused,
    listRunJobs: unused,
    listSetupTestJobs: unused,
    listRunSecrets: unused,
    listSetupTestSecrets: unused,
    ...over,
  };
}

describe('waitForPod (shared by runs and setup tests)', () => {
  const clock = { now: () => new Date() };
  const timing = { pendingLimitMs: 40, pollMs: 5, heartbeatMs: 1000 };

  it('returns a started pod', async () => {
    const kube = kubeWith({ getRunPod: async () => pod('Running') });
    expect((await waitForPod({ kube, clock, ...timing }, 'job', new AbortController().signal)).phase).toBe('Running');
  });

  it('throws the typed, non-retryable POD_PENDING_TIMEOUT after the limit (pending, or no pod at all)', async () => {
    for (const got of [pod('Pending', new Date(Date.now() - 1000)), null]) {
      const kube = kubeWith({ getRunPod: async () => got });
      const err = await waitForPod({ kube, clock, ...timing }, 'job', new AbortController().signal).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(ApplicationFailure);
      expect((err as ApplicationFailure).type).toBe(POD_PENDING_TIMEOUT);
      expect((err as ApplicationFailure).nonRetryable).toBe(true);
    }
  });

  it('is cancellable', async () => {
    const kube = kubeWith({ getRunPod: async () => pod('Pending', new Date()) });
    const ac = new AbortController();
    ac.abort();
    await expect(waitForPod({ kube, clock, ...timing }, 'job', ac.signal)).rejects.toBeInstanceOf(CancelledFailure);
  });
});

describe('run followPodLogs pending limit', () => {
  it('throws POD_PENDING_TIMEOUT like the setup-test follower', async () => {
    const config = parseConfig({
      NODE_ENV: 'test',
      PUBLIC_ORIGIN: 'http://localhost:5173',
      DATABASE_APP_URL: 'x',
      DATABASE_OWNER_URL: 'x',
      DATABASE_ADMIN_URL: 'x',
      TEMPORAL_ADDRESS: 'x',
      TEMPORAL_NAMESPACE: 'default',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      RUNNER_IMAGE: 'img',
      ENABLE_FAKE_PROVIDER: 'true',
      FAKE_STATE_DIR: 'unused',
    });
    // The pool is lazy: nothing before the pod wait touches the database.
    const db = createDb('postgres://nobody@127.0.0.1:1/none');
    try {
      const acts = createRunActivities({
        db,
        kube: kubeWith({ getRunPod: async () => null }),
        adapters: createAdapterRegistry(config, { now: () => new Date() }),
        secrets: { get: async () => null, put: async () => undefined, delete: async () => undefined },
        signaller: { signalRun: async () => undefined },
        clock: { now: () => new Date() },
        config,
        timing: { pendingLimitMs: 30, pollMs: 5, heartbeatMs: 1000 },
      });
      const ctx = {
        orgId: '44444444-4444-4444-8444-444444444444',
        runId: '55555555-5555-4555-8555-555555555555',
        projectId: '66666666-6666-4666-8666-666666666666',
        agentId: null,
        status: 'starting' as const,
        timeoutSeconds: 60,
        maxConcurrentRuns: 1,
      };
      const err = await new MockActivityEnvironment().run(acts.followPodLogs, ctx).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApplicationFailure);
      expect((err as ApplicationFailure).type).toBe(POD_PENDING_TIMEOUT);
    } finally {
      await db.close();
    }
  });
});

describe('followPodLog bookkeeping (chunk keys and durable line)', () => {
  it('keys markers by their own line and output chunks by their last line; durable never passes buffered output', async () => {
    const lines = [
      'agentdesk: plugins begin', // 1 marker
      'setup| a', // 2 buffered
      'setup| b', // 3 buffered
      'agentdesk: setup begin', // 4 flushes the chunk (keyed 3), then the marker (keyed 4)
      'setup| c', // 5 buffered, flushed at the end of the stream
    ];
    const stored: { line: number; kind: unknown; text: unknown }[] = [];
    const beats: number[] = [];
    const kube = kubeWith({
      getRunPod: async () => pod('Running'),
      async *streamLogs() {
        for (const l of lines) yield l;
      },
    });
    const hooks: FollowHooks<string> = {
      what: 'test follow',
      jobName: 'job',
      secrets: async () => [],
      storedBudget: async () => ({ chars: 0, truncated: false }),
      storeLifecycle: async (line, payload) => void stored.push({ line, kind: payload.kind, text: payload.text }),
      afterStream: async (pass) => {
        await pass.flushPending();
        pass.markDurable(pass.index);
        pass.beat();
        return { done: 'finished' };
      },
    };
    const env = new MockActivityEnvironment();
    env.on('heartbeat', (b: unknown) => {
      if (typeof b === 'object' && b !== null && 'lastLine' in b && typeof b.lastLine === 'number') {
        beats.push(b.lastLine);
      }
    });
    const timing = { kube, clock: { now: () => new Date() }, pollMs: 5, heartbeatMs: 1000, pendingLimitMs: 1000 };
    const out = await env.run(() => followPodLog(timing, hooks));
    expect(out).toBe('finished');
    expect(stored).toEqual([
      { line: 1, kind: 'plugins_begin', text: 'agentdesk: plugins begin' },
      { line: 3, kind: 'setup_output', text: 'a\nb' },
      { line: 4, kind: 'setup_begin', text: 'agentdesk: setup begin' },
      { line: 5, kind: 'setup_output', text: 'c' },
    ]);
    // Buffered output is not durable: the beat stays at the last stored line (1) until the marker flushes it (4).
    expect(beats).toEqual([0, 1, 1, 1, 4, 4, 5]);
  });
});
