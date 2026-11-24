import type { RunDetailData, RunUsageView } from './types';

type DataView = Extract<RunUsageView, { state: 'data' }>;

const longRouterModel = 'gateway/team-router-long-model-name-for-internal-routing-2026-11-01@preview';

/** Run 60 on the board RunSucceededUsage: one model, priced on one day. */
export const runSucceededUsage: DataView = {
  state: 'data',
  total: '48,213',
  input: '6,104',
  cacheRead: '38,880',
  cacheWrite: '1,620',
  output: '1,609',
  cost: '~$0.42',
  atLeast: false,
  priceDate: '21 Nov 2026',
  partial: false,
  models: [{ name: 'model-a', tokens: '48,213', cost: '~$0.42', unpriced: false }],
};

const multiModel: DataView = {
  ...runSucceededUsage,
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

/** Run 61 on the boards RunRunningUsage and RunRunningUsageReconnecting: usage so far. */
export const runRunningUsage: DataView = {
  ...runSucceededUsage,
  total: '26,572',
  input: '3,120',
  cacheRead: '21,400',
  cacheWrite: '1,240',
  output: '812',
  cost: '~$0.24',
  models: [{ name: 'model-a', tokens: '26,572', cost: '~$0.24', unpriced: false }],
};

/** The data behind the usage boards of Screens/Run detail, each laid over the RunSucceeded or RunRunning data. */
export function usageBoardDetails(
  succeededData: RunDetailData,
  runningData: RunDetailData,
): Record<UsageBoardKey, RunDetailData> {
  const on = (usage: RunUsageView, extra: Partial<RunDetailData> = {}): RunDetailData => ({
    ...succeededData,
    usage,
    ...extra,
  });
  return {
    RunSucceededUsage: on(runSucceededUsage),
    RunSucceededUsageCollapsed: on(multiModel, { usageCollapsed: true }),
    RunSucceededUsageModelsCollapsed: on(multiModel, { usageModelsCollapsed: true }),
    RunSucceededUsageMultiModel: on(multiModel),
    RunSucceededUsageUnpriced: on({
      ...multiModel,
      total: '61,173',
      input: '9,300',
      cacheRead: '48,100',
      cacheWrite: '1,980',
      output: '1,793',
      cost: '~$0.42',
      atLeast: true,
      partial: true,
      models: [
        { name: 'model-a', tokens: '48,213', cost: '~$0.42', unpriced: false },
        { name: longRouterModel, tokens: '12,960', cost: '—', unpriced: true },
      ],
    }),
    RunSucceededUsagePartial: on({
      ...multiModel,
      total: '20,521,234',
      input: '1,204,118',
      cacheRead: '18,640,377',
      cacheWrite: '402,551',
      output: '274,188',
      cost: '~$42.89',
      atLeast: true,
      partial: true,
      models: [
        { name: 'model-a', tokens: '18,402,330', cost: '~$41.87', unpriced: false },
        { name: 'model-b', tokens: '2,118,904', cost: '~$1.02', unpriced: false },
      ],
    }),
    RunSucceededUsageNonePriced: on({
      state: 'data',
      total: '12,840',
      input: '2,410',
      cacheRead: '9,700',
      cacheWrite: '400',
      output: '330',
      cost: '—',
      atLeast: false,
      partial: true,
      models: [{ name: 'gateway/model-x', tokens: '12,840', cost: '—', unpriced: true }],
    }),
    RunSucceededUsageReasoning: on({ ...runSucceededUsage, reasoning: '640' }),
    RunSucceededUsageZero: on({
      ...runSucceededUsage,
      total: '0',
      input: '0',
      cacheRead: '0',
      cacheWrite: '0',
      output: '0',
      cost: '~$0.00',
      models: [{ name: 'model-a', tokens: '0', cost: '~$0.00', unpriced: false }],
    }),
    RunSucceededUsageNone: on({ state: 'none' }),
    RunSucceededUsagePriceRange: on({ ...multiModel, priceDate: '18 Nov 2026 to 21 Nov 2026' }),
    RunRunningUsage: { ...runningData, usage: runRunningUsage },
    RunRunningUsageReconnecting: {
      ...runningData,
      usage: runRunningUsage,
      connection: { state: 'reconnecting', label: 'Reconnecting, attempt 3' },
    },
  };
}

export type UsageBoardKey =
  | 'RunSucceededUsage'
  | 'RunSucceededUsageCollapsed'
  | 'RunSucceededUsageModelsCollapsed'
  | 'RunSucceededUsageMultiModel'
  | 'RunSucceededUsageUnpriced'
  | 'RunSucceededUsagePartial'
  | 'RunSucceededUsageNonePriced'
  | 'RunSucceededUsageReasoning'
  | 'RunSucceededUsageZero'
  | 'RunSucceededUsageNone'
  | 'RunSucceededUsagePriceRange'
  | 'RunRunningUsage'
  | 'RunRunningUsageReconnecting';
