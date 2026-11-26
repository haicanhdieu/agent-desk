// parkRun's pause reason, driven without a database: `withOrg` hands the activity a recording transaction. The real
// transaction behaviour is covered by session.activity.int.test.ts.
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '@agentdesk/db';
import type { RunContext } from '../src/activities/run.activities';

const written: Record<string, unknown>[] = [];
const events: Record<string, unknown>[] = [];
/** What the project-row select returns (the keep settings); none means the defaults. */
let agentRows: { paused: number; done: number }[] = [];

vi.mock('@agentdesk/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentdesk/db')>();
  const rows = (): Promise<unknown[]> => Promise.resolve(agentRows);
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    then: (r: (v: unknown[]) => unknown) => rows().then(r),
  };
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
vi.mock('../src/activities/run-events', () => ({
  appendRunEvent: (_tx: unknown, _org: string, input: { type: string; payload: Record<string, unknown> }) => {
    events.push(input);
    return Promise.resolve({ seq: 1 });
  },
}));
vi.mock('../src/activities/run-status.activity', () => ({
  setRunStatusTx: () => Promise.resolve({ seq: 1, changed: true, previous: 'idle' }),
}));

import { createSessionActivities } from '../src/activities/session.activity';

const ctx: RunContext = {
  orgId: 'org1',
  runId: 'run1',
  projectId: 'p1',
  agentId: 'a1',
  status: 'running',
  timeoutSeconds: 3600,
  maxConcurrentRuns: 1,
};
const acts = createSessionActivities({
  db: {} as Db,
  config: { RUN_KEPT_DONE_SESSIONS_PER_PROJECT: 10, RUN_POD_MEMORY_LIMIT: '2Gi' },
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

describe('parkRun with the exit code of a pod that was lost', () => {
  const at = '2026-01-01T00:00:00.000Z';
  const reset = (): void => {
    written.length = 0;
    events.length = 0;
    agentRows = [];
  };

  it('records it as a pod_exit event, so the page can tell a kill (137) from a lost pod', async () => {
    reset();
    await acts.parkRun(ctx, { kind: 'needs_input', at, reason: 'pod_lost', podExitCode: 137 });
    expect(events).toEqual([
      { runId: 'run1', type: 'lifecycle', payload: { kind: 'pod_exit', code: 137 }, ts: new Date(at) },
    ]);
  });

  it('records nothing for another reason', async () => {
    reset();
    await acts.parkRun(ctx, { kind: 'needs_input', at, reason: 'idle_timeout', podExitCode: 137 });
    expect(events).toEqual([]);
  });

  it.each([
    ['no exit code', {}],
    ['the placeholder -1', { podExitCode: -1 }],
    ['a code no process exits with', { podExitCode: 256 }],
    ['a code that is not a whole number', { podExitCode: 1.5 }],
  ] as const)(
    'records a pod_exit with code null for %s, so an older pod_exit is not read for this pause',
    async (_name, extra) => {
      reset();
      await acts.parkRun(ctx, { kind: 'needs_input', at, reason: 'pod_lost', ...extra });
      expect(events).toEqual([
        { runId: 'run1', type: 'lifecycle', payload: { kind: 'pod_exit', code: null }, ts: new Date(at) },
      ]);
    },
  );
});

describe('parkRun with a resume queued behind the ending', () => {
  const at = '2026-01-01T00:00:00.000Z';
  const reset = (): void => {
    written.length = 0;
    events.length = 0;
    agentRows = [];
  };

  it('records why the resume could not run when nothing is kept (doneKeepSeconds 0)', async () => {
    reset();
    agentRows = [{ paused: 3600, done: 0 }];
    const parked = await acts.parkRun(ctx, { kind: 'done', at, reason: 'idle_timeout', resumeQueued: true });
    expect(parked.sessionExpiresAt).toBeNull();
    expect(events).toEqual([
      {
        runId: 'run1',
        type: 'lifecycle',
        payload: {
          kind: 'resume_failed',
          reason: 'nothing was kept to resume from',
          text: 'The resume could not run: nothing was kept to resume from.',
        },
        ts: new Date(at),
      },
    ]);
  });

  it.each([
    ['a session is kept', 'needs_input', { paused: 3600, done: 0 }, true],
    ['no resume was queued', 'done', { paused: 3600, done: 0 }, false],
  ] as const)('records nothing when %s', async (_name, kind, agent, resumeQueued) => {
    reset();
    agentRows = [agent];
    await acts.parkRun(ctx, { kind, at, reason: 'idle_timeout', ...(resumeQueued ? { resumeQueued } : {}) });
    expect(events).toEqual([]);
  });
});
