import pg from 'pg';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TRANSCRIPT_ENTRY_CAP, TRANSCRIPT_LIMIT_NOTICE, type TranscriptWireEntry } from '@agentdesk/contracts';
import { createDb, runTranscriptEntries, withOrg, type Db } from '@agentdesk/db';
import { startPg, type TestPg } from '@agentdesk/db/testing';
import {
  createTranscriptSink,
  insertTranscriptEntry,
  toTranscriptRow,
  TRANSCRIPT_LIMIT_SOURCE_ID,
} from '../src/activities/transcript-store';

const ORG = '66666666-6666-4666-8666-666666666666';
const OTHER_ORG = '77777777-7777-4777-8777-777777777777';
const AGENT = '88888888-8888-4888-8888-888888888888';
const NOW = new Date('2026-11-19T12:00:00.000Z');

let pgx: TestPg;
let db: Db;
let projectId: string;

async function asOwner<T>(org: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: pgx.ownerUrl });
  await c.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('app.org_id', $1, true)`, [org]);
    const out = await fn(c);
    await c.query('commit');
    return out;
  } finally {
    await c.end();
  }
}

const seedRun = (org = ORG, project = projectId): Promise<string> =>
  asOwner(org, async (c) => {
    const r = await c.query<{ id: string }>(
      `insert into runs (org_id, project_id, agent_id, command, skill_name, ticket_ref, ticket_kind, ticket_number,
         checkout_ref, args, status, trigger_source)
       values ($1, $2, $3, 'fix', 'fix', '7', 'issue', 7, 'main', '', 'running', 'manual') returning id`,
      [org, project, AGENT],
    );
    return r.rows[0]?.id ?? '';
  });

const rowsOf = (runId: string, org = ORG) =>
  withOrg(db, org, (tx) =>
    tx
      .select()
      .from(runTranscriptEntries)
      .where(eq(runTranscriptEntries.runId, runId))
      .orderBy(runTranscriptEntries.seq),
  );

const wire = (id: string, text = 'hello', over: Partial<TranscriptWireEntry> = {}): TranscriptWireEntry => ({
  id,
  kind: 'agent',
  text,
  ...over,
});

const insert = (runId: string, entry: TranscriptWireEntry) =>
  withOrg(db, ORG, (tx) => insertTranscriptEntry(tx, ORG, runId, toTranscriptRow(entry, [], NOW)));

const sinkFor = (runId: string, warns: { msg: string; fields: Record<string, unknown> }[] = [], over: Db = db) =>
  createTranscriptSink({
    db: over,
    orgId: ORG,
    runId,
    now: () => NOW,
    warn: (msg, fields) => void warns.push({ msg, fields }),
  });

beforeAll(async () => {
  pgx = await startPg();
  db = createDb(pgx.appUrl);
  const c = new pg.Client({ connectionString: pgx.ownerUrl });
  await c.connect();
  await c.query(`insert into organization (id, name, slug, created_at) values ($1, 'Acme', 'acme', now())`, [ORG]);
  await c.query(`insert into organization (id, name, slug, created_at) values ($1, 'Other', 'other', now())`, [
    OTHER_ORG,
  ]);
  await c.end();
  projectId = await asOwner(ORG, async (cl) => {
    const conn = await cl.query<{ id: string }>(
      `insert into connections (org_id, provider, capabilities, external_id, account_name)
       values ($1, 'fake', '{"code":true,"board":true}', $2, 'dev') returning id`,
      [ORG, `fake-${ORG}`],
    );
    const proj = await cl.query<{ id: string }>(
      `insert into projects (org_id, name, repo_path, code_connection_id, board_connection_id, max_concurrent_runs)
       values ($1, 'demo', 'dev/demo', $2, $2, 3) returning id`,
      [ORG, conn.rows[0]?.id],
    );
    const pid = proj.rows[0]?.id ?? '';
    await cl.query(
      `insert into agents (id, org_id, project_id, name, model, credential_secret_name, credential_type, max_turns,
         timeout_seconds)
       values ($1, $2, $3, 'claude', 'sonnet', 'cred', 'oauth_token', 25, 900)`,
      [AGENT, ORG, pid],
    );
    return pid;
  });
}, 180_000);

afterAll(async () => {
  await db?.close();
  await pgx?.stop();
});

describe('toTranscriptRow', () => {
  it('redacts secrets in text, including inside a tool step summary', () => {
    const row = toTranscriptRow(
      { id: 't1:0', kind: 'tool', tool: 'Bash', text: 'curl -H "Bearer s3cr3t"' },
      ['s3cr3t'],
      NOW,
    );
    expect(row).toMatchObject({ sourceId: 't1:0', kind: 'tool', tool: 'Bash', text: 'curl -H "Bearer ***"' });
  });

  it('keeps a plausible at and replaces a future or ancient one with now', () => {
    const at = (iso: string | undefined) => toTranscriptRow(wire('a', 'x', iso ? { at: iso } : {}), [], NOW).at;
    expect(at('2026-11-19T11:00:00.000Z')).toEqual(new Date('2026-11-19T11:00:00.000Z'));
    expect(at('2026-11-19T12:04:00.000Z')).toEqual(new Date('2026-11-19T12:04:00.000Z'));
    expect(at('2026-11-19T12:06:00.000Z')).toEqual(NOW);
    expect(at('2026-10-01T00:00:00.000Z')).toEqual(NOW);
    expect(at('2026-10-20T12:00:00.000Z')).toEqual(new Date('2026-10-20T12:00:00.000Z'));
    expect(at(undefined)).toEqual(NOW);
  });

  it('maps a missing tool to null and a missing truncated flag to false', () => {
    expect(toTranscriptRow(wire('a'), [], NOW)).toMatchObject({ tool: null, truncated: false });
    expect(toTranscriptRow(wire('a', 'x', { truncated: true }), [], NOW).truncated).toBe(true);
  });
});

describe('insertTranscriptEntry', () => {
  it('assigns seq 1, 2, 3 in order and ignores a repeated source id', async () => {
    const runId = await seedRun();
    expect(await insert(runId, wire('a'))).toBe(true);
    expect(await insert(runId, wire('b'))).toBe(true);
    expect(await insert(runId, wire('a', 'changed'))).toBe(false);
    expect(await insert(runId, wire('c'))).toBe(true);
    const rows = await rowsOf(runId);
    expect(rows.map((r) => [r.seq, r.sourceId, r.text])).toEqual([
      [1, 'a', 'hello'],
      [2, 'b', 'hello'],
      [3, 'c', 'hello'],
    ]);
  });

  it("writes rows under the run's org and they are invisible to another org", async () => {
    const runId = await seedRun();
    await insert(runId, wire('a'));
    expect(await rowsOf(runId)).toHaveLength(1);
    expect(await rowsOf(runId, OTHER_ORG)).toHaveLength(0);
    expect((await rowsOf(runId))[0]?.orgId).toBe(ORG);
  });
});

describe('createTranscriptSink', () => {
  it('counts rows stored by earlier pods and stores the notice once', async () => {
    const runId = await seedRun();
    await asOwner(ORG, (c) =>
      c.query(
        `insert into run_transcript_entries (org_id, run_id, seq, source_id, at, kind, text)
         select $1, $2, g, 'old-' || g, now(), 'agent', 'x' from generate_series(1, $3::int) g`,
        [ORG, runId, TRANSCRIPT_ENTRY_CAP - 1],
      ),
    );
    const sink = sinkFor(runId);
    await sink.store(wire('new-1'), []);
    await sink.store(wire('new-2'), []);
    let rows = await rowsOf(runId);
    expect(rows).toHaveLength(TRANSCRIPT_ENTRY_CAP + 1);
    expect(rows.at(-1)).toMatchObject({
      sourceId: TRANSCRIPT_LIMIT_SOURCE_ID,
      kind: 'notice',
      text: TRANSCRIPT_LIMIT_NOTICE,
    });
    expect(rows.some((r) => r.sourceId === 'new-1')).toBe(true);
    expect(rows.some((r) => r.sourceId === 'new-2')).toBe(false);
    await sink.store(wire('new-3'), []);
    // A later pod's sink counts the notice too and adds nothing.
    await sinkFor(runId).store(wire('new-4'), []);
    rows = await rowsOf(runId);
    expect(rows).toHaveLength(TRANSCRIPT_ENTRY_CAP + 1);
    expect(rows.filter((r) => r.sourceId === TRANSCRIPT_LIMIT_SOURCE_ID)).toHaveLength(1);
  }, 60_000);

  it('a resumed pod re-sending stored entries at exactly the cap stores no limit notice', async () => {
    const runId = await seedRun();
    await asOwner(ORG, (c) =>
      c.query(
        `insert into run_transcript_entries (org_id, run_id, seq, source_id, at, kind, text)
         select $1, $2, g, 'old-' || g, now(), 'agent', 'x' from generate_series(1, $3::int) g`,
        [ORG, runId, TRANSCRIPT_ENTRY_CAP],
      ),
    );
    await sinkFor(runId).store(wire('old-1'), []);
    await sinkFor(runId).store(wire('old-2'), []);
    expect(await rowsOf(runId)).toHaveLength(TRANSCRIPT_ENTRY_CAP);
    await sinkFor(runId).store(wire('new-1'), []);
    const rows = await rowsOf(runId);
    expect(rows).toHaveLength(TRANSCRIPT_ENTRY_CAP + 1);
    expect(rows.at(-1)?.sourceId).toBe(TRANSCRIPT_LIMIT_SOURCE_ID);
  }, 60_000);

  it('redacts with the given secrets before storing', async () => {
    const runId = await seedRun();
    await sinkFor(runId).store(wire('a', 'token s3cr3t here'), ['s3cr3t']);
    expect((await rowsOf(runId))[0]?.text).toBe('token *** here');
  });

  it('an insert that keeps failing is logged by kind and count, never its text, and the sink carries on', async () => {
    const runId = await seedRun();
    let failures = 3;
    // A stand-in whose first three transactions fail (a database outage), then behaves like the real one. The cast
    // is only to build that test double; the sink sees the same `orm.transaction` surface.
    const flaky = {
      ...db,
      orm: {
        transaction: (fn: never) => {
          if (failures-- > 0) throw new Error('connection lost: PRIVATE-TEXT');
          return (db.orm.transaction as (f: never) => Promise<unknown>)(fn);
        },
      },
    } as unknown as Db;
    const warns: { msg: string; fields: Record<string, unknown> }[] = [];
    const sink = sinkFor(runId, warns, flaky);
    await sink.store(wire('a', 'PRIVATE-TEXT'), []);
    expect(warns).toHaveLength(1);
    expect(JSON.stringify(warns)).not.toContain('PRIVATE-TEXT');
    expect(warns[0]?.fields).toEqual({ kind: 'agent', failed: 1 });
    expect(await rowsOf(runId)).toHaveLength(0);
    await sink.store(wire('b'), []);
    expect((await rowsOf(runId)).map((r) => r.sourceId)).toEqual(['b']);
  });
});
