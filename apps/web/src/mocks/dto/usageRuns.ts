import type { ModelUsageDto, RunDto, RunUsageDetail } from '@agentdesk/contracts';
import { ids } from './ids';
import { runFixtures } from './runs';

// Runs of invoicer-api with recorded token usage and estimated cost (spec 2026-11-24-run-token-usage-cost, ## Testing).
// Seeded into the browser mock only (startMockWorker), like lifecycleRuns.ts, so the unit tests' run lists and counts
// stay as they were; the mocked e2e specs open them by number (e2e/mock/mock.ts: USAGE_RUNS). Models are neutral names.

/** Run number of each usage case; e2e/mock/mock.ts re-exports this map. */
export const USAGE_RUNS = {
  oneModel: 105,
  twoModel: 106,
  subCent: 107,
  unpriced: 108,
  nonePriced: 109,
  noUsage: 110,
  zeroUsage: 111,
  capPartial: 112,
  longModelName: 113,
  reasoning: 114,
  noCache: 115,
  mixedPriceDates: 116,
  sameDay: 117,
  nearMidnight: 118,
  olderPrice: 119,
  newerPrice: 120,
} as const;

const NOV_21 = '2026-11-21T12:00:00Z';
const SOURCE = 'fixture-price-list';

interface ModelSpec {
  model: string;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  reasoning?: number;
  cost: number | null;
}

const modelOf = (s: ModelSpec): ModelUsageDto => ({
  model: s.model,
  inputTokens: s.input,
  cacheReadTokens: s.cacheRead,
  cacheWriteTokens: s.cacheWrite,
  outputTokens: s.output,
  reasoningTokens: s.reasoning ?? null,
  totalTokens: s.input + s.cacheRead + s.cacheWrite + s.output,
  estimatedCostUsd: s.cost,
  costPartial: s.cost === null,
});

/** Totals are the sums of the model rows; the cost is the sum of the priced rows, null when none is priced. */
function usageOf(
  specs: ModelSpec[],
  dates: [string, string] | null,
  over: Partial<RunUsageDetail> = {},
): RunUsageDetail {
  const models = specs.map(modelOf);
  const sum = (f: (m: ModelUsageDto) => number) => models.reduce((a, m) => a + f(m), 0);
  const priced = models.filter((m) => m.estimatedCostUsd !== null);
  const reasoning = models.filter((m) => m.reasoningTokens !== null);
  const cost = priced.length ? Math.round(priced.reduce((a, m) => a + (m.estimatedCostUsd ?? 0), 0) * 1e6) / 1e6 : null;
  return {
    inputTokens: sum((m) => m.inputTokens),
    cacheReadTokens: sum((m) => m.cacheReadTokens),
    cacheWriteTokens: sum((m) => m.cacheWriteTokens),
    outputTokens: sum((m) => m.outputTokens),
    reasoningTokens: reasoning.length ? reasoning.reduce((a, m) => a + (m.reasoningTokens ?? 0), 0) : null,
    totalInputTokens: sum((m) => m.inputTokens + m.cacheReadTokens + m.cacheWriteTokens),
    totalTokens: sum((m) => m.totalTokens),
    modelCount: models.length,
    estimatedCostUsd: cost,
    partial: models.some((m) => m.costPartial),
    models,
    priceAsOfEarliest: dates ? dates[0] : null,
    priceAsOfLatest: dates ? dates[1] : null,
    priceSource: dates ? SOURCE : null,
    ...over,
  };
}

const base = (() => {
  const run = runFixtures.find((r) => r.number === 65);
  if (!run) throw new Error('fixture run 65 missing');
  return run;
})();

const make = (number: number, title: string, usage: RunUsageDetail | null): RunDto => ({
  ...base,
  id: ids.run(1, number),
  number,
  command: 'code-build',
  ticket: { ...base.ticket, ref: String(300 + number), number: 300 + number, title },
  status: 'succeeded',
  sessionExpiresAt: null,
  agentNote: null,
  usage,
});

const A = { model: 'model-a' };
const B = { model: 'model-b' };
const ONE: ModelSpec = { ...A, input: 12000, cacheRead: 30000, cacheWrite: 1213, output: 5000, cost: 0.42 };
const dated = (iso: string): [string, string] => [iso, iso];
const LONG_MODEL = 'Ab0._:/@-'.repeat(15).slice(0, 128);

