import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FAKE_PRICE_RECORDS,
  FAKE_PRICE_STATE_FILE,
  PriceSourceError,
  createFakePriceSource,
} from '../../../src/adapters/price-source';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fake-price-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const write = (v: unknown) =>
  writeFileSync(join(dir, FAKE_PRICE_STATE_FILE), typeof v === 'string' ? v : JSON.stringify(v));
const providers = ['anthropic'];

describe('fake price source', () => {
  it('has the fixed set and no unpriced model', () => {
    expect(FAKE_PRICE_STATE_FILE).toBe('price-source.json');
    expect(FAKE_PRICE_RECORDS.map((r) => r.modelId)).toEqual(['fake-model-a', 'fake-model-b']);
    expect(FAKE_PRICE_RECORDS[0]).toMatchObject({
      provider: 'anthropic',
      inputPerMTokUsd: 3,
      outputPerMTokUsd: 15,
      cacheReadPerMTokUsd: 0.3,
      cacheWritePerMTokUsd: 3.75,
      cacheWriteLongPerMTokUsd: 6,
    });
    expect(FAKE_PRICE_RECORDS[1]).toMatchObject({
      inputPerMTokUsd: 1,
      outputPerMTokUsd: 5,
      cacheReadPerMTokUsd: 0.1,
      cacheWritePerMTokUsd: 1.25,
      cacheWriteLongPerMTokUsd: 2,
    });
  });

  it('gives the fixed set when there is no file', async () => {
    const src = createFakePriceSource({ stateDir: dir });
    expect(src.kind).toBe('fake');
    const res = await src.fetchPrices({ providers });
    expect(res.records).toEqual(FAKE_PRICE_RECORDS);
    expect(res.seen).toBe(2);
    expect(res.skipped).toBe(0);
  });

  it('gives the fixed set for mode ok', async () => {
    write({ mode: 'ok' });
    const res = await createFakePriceSource({ stateDir: dir }).fetchPrices({ providers });
    expect(res.records).toEqual(FAKE_PRICE_RECORDS);
  });

  it.each(['unreachable', 'bad_shape'] as const)('throws %s', async (kind) => {
    write({ mode: kind === 'unreachable' ? 'outage' : 'bad_shape' });
    const err = await createFakePriceSource({ stateDir: dir })
      .fetchPrices({ providers })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PriceSourceError);
    expect((err as PriceSourceError).kind).toBe(kind);
  });

  it('replaces the set with records', async () => {
    const rec = { ...FAKE_PRICE_RECORDS[0]!, modelId: 'custom' };
    write({ records: [rec] });
    const res = await createFakePriceSource({ stateDir: dir }).fetchPrices({ providers });
    expect(res.records).toEqual([rec]);
  });

  it('throws bad_shape for a garbage file or invalid records', async () => {
    const src = createFakePriceSource({ stateDir: dir });
    for (const bad of ['not json{', { records: [{ provider: 'anthropic' }] }, { mode: 'weird' }]) {
      write(bad);
      const err = await src.fetchPrices({ providers }).catch((e: unknown) => e);
      expect((err as PriceSourceError).kind).toBe('bad_shape');
    }
  });

  it('re-reads the file on every fetch', async () => {
    const src = createFakePriceSource({ stateDir: dir });
    expect((await src.fetchPrices({ providers })).records).toHaveLength(2);
    write({ records: [FAKE_PRICE_RECORDS[1]] });
    expect((await src.fetchPrices({ providers })).records).toHaveLength(1);
  });

  it('filters to the requested providers', async () => {
    const res = await createFakePriceSource({ stateDir: dir }).fetchPrices({ providers: ['vendor-a'] });
    expect(res.records).toEqual([]);
  });
});
