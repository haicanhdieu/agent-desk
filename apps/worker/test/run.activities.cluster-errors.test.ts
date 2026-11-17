import { ApiException } from '@kubernetes/client-node';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  FakeKubeGateway,
  MemorySecretStore,
  createAdapterRegistry,
  parseConfig,
  type KubeGateway,
  type RunPod,
} from '@agentdesk/core';
import { ApplicationFailure } from '@temporalio/activity';
import { createDb, type Db } from '@agentdesk/db';
import type { RunContext } from '../src/activities/run.activities';
import { createRunActivities } from '../src/activities/run.activities.impl';

const ORG = '44444444-4444-4444-8444-444444444444';
const CTX: RunContext = {
  orgId: ORG,
  runId: '66666666-6666-4666-8666-666666666666',
  projectId: '77777777-7777-4777-8777-777777777777',
  agentId: '55555555-5555-4555-8555-555555555555',
  status: 'running',
  timeoutSeconds: 900,
  maxConcurrentRuns: 3,
  idleEndSeconds: 600,
  endingDeadlineSeconds: 90,
};

/**
 * A transaction that answers the `session_ending_at` update (a row, or none when it was already set) and the seq read,
 * and records every statement the transaction executes. Enough for `endSession` and `notifyRunStatus`.
 */
function fakeDb(rowChanged: boolean): { db: Db; executed: { sql: string; params: unknown[] }[] } {
  const executed: { sql: string; params: unknown[] }[] = [];
  const dialect = new PgDialect();
  const tx = {
    execute: async (q: Parameters<PgDialect['sqlToQuery']>[0]) => void executed.push(dialect.sqlToQuery(q)),
    update: () => ({
      set: () => ({ where: () => ({ returning: async () => (rowChanged ? [{ id: CTX.runId }] : []) }) }),
    }),
    select: () => ({ from: () => ({ where: async () => [{ seq: 7 }] }) }),
  };
  const real = createDb('postgres://nobody@127.0.0.1:1/none'); // lazy pool: nothing connects
  const orm = { transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } as unknown as Db['orm'];
  return { db: { ...real, orm }, executed };
}

function activities(db: Db, kube: KubeGateway = new FakeKubeGateway(join(tmpdir(), 'end-session-unused'))) {
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
  return createRunActivities({
    db,
    kube, // the default has no pod: endSession then has nothing to exec
    adapters: createAdapterRegistry(config, clock),
    secrets: new MemorySecretStore(),
    signaller: { signalRun: async () => undefined },
    clock,
    config,
  });
}

const refused = (status: number): ApiException<undefined> => new ApiException(status, 'denied', undefined, {});

/** A gateway whose Job delete and pod read fail with `err`. */
function failingKube(err: Error): KubeGateway {
  const base = new FakeKubeGateway(join(tmpdir(), 'cluster-errors-unused'));
  return Object.assign(base, {
    deleteJob: async () => {
      throw err;
    },
    getRunPod: async (): Promise<RunPod | null> => {
      throw err;
    },
  });
}

const typeOf = async (p: Promise<unknown>): Promise<string | undefined> => {
  try {
    await p;
  } catch (e) {
    return e instanceof ApplicationFailure ? `${e.type}:${e.nonRetryable}` : 'other';
  }
  return undefined;
};

describe('cluster calls: permanent refusals are not retried (follower-reconnect)', () => {
  const calls = {
    deleteJob: (a: ReturnType<typeof activities>) => a.deleteJob(CTX),
    ensureJobGone: (a: ReturnType<typeof activities>) => a.ensureJobGone(CTX),
    endSession: (a: ReturnType<typeof activities>) => a.endSession(CTX),
  };
  for (const [name, call] of Object.entries(calls)) {
    it(`${name}: HTTP 403 throws a non-retryable ClusterPermanentError`, async () => {
      const a = activities(fakeDb(true).db, failingKube(refused(403)));
      expect(await typeOf(call(a))).toBe('ClusterPermanentError:true');
    });

    it(`${name}: HTTP 503 stays retryable`, async () => {
      const a = activities(fakeDb(true).db, failingKube(refused(503)));
      const t = await typeOf(call(a));
      expect(t === undefined || t.endsWith(':false')).toBe(true);
    });
  }
});
