import type { RunUsageDetail, RunUsageSummary } from '@agentdesk/contracts';
import { describe, expect, it } from 'vitest';
import { toRunUsage, toUsageCell } from './usage.map';

const summary = (over: Partial<RunUsageSummary> = {}): RunUsageSummary => ({
  inputTokens: 6120,
  cacheReadTokens: 38400,
  cacheWriteTokens: 2100,
  outputTokens: 1593,
  reasoningTokens: null,
  totalInputTokens: 46620,
  totalTokens: 48213,
  modelCount: 1,
  estimatedCostUsd: 0.42,
  partial: false,
  ...over,
});

const NOV_21 = '2026-11-21T12:00:00Z';
const SOURCE = 'secret-price-source-name';

const detail = (over: Partial<RunUsageDetail> = {}): RunUsageDetail => ({
  ...summary(),
  models: [
    {
      model: 'model-a',
      inputTokens: 6120,
      cacheReadTokens: 38400,
      cacheWriteTokens: 2100,
      outputTokens: 1593,
      reasoningTokens: null,
      totalTokens: 48213,
      estimatedCostUsd: 0.42,
      costPartial: false,
    },
  ],
  priceAsOfEarliest: NOV_21,
  priceAsOfLatest: NOV_21,
  priceSource: SOURCE,
  ...over,
});

describe('toUsageCell', () => {
  it('shows compact tokens and cost with exact numbers in the title', () => {
    expect(toUsageCell(summary())).toEqual({
      text: '48.2k · ~$0.42',
      title: '48,213 tokens in total, estimated cost $0.42, 1 model',
      srSuffix: ' tokens, estimated cost',
    });
  });

  it('adds + and "at least" when partial and priced', () => {
    expect(toUsageCell(summary({ totalTokens: 61173, modelCount: 2, partial: true }))).toEqual({
      text: '61.2k · ~$0.42+',
      title: '61,173 tokens in total, estimated cost at least $0.42, 2 models',
      srSuffix: ' tokens, estimated cost, at least',
    });
  });

  it('shows a dash and no estimated cost when nothing is priced', () => {
    expect(toUsageCell(summary({ totalTokens: 12840, estimatedCostUsd: null, partial: true }))).toEqual({
      text: '12.8k · —',
      title: '12,840 tokens in total, no estimated cost, 1 model',
      srSuffix: ' tokens, no estimated cost',
    });
  });

  it('says under $0.01 below a cent', () => {
    expect(toUsageCell(summary({ totalTokens: 2104, estimatedCostUsd: 0.004 }))).toEqual({
      text: '2.1k · ~<$0.01',
      title: '2,104 tokens in total, estimated cost under $0.01, 1 model',
      srSuffix: ' tokens, estimated cost',
    });
  });

  it('shows a dash for no usage', () => {
    expect(toUsageCell(null)).toEqual({ text: '—', title: 'No usage data', srSuffix: 'No usage data' });
  });

  it('shows zero usage as 0 and ~$0.00', () => {
    expect(toUsageCell(summary({ totalTokens: 0, estimatedCostUsd: 0 })).text).toBe('0 · ~$0.00');
  });
});

describe('toRunUsage', () => {
  it('is none for null', () => {
    expect(toRunUsage(null)).toEqual({ state: 'none' });
  });

  it('passes the contract numbers through as exact text', () => {
    const v = toRunUsage(detail(), 'UTC');
    expect(v).toEqual({
      state: 'data',
      total: '48,213',
      input: '6,120',
      cacheRead: '38,400',
      cacheWrite: '2,100',
      output: '1,593',
      cost: '~$0.42',
      atLeast: false,
      priceDate: '21 Nov 2026',
      partial: false,
      models: [{ name: 'model-a', tokens: '48,213', cost: '~$0.42', unpriced: false }],
    });
  });

  it('never recomputes the total from the split', () => {
    const v = toRunUsage(detail({ totalTokens: 50000 }), 'UTC');
    expect(v).toMatchObject({ total: '50,000' });
  });

  it('shows zero usage as 0 with a cost and a date', () => {
    const v = toRunUsage(
      detail({
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
      }),
      'UTC',
    );
    expect(v).toMatchObject({ total: '0', input: '0', output: '0', cost: '~$0.00', priceDate: '21 Nov 2026' });
  });

  it('marks a partial priced run as at least', () => {
    expect(toRunUsage(detail({ partial: true }), 'UTC')).toMatchObject({
      atLeast: true,
      partial: true,
      cost: '~$0.42',
    });
  });

  it('shows no cost, no date and the partial note when nothing is priced', () => {
    const v = toRunUsage(
      detail({ estimatedCostUsd: null, partial: true, priceAsOfEarliest: null, priceAsOfLatest: null }),
      'UTC',
    );
    expect(v).toMatchObject({ cost: '—', atLeast: false, partial: true });
    expect(v).not.toHaveProperty('priceDate');
  });

  it('marks an unpriced model with a dash', () => {
    const base = detail();
    const model = base.models[0];
    if (!model) throw new Error('model missing');
    const v = toRunUsage(
      detail({ models: [{ ...model, estimatedCostUsd: null, costPartial: true }], partial: true }),
      'UTC',
    );
    expect(v).toMatchObject({ models: [{ name: 'model-a', cost: '—', unpriced: true }] });
  });

  it('shows reasoning only when reported', () => {
    expect(toRunUsage(detail({ reasoningTokens: 400 }), 'UTC')).toMatchObject({ reasoning: '400' });
    expect(toRunUsage(detail({ reasoningTokens: null }), 'UTC')).not.toHaveProperty('reasoning');
  });

  it('uses the contract cache write value', () => {
    expect(toRunUsage(detail({ cacheWriteTokens: 7 }), 'UTC')).toMatchObject({ cacheWrite: '7' });
  });

  it('gives one date or two depending on the local day of the range', () => {
    const range = { priceAsOfEarliest: '2026-11-21T01:00:00Z', priceAsOfLatest: '2026-11-21T20:00:00Z' };
    expect(toRunUsage(detail(range), 'UTC')).toMatchObject({ priceDate: '21 Nov 2026' });
    expect(toRunUsage(detail(range), 'Asia/Ho_Chi_Minh')).toMatchObject({
      priceDate: '21 Nov 2026 to 22 Nov 2026',
    });
  });

  it('never exposes the price source', () => {
    expect(JSON.stringify(toRunUsage(detail(), 'UTC'))).not.toContain(SOURCE);
  });
});
