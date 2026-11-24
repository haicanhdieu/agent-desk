import { USAGE_ENTRY_CAP } from '@agentdesk/contracts';
import type { ModelUsageDto, RunUsageDetail, RunUsageSummary } from '@agentdesk/contracts';

export interface UsageTokens {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheWriteLongTokens: number;
  outputTokens: number;
}

/** USD per million tokens. */
export interface UsageRates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWriteLong: number;
}

export interface UsageGroup extends UsageTokens {
  model: string;
  reasoningTokens: number | null;
  rates: UsageRates | null;
  priceAsOfEarliest: Date | null;
  priceAsOfLatest: Date | null;
  priceSource: string | null;
  entries: number;
}

/** Estimated USD cost of the tokens at the given rates. Pure: reads no table or state. */
export function estimateUsageCost(tokens: UsageTokens, rates: UsageRates): number {
  return (
    (tokens.inputTokens * rates.input +
      tokens.outputTokens * rates.output +
      tokens.cacheReadTokens * rates.cacheRead +
      tokens.cacheWriteTokens * rates.cacheWrite +
      tokens.cacheWriteLongTokens * rates.cacheWriteLong) /
    1e6
  );
}

function sumReasoning(values: readonly (number | null)[]): number | null {
  let total: number | null = null;
  for (const v of values) if (v !== null) total = (total ?? 0) + v;
  return total;
}

export function summarizeUsage(groups: readonly UsageGroup[], opts: { entryCap?: number } = {}): RunUsageDetail | null {
  if (groups.length === 0) return null;
  const cap = opts.entryCap ?? USAGE_ENTRY_CAP;

  const byModel = new Map<string, UsageGroup[]>();
  for (const g of groups) {
    const list = byModel.get(g.model);
    if (list) list.push(g);
    else byModel.set(g.model, [g]);
  }

  const models: ModelUsageDto[] = [];
  for (const [model, list] of byModel) {
    const inputTokens = list.reduce((s, g) => s + g.inputTokens, 0);
    const cacheReadTokens = list.reduce((s, g) => s + g.cacheReadTokens, 0);
    const cacheWriteTokens = list.reduce((s, g) => s + g.cacheWriteTokens + g.cacheWriteLongTokens, 0);
    const outputTokens = list.reduce((s, g) => s + g.outputTokens, 0);
    const priced = list.filter((g) => g.rates !== null);
    const estimatedCostUsd =
      priced.length === 0 ? null : priced.reduce((s, g) => (g.rates ? s + estimateUsageCost(g, g.rates) : s), 0);
    models.push({
      model,
      inputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      outputTokens,
      reasoningTokens: sumReasoning(list.map((g) => g.reasoningTokens)),
      totalTokens: inputTokens + cacheReadTokens + cacheWriteTokens + outputTokens,
      estimatedCostUsd,
      costPartial: priced.length < list.length,
    });
  }
  models.sort((a, b) => b.totalTokens - a.totalTokens || (a.model < b.model ? -1 : a.model > b.model ? 1 : 0));

  const sum = (f: (m: ModelUsageDto) => number): number => models.reduce((s, m) => s + f(m), 0);
  const inputTokens = sum((m) => m.inputTokens);
  const cacheReadTokens = sum((m) => m.cacheReadTokens);
  const cacheWriteTokens = sum((m) => m.cacheWriteTokens);
  const pricedModels = models.filter((m) => m.estimatedCostUsd !== null);
  const pricedGroups = groups.filter((g) => g.rates !== null);

  let earliest: Date | null = null;
  let latest: Date | null = null;
  let latestGroup: UsageGroup | null = null;
  for (const g of pricedGroups) {
    if (g.priceAsOfEarliest && (!earliest || g.priceAsOfEarliest < earliest)) earliest = g.priceAsOfEarliest;
    if (g.priceAsOfLatest && (!latest || g.priceAsOfLatest > latest)) {
      latest = g.priceAsOfLatest;
      latestGroup = g;
    }
  }

  const entries = groups.reduce((s, g) => s + g.entries, 0);

  return {
    inputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens: sum((m) => m.outputTokens),
    reasoningTokens: sumReasoning(models.map((m) => m.reasoningTokens)),
    totalInputTokens: inputTokens + cacheReadTokens + cacheWriteTokens,
    totalTokens: sum((m) => m.totalTokens),
    modelCount: models.length,
    estimatedCostUsd:
      pricedModels.length === 0 ? null : pricedModels.reduce((s, m) => s + (m.estimatedCostUsd ?? 0), 0),
    partial: pricedGroups.length < groups.length || entries >= cap,
    models,
    priceAsOfEarliest: earliest ? earliest.toISOString() : null,
    priceAsOfLatest: latest ? latest.toISOString() : null,
    priceSource: latestGroup?.priceSource ?? null,
  };
}

export function toUsageSummary(detail: RunUsageDetail): RunUsageSummary {
  const { models: _models, priceAsOfEarliest: _e, priceAsOfLatest: _l, priceSource: _s, ...summary } = detail;
  return summary;
}
