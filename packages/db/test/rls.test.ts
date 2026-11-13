import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, withOrg, type Db, type Tx } from '../src';
import { startPg, type TestPg } from './helpers/pg';
import { ORG_A, ORG_B, seedOrg, type SeededOrg } from './helpers/seed';

let pgx: TestPg;
let db: Db;
let a: SeededOrg;
let b: SeededOrg;

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

/** Inserts one row for `orgId` into a table, referencing the A-org rows for foreign keys. */
const inserts: Record<string, (tx: Tx, orgId: string) => Promise<unknown>> = {
  connections: (tx, o) =>
    tx.execute(sql`insert into connections (org_id, provider, capabilities, external_id, account_name)
      values (${o}, 'fake', '{"code":true,"board":true}', ${`x-${Math.random()}`}, 'acct')`),
  projects: (tx, o) =>
    tx.execute(sql`insert into projects (org_id, name, repo_path, code_connection_id, board_connection_id)
      values (${o}, 'p', ${`r/${Math.random()}`}, ${a.connectionId}, ${a.connectionId})`),
  agents: (tx, o) =>
    tx.execute(sql`insert into agents (org_id, project_id, name, model)
      values (${o}, ${a.projectId}, ${`n-${Math.random()}`}, 'm')`),
  rules: (tx, o) =>
    tx.execute(sql`insert into rules (org_id, project_id, command, agent_id, skill_name)
      values (${o}, ${a.projectId}, ${`/c${Math.random()}`}, ${a.agentId}, 's')`),
  runs: (tx, o) =>
    tx.execute(sql`insert into runs (org_id, project_id, command, skill_name, ticket_ref, ticket_kind, checkout_ref, trigger_source)
      values (${o}, ${a.projectId}, '/fix', 'fix', '#9', 'issue', 'main', 'manual')`),
  run_events: (tx, o) =>
    tx.execute(sql`insert into run_events (org_id, run_id, seq, type) values (${o}, ${a.runId}, 99, 'status')`),
  inbound_events: (tx, o) =>
    tx.execute(sql`insert into inbound_events (org_id, provider, channel, delivery_id, outcome)
      values (${o}, 'fake', 'webhook', ${`d-${Math.random()}`}, 'accepted')`),
  setup_script_versions: (tx, o) =>
    tx.execute(sql`insert into setup_script_versions (org_id, project_id, version, body, created_by)
      values (${o}, ${a.projectId}, 2, 'x', 'u1')`),
  setup_tests: (tx, o) =>
    tx.execute(sql`insert into setup_tests (org_id, project_id, status, script_sha256, started_by)
      values (${o}, ${a.projectId}, 'queued', 'abc', 'u1')`),
  setup_test_events: (tx, o) =>
    tx.execute(sql`insert into setup_test_events (org_id, setup_test_id, seq, type)
      values (${o}, ${a.setupTestId}, 99, 'status')`),
  poll_cursors: (tx, o) => tx.execute(sql`insert into poll_cursors (org_id, project_id) values (${o}, ${b.projectId})`),
  audit_log: (tx, o) => tx.execute(sql`insert into audit_log (org_id, action) values (${o}, 'x')`),
};

function pgCode(e: unknown): unknown {
  let cur: unknown = e;
  while (typeof cur === 'object' && cur !== null) {
    if ('code' in cur && typeof cur.code === 'string') return cur.code;
    cur = 'cause' in cur ? cur.cause : null;
  }
  return undefined;
}

