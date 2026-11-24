import { describe, expect, it } from 'vitest';
import { USAGE_ENTRY_CAP } from '@agentdesk/contracts';
import {
  estimateUsageCost,
  summarizeUsage,
  toUsageSummary,
  type UsageGroup,
  type UsageRates,
  type UsageTokens,
} from '../../src/usage/estimate';

const RATES: UsageRates = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, cacheWriteLong: 6 };
const zero: UsageTokens = {
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cacheWriteLongTokens: 0,
  outputTokens: 0,
};

function group(over: Partial<UsageGroup> = {}): UsageGroup {
  return {
    ...zero,
    model: 'm',
    reasoningTokens: null,
    rates: RATES,
    priceAsOfEarliest: new Date('2026-01-01T00:00:00Z'),
    priceAsOfLatest: new Date('2026-01-01T00:00:00Z'),
    priceSource: 'src',
    entries: 1,
    ...over,
  };
}

describe('estimateUsageCost', () => {
  it.each([
    ['all zero', zero, 0],
    ['one input token', { ...zero, inputTokens: 1 }, 3 / 1e6],
    ['100M output', { ...zero, outputTokens: 100_000_000 }, (100_000_000 * 15) / 1e6],
    [
      'cache only',
      { ...zero, cacheReadTokens: 1000, cacheWriteTokens: 200, cacheWriteLongTokens: 50 },
      (1000 * 0.3 + 200 * 3.75 + 50 * 6) / 1e6,
    ],
  ])('%s', (_n, tokens, expected) => {
    expect(estimateUsageCost(tokens, RATES)).toBeCloseTo(expected, 12);
  });

  it('takes only tokens and rates and keeps no state', () => {
    expect(estimateUsageCost.length).toBe(2);
    const t = { ...zero, inputTokens: 1_000_000 };
    expect(estimateUsageCost(t, RATES)).toBe(3);
    expect(estimateUsageCost(t, { ...RATES, input: 5 })).toBe(5);
  });
});

describe('summarizeUsage', () => {
  it('returns null for no groups', () => {
    expect(summarizeUsage([])).toBeNull();
  });

  it('prices each group at its own rates', () => {
    const d = summarizeUsage([
      group({ inputTokens: 1_000_000 }),
      group({ inputTokens: 1_000_000, rates: { ...RATES, input: 5 } }),
    ]);
    expect(d?.models).toHaveLength(1);
    expect(d?.estimatedCostUsd).toBe(8);
    expect(d?.models[0]?.estimatedCostUsd).toBe(8);
    expect(d?.partial).toBe(false);
  });

  it('marks an unpriced model partial with null cost', () => {
    const d = summarizeUsage([
      group({ model: 'a', inputTokens: 1_000_000 }),
      group({
        model: 'b',
        inputTokens: 10,
        rates: null,
        priceAsOfEarliest: null,
        priceAsOfLatest: null,
        priceSource: null,
      }),
    ]);
    expect(d?.partial).toBe(true);
    expect(d?.estimatedCostUsd).toBe(3);
    const b = d?.models.find((m) => m.model === 'b');
    expect(b?.estimatedCostUsd).toBeNull();
    expect(b?.costPartial).toBe(true);
    expect(d?.models.find((m) => m.model === 'a')?.costPartial).toBe(false);
  });

  it('gives null cost and dates when nothing is priced', () => {
    const d = summarizeUsage([
      group({ rates: null, priceAsOfEarliest: null, priceAsOfLatest: null, priceSource: null }),
    ]);
    expect(d?.estimatedCostUsd).toBeNull();
    expect(d?.priceAsOfEarliest).toBeNull();
    expect(d?.priceAsOfLatest).toBeNull();
    expect(d?.priceSource).toBeNull();
  });

  it('sorts by total tokens desc then model name', () => {
    const d = summarizeUsage([
      group({ model: 'b', inputTokens: 5 }),
      group({ model: 'a', inputTokens: 5 }),
      group({ model: 'c', inputTokens: 9 }),
    ]);
    expect(d?.models.map((m) => m.model)).toEqual(['c', 'a', 'b']);
  });

  it('totals tokens without adding reasoning', () => {
    const d = summarizeUsage([
      group({
        inputTokens: 2048,
        cacheReadTokens: 1800,
        cacheWriteTokens: 248,
        outputTokens: 500,
        reasoningTokens: 300,
      }),
    ]);
    expect(d?.totalTokens).toBe(4596);
    expect(d?.totalInputTokens).toBe(4096);
    expect(d?.reasoningTokens).toBe(300);
    expect(d?.models[0]?.reasoningTokens).toBe(300);
  });

  it('adds standard and long cache writes', () => {
    const d = summarizeUsage([group({ cacheWriteTokens: 200, cacheWriteLongTokens: 50 })]);
    expect(d?.cacheWriteTokens).toBe(250);
    expect(d?.models[0]?.cacheWriteTokens).toBe(250);
    expect(d?.totalTokens).toBe(250);
  });

  it('is partial when entries reach the cap', () => {
    const d = summarizeUsage([group({ entries: 12000 }), group({ model: 'x', entries: 8000 })]);
    expect(USAGE_ENTRY_CAP).toBe(20000);
    expect(d?.partial).toBe(true);
    expect(summarizeUsage([group({ entries: 20000 })], { entryCap: 30000 })?.partial).toBe(false);
  });

  it('spans price dates and takes the source of the latest', () => {
    const d = summarizeUsage([
      group({
        model: 'a',
        priceAsOfEarliest: new Date('2026-01-01T00:00:00Z'),
        priceAsOfLatest: new Date('2026-02-01T00:00:00Z'),
        priceSource: 'old',
      }),
      group({
        model: 'b',
        priceAsOfEarliest: new Date('2026-03-01T00:00:00Z'),
        priceAsOfLatest: new Date('2026-04-01T00:00:00Z'),
        priceSource: 'new',
      }),
    ]);
    expect(d?.priceAsOfEarliest).toBe('2026-01-01T00:00:00.000Z');
    expect(d?.priceAsOfLatest).toBe('2026-04-01T00:00:00.000Z');
    expect(d?.priceSource).toBe('new');
  });

  it('keeps reasoning null when every group is null', () => {
    expect(summarizeUsage([group(), group({ model: 'z' })])?.reasoningTokens).toBeNull();
  });
});

describe('toUsageSummary', () => {
  it('drops models, dates and source', () => {
    const d = summarizeUsage([group({ inputTokens: 10 })]);
    if (!d) throw new Error('expected detail');
    const s = toUsageSummary(d);
    expect(s).not.toHaveProperty('models');
    expect(s).not.toHaveProperty('priceAsOfEarliest');
    expect(s).not.toHaveProperty('priceAsOfLatest');
    expect(s).not.toHaveProperty('priceSource');
    expect(s.totalTokens).toBe(10);
    expect(s.modelCount).toBe(1);
  });
});
