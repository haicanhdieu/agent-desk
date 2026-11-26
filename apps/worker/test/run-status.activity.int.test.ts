import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, listenRunStatus, withOrg, runEvents, runs, type Db, type RunStatusMessage } from '@agentdesk/db';
import { startPg, type TestPg } from '@agentdesk/db/testing';
import { eq } from 'drizzle-orm';
import { setRunStatus, setRunStatusTx, type SetRunStatusInput } from '../src/activities/run-status.activity';
import { appendRunEvent } from '../src/activities/run-events';

const ORG = '33333333-3333-4333-8333-333333333333';
let pgx: TestPg;
let db: Db;
let projectId: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function seedRun(): Promise<string> {
  const c = new pg.Client({ connectionString: pgx.ownerUrl });
  await c.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('app.org_id', $1, true)`, [ORG]);
    const r = await c.query<{ id: string }>(
      `insert into runs (org_id, project_id, command, skill_name, ticket_ref, ticket_kind, checkout_ref, trigger_source)
       values ($1, $2, '/fix', 'fix', '#1', 'issue', 'main', 'manual') returning id`,
      [ORG, projectId],
    );
    await c.query('commit');
    const row = r.rows[0];
    if (!row) throw new Error('seed failed');
    return row.id;
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  pgx = await startPg();
  db = createDb(pgx.appUrl);
  const c = new pg.Client({ connectionString: pgx.ownerUrl });
  await c.connect();
  await c.query('begin');
  await c.query(`select set_config('app.org_id', $1, true)`, [ORG]);
  const conn = await c.query<{ id: string }>(
    `insert into connections (org_id, provider, capabilities, external_id, account_name)
     values ($1, 'fake', '{"code":true,"board":true}', 'acct', 'acct') returning id`,
    [ORG],
  );
  const proj = await c.query<{ id: string }>(
    `insert into projects (org_id, name, repo_path, code_connection_id, board_connection_id)
     values ($1, 'demo', 'dev/demo', $2, $2) returning id`,
    [ORG, conn.rows[0]?.id],
  );
  await c.query('commit');
  await c.end();
  projectId = proj.rows[0]?.id ?? '';
}, 180_000);

afterAll(async () => {
  await db?.close();
  await pgx?.stop();
});

const load = (runId: string) =>
  withOrg(db, ORG, async (tx) => {
    const [run] = await tx.select().from(runs).where(eq(runs.id, runId));
    const events = await tx.select().from(runEvents).where(eq(runEvents.runId, runId)).orderBy(runEvents.seq);
    return { run, events };
  });

describe('setRunStatus', () => {
  it('running sets started_at, appends a status event and emits NOTIFY with the seq', async () => {
    const runId = await seedRun();
    const got: RunStatusMessage[] = [];
    const stop = await listenRunStatus(pgx.appUrl, (m) => got.push(m));
    try {
      const at = '2026-11-12T10:00:00.000Z';
      const res = await setRunStatus(db, { orgId: ORG, runId, status: 'running', at });
      expect(res).toEqual({ seq: 1 });
      const { run, events } = await load(runId);
      expect(run?.status).toBe('running');
      expect(run?.startedAt?.toISOString()).toBe(at);
      expect(run?.finishedAt).toBeNull();
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe('status');
      expect(events[0]?.payload).toEqual({
        status: 'running',
        exitCode: null,
        failureReason: null,
        waitingOn: null,
        agentNote: null,
        pausedAt: null,
        sessionExpiresAt: null,
      });
      await sleep(300);
      expect(got).toEqual([{ orgId: ORG, runId, seq: 1 }]);
    } finally {
      await stop();
    }
  });

  it('idle sets idle_since, cleared by the next status; final sets finished_at, exit code and reason', async () => {
    const runId = await seedRun();
    await setRunStatus(db, { orgId: ORG, runId, status: 'running', at: '2026-11-12T10:00:00.000Z' });
    await setRunStatus(db, { orgId: ORG, runId, status: 'idle', at: '2026-11-12T10:01:00.000Z' });
    expect((await load(runId)).run?.idleSince?.toISOString()).toBe('2026-11-12T10:01:00.000Z');
    await setRunStatus(db, { orgId: ORG, runId, status: 'running', at: '2026-11-12T10:02:00.000Z' });
    const mid = (await load(runId)).run;
    expect(mid?.idleSince).toBeNull();
    expect(mid?.startedAt?.toISOString()).toBe('2026-11-12T10:00:00.000Z');
    const res = await setRunStatus(db, {
      orgId: ORG,
      runId,
      status: 'failed',
      exitCode: 2,
      failureReason: 'boom',
      at: '2026-11-12T10:03:00.000Z',
    });
    expect(res.seq).toBe(4);
    const { run, events } = await load(runId);
    expect(run?.finishedAt?.toISOString()).toBe('2026-11-12T10:03:00.000Z');
    expect(run?.exitCode).toBe(2);
    expect(run?.failureReason).toBe('boom');
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
  });

  it('done sets idle_since and agent_note; next running clears both', async () => {
    const runId = await seedRun();
    await setRunStatus(db, { orgId: ORG, runId, status: 'running', at: '2026-11-12T10:00:00.000Z' });
    await setRunStatus(db, {
      orgId: ORG,
      runId,
      status: 'done',
      agentNote: 'All finished',
      at: '2026-11-12T10:01:00.000Z',
    });
    const done = (await load(runId)).run;
    expect(done?.status).toBe('done');
    expect(done?.idleSince?.toISOString()).toBe('2026-11-12T10:01:00.000Z');
    expect(done?.agentNote).toBe('All finished');
    await setRunStatus(db, { orgId: ORG, runId, status: 'running', at: '2026-11-12T10:02:00.000Z' });
    const next = (await load(runId)).run;
    expect(next?.idleSince).toBeNull();
    expect(next?.agentNote).toBeNull();
  });

  it('running with waitingOn background stores it; idle clears it', async () => {
    const runId = await seedRun();
    await setRunStatus(db, {
      orgId: ORG,
      runId,
      status: 'running',
      waitingOn: 'background',
      at: '2026-11-12T10:00:00.000Z',
    });
    expect((await load(runId)).run?.waitingOn).toBe('background');
    await setRunStatus(db, {
      orgId: ORG,
      runId,
      status: 'idle',
      waitingOn: 'background',
      at: '2026-11-12T10:01:00.000Z',
    });
    expect((await load(runId)).run?.waitingOn).toBeNull();
  });

  it('running → running with a new waitingOn writes and appends one status event', async () => {
    const runId = await seedRun();
    await setRunStatus(db, { orgId: ORG, runId, status: 'running', at: '2026-11-12T10:00:00.000Z' });
    const res = await setRunStatus(db, {
      orgId: ORG,
      runId,
      status: 'running',
      waitingOn: 'background',
      at: '2026-11-12T10:01:00.000Z',
    });
    expect(res.seq).toBe(2);
    const { run, events } = await load(runId);
    expect(run?.waitingOn).toBe('background');
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
    expect(events[1]?.payload).toMatchObject({ status: 'running', waitingOn: 'background', agentNote: null });
  });

  it('agent note is collapsed to one line and capped at 500', async () => {
    const runId = await seedRun();
    await setRunStatus(db, {
      orgId: ORG,
      runId,
      status: 'idle',
      agentNote: `line one\nline two\r\n${'x'.repeat(600)}`,
      at: '2026-11-12T10:00:00.000Z',
    });
    const note = (await load(runId)).run?.agentNote ?? '';
    expect(note.startsWith('line one line two ')).toBe(true);
    expect(note).not.toMatch(/[\r\n]/);
    expect(note.length).toBe(500);
  });

  it('persists failure_stage with the final status, and leaves it null otherwise', async () => {
    const setup = await seedRun();
    await setRunStatus(db, { orgId: ORG, runId: setup, status: 'starting', at: '2026-11-12T10:00:00.000Z' });
    expect((await load(setup)).run?.failureStage).toBeNull();
    await setRunStatus(db, {
      orgId: ORG,
      runId: setup,
      status: 'failed',
      failureReason: 'setup failed (exit 1)',
      failureStage: 'setup',
      at: '2026-11-12T10:01:00.000Z',
    });
    expect((await load(setup)).run?.failureStage).toBe('setup');
    const agent = await seedRun();
    await setRunStatus(db, {
      orgId: ORG,
      runId: agent,
      status: 'failed',
      exitCode: 2,
      failureStage: 'agent',
      at: '2026-11-12T10:01:00.000Z',
    });
    expect((await load(agent)).run?.failureStage).toBe('agent');
    const infra = await seedRun();
    await setRunStatus(db, { orgId: ORG, runId: infra, status: 'failed', at: '2026-11-12T10:01:00.000Z' });
    expect((await load(infra)).run?.failureStage).toBeNull();
  });

  it('persists failure_code with the final status, and leaves it null otherwise', async () => {
    const id = await seedRun();
    await setRunStatus(db, { orgId: ORG, runId: id, status: 'starting', at: '2026-11-12T10:00:00.000Z' });
    expect((await load(id)).run?.failureCode).toBeNull();
    await setRunStatus(db, {
      orgId: ORG,
      runId: id,
      status: 'failed',
      failureCode: 'no_credential',
      at: '2026-11-12T10:01:00.000Z',
    });
    expect((await load(id)).run?.failureCode).toBe('no_credential');
    const other = await seedRun();
    await setRunStatus(db, { orgId: ORG, runId: other, status: 'failed', at: '2026-11-12T10:01:00.000Z' });
    expect((await load(other)).run?.failureCode).toBeNull();
  });

  it('a transition out of a final status is a no-op that returns the current seq', async () => {
    const runId = await seedRun();
    const got: RunStatusMessage[] = [];
    await setRunStatus(db, { orgId: ORG, runId, status: 'succeeded', exitCode: 0, at: '2026-11-12T10:00:00.000Z' });
    const stop = await listenRunStatus(pgx.appUrl, (m) => got.push(m));
    try {
      const again = await setRunStatus(db, { orgId: ORG, runId, status: 'succeeded', at: '2026-11-12T11:00:00.000Z' });
      const back = await setRunStatus(db, { orgId: ORG, runId, status: 'running', at: '2026-11-12T11:00:00.000Z' });
      expect(again).toEqual({ seq: 1 });
      expect(back).toEqual({ seq: 1 });
      const { run, events } = await load(runId);
      expect(run?.status).toBe('succeeded');
      expect(run?.finishedAt?.toISOString()).toBe('2026-11-12T10:00:00.000Z');
      expect(events).toHaveLength(1);
      await sleep(300);
      expect(got).toEqual([]);
    } finally {
      await stop();
    }
  });

  it('concurrent calls produce distinct, gapless seqs', async () => {
    const runId = await seedRun();
    const statuses = ['starting', 'running', 'idle', 'running', 'idle', 'running'] as const;
    const results = await Promise.all(
      statuses.map((status, i) => setRunStatus(db, { orgId: ORG, runId, status, at: `2026-11-12T10:0${i}:00.000Z` })),
    );
    expect(results.map((r) => r.seq).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6]);
    expect((await load(runId)).events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('concurrent appendRunEvent and setRunStatus on one run give gapless unique seqs', async () => {
    const runId = await seedRun();
    const append = (i: number) =>
      withOrg(db, ORG, (tx) => appendRunEvent(tx, ORG, { runId, type: 'lifecycle', payload: { i } }));
    const results = await Promise.all([
      append(1),
      setRunStatus(db, { orgId: ORG, runId, status: 'starting', at: '2026-11-12T10:00:00.000Z' }),
      append(2),
      setRunStatus(db, { orgId: ORG, runId, status: 'running', at: '2026-11-12T10:01:00.000Z' }),
      append(3),
      append(4),
    ]);
    expect(results.map((r) => r?.seq).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect((await load(runId)).events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('rejects an unknown run and a malformed timestamp', async () => {
    await expect(
      setRunStatus(db, {
        orgId: ORG,
        runId: '99999999-9999-4999-8999-999999999999',
        status: 'running',
        at: new Date().toISOString(),
      }),
    ).rejects.toMatchObject({ nonRetryable: true });
    const runId = await seedRun();
    await expect(setRunStatus(db, { orgId: ORG, runId, status: 'running', at: 'nope' })).rejects.toMatchObject({
      nonRetryable: true,
    });
  });
});

const setRunStatusTxForTest = (runId: string, rest: Omit<SetRunStatusInput, 'orgId' | 'runId'>) =>
  withOrg(db, ORG, (tx) => setRunStatusTx(tx, { orgId: ORG, runId, ...rest }));

describe('setRunStatus kept sessions', () => {
  const T0 = '2026-11-12T10:00:00.000Z';
  const T1 = '2026-11-12T10:10:00.000Z';
  const T2 = '2026-11-12T11:00:00.000Z';
  const EXP = '2026-11-19T10:10:00.000Z';
  const T3 = '2026-11-12T11:30:00.000Z';

  it('idle to paused with a session keeps the note and idle_since, sets paused_at and the expiry', async () => {
    const runId = await seedRun();
    await setRunStatus(db, { orgId: ORG, runId, status: 'idle', agentNote: 'Which database?', at: T0 });
    await setRunStatus(db, {
      orgId: ORG,
      runId,
      status: 'paused',
      session: { expiresAt: EXP },
      keepAgentNote: true,
      at: T1,
    });
    const { run, events } = await load(runId);
    expect(run?.status).toBe('paused');
    expect(run?.agentNote).toBe('Which database?');
    expect(run?.idleSince?.toISOString()).toBe(T0);
    expect(run?.pausedAt?.toISOString()).toBe(T1);
    expect(run?.sessionExpiresAt?.toISOString()).toBe(EXP);
    expect(events[1]?.payload).toMatchObject({
      status: 'paused',
      agentNote: 'Which database?',
      pausedAt: T1,
      sessionExpiresAt: EXP,
    });
  });

  it('done to succeeded with a session sets finished_at, keeps the note and sets the expiry', async () => {
    const runId = await seedRun();
    await setRunStatus(db, { orgId: ORG, runId, status: 'done', agentNote: 'Opened PR #1', at: T0 });
    await setRunStatus(db, {
      orgId: ORG,
      runId,
      status: 'succeeded',
      session: { expiresAt: EXP },
      keepAgentNote: true,
      at: T1,
    });
    const run = (await load(runId)).run;
    expect(run?.status).toBe('succeeded');
    expect(run?.finishedAt?.toISOString()).toBe(T1);
    expect(run?.agentNote).toBe('Opened PR #1');
    expect(run?.sessionExpiresAt?.toISOString()).toBe(EXP);
  });

  it('succeeded to queued with reopen and a future expiry writes and clears finished_at and exit_code', async () => {
    const runId = await seedRun();
    await setRunStatus(db, {
      orgId: ORG,
      runId,
      status: 'succeeded',
      exitCode: 0,
      session: { expiresAt: EXP },
      at: T0,
    });
    const res = await setRunStatusTxForTest(runId, { status: 'queued', reopen: true, keepAgentNote: true, at: T1 });
    expect(res.changed).toBe(true);
    const run = (await load(runId)).run;
    expect(run?.status).toBe('queued');
    expect(run?.finishedAt).toBeNull();
    expect(run?.exitCode).toBeNull();
    expect(run?.sessionExpiresAt?.toISOString()).toBe(EXP);
  });

  it('reopen with a past or missing expiry is a no-op', async () => {
    const past = await seedRun();
    await setRunStatus(db, { orgId: ORG, runId: past, status: 'succeeded', session: { expiresAt: T1 }, at: T0 });
    expect((await setRunStatusTxForTest(past, { status: 'queued', reopen: true, at: T2 })).changed).toBe(false);
    expect((await load(past)).run?.status).toBe('succeeded');
    const none = await seedRun();
    await setRunStatus(db, { orgId: ORG, runId: none, status: 'succeeded', at: T0 });
    expect((await setRunStatusTxForTest(none, { status: 'queued', reopen: true, at: T1 })).changed).toBe(false);
  });

  describe('a reopened session of a succeeded run keeps its result (ADR 0032)', () => {
    async function reopenedRun(): Promise<string> {
      const runId = await seedRun();
      await setRunStatus(db, { orgId: ORG, runId, status: 'succeeded', session: { expiresAt: EXP }, at: T0 });
      const res = await setRunStatusTxForTest(runId, { status: 'queued', reopen: true, reopened: true, at: T1 });
      expect(res.changed).toBe(true);
      await setRunStatus(db, { orgId: ORG, runId, status: 'done', keepAgentNote: true, session: null, at: T2 });
      return runId;
    }

    it('the reopen sets reopened_at and records session_reopened', async () => {
      const runId = await reopenedRun();
      const { run, events } = await load(runId);
      expect(run?.reopenedAt?.toISOString()).toBe(T1);
      expect(events.filter((e) => e.type === 'lifecycle').map((e) => e.payload)).toEqual([
        { kind: 'session_reopened' },
      ]);
    });

    it.each(['cancelled', 'timed_out', 'failed', 'expired'] as const)(
      'refuses %s as a final status',
      async (status) => {
        const runId = await reopenedRun();
        const before = (await load(runId)).events.length;
        const res = await setRunStatusTxForTest(runId, { status, at: T3 });
        expect(res.changed).toBe(false);
        const { run, events } = await load(runId);
        expect(run?.status).toBe('done');
        expect(run?.reopenedAt).not.toBeNull();
        expect(events).toHaveLength(before);
      },
    );

    it('succeeded is allowed and reopened: false clears the flag', async () => {
      const runId = await reopenedRun();
      const res = await setRunStatusTxForTest(runId, {
        status: 'succeeded',
        reopened: false,
        session: { expiresAt: EXP },
        at: T3,
      });
      expect(res.changed).toBe(true);
      const run = (await load(runId)).run;
      expect(run?.status).toBe('succeeded');
      expect(run?.reopenedAt).toBeNull();
      expect(run?.sessionExpiresAt?.toISOString()).toBe(EXP);
    });
  });

  it('reopen does not leave failed', async () => {
    const runId = await seedRun();
    await setRunStatus(db, { orgId: ORG, runId, status: 'failed', at: T0 });
    expect((await setRunStatusTxForTest(runId, { status: 'queued', reopen: true, at: T1 })).changed).toBe(false);
    expect((await load(runId)).run?.status).toBe('failed');
  });

  it('paused to expired clears the expiry and sets finished_at', async () => {
    const runId = await seedRun();
    await setRunStatus(db, { orgId: ORG, runId, status: 'paused', session: { expiresAt: EXP }, at: T0 });
    await setRunStatus(db, { orgId: ORG, runId, status: 'expired', at: T1 });
    const run = (await load(runId)).run;
    expect(run?.status).toBe('expired');
    expect(run?.sessionExpiresAt).toBeNull();
    expect(run?.finishedAt?.toISOString()).toBe(T1);
  });

  it('paused to cancelled clears the expiry', async () => {
    const runId = await seedRun();
    await setRunStatus(db, { orgId: ORG, runId, status: 'paused', session: { expiresAt: EXP }, at: T0 });
    await setRunStatus(db, { orgId: ORG, runId, status: 'cancelled', at: T1 });
    expect((await load(runId)).run?.sessionExpiresAt).toBeNull();
  });

  it.each(['idle', 'done', 'running'] as const)(
    'paused_at is cleared (row and event) when a paused run goes %s with session null',
    async (to) => {
      const runId = await seedRun();
      await setRunStatus(db, { orgId: ORG, runId, status: 'paused', session: { expiresAt: EXP }, at: T0 });
      expect((await load(runId)).run?.pausedAt?.toISOString()).toBe(T0);
      await setRunStatus(db, { orgId: ORG, runId, status: to, session: null, at: T1 });
      const { run, events } = await load(runId);
      expect(run?.pausedAt).toBeNull();
      expect(events[1]?.payload).toMatchObject({ status: to, pausedAt: null });
      // Idempotent: the same call again leaves the same row.
      await setRunStatus(db, { orgId: ORG, runId, status: to, session: null, at: T1 });
      expect((await load(runId)).run?.pausedAt).toBeNull();
    },
  );

  it.each(['queued', 'starting'] as const)(
    'paused_at is kept (row and event) when a paused run goes %s with no session (mid-resume)',
    async (to) => {
      const runId = await seedRun();
      await setRunStatus(db, { orgId: ORG, runId, status: 'paused', session: { expiresAt: EXP }, at: T0 });
      await setRunStatus(db, { orgId: ORG, runId, status: to, keepAgentNote: true, at: T1 });
      const { run, events } = await load(runId);
      expect(run?.pausedAt?.toISOString()).toBe(T0);
      expect(events[1]?.payload).toMatchObject({ status: to, pausedAt: T0 });
    },
  );

  it('a paused write without a session keeps paused_at; with a session it moves to the new time', async () => {
    const runId = await seedRun();
    await setRunStatus(db, { orgId: ORG, runId, status: 'paused', session: { expiresAt: EXP }, at: T0 });
    await setRunStatus(db, { orgId: ORG, runId, status: 'paused', at: T1 });
    expect((await load(runId)).run?.pausedAt?.toISOString()).toBe(T0);
    await setRunStatus(db, { orgId: ORG, runId, status: 'paused', session: { expiresAt: EXP }, at: T2 });
    expect((await load(runId)).run?.pausedAt?.toISOString()).toBe(T2);
  });

  it('paused to expired keeps paused_at as history', async () => {
    const runId = await seedRun();
    await setRunStatus(db, { orgId: ORG, runId, status: 'paused', session: { expiresAt: EXP }, at: T0 });
    await setRunStatus(db, { orgId: ORG, runId, status: 'expired', at: T1 });
    const { run, events } = await load(runId);
    expect(run?.pausedAt?.toISOString()).toBe(T0);
    expect(events[1]?.payload).toMatchObject({ status: 'expired', pausedAt: T0 });
  });

  it('a no-op write (onlyFrom mismatch) leaves paused_at alone', async () => {
    const runId = await seedRun();
    await setRunStatus(db, { orgId: ORG, runId, status: 'paused', session: { expiresAt: EXP }, at: T0 });
    const res = await withOrg(db, ORG, (tx) =>
      setRunStatusTx(tx, { orgId: ORG, runId, status: 'idle', session: null, at: T1 }, { onlyFrom: ['running'] }),
    );
    expect(res.changed).toBe(false);
    expect((await load(runId)).run?.pausedAt?.toISOString()).toBe(T0);
  });

  it('session null clears the expiry; absent leaves it', async () => {
    const runId = await seedRun();
    await setRunStatus(db, { orgId: ORG, runId, status: 'paused', session: { expiresAt: EXP }, at: T0 });
    await setRunStatus(db, { orgId: ORG, runId, status: 'paused', at: T1 });
    expect((await load(runId)).run?.sessionExpiresAt?.toISOString()).toBe(EXP);
    await setRunStatus(db, { orgId: ORG, runId, status: 'paused', session: null, at: T2 });
    expect((await load(runId)).run?.sessionExpiresAt).toBeNull();
  });

  describe('the session ending time and the pause reason', () => {
    const mark = (runId: string) =>
      withOrg(db, ORG, (tx) =>
        tx
          .update(runs)
          .set({ sessionEndingAt: new Date(T0), pauseReason: 'pod_lost' })
          .where(eq(runs.id, runId)),
      );

    it.each(['paused', 'succeeded', 'failed', 'cancelled'] as const)(
      'moving to %s clears session_ending_at',
      async (to) => {
        const runId = await seedRun();
        await setRunStatus(db, { orgId: ORG, runId, status: 'idle', at: T0 });
        await mark(runId);
        await setRunStatus(db, {
          orgId: ORG,
          runId,
          status: to,
          ...(to === 'paused' ? { session: { expiresAt: EXP } } : {}),
          at: T1,
        });
        expect((await load(runId)).run?.sessionEndingAt).toBeNull();
      },
    );

    it('a live status leaves session_ending_at alone', async () => {
      const runId = await seedRun();
      await setRunStatus(db, { orgId: ORG, runId, status: 'idle', at: T0 });
      await mark(runId);
      await setRunStatus(db, { orgId: ORG, runId, status: 'idle', keepAgentNote: true, at: T1 });
      expect((await load(runId)).run?.sessionEndingAt?.toISOString()).toBe(T0);
    });

    it('session null on a live status clears the pause reason; a final status and a plain write keep it', async () => {
      const runId = await seedRun();
      await setRunStatus(db, { orgId: ORG, runId, status: 'paused', session: { expiresAt: EXP }, at: T0 });
      await mark(runId);
      await setRunStatus(db, { orgId: ORG, runId, status: 'paused', at: T1 });
      expect((await load(runId)).run?.pauseReason).toBe('pod_lost');
      await setRunStatus(db, { orgId: ORG, runId, status: 'idle', keepAgentNote: true, session: null, at: T2 });
      expect((await load(runId)).run?.pauseReason).toBeNull();

      const other = await seedRun();
      await setRunStatus(db, { orgId: ORG, runId: other, status: 'paused', session: { expiresAt: EXP }, at: T0 });
      await mark(other);
      await setRunStatus(db, { orgId: ORG, runId: other, status: 'expired', at: T1 });
      expect((await load(other)).run?.pauseReason).toBe('pod_lost');
    });
  });
});
