import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApplicationFailure } from '@temporalio/common';
import {
  createPriceSourceRegistry,
  loadCurrentPriceVersion,
  type PriceSource,
  type SourceRateRecord,
} from '@agentdesk/core';
import { createDb, modelPrices, modelPriceVersions, type Db } from '@agentdesk/db';
import { startPg, type TestPg } from '@agentdesk/db/testing';
import { syncModelPrices } from '../src/activities/price-sync.activity';
import { scriptedPriceSource, seedPriceVersion } from './helpers/prices';

let pgx: TestPg;
let db: Db;
let admin: pg.Pool;

const T0 = new Date('2026-11-24T12:00:00.000Z');
const T_OLD = new Date('2026-11-20T00:00:00.000Z');
const clock = { now: () => T0 };

beforeAll(async () => {
  pgx = await startPg();
  db = createDb(pgx.appUrl);
  const u = new URL(pgx.adminUrl);
  u.pathname = '/agentdesk';
  admin = new pg.Pool({ connectionString: u.toString() });
});
afterAll(async () => {
  await admin.end();
  await db.close();
  await pgx.stop();
});
beforeEach(async () => {
  await admin.query('truncate model_prices, model_price_versions cascade');
});

const rec = (modelId: string, input = 3): SourceRateRecord => ({
  provider: 'anthropic',
  modelId,
  inputPerMTokUsd: input,
  outputPerMTokUsd: 15,
  cacheReadPerMTokUsd: 0.3,
  cacheWritePerMTokUsd: 3.75,
  cacheWriteLongPerMTokUsd: 6,
});
const many = (n: number, input = 3): SourceRateRecord[] =>
  Array.from({ length: n }, (_, i) => rec(`model-${i}`, input));

interface Logged {
  level: 'warn' | 'error';
  msg: string;
  meta: Record<string, unknown> | undefined;
}
function setup(source: PriceSource | undefined) {
  const logs: Logged[] = [];
  const deps = {
    db,
    registry: { source: () => source },
    clock,
    log: {
      warn: (msg: string, meta?: Record<string, unknown>) => void logs.push({ level: 'warn', msg, meta }),
      error: (msg: string, meta?: Record<string, unknown>) => void logs.push({ level: 'error', msg, meta }),
    },
  };
  return { deps, logs };
}
async function failureOf(p: Promise<unknown>): Promise<ApplicationFailure> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ApplicationFailure) return err;
    throw err;
  }
  throw new Error('expected a failure');
}
const versionCount = async (): Promise<number> => (await db.orm.select().from(modelPriceVersions)).length;
const priceCount = async (): Promise<number> => (await db.orm.select().from(modelPrices)).length;

