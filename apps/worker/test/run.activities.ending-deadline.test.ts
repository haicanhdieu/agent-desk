import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApplicationFailure } from '@temporalio/common';
import { describe, expect, it } from 'vitest';
import { END_REASONS, FakeKubeGateway, MemorySecretStore, createAdapterRegistry, parseConfig } from '@agentdesk/core';
import { createDb, type Db } from '@agentdesk/db';
import type { RunContext } from '../src/activities/run.activities';
import { createRunActivities } from '../src/activities/run.activities.impl';
import { END_REASONS as END_REASONS_WORKFLOW } from '../src/workflows/run.workflow';

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

/** A transaction that holds one run (or none) and records what is inserted. Enough for appendRunEvent only. */
function fakeDb(runExists: boolean): { db: Db; inserted: Record<string, unknown>[] } {
  const inserted: Record<string, unknown>[] = [];
  const tx = {
    execute: async () => undefined,
    select: () => ({
      from: () => ({
        where: () => Object.assign(Promise.resolve([{ seq: 0 }]), { for: async () => (runExists ? [{ id: 1 }] : []) }),
      }),
    }),
    insert: () => ({ values: async (v: Record<string, unknown>) => void inserted.push(v) }),
  };
  const real = createDb('postgres://nobody@127.0.0.1:1/none'); // lazy pool: nothing connects
  // Only the transaction entry point is replaced, and only with what appendRunEvent touches.
  const orm = { transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } as unknown as Db['orm'];
  return { db: { ...real, orm }, inserted };
}

function activities(db: Db) {
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
    kube: new FakeKubeGateway(join(tmpdir(), 'ending-deadline-unused')),
    adapters: createAdapterRegistry(config, clock),
    secrets: new MemorySecretStore(),
    signaller: { signalRun: async () => undefined },
    clock,
    config,
  });
}

const AT = '2026-01-01T00:01:00.000Z';

describe('recordEndingDeadline', () => {
  it('appends one lifecycle event; the text mentions scrollback only when it was not saved', async () => {
    for (const [scrollbackSaved, text] of [
      [true, 'The session did not end in time; the pod was stopped.'],
      [false, 'The session did not end in time; the pod was stopped. Final scrollback not saved.'],
    ] as const) {
      const { db, inserted } = fakeDb(true);
      await activities(db).recordEndingDeadline(CTX, { scrollbackSaved, at: AT });
      expect(inserted).toEqual([
        {
          orgId: ORG,
          runId: CTX.runId,
          seq: 1,
          ts: new Date(AT),
          type: 'lifecycle',
          payload: { kind: 'ending_deadline', text },
        },
      ]);
    }
  });

  it.each([
    ['an invalid timestamp', true, 'not a date'],
    ['an unknown run', false, AT],
  ])('%s fails non-retryably', async (_name, runExists, at) => {
    const { db, inserted } = fakeDb(runExists);
    const err = await activities(db)
      .recordEndingDeadline(CTX, { scrollbackSaved: true, at })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApplicationFailure);
    expect((err as ApplicationFailure).nonRetryable).toBe(true);
    expect(inserted).toEqual([]);
  });
});

describe('END_REASONS', () => {
  it('the workflow mirror equals core (workflow code cannot import core)', () => {
    expect([...END_REASONS_WORKFLOW]).toEqual([...END_REASONS]);
  });
});
