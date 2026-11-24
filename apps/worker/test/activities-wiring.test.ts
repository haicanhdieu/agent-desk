import { describe, expect, it } from 'vitest';
import { createAdapterRegistry, parseConfig, type KubeGateway } from '@agentdesk/core';
import { createDb } from '@agentdesk/db';
import { createActivities } from '../src/activities';
import type { RunContext } from '../src/activities/run.activities';

const unused = async (): Promise<never> => {
  throw new Error('unused');
};

const kube: KubeGateway = {
  ensureSecret: unused,
  replaceSecretData: unused,
  readSecret: async () => null,
  deleteSecret: unused,
  ensureJob: unused,
  getRunPod: async () => null,
  streamLogs: () => ({ [Symbol.asyncIterator]: () => ({ next: unused }) }),
  exec: unused,
  deleteJob: unused,
  listRunJobs: async () => [],
  listSetupTestJobs: async () => [],
  listRunSecrets: async () => [],
  listSetupTestSecrets: async () => [],
  ensureVolumeClaim: unused,
  deleteVolumeClaim: unused,
  listRunVolumeClaims: async () => [],
};

interface Recorded {
  gate: unknown[][];
  schedules: string[];
}

function build(warnings?: string[], rec: Recorded = { gate: [], schedules: [] }) {
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
  const clock = { now: () => new Date('2026-01-01T00:00:00Z') };
  return createActivities({
    // The pool is lazy: nothing here reads the database.
    db: createDb('postgres://nobody@127.0.0.1:1/none'),
    kube,
    adapters: createAdapterRegistry(config, clock),
    secrets: { get: async () => null, put: async () => undefined, delete: async () => undefined },
    signaller: { signalRun: async () => undefined },
    clock,
    priceSources: { source: () => undefined },
    config,
    starter: { start: unused },
    gate: {
      signalWithStart: async (...args: unknown[]) => {
        rec.gate.push(args);
        // requestSlot ignores the returned handle (it queries `getHandle`); there is no real one to build here.
        return undefined as never;
      },
      // requestSlot reads the gate's state after signalling; an empty settled gate says the run is not queued.
      getHandle: () => ({ query: async () => ({ limit: 1, queue: [], active: [], settled: true }) }) as never,
    },
    temporal: {
      isWorkflowOpen: async () => false,
      listOpenGateProjectIds: async () => [],
      gateRuns: async () => [],
      releaseSlot: async () => undefined,
    },
    pollSchedules: {
      pause: async (projectId, note) => void rec.schedules.push(`pause:${projectId}:${note}`),
      unpause: async () => undefined,
      remove: async () => undefined,
      startResume: async (input) => void rec.schedules.push(`resume:${input.projectId}:${input.until}`),
    },
    ...(warnings ? { log: { warn: (msg: string) => void warnings.push(msg), error: () => undefined } } : {}),
  });
}

describe('createActivities', () => {
  it('registers every activity the workflows call', () => {
    const acts = build();
    for (const name of [
      'setRunStatus',
      'requestSlot',
      'pollOnce',
      'pausePollSchedule',
      'resumePollSchedule',
      'sweepOutbox',
      'reconcile',
      'syncModelPrices',
      'loadRun',
      'followPodLogs',
      'parkRun',
      'endKeptSession',
      'restoreParked',
      'deleteRunVolume',
    ] as const) {
      expect(acts[name], name).toBeTypeOf('function');
    }
  });

  it('requestSlot signals the project gate', async () => {
    const rec: Recorded = { gate: [], schedules: [] };
    await build(undefined, rec).requestSlot({ projectId: 'p1', runId: 'r1', limit: 2 });
    expect(rec.gate).toEqual([
      [
        expect.any(String),
        expect.objectContaining({ workflowId: 'gate-p1', args: [{ projectId: 'p1', limit: 2 }], signalArgs: ['r1'] }),
      ],
    ]);
  });

  it('pausePollSchedule pauses the schedule and, for a rate limit, starts the resume timer', async () => {
    const rec: Recorded = { gate: [], schedules: [] };
    const acts = build(undefined, rec);
    await acts.pausePollSchedule({ orgId: 'o1', projectId: 'p1', note: 'manual' });
    await acts.pausePollSchedule({
      orgId: 'o1',
      projectId: 'p1',
      note: 'rate limited',
      resumeAt: '2026-01-01T01:00:00Z',
    });
    expect(rec.schedules).toEqual(['pause:p1:manual', 'pause:p1:rate limited', 'resume:p1:2026-01-01T01:00:00Z']);
  });

  it('reconcile runs against the bound kube and temporal dependencies', async () => {
    await expect(build().reconcile()).resolves.toBeUndefined();
    await expect(build([]).reconcile()).resolves.toBeUndefined();
  });

  it('deleteRunVolume reports a plain, retryable failure when the cluster refuses', async () => {
    // The shared kube stub's deleteVolumeClaim throws `unused`.
    const ctx: RunContext = {
      orgId: 'o1',
      runId: '11111111-1111-4111-8111-111111111111',
      projectId: 'p1',
      agentId: null,
      status: 'running',
      timeoutSeconds: 600,
      maxConcurrentRuns: 1,
    };
    await expect(build().deleteRunVolume(ctx)).rejects.toMatchObject({
      message: 'delete run volume: unused',
      nonRetryable: false,
    });
  });
});
