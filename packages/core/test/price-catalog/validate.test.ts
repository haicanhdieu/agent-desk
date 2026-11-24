import { describe, expect, it } from 'vitest';
import type { SourceRateRecord } from '../../src/adapters/price-source';
import { validateSourceRecords } from '../../src/price-catalog/validate';

function rec(over: Partial<SourceRateRecord> = {}): SourceRateRecord {
  return {
    provider: 'anthropic',
    modelId: 'model-a',
    inputPerMTokUsd: 3,
    outputPerMTokUsd: 15,
    cacheReadPerMTokUsd: 0.3,
    cacheWritePerMTokUsd: 3.75,
    cacheWriteLongPerMTokUsd: 6,
    ...over,
  };
}

describe('validateSourceRecords', () => {
  it('normalises a valid record', () => {
    const out = validateSourceRecords([rec({ modelId: 'Vendor/Model.1' })]);
    expect(out).toEqual({
      records: [
        {
          provider: 'anthropic',
          modelKey: 'model-1',
          input: 3,
          output: 15,
          cacheRead: 0.3,
          cacheWrite: 3.75,
          cacheWriteLong: 6,
        },
      ],
      dropped: 0,
      duplicates: 0,
    });
  });

  it.each([-1, 1000.01, Number.NaN, Number.POSITIVE_INFINITY])('drops rate %s', (bad) => {
    const out = validateSourceRecords([rec({ outputPerMTokUsd: bad })]);
    expect(out.records).toEqual([]);
    expect(out.dropped).toBe(1);
  });

  it('keeps rates of 0 and 1000', () => {
    const out = validateSourceRecords([rec({ inputPerMTokUsd: 0, outputPerMTokUsd: 1000 })]);
    expect(out.records).toHaveLength(1);
    expect(out.dropped).toBe(0);
  });

  it('drops a hostile key and a bad provider', () => {
    const out = validateSourceRecords([rec({ modelId: "x'; drop table" }), rec({ provider: 'Bad Provider' })]);
    expect(out.records).toEqual([]);
    expect(out.dropped).toBe(2);
  });

  it('keeps the last of two records with the same normalised key', () => {
    const out = validateSourceRecords([
      rec({ modelId: 'v/Model.1', inputPerMTokUsd: 1 }),
      rec({ modelId: 'model-1:x', inputPerMTokUsd: 2 }),
    ]);
    expect(out.records).toHaveLength(1);
    expect(out.records[0]?.input).toBe(2);
    expect(out.duplicates).toBe(1);
  });
});
