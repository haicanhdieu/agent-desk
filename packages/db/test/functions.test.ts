import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createDb,
  listenRunStatus,
  notifyRunStatus,
  queuedRunsWithoutWorkflow,
  resolveProject,
  withOrg,
  type Db,
  type RunStatusMessage,
} from '../src';
import { startPg, type TestPg } from './helpers/pg';
import { ORG_A, ORG_B, seedOrg, seedRun, type SeededOrg } from './helpers/seed';

let pgx: TestPg;
let db: Db;
let a: SeededOrg;
let b: SeededOrg;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  pgx = await startPg();
  db = createDb(pgx.appUrl);
  a = await seedOrg(pgx.ownerUrl, ORG_A, {
    externalId: 'acct-1',
    repoPath: 'dev/demo',
  });
  b = await seedOrg(pgx.ownerUrl, ORG_B, {
    externalId: 'acct-2',
    repoPath: 'dev/other',
  });
});

afterAll(async () => {
  await db?.close();
  await pgx?.stop();
});

describe('resolveProject', () => {
  it('returns the org and project ids for a known repo', async () => {
    expect(await resolveProject(db, 'fake', 'acct-1', 'dev/demo')).toEqual({
      orgId: ORG_A,
      projectId: a.projectId,
    });
    expect(await resolveProject(db, 'fake', 'acct-2', 'dev/other')).toEqual({
      orgId: ORG_B,
      projectId: b.projectId,
    });
  });

  it('returns null for an unknown repo or a repo under another account', async () => {
    expect(await resolveProject(db, 'fake', 'acct-1', 'dev/nope')).toBeNull();
    expect(await resolveProject(db, 'fake', 'acct-1', 'dev/other')).toBeNull();
    expect(await resolveProject(db, 'other-provider', 'acct-1', 'dev/demo')).toBeNull();
  });

  it('does not resolve a project whose connection belongs to another org', async () => {
    // Connection in org B; a project in org A points at it (FK checks ignore RLS, so this can exist).
    const client = new pg.Client({ connectionString: pgx.ownerUrl });
    await client.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.org_id', $1, true)`, [ORG_B]);
      const conn = await client.query<{ id: string }>(
        `insert into connections (org_id, provider, capabilities, external_id, account_name)
         values ($1, 'fake', '{"code":true,"board":true}', 'acct-cross', 'acct') returning id`,
        [ORG_B],
      );
      await client.query(`select set_config('app.org_id', $1, true)`, [ORG_A]);
      await client.query(
        `insert into projects (org_id, name, repo_path, code_connection_id, board_connection_id)
         values ($1, 'cross', 'dev/cross', $2, $2)`,
        [ORG_A, conn.rows[0]?.id],
      );
      await client.query('commit');
    } finally {
      await client.end();
    }
    expect(await resolveProject(db, 'fake', 'acct-cross', 'dev/cross')).toBeNull();
    // A normal project still resolves.
    expect(await resolveProject(db, 'fake', 'acct-1', 'dev/demo')).toEqual({ orgId: ORG_A, projectId: a.projectId });
  });
});

describe('queuedRunsWithoutWorkflow', () => {
  it('returns only old queued runs without a workflow, from every org', async () => {
    const oldA = await seedRun(pgx.ownerUrl, a, {
      ageSeconds: 120,
      workflowId: null,
      ticketRef: '#10',
    });
    const oldB = await seedRun(pgx.ownerUrl, b, {
      ageSeconds: 120,
      workflowId: null,
      ticketRef: '#10',
    });
    await seedRun(pgx.ownerUrl, a, {
      ageSeconds: 120,
      workflowId: 'wf-1',
      ticketRef: '#11',
    });
    await seedRun(pgx.ownerUrl, b, {
      ageSeconds: 5,
      workflowId: null,
      ticketRef: '#11',
    });
    // The runs seeded by seedOrg are fresh (queued now), so they are excluded too.
    const got = await queuedRunsWithoutWorkflow(db, 30);
    expect(got).toHaveLength(2);
    expect(got).toEqual(
      expect.arrayContaining([
        { orgId: ORG_A, runId: oldA },
        { orgId: ORG_B, runId: oldB },
      ]),
    );
  });
});

describe('run_status notify', () => {
  it('is delivered to the listener only after the transaction commits', async () => {
    const got: RunStatusMessage[] = [];
    const stop = await listenRunStatus(pgx.appUrl, (m) => got.push(m));
    try {
      await withOrg(db, ORG_A, async (tx) => {
        await notifyRunStatus(tx, { orgId: ORG_A, runId: a.runId, seq: 7 });
        await sleep(400);
        expect(got).toEqual([]);
      });
      for (let i = 0; i < 50 && got.length === 0; i++) await sleep(100);
      expect(got).toEqual([{ orgId: ORG_A, runId: a.runId, seq: 7 }]);
    } finally {
      await stop();
    }
  });

  it('is not delivered when the transaction rolls back', async () => {
    const got: RunStatusMessage[] = [];
    const stop = await listenRunStatus(pgx.appUrl, (m) => got.push(m));
    try {
      await withOrg(db, ORG_A, async (tx) => {
        await notifyRunStatus(tx, { orgId: ORG_A, runId: a.runId, seq: 8 });
        throw new Error('boom');
      }).catch(() => undefined);
      await sleep(500);
      expect(got).toEqual([]);
    } finally {
      await stop();
    }
  });
});

describe('listenRunStatus lifecycle', () => {
  it('rejects on a bad url and leaves no retry loop', async () => {
    const spy = vi.spyOn(pg.Client.prototype, 'connect');
    try {
      await expect(
        listenRunStatus('postgres://nobody:x@127.0.0.1:1/none', () => undefined, { reconnectDelayMs: 20 }),
      ).rejects.toThrow();
      const calls = spy.mock.calls.length;
      await sleep(300);
      expect(spy.mock.calls.length).toBe(calls);
    } finally {
      spy.mockRestore();
    }
  });

  it('reconnects after its backend is terminated and keeps delivering', async () => {
    const got: RunStatusMessage[] = [];
    const stop = await listenRunStatus(pgx.appUrl, (m) => got.push(m), { reconnectDelayMs: 100 });
    const admin = new pg.Client({ connectionString: pgx.adminUrl });
    await admin.connect();
    try {
      await admin.query(
        `select pg_terminate_backend(pid) from pg_stat_activity where usename = 'agentdesk_app' and query ilike 'LISTEN%'`,
      );
      await sleep(600);
      await withOrg(db, ORG_A, (tx) => notifyRunStatus(tx, { orgId: ORG_A, runId: a.runId, seq: 9 }));
      for (let i = 0; i < 50 && got.length === 0; i++) await sleep(100);
      expect(got).toEqual([{ orgId: ORG_A, runId: a.runId, seq: 9 }]);
    } finally {
      await stop();
      await sleep(200);
      const r = await admin.query(
        `select 1 from pg_stat_activity where usename = 'agentdesk_app' and query ilike 'LISTEN%'`,
      );
      expect(r.rowCount).toBe(0);
      await admin.end();
    }
  });
});
