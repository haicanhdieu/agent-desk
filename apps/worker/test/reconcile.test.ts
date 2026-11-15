import { describe, expect, it } from 'vitest';
import type { KubeGateway } from '@agentdesk/core';
import { createDb } from '@agentdesk/db';
import { reconcile, type ReconcileTemporal } from '../src/activities/reconcile.activity';

// Objects whose labels are not UUIDs belong to no run or setup test, so reconcile never reads the database for them.
// The pool is lazy: a query would fail to connect, so a passing test proves none was made.
const db = createDb('postgres://nobody@127.0.0.1:1/none');

const BAD = { orgId: 'not-a-uuid', projectId: 'p1' };

const unused = async (): Promise<never> => {
  throw new Error('unused');
};

function kubeWith(over: Partial<KubeGateway>): KubeGateway {
  return {
    ensureSecret: unused,
    readSecret: async () => null,
    deleteSecret: async () => undefined,
    ensureJob: unused,
    getRunPod: async () => null,
    streamLogs: () => ({ [Symbol.asyncIterator]: () => ({ next: unused }) }),
    exec: unused,
    deleteJob: async () => undefined,
    listRunJobs: async () => [],
    listSetupTestJobs: async () => [],
    listRunSecrets: async () => [],
    listSetupTestSecrets: async () => [],
    ...over,
  };
}

const temporal = (over: Partial<ReconcileTemporal> = {}): ReconcileTemporal => ({
  isWorkflowOpen: async () => true,
  listOpenGateProjectIds: async () => [],
  gateRuns: async () => [],
  releaseSlot: async () => undefined,
  ...over,
});

const setupTest = { ttlSeconds: 60, setupTimeoutSeconds: 60 };

describe('reconcile with malformed labels', () => {
  it('deletes objects whose labels are not ids, without a database read', async () => {
    const deleted: string[] = [];
    const out = await reconcile({
      db,
      setupTest,
      temporal: temporal(),
      kube: kubeWith({
        listRunJobs: async () => [{ jobName: 'run-job', runId: 'bad', ...BAD }],
        listRunSecrets: async () => [{ secretName: 'run-orphan', runId: 'bad', ...BAD }],
        listSetupTestJobs: async () => [{ jobName: 'st-job', setupTestId: 'bad', ...BAD }],
        listSetupTestSecrets: async () => [{ secretName: 'st-orphan', setupTestId: 'bad', ...BAD }],
        deleteJob: async (name) => void deleted.push(`job:${name}`),
        deleteSecret: async (name) => void deleted.push(`secret:${name}`),
      }),
    });
    expect(out).toEqual({
      deletedJobs: 1,
      deletedSecrets: 1,
      releasedSlots: 0,
      deletedSetupTestJobs: 1,
      deletedSetupTestSecrets: 1,
    });
    expect(deleted).toEqual([
      'job:run-job',
      'secret:run-job',
      'secret:run-orphan',
      'job:st-job',
      'secret:st-job',
      'secret:st-orphan',
    ]);
  });
});

describe('reconcile failure handling', () => {
  it('logs only the error name for each failed cleanup and keeps going', async () => {
    const warnings: { msg: string; meta: Record<string, unknown> | undefined }[] = [];
    class KubeDown extends Error {
      override name = 'KubeDown';
    }
    const fail = async (): Promise<never> => {
      throw new KubeDown('token ghs_secretvalue leaked in the message');
    };
    const out = await reconcile({
      db,
      setupTest,
      log: { warn: (msg, meta) => void warnings.push({ msg, meta }) },
      temporal: temporal({
        listOpenGateProjectIds: async () => ['proj-1'],
        gateRuns: fail,
      }),
      kube: kubeWith({
        listRunJobs: async () => [{ jobName: 'run-job', runId: 'bad', ...BAD }],
        listRunSecrets: async () => [{ secretName: 'run-orphan', runId: 'bad', ...BAD }],
        listSetupTestJobs: async () => [{ jobName: 'st-job', setupTestId: 'bad', ...BAD }],
        listSetupTestSecrets: async () => [{ secretName: 'st-orphan', setupTestId: 'bad', ...BAD }],
        deleteJob: fail,
        deleteSecret: fail,
      }),
    });
    expect(out).toEqual({
      deletedJobs: 0,
      deletedSecrets: 0,
      releasedSlots: 0,
      deletedSetupTestJobs: 0,
      deletedSetupTestSecrets: 0,
    });
    expect(warnings.map((w) => w.msg)).toEqual([
      'reconcile: job cleanup failed',
      'reconcile: secret cleanup failed',
      'reconcile: setup test job cleanup failed',
      'reconcile: setup test secret cleanup failed',
      'reconcile: gate cleanup failed',
    ]);
    for (const w of warnings) expect(w.meta).toMatchObject({ error: 'KubeDown' });
    expect(JSON.stringify(warnings)).not.toContain('ghs_secretvalue');
  });

  it('reports an unnamed thrown value as unknown', async () => {
    const warnings: Record<string, unknown>[] = [];
    await reconcile({
      db,
      setupTest,
      log: { warn: (_msg, meta) => void warnings.push(meta ?? {}) },
      temporal: temporal(),
      kube: kubeWith({
        listRunJobs: async () => [{ jobName: 'run-job', runId: 'bad', ...BAD }],
        deleteJob: () => Promise.reject('plain string'),
      }),
    });
    expect(warnings).toEqual([{ job: 'run-job', error: 'unknown' }]);
  });
});
