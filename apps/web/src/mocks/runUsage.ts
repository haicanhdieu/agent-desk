import type { RunUsageView } from './types';

type DataView = Extract<RunUsageView, { state: 'data' }>;

/** A model name of 128 characters with `. : / @ -`, to prove truncation. */
export const longModelName = `${'provider/model-family.name:build@2026-11-21-'.repeat(3)}`.slice(0, 127) + 'x';
/** A model name that is markup and shell text; it must render as plain text. */
export const hostileModelName = `<img src=x onerror=alert(1)>'; rm -rf /`;

const single: DataView = {
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
};

const multi: DataView = {
  ...single,
  total: '58,087',
  input: '8,410',
  cacheRead: '45,920',
  cacheWrite: '2,016',
  output: '1,741',
  cost: '~$0.45',
  models: [
    { name: 'model-a', tokens: '48,213', cost: '~$0.42', unpriced: false },
    { name: 'model-b', tokens: '9,874', cost: '~$0.03', unpriced: false },
  ],
};

/** The thirteen RunUsage story fixtures, keyed by story name. */
export const runUsageViews = {
  SingleModel: single,
  MultiModel: multi,
  Partial: {
    ...multi,
    cost: '~$42.89',
    atLeast: true,
    partial: true,
  },
  UnpricedModel: {
    ...multi,
    cost: '~$0.42',
    atLeast: true,
    partial: true,
    models: [
      { name: 'model-a', tokens: '48,213', cost: '~$0.42', unpriced: false },
      { name: longModelName, tokens: '9,874', cost: '—', unpriced: true },
    ],
  },
  WithReasoning: { ...single, reasoning: '640' },
  NoUsage: { state: 'none' },
  Zero: {
    ...single,
    total: '0',
    input: '0',
    cacheRead: '0',
    cacheWrite: '0',
    output: '0',
    cost: '~$0.00',
    models: [{ name: 'model-a', tokens: '0', cost: '~$0.00', unpriced: false }],
  },
  LongModelName: { ...single, models: [{ name: longModelName, tokens: '48,213', cost: '~$0.42', unpriced: false }] },
  HostileModelName: {
    ...single,
    models: [{ name: hostileModelName, tokens: '48,213', cost: '~$0.42', unpriced: false }],
  },
  Collapsed: single,
  ModelsCollapsed: multi,
  SinglePriceDate: multi,
  PriceDateRange: { ...multi, priceDate: '18 Nov 2026 to 21 Nov 2026' },
} satisfies Record<string, RunUsageView>;
