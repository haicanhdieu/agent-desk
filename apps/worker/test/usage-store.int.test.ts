import pg from 'pg';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { USAGE_ENTRY_CAP, type UsageWireEntry } from '@agentdesk/contracts';
import {
  createPriceSourceRegistry,
  writePriceVersion,
  type AgentAdapter,
  type Clock,
  type NormalizedRate,
} from '@agentdesk/core';
import { createDb, runUsageEntries, withOrg, type Db } from '@agentdesk/db';
import { startPg, type TestPg } from '@agentdesk/db/testing';
import { createUsageSink } from '../src/activities/usage-store';
import { customKeyAgent, pricedAgent, unpricedAgent } from './helpers/stub-agent';

const T0 = new Date('2026-11-24T12:00:00.000Z');
const V1_AT = new Date('2026-11-20T00:00:00.000Z');
const V2_AT = new Date('2026-11-22T00:00:00.000Z');

let pgx: TestPg;
let db: Db;
let admin: pg.Pool;
let org: string;
let projectId: string;
let agentId: string;
let now: Date;
const clock: Clock = { now: () => now };

async function asOwner<T>(orgId: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: pgx.ownerUrl });
  await c.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('app.org_id', $1, true)`, [orgId]);
    const out = await fn(c);
    await c.query('commit');
    return out;
  } finally {
    await c.end();
  }
}

async function newOrg(): Promise<void> {
  org = crypto.randomUUID();
  const c = new pg.Client({ connectionString: pgx.ownerUrl });
  await c.connect();
  await c.query(`insert into organization (id, name, slug, created_at) values ($1, 'Acme', $2, now())`, [
    org,
    `o-${org}`,
  ]);
  await c.end();
  await asOwner(org, async (cl) => {
    const conn = await cl.query<{ id: string }>(
      `insert into connections (org_id, provider, capabilities, external_id, account_name)
       values ($1, 'fake', '{"code":true,"board":true}', $2, 'dev') returning id`,
      [org, `fake-${org}`],
    );
    const proj = await cl.query<{ id: string }>(
      `insert into projects (org_id, name, repo_path, code_connection_id, board_connection_id, max_concurrent_runs)
       values ($1, 'demo', 'dev/demo', $2, $2, 3) returning id`,
      [org, conn.rows[0]?.id],
    );
    projectId = proj.rows[0]?.id ?? '';
    const ag = await cl.query<{ id: string }>(
      `insert into agents (org_id, project_id, name, model, credential_secret_name, credential_type, max_turns,
         timeout_seconds)
       values ($1, $2, 'claude', 'sonnet', 'cred', 'oauth_token', 25, 900) returning id`,
      [org, projectId],
    );
    agentId = ag.rows[0]?.id ?? '';
  });
}

const seedRun = (): Promise<string> =>
  asOwner(org, async (c) => {
    const r = await c.query<{ id: string }>(
      `insert into runs (org_id, project_id, agent_id, command, skill_name, ticket_ref, ticket_kind, ticket_number,
         checkout_ref, args, status, trigger_source)
       values ($1, $2, $3, 'fix', 'fix', '7', 'issue', 7, 'main', '', 'running', 'manual') returning id`,
      [org, projectId, agentId],
    );
    return r.rows[0]?.id ?? '';
  });

const rate = (modelKey: string, input = 3, over: Partial<NormalizedRate> = {}): NormalizedRate => ({
  provider: 'vendor-a',
  modelKey,
  input,
  output: 15,
  cacheRead: 0.3,
  cacheWrite: 3.75,
  cacheWriteLong: 6,
  ...over,
});
const seedVersion = (records: NormalizedRate[], at: Date, source = 'src-1') =>
  writePriceVersion(db, { source, records, now: at });

const wire = (id: string, over: Partial<UsageWireEntry> = {}): UsageWireEntry => ({
  id,
  model: 'm1',
  inputTokens: 10,
  outputTokens: 1,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cacheWriteLongTokens: 0,
  ...over,
});

type Warn = { msg: string; fields: Record<string, unknown> };
const sinkFor = (runId: string, over: { adapter?: AgentAdapter; db?: Db; warns?: Warn[]; orgId?: string } = {}) =>
  createUsageSink({
    db: over.db ?? db,
    orgId: over.orgId ?? org,
    runId,
    clock,
    warn: (msg, fields) => void over.warns?.push({ msg, fields }),
    adapterFor: () => over.adapter ?? pricedAgent,
  });

const rowsOf = (runId: string) =>
  withOrg(db, org, (tx) =>
    tx.select().from(runUsageEntries).where(eq(runUsageEntries.runId, runId)).orderBy(runUsageEntries.sourceId),
  );

beforeAll(async () => {
  pgx = await startPg();
  db = createDb(pgx.appUrl);
  const u = new URL(pgx.adminUrl);
  u.pathname = '/agentdesk';
  admin = new pg.Pool({ connectionString: u.toString() });
}, 180_000);
afterAll(async () => {
  await admin?.end();
  await db?.close();
  await pgx?.stop();
});
beforeEach(async () => {
  now = T0;
  await admin.query('truncate model_prices, model_price_versions cascade');
  await newOrg();
});

describe('usage sink pricing snapshot', () => {
  it('writes the five rates, date, source and version of one version on first insert', async () => {
    const v = await seedVersion([rate('m1')], V1_AT);
    const runId = await seedRun();
    await sinkFor(runId).store(wire('a'));
    const [row] = await rowsOf(runId);
    expect(row).toMatchObject({
      sourceId: 'a',
      model: 'm1',
      priceInput: '3.000000',
      priceOutput: '15.000000',
      priceCacheRead: '0.300000',
      priceCacheWrite: '3.750000',
      priceCacheWriteLong: '6.000000',
      priceSource: 'src-1',
      priceVersionId: v.versionId,
    });
    expect(row?.priceAsOf).toEqual(V1_AT);
  });

  it('uses the adapter model key map', async () => {
    await seedVersion([rate('m1')], V1_AT);
    const runId = await seedRun();
    await sinkFor(runId, { adapter: customKeyAgent }).store(wire('a', { model: 'v-m1' }));
    expect((await rowsOf(runId))[0]?.priceInput).toBe('3.000000');
  });
});

describe('usage sink counters', () => {
  it('storing the same entry twice changes nothing', async () => {
    await seedVersion([rate('m1')], V1_AT);
    const runId = await seedRun();
    const sink = sinkFor(runId);
    await sink.store(wire('a'));
    const first = await rowsOf(runId);
    await sink.store(wire('a'));
    expect(await rowsOf(runId)).toEqual(first);
  });

  it('a placeholder then the final value gives the final counters at the first rates', async () => {
    await seedVersion([rate('m1')], V1_AT);
    const runId = await seedRun();
    const sink = sinkFor(runId);
    await sink.store(wire('a', { outputTokens: 1 }));
    await sink.store(wire('a', { outputTokens: 500, reasoningTokens: 7 }));
    const [row] = await rowsOf(runId);
    expect(row).toMatchObject({ outputTokens: 500, reasoningTokens: 7, priceInput: '3.000000' });
  });

  it('the final value then a placeholder or a lower replay never lowers a counter', async () => {
    await seedVersion([rate('m1')], V1_AT);
    const runId = await seedRun();
    const sink = sinkFor(runId);
    await sink.store(wire('a', { outputTokens: 500, inputTokens: 40, reasoningTokens: 7 }));
    await sink.store(wire('a', { outputTokens: 1 }));
    await sink.store(wire('a', { outputTokens: 20, inputTokens: 5 }));
    expect((await rowsOf(runId))[0]).toMatchObject({ outputTokens: 500, inputTokens: 40, reasoningTokens: 7 });
  });

  it('P3: a final row after a new version keeps the first version rates, in either order', async () => {
    const v1 = await seedVersion([rate('m1')], V1_AT);
    const runId = await seedRun();
    const sink = sinkFor(runId);
    await sink.store(wire('a', { outputTokens: 1 }));
    await seedVersion([rate('m1', 9)], V2_AT);
    now = new Date(T0.getTime() + 10 * 60_000);
    await sink.store(wire('a', { outputTokens: 500 }));
    expect((await rowsOf(runId))[0]).toMatchObject({
      outputTokens: 500,
      priceInput: '3.000000',
      priceVersionId: v1.versionId,
    });
    // Reverse: first sight at v2, the placeholder arrives later.
    const run2 = await seedRun();
    const sink2 = sinkFor(run2);
    await sink2.store(wire('b', { outputTokens: 500 }));
    await sink2.store(wire('b', { outputTokens: 1 }));
    expect((await rowsOf(run2))[0]).toMatchObject({ outputTokens: 500, priceInput: '9.000000' });
  });

  it('P2: ids first seen under different versions carry their own rates', async () => {
    const v1 = await seedVersion([rate('m1')], V1_AT);
    const runId = await seedRun();
    const sink = sinkFor(runId);
    await sink.store(wire('1'));
    await seedVersion([rate('m1', 9)], V2_AT);
    now = new Date(T0.getTime() + 6 * 60_000);
    await sink.store(wire('2'));
    const rows = await rowsOf(runId);
    expect(rows.map((r) => [r.sourceId, r.priceInput])).toEqual([
      ['1', '3.000000'],
      ['2', '9.000000'],
    ]);
    expect(rows[0]?.priceVersionId).toBe(v1.versionId);
    expect(rows[1]?.priceVersionId).not.toBe(v1.versionId);
    expect(rows[0]?.priceAsOf).toEqual(V1_AT);
    expect(rows[1]?.priceAsOf).toEqual(V2_AT);
  });

  it('P4: an unpriced model stays unpriced and a priced one keeps its rates after a new version', async () => {
    await seedVersion([rate('m1')], V1_AT);
    const runId = await seedRun();
    const sink = sinkFor(runId);
    await sink.store(wire('u', { model: 'm2' }));
    await sink.store(wire('p', { model: 'm1' }));
    await seedVersion([rate('m2', 5)], V2_AT);
    now = new Date(T0.getTime() + 6 * 60_000);
    await sink.store(wire('u', { model: 'm2', outputTokens: 9 }));
    await sink.store(wire('p', { model: 'm1', outputTokens: 9 }));
    const rows = await rowsOf(runId);
    expect(rows.find((r) => r.sourceId === 'u')).toMatchObject({
      outputTokens: 9,
      priceInput: null,
      priceSource: null,
    });
    expect(rows.find((r) => r.sourceId === 'p')).toMatchObject({ outputTokens: 9, priceInput: '3.000000' });
  });

  it('caches the price version for five minutes on the clock', async () => {
    await seedVersion([rate('m1')], V1_AT);
    const runId = await seedRun();
    const sink = sinkFor(runId);
    await sink.store(wire('1'));
    await seedVersion([rate('m1', 9)], V2_AT);
    now = new Date(T0.getTime() + 4 * 60_000);
    await sink.store(wire('2'));
    now = new Date(T0.getTime() + 5 * 60_000 + 1);
    await sink.store(wire('3'));
    expect((await rowsOf(runId)).map((r) => r.priceInput)).toEqual(['3.000000', '3.000000', '9.000000']);
  });
});

describe('usage sink unpriced rows (BR-21 / P9)', () => {
  it('no current version writes all price columns null', async () => {
    const runId = await seedRun();
    await sinkFor(runId).store(wire('a'));
    expect((await rowsOf(runId))[0]).toMatchObject({
      priceInput: null,
      priceOutput: null,
      priceCacheRead: null,
      priceCacheWrite: null,
      priceCacheWriteLong: null,
      priceAsOf: null,
      priceSource: null,
      priceVersionId: null,
    });
  });

  it('a model with no entry, an adapter without pricing and a deleted agent are unpriced', async () => {
    await seedVersion([rate('m1')], V1_AT);
    const runId = await seedRun();
    await sinkFor(runId).store(wire('a', { model: 'zzz' }));
    await sinkFor(runId, { adapter: unpricedAgent }).store(wire('b'));
    const gone = await seedRun();
    await asOwner(org, (c) => c.query('update runs set agent_id = null where id = $1', [gone]));
    await sinkFor(gone).store(wire('c'));
    expect((await rowsOf(runId)).map((r) => r.priceInput)).toEqual([null, null]);
    expect((await rowsOf(gone)).map((r) => r.priceInput)).toEqual([null]);
  });

  it('after a failed sync (no write) entries still price from the last version', async () => {
    await seedVersion([rate('m1')], V1_AT);
    now = new Date(T0.getTime() + 30 * 24 * 3600_000);
    const runId = await seedRun();
    await sinkFor(runId).store(wire('a'));
    expect((await rowsOf(runId))[0]?.priceInput).toBe('3.000000');
  });
});

describe('usage sink redaction', () => {
  it('drops an entry whose model or id holds a known secret, logging counts only', async () => {
    await seedVersion([rate('m1')], V1_AT);
    const runId = await seedRun();
    const warns: Warn[] = [];
    const sink = sinkFor(runId, { warns });
    const secrets = ['tok-abc123SECRET'];
    await sink.store(wire('a', { model: 'tok-abc123SECRET' }), secrets);
    await sink.store(wire('id-tok-abc123SECRET'), secrets);
    expect(await rowsOf(runId)).toHaveLength(0);
    expect(JSON.stringify(warns)).not.toContain('abc123SECRET');
    expect(warns).toEqual([
      { msg: 'usage entry not stored', fields: { failed: 1 } },
      { msg: 'usage entry not stored', fields: { failed: 2 } },
    ]);
  });

  it('still stores a clean entry when secrets are given', async () => {
    await seedVersion([rate('m1')], V1_AT);
    const runId = await seedRun();
    await sinkFor(runId).store(wire('ok'), ['tok-abc123SECRET']);
    expect(await rowsOf(runId)).toHaveLength(1);
  });
});

describe('usage sink cap, resume, failure', () => {
  it('at the cap drops a new id with one warn and still raises counters of a stored id', async () => {
    await seedVersion([rate('m1')], V1_AT);
    const runId = await seedRun();
    await asOwner(org, (c) =>
      c.query(
        `insert into run_usage_entries (org_id, run_id, source_id, model)
         select $1, $2, 'bulk-' || g, 'm1' from generate_series(1, $3::int) g`,
        [org, runId, USAGE_ENTRY_CAP],
      ),
    );
    const warns: Warn[] = [];
    const sink = sinkFor(runId, { warns });
    await sink.store(wire('new-1'));
    await sink.store(wire('new-2'));
    await sink.store(wire('bulk-5', { outputTokens: 77 }));
    const rows = await withOrg(db, org, (tx) =>
      tx.select().from(runUsageEntries).where(eq(runUsageEntries.runId, runId)),
    );
    expect(rows).toHaveLength(USAGE_ENTRY_CAP);
    const known = rows.find((r) => r.sourceId === 'bulk-5');
    expect(known).toMatchObject({ outputTokens: 77, priceInput: null });
    expect(warns.filter((w) => w.msg === 'usage cap reached')).toHaveLength(1);
    expect(JSON.stringify(warns)).not.toContain('new-1');
  }, 60_000);

  it('a second sink re-sending stored entries adds nothing, and new ids add to the same run', async () => {
    await seedVersion([rate('m1')], V1_AT);
    const runId = await seedRun();
    await sinkFor(runId).store(wire('a'));
    await sinkFor(runId).store(wire('b'));
    const before = await rowsOf(runId);
    const second = sinkFor(runId);
    await second.store(wire('a'));
    await second.store(wire('b'));
    expect(await rowsOf(runId)).toEqual(before);
    await second.store(wire('c'));
    expect((await rowsOf(runId)).map((r) => r.sourceId)).toEqual(['a', 'b', 'c']);
  });

  it('a failing transaction three times logs counts only, and a later store heals', async () => {
    await seedVersion([rate('m1')], V1_AT);
    const runId = await seedRun();
    let failures = 3;
    const flaky = new Proxy(db, {
      get(target, prop, recv) {
        if (prop === 'orm') {
          return new Proxy(target.orm, {
            get(o, p) {
              if (p === 'transaction') {
                return (...args: unknown[]) => {
                  if (failures > 0) {
                    failures -= 1;
                    return Promise.reject(new Error('boom secret-model-x'));
                  }
                  return (o.transaction as (...a: unknown[]) => unknown).apply(o, args);
                };
              }
              const v: unknown = Reflect.get(o, p);
              return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(o) : v;
            },
          });
        }
        return Reflect.get(target, prop, recv) as unknown;
      },
    });
    const warns: Warn[] = [];
    const sink = sinkFor(runId, { db: flaky, warns });
    await sink.store(wire('secret-id', { model: 'secret-model-x' }));
    expect(warns).toEqual([{ msg: 'usage entry not stored', fields: { failed: 1 } }]);
    expect(await rowsOf(runId)).toHaveLength(0);
    await sink.store(wire('secret-id', { model: 'secret-model-x' }));
    expect(await rowsOf(runId)).toHaveLength(1);
  });

  it('a rolled back attempt does not count the new id twice toward the cap', async () => {
    await seedVersion([rate('m1')], V1_AT);
    const runId = await seedRun();
    await asOwner(org, (c) =>
      c.query(
        `insert into run_usage_entries (org_id, run_id, source_id, model)
         select $1, $2, 'bulk-' || g, 'm1' from generate_series(1, $3::int) g`,
        [org, runId, USAGE_ENTRY_CAP - 3],
      ),
    );
    let rollbacks = 1;
    const flaky = new Proxy(db, {
      get(target, prop, recv) {
        if (prop === 'orm') {
          return new Proxy(target.orm, {
            get(o, p) {
              if (p === 'transaction') {
                return (cb: (tx: unknown) => Promise<unknown>, ...rest: unknown[]) =>
                  (o.transaction as (...a: unknown[]) => unknown).call(
                    o,
                    async (tx: unknown) => {
                      const result = await cb(tx);
                      if (rollbacks > 0) {
                        rollbacks -= 1;
                        throw new Error('commit failed');
                      }
                      return result;
                    },
                    ...rest,
                  );
              }
              const v: unknown = Reflect.get(o, p);
              return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(o) : v;
            },
          });
        }
        return Reflect.get(target, prop, recv) as unknown;
      },
    });
    const warns: Warn[] = [];
    const sink = sinkFor(runId, { db: flaky, warns });
    await sink.store(wire('new-1'));
    await sink.store(wire('new-2'));
    await sink.store(wire('new-3'));
    expect(await rowsOf(runId)).toHaveLength(USAGE_ENTRY_CAP);
    expect(warns).toEqual([]);
  }, 60_000);

  it('two sinks storing the same new id at once give one row', async () => {
    await seedVersion([rate('m1')], V1_AT);
    const runId = await seedRun();
    await Promise.all([sinkFor(runId).store(wire('a')), sinkFor(runId).store(wire('a'))]);
    expect(await rowsOf(runId)).toHaveLength(1);
  });

  it('P8: storing entries makes no price source call', async () => {
    await seedVersion([rate('m1')], V1_AT);
    let calls = 0;
    createPriceSourceRegistry(
      { MODEL_PRICES_SOURCE: 'litellm', MODEL_PRICES_URL: 'https://example.invalid/p.json', FAKE_STATE_DIR: '/tmp' },
      {
        http: async () => {
          calls += 1;
          throw new Error('no network');
        },
      },
    );
    const runId = await seedRun();
    const sink = sinkFor(runId);
    for (let i = 0; i < 50; i += 1) await sink.store(wire(`e${i}`));
    expect(calls).toBe(0);
  });
});
