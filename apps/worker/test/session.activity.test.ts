// parkRun's pause reason, driven without a database: `withOrg` hands the activity a recording transaction. The real
// transaction behaviour is covered by session.activity.int.test.ts.
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '@agentdesk/db';
import type { RunContext } from '../src/activities/run.activities';

const written: Record<string, unknown>[] = [];

vi.mock('@agentdesk/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentdesk/db')>();
  const rows = (): Promise<never[]> => Promise.resolve([]);
  const chain = { from: () => chain, where: () => chain, then: (r: (v: never[]) => unknown) => rows().then(r) };
  const tx = {
    select: () => chain,
    update: () => ({
      set: (values: Record<string, unknown>) => {
        written.push(values);
        return { where: () => Promise.resolve() };
      },
    }),
  };
  return { ...actual, withOrg: (_db: Db, _org: string, fn: (t: typeof tx) => unknown) => fn(tx) };
});
vi.mock('../src/activities/run-status.activity', () => ({
  setRunStatusTx: () => Promise.resolve({ seq: 1, changed: true, previous: 'idle' }),
}));

import { createSessionActivities } from '../src/activities/session.activity';

const ctx: RunContext = {
  orgId: 'org1',
  runId: 'run1',
  projectId: 'p1',
  agentId: null,
  status: 'running',
  timeoutSeconds: 3600,
  maxConcurrentRuns: 1,
};
const acts = createSessionActivities({
  db: {} as Db,
  config: { RUN_KEPT_DONE_SESSIONS_PER_PROJECT: 10 },
  signaller: { signalRun: () => Promise.resolve() },
  redactionValues: () => Promise.resolve([]),
});

describe('parkRun pause reason', () => {
  it('writes the reason it is given', async () => {
    written.length = 0;
    await acts.parkRun(ctx, { kind: 'needs_input', at: '2026-01-01T00:00:00.000Z', reason: 'pod_lost' });
    expect(written).toEqual([{ pauseReason: 'pod_lost' }]);
  });

  it('defaults to idle_timeout when the input has no reason (a park scheduled by the code before the reason existed)', async () => {
    written.length = 0;
    // Old workflow code sent `{ kind, at }` only; a retry across a deploy must not throw.
    const old = { kind: 'needs_input', at: '2026-01-01T00:00:00.000Z' } as const;
    await acts.parkRun(ctx, old);
    expect(written).toEqual([{ pauseReason: 'idle_timeout' }]);
  });
});