describe.each(Object.keys(inserts))('RLS on %s', (table) => {
  it('withOrg(A) selects only org A rows', async () => {
    const rows = await withOrg(db, ORG_A, (tx) =>
      tx.execute<{ org_id: string }>(sql`select org_id from ${sql.identifier(table)}`),
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    expect(new Set(rows.rows.map((r) => r.org_id))).toEqual(new Set([ORG_A]));
  });

  it('withOrg(A) cannot insert a row for org B (42501)', async () => {
    const insert = inserts[table];
    if (!insert) throw new Error('no insert');
    const err = await withOrg(db, ORG_A, (tx) => insert(tx, ORG_B)).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(pgCode(err)).toBe('42501');
  });

  it('a raw query without withOrg returns 0 rows', async () => {
    const r = await db.pool.query(`select 1 from ${table}`);
    expect(r.rowCount).toBe(0);
  });
});

describe('setup_script_versions is append-only for the app role', () => {
  it.each(['update setup_script_versions set note = $1', 'delete from setup_script_versions'])(
    '%s is denied (42501)',
    async (stmt) => {
      const err = await withOrg(db, ORG_A, (tx) =>
        stmt.startsWith('update')
          ? tx.execute(sql`update setup_script_versions set note = 'n'`)
          : tx.execute(sql`delete from setup_script_versions`),
      ).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(pgCode(err)).toBe('42501');
    },
  );

  it('rejects a body over 64 KiB in bytes and a note over 200 chars', async () => {
    const big = (body: string, note: string | null) =>
      withOrg(db, ORG_A, (tx) =>
        tx.execute(sql`insert into setup_script_versions (org_id, project_id, version, body, note, created_by)
          values (${ORG_A}, ${a.projectId}, ${Math.floor(Math.random() * 1e6) + 10}, ${body}, ${note}, 'u1')`),
      ).then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(await big('é'.repeat(32768), null)).toBeUndefined();
    expect(pgCode(await big('é'.repeat(32768) + 'a', null))).toBe('23514');
    expect(pgCode(await big('x', 'n'.repeat(201)))).toBe('23514');
  });

  it('enforces unique (project_id, version)', async () => {
    const err = await withOrg(db, ORG_A, (tx) =>
      tx.execute(sql`insert into setup_script_versions (org_id, project_id, version, body, created_by)
        values (${ORG_A}, ${a.projectId}, 1, 'dup', 'u1')`),
    ).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(pgCode(err)).toBe('23505');
  });
});

describe('setup_tests constraints', () => {
  const attempt = (stmt: (tx: Tx) => Promise<unknown>) =>
    withOrg(db, ORG_A, stmt).then(
      () => undefined,
      (e: unknown) => e,
    );

  it('rejects an invalid status (23514) and accepts every valid one', async () => {
    const insert = (status: string) =>
      attempt((tx) =>
        tx.execute(sql`insert into setup_tests (org_id, project_id, status, script_sha256, started_by)
          values (${ORG_A}, ${a.projectId}, ${status}, 'abc', 'u1')`),
      );
    expect(pgCode(await insert('bogus'))).toBe('23514');
    for (const s of ['queued', 'running', 'passed', 'failed', 'ended']) expect(await insert(s)).toBeUndefined();
  });

  it('rejects a script_body over 64 KiB in bytes', async () => {
    const insert = (body: string) =>
      attempt((tx) =>
        tx.execute(sql`insert into setup_tests (org_id, project_id, status, script_sha256, script_body, started_by)
          values (${ORG_A}, ${a.projectId}, 'queued', 'abc', ${body}, 'u1')`),
      );
    expect(await insert('é'.repeat(32768))).toBeUndefined();
    expect(pgCode(await insert('é'.repeat(32768) + 'a'))).toBe('23514');
  });

  it('defaults plugins, allows the app role to update and clear the body', async () => {
    const rows = await withOrg(db, ORG_A, async (tx) => {
      await tx.execute(sql`update setup_tests set script_body = null, status = 'ended', ended_at = now()
        where id = ${a.setupTestId}`);
      return tx.execute<{ plugins: unknown; script_body: string | null }>(
        sql`select plugins, script_body from setup_tests where id = ${a.setupTestId}`,
      );
    });
    expect(rows.rows[0]).toEqual({ plugins: { installed: [], skipped: [], failed: [] }, script_body: null });
  });

  it('rejects an invalid setup_test_events type (23514) and a duplicate seq (23505)', async () => {
    const insertEvent = (seq: number, type: string) =>
      attempt((tx) =>
        tx.execute(sql`insert into setup_test_events (org_id, setup_test_id, seq, type)
          values (${ORG_A}, ${a.setupTestId}, ${seq}, ${type})`),
      );
    expect(pgCode(await insertEvent(50, 'scrollback'))).toBe('23514');
    expect(pgCode(await insertEvent(1, 'status'))).toBe('23505');
  });

  it('deleting a project cascades to its setup tests and their events', async () => {
    const o = await seedOrg(pgx.ownerUrl, '33333333-3333-4333-8333-333333333333', {
      externalId: 'acct-3',
      repoPath: 'dev/third',
    });
    await withOrg(db, o.orgId, (tx) => tx.execute(sql`delete from projects where id = ${o.projectId}`));
    const counts = await withOrg(db, o.orgId, async (tx) => ({
      tests: (await tx.execute(sql`select 1 from setup_tests`)).rows.length,
      events: (await tx.execute(sql`select 1 from setup_test_events`)).rows.length,
    }));
    expect(counts).toEqual({ tests: 0, events: 0 });
  });
});

describe('inbound_events null-org intake', () => {
  it('allows an insert without an org (no RETURNING) that stays invisible to every tenant', async () => {
    await withOrg(db, ORG_A, (tx) =>
      tx.execute(sql`insert into inbound_events (org_id, provider, channel, delivery_id, outcome)
        values (null, 'fake', 'webhook', 'orphan-1', 'unmatched')`),
    );
    for (const org of [ORG_A, ORG_B]) {
      const r = await withOrg(db, org, (tx) =>
        tx.execute(sql`select 1 from inbound_events where delivery_id = 'orphan-1'`),
      );
      expect(r.rows).toHaveLength(0);
    }
    const r = await db.pool.query(`select 1 from inbound_events`);
    expect(r.rowCount).toBe(0);
  });

  it('rejects RETURNING on a null-org insert', async () => {
    const err = await withOrg(db, ORG_A, (tx) =>
      tx.execute(sql`insert into inbound_events (org_id, provider, channel, delivery_id, outcome)
        values (null, 'fake', 'webhook', 'orphan-2', 'unmatched') returning id`),
    ).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(pgCode(err)).toBe('42501');
  });
});

describe('withOrg', () => {
  it('does not leak the org to the next transaction on a reused connection', async () => {
    const single = createDb(pgx.appUrl, { max: 1 });
    try {
      await withOrg(single, ORG_A, (tx) => tx.execute(sql`select 1`));
      const r = await single.pool.query(`select current_setting('app.org_id', true) as v`);
      expect(r.rows[0]?.v ?? '').toBe('');
    } finally {
      await single.close();
    }
  });

  it('rejects a non-uuid org id before querying', async () => {
    await expect(withOrg(db, `x'; drop table runs; --`, async () => 1)).rejects.toThrow(/org id/i);
  });
});
