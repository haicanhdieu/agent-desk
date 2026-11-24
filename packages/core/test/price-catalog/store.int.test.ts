import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, modelPrices, modelPriceVersions, type Db } from '@agentdesk/db';
import { startPg, type TestPg } from '@agentdesk/db/testing';
import { loadCurrentPriceVersion, rateKey, writePriceVersion, type NormalizedRate } from '../../src';

let pgServer: TestPg;
let db: Db;
let admin: pg.Pool;

beforeAll(async () => {
  pgServer = await startPg();
  db = createDb(pgServer.appUrl);
  const u = new URL(pgServer.adminUrl);
  u.pathname = '/agentdesk';
  admin = new pg.Pool({ connectionString: u.toString() });
});
afterAll(async () => {
  await admin.end();
  await db.close();
  await pgServer.stop();
});
beforeEach(async () => {
  await admin.query('truncate model_prices, model_price_versions cascade');
});

const rec = (modelKey: string, input = 3, over: Partial<NormalizedRate> = {}): NormalizedRate => ({
  provider: 'anthropic',
  modelKey,
  input,
  output: 15,
  cacheRead: 0.3,
  cacheWrite: 3.75,
  cacheWriteLong: 6,
  ...over,
});
const t1 = new Date('2026-11-01T00:00:00Z');
const t2 = new Date('2026-11-02T00:00:00Z');
const t3 = new Date('2026-11-03T00:00:00Z');

async function versions() {
  return (await db.orm.select().from(modelPriceVersions)).sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime());
}

describe('price catalog store', () => {
  it('returns null on an empty database', async () => {
    expect(await loadCurrentPriceVersion(db)).toBeNull();
  });

  it('creates the first version as current and reads rates back as six-decimal strings', async () => {
    const r = await writePriceVersion(db, { source: 's1', records: [rec('a'), rec('b')], now: t1 });
    expect(r.outcome).toBe('created');
    const cur = await loadCurrentPriceVersion(db);
    expect(cur?.id).toBe(r.versionId);
    expect(cur?.source).toBe('s1');
    expect(cur?.checkedAt).toEqual(t1);
    expect(cur?.rates.get(rateKey('anthropic', 'a'))?.input).toBe('3.000000');
    expect(cur?.rates.size).toBe(2);
    expect((await versions())[0]?.entryCount).toBe(2);
  });

  it('confirms identical rates: same id, checked_at moves, fetched_at and entries stay', async () => {
    const a = await writePriceVersion(db, { source: 's1', records: [rec('a')], now: t1 });
    const b = await writePriceVersion(db, { source: 's1', records: [rec('a')], now: t2 });
    expect(b).toEqual({ outcome: 'confirmed', versionId: a.versionId });
    const [v] = await versions();
    expect(v?.checkedAt).toEqual(t2);
    expect(v?.fetchedAt).toEqual(t1);
    expect(await db.orm.select().from(modelPrices)).toHaveLength(1);
  });

  it('writes a new current version when a rate changes and keeps the old entries', async () => {
    const a = await writePriceVersion(db, { source: 's1', records: [rec('a')], now: t1 });
    const b = await writePriceVersion(db, { source: 's1', records: [rec('a', 4)], now: t2 });
    expect(b.outcome).toBe('created');
    expect(b.versionId).not.toBe(a.versionId);
    expect((await loadCurrentPriceVersion(db))?.id).toBe(b.versionId);
    const rows = await db.orm.select().from(modelPrices);
    expect(rows.find((r) => r.versionId === a.versionId)?.priceInput).toBe('3.000000');
    expect(rows.find((r) => r.versionId === b.versionId)?.priceInput).toBe('4.000000');
  });

  it('writes a new version for a different source with the same rates', async () => {
    const a = await writePriceVersion(db, { source: 's1', records: [rec('a')], now: t1 });
    const b = await writePriceVersion(db, { source: 's2', records: [rec('a')], now: t2 });
    expect(b.outcome).toBe('created');
    expect(b.versionId).not.toBe(a.versionId);
  });

  it('writes a new version when the model set differs', async () => {
    await writePriceVersion(db, { source: 's1', records: [rec('a')], now: t1 });
    const b = await writePriceVersion(db, { source: 's1', records: [rec('a'), rec('b')], now: t2 });
    expect(b.outcome).toBe('created');
  });

  it('rolls back everything when an entry insert fails', async () => {
    const a = await writePriceVersion(db, { source: 's1', records: [rec('a')], now: t1 });
    await expect(
      writePriceVersion(db, { source: 's1', records: [rec('a', 4), rec('bad', 5000)], now: t2 }),
    ).rejects.toThrow();
    expect((await loadCurrentPriceVersion(db))?.id).toBe(a.versionId);
    expect(await versions()).toHaveLength(1);
    expect(await db.orm.select().from(modelPrices)).toHaveLength(1);
  });

  it('ends with one current version after two concurrent identical writes', async () => {
    const input = { source: 's1', records: [rec('a')], now: t1 };
    const results = await Promise.all([writePriceVersion(db, input), writePriceVersion(db, input)]);
    expect(results.map((r) => r.versionId)).toHaveLength(2);
    const vs = await versions();
    expect(vs.filter((v) => v.isCurrent)).toHaveLength(1);
  });

  it('leaves old version rows unchanged after later writes', async () => {
    const a = await writePriceVersion(db, { source: 's1', records: [rec('a')], now: t1 });
    const before = (await db.orm.select().from(modelPrices)).filter((r) => r.versionId === a.versionId);
    await writePriceVersion(db, { source: 's1', records: [rec('a', 9)], now: t2 });
    await writePriceVersion(db, { source: 's1', records: [rec('a', 9)], now: t3 });
    const after = (await db.orm.select().from(modelPrices)).filter((r) => r.versionId === a.versionId);
    expect(after).toEqual(before);
  });

  it('writes more records than one statement can bind and reads them all back', async () => {
    const records = Array.from({ length: 9000 }, (_, i) => rec(`m${i}`));
    const r = await writePriceVersion(db, { source: 's1', records, now: t1 });
    expect(r.outcome).toBe('created');
    const cur = await loadCurrentPriceVersion(db);
    expect(cur?.rates.size).toBe(9000);
  });

  it('round-trips a key containing @ and /', async () => {
    await writePriceVersion(db, { source: 's1', records: [rec('vendor/model@2025-01')], now: t1 });
    const cur = await loadCurrentPriceVersion(db);
    expect(cur?.rates.get(rateKey('anthropic', 'vendor/model@2025-01'))?.output).toBe('15.000000');
  });
});