describe('syncModelPrices', () => {
  it('returns off and writes nothing when no source is configured', async () => {
    const { deps } = setup(undefined);
    expect(await syncModelPrices(deps)).toEqual({ outcome: 'off' });
    expect(await versionCount()).toBe(0);
  });

  it('creates the first version', async () => {
    const { deps } = setup(scriptedPriceSource([many(3)]));
    expect(await syncModelPrices(deps)).toEqual({ outcome: 'created', entries: 3 });
    const cur = await loadCurrentPriceVersion(db);
    expect(cur?.source).toBe('scripted');
    expect(cur?.checkedAt).toEqual(T0);
  });

  it('asks the source for the anthropic provider only', async () => {
    const src = scriptedPriceSource([many(1)]);
    await syncModelPrices(setup(src).deps);
    expect(src.inputs).toEqual([{ providers: ['anthropic'] }]);
  });

  it('confirms identical rates and only moves checked_at', async () => {
    const id = await seedPriceVersion(db, { source: 'scripted', checkedAt: T_OLD, rates: many(3) });
    const { deps } = setup(scriptedPriceSource([many(3)]));
    expect(await syncModelPrices(deps)).toEqual({ outcome: 'confirmed', entries: 3 });
    const cur = await loadCurrentPriceVersion(db);
    expect(cur?.id).toBe(id);
    expect(cur?.checkedAt).toEqual(T0);
    expect(await versionCount()).toBe(1);
  });

  it('creates a new version for changed rates within the guards, keeping the old one', async () => {
    const oldId = await seedPriceVersion(db, { source: 'scripted', checkedAt: T_OLD, rates: many(100) });
    const changed = many(100);
    changed[0] = rec('model-0', 4);
    const { deps } = setup(scriptedPriceSource([changed]));
    expect(await syncModelPrices(deps)).toEqual({ outcome: 'created', entries: 100 });
    expect(await versionCount()).toBe(2);
    expect(await priceCount()).toBe(200);
    expect((await loadCurrentPriceVersion(db))?.id).not.toBe(oldId);
  });

  it.each(['unreachable', 'too_large', 'bad_shape', 'rejected'] as const)(
    'fails with PriceSyncFailed %s and keeps the current version untouched',
    async (kind) => {
      const id = await seedPriceVersion(db, { source: 'scripted', checkedAt: T_OLD, rates: many(3) });
      const { deps, logs } = setup(scriptedPriceSource([kind]));
      const failure = await failureOf(syncModelPrices(deps));
      expect(failure.type).toBe('PriceSyncFailed');
      expect(failure.nonRetryable).toBe(false);
      expect(failure.details).toEqual([kind]);
      expect(failure.message).toBe(`price sync: ${kind}`);
      const cur = await loadCurrentPriceVersion(db);
      expect(cur?.id).toBe(id);
      expect(cur?.checkedAt).toEqual(T_OLD);
      expect(await versionCount()).toBe(1);
      expect(logs.map((l) => l.level)).toEqual(['warn']);
      expect(logs[0]?.meta).toMatchObject({ kind });
    },
  );

  it('rejects a guard failure (6 of 100 moved 6x), logs an error, and writes nothing', async () => {
    const id = await seedPriceVersion(db, { source: 'scripted', checkedAt: T_OLD, rates: many(100) });
    const moved = many(100);
    for (let i = 0; i < 6; i++) moved[i] = rec(`model-${i}`, 18);
    const { deps, logs } = setup(scriptedPriceSource([moved]));
    const failure = await failureOf(syncModelPrices(deps));
    expect(failure.type).toBe('PriceSyncFailed');
    expect(failure.details).toEqual(['moved']);
    const cur = await loadCurrentPriceVersion(db);
    expect(cur?.id).toBe(id);
    expect(cur?.checkedAt).toEqual(T_OLD);
    expect(await versionCount()).toBe(1);
    expect(logs.map((l) => l.level)).toEqual(['error']);
  });

  it('fails with zero_match when the source returns nothing usable', async () => {
    const { deps } = setup(scriptedPriceSource([[]]));
    expect((await failureOf(syncModelPrices(deps))).details).toEqual(['zero_match']);
    expect(await versionCount()).toBe(0);
  });

  it('accepts a source change despite big moves and logs one warning', async () => {
    await seedPriceVersion(db, { source: 'old-source', checkedAt: T_OLD, rates: many(100) });
    const { deps, logs } = setup(scriptedPriceSource([many(100, 90)], 'new-source'));
    expect(await syncModelPrices(deps)).toEqual({ outcome: 'created', entries: 100 });
    expect((await loadCurrentPriceVersion(db))?.source).toBe('new-source');
    expect(await versionCount()).toBe(2);
    expect(logs.filter((l) => l.level === 'warn')).toHaveLength(1);
  });

  it('is idempotent when the same input is retried, and never deletes', async () => {
    const { deps } = setup(scriptedPriceSource([many(3)]));
    expect((await syncModelPrices(deps)).outcome).toBe('created');
    expect((await syncModelPrices(deps)).outcome).toBe('confirmed');
    expect(await versionCount()).toBe(1);
    expect(await priceCount()).toBe(3);
  });

  it('never puts a model id or record text in log meta', async () => {
    await seedPriceVersion(db, { source: 'old-source', checkedAt: T_OLD, rates: [rec('secret-model-xyz')] });
    const a = setup(scriptedPriceSource([[rec('secret-model-xyz')]], 'new-source'));
    await syncModelPrices(a.deps);
    const b = setup(scriptedPriceSource(['bad_shape']));
    await failureOf(syncModelPrices(b.deps));
    const c = setup(scriptedPriceSource([[rec('secret-model-xyz', 90), rec('other-model', 1)]], 'new-source'));
    await failureOf(syncModelPrices(c.deps));
    const all = JSON.stringify([...a.logs, ...b.logs, ...c.logs]);
    expect(all).not.toContain('secret-model-xyz');
    expect(all).not.toContain('other-model');
  });

  it('reads the real registry: off mode returns off', async () => {
    const registry = createPriceSourceRegistry({
      MODEL_PRICES_SOURCE: 'off',
      MODEL_PRICES_URL: 'http://unused',
      FAKE_STATE_DIR: 'unused',
    });
    const { deps } = setup(undefined);
    expect(await syncModelPrices({ ...deps, registry })).toEqual({ outcome: 'off' });
  });
});