export const usageRunFixtures: RunDto[] = [
  make(USAGE_RUNS.oneModel, 'Usage: one model', usageOf([ONE], dated(NOV_21))),
  make(
    USAGE_RUNS.twoModel,
    'Usage: two models',
    usageOf(
      [
        { ...A, input: 10000, cacheRead: 25000, cacheWrite: 1000, output: 4000, cost: 0.3 },
        { ...B, input: 5000, cacheRead: 8000, cacheWrite: 500, output: 1000, cost: 0.1 },
      ],
      dated(NOV_21),
    ),
  ),
  make(
    USAGE_RUNS.subCent,
    'Usage: under one cent',
    usageOf([{ ...A, input: 1000, cacheRead: 800, cacheWrite: 104, output: 200, cost: 0.004 }], dated(NOV_21)),
  ),
  make(
    USAGE_RUNS.unpriced,
    'Usage: one model unpriced',
    usageOf([ONE, { ...B, input: 4000, cacheRead: 8000, cacheWrite: 960, output: 0, cost: null }], dated(NOV_21)),
  ),
  make(
    USAGE_RUNS.nonePriced,
    'Usage: no model priced',
    usageOf([{ ...B, input: 3000, cacheRead: 7000, cacheWrite: 840, output: 2000, cost: null }], null),
  ),
  make(USAGE_RUNS.noUsage, 'Usage: none recorded', null),
  make(
    USAGE_RUNS.zeroUsage,
    'Usage: all zero',
    usageOf([{ ...A, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, cost: 0 }], dated(NOV_21)),
  ),
  make(USAGE_RUNS.capPartial, 'Usage: cap reached', usageOf([ONE], dated(NOV_21), { partial: true })),
  make(USAGE_RUNS.longModelName, 'Usage: long model name', usageOf([{ ...ONE, model: LONG_MODEL }], dated(NOV_21))),
  make(
    USAGE_RUNS.reasoning,
    'Usage: reasoning tokens',
    usageOf(
      [{ ...A, input: 1000, cacheRead: 2000, cacheWrite: 100, output: 500, reasoning: 300, cost: 0.05 }],
      dated(NOV_21),
    ),
  ),
  make(
    USAGE_RUNS.noCache,
    'Usage: no cache tokens',
    usageOf([{ ...A, input: 8000, cacheRead: 0, cacheWrite: 0, output: 2000, cost: 0.06 }], dated(NOV_21)),
  ),
  make(
    USAGE_RUNS.mixedPriceDates,
    'Usage: priced on different dates',
    usageOf(
      [
        { ...A, input: 10000, cacheRead: 27000, cacheWrite: 1000, output: 2000, cost: 0.3 },
        { ...B, input: 4000, cacheRead: 12000, cacheWrite: 87, output: 2000, cost: 0.15 },
      ],
      ['2026-11-18T12:00:00Z', NOV_21],
    ),
  ),
  make(
    USAGE_RUNS.sameDay,
    'Usage: two instants on one day',
    usageOf(
      [{ ...A, input: 5000, cacheRead: 12000, cacheWrite: 500, output: 2500, cost: 0.42 }],
      ['2026-11-21T09:00:00Z', '2026-11-21T15:00:00Z'],
    ),
  ),
  make(
    USAGE_RUNS.nearMidnight,
    'Usage: near midnight',
    usageOf(
      [{ ...A, input: 5000, cacheRead: 12000, cacheWrite: 500, output: 2500, cost: 0.42 }],
      dated('2026-11-21T03:30:00Z'),
    ),
  ),
  make(
    USAGE_RUNS.olderPrice,
    'Usage: older price date',
    usageOf(
      [{ ...A, input: 6000, cacheRead: 20000, cacheWrite: 1000, output: 3000, cost: 0.2 }],
      dated('2026-06-01T12:00:00Z'),
    ),
  ),
  make(
    USAGE_RUNS.newerPrice,
    'Usage: newer price date',
    usageOf([{ ...A, input: 6000, cacheRead: 20000, cacheWrite: 1000, output: 3000, cost: 0.31 }], dated(NOV_21)),
  ),
];
