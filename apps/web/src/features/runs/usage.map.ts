import type { RunUsageDetail, RunUsageSummary } from '@agentdesk/contracts';
import type { RunUsageView, UsageCellView } from '@/mocks/types';
import { formatTokensCompact, formatTokensExact, formatUsd, priceDateRange } from './usageFormat';

const NO_USAGE: UsageCellView = { text: '—', title: 'No usage data', srSuffix: 'No usage data' };

/** "$0.42" for the title: the formatted cost without its `~`. */
const titleCost = (cost: number): string => formatUsd(cost).slice(1);

/** Runs list Usage cell: compact text, exact hover title and the screen reader suffix. */
export function toUsageCell(usage: RunUsageSummary | null): UsageCellView {
  if (usage === null) return NO_USAGE;
  const cost = usage.estimatedCostUsd;
  const tokens = `${formatTokensExact(usage.totalTokens)} tokens in total`;
  const models = `${usage.modelCount} model${usage.modelCount === 1 ? '' : 's'}`;
  if (cost === null) {
    return {
      text: `${formatTokensCompact(usage.totalTokens)} · —`,
      title: `${tokens}, no estimated cost, ${models}`,
      srSuffix: ' tokens, no estimated cost',
    };
  }
  const plus = usage.partial ? '+' : '';
  const amount = cost > 0 && cost < 0.01 ? 'under $0.01' : titleCost(cost);
  return {
    text: `${formatTokensCompact(usage.totalTokens)} · ${formatUsd(cost)}${plus}`,
    title: `${tokens}, estimated cost ${usage.partial ? 'at least ' : ''}${amount}, ${models}`,
    srSuffix: usage.partial ? ' tokens, estimated cost, at least' : ' tokens, estimated cost',
  };
}

/** Run detail Usage section: exact numbers from the contract (never recomputed) and the price date text. */
export function toRunUsage(usage: RunUsageDetail | null, timeZone?: string): RunUsageView {
  if (usage === null) return { state: 'none' };
  const priced = usage.estimatedCostUsd !== null;
  const priceDate = priceDateRange(usage.priceAsOfEarliest, usage.priceAsOfLatest, timeZone);
  return {
    state: 'data',
    total: formatTokensExact(usage.totalTokens),
    input: formatTokensExact(usage.inputTokens),
    cacheRead: formatTokensExact(usage.cacheReadTokens),
    cacheWrite: formatTokensExact(usage.cacheWriteTokens),
    output: formatTokensExact(usage.outputTokens),
    ...(usage.reasoningTokens !== null && { reasoning: formatTokensExact(usage.reasoningTokens) }),
    cost: formatUsd(usage.estimatedCostUsd),
    atLeast: priced && usage.partial,
    ...(priceDate !== undefined && { priceDate }),
    partial: usage.partial || !priced,
    models: usage.models.map((m) => ({
      name: m.model,
      tokens: formatTokensExact(m.totalTokens),
      cost: formatUsd(m.estimatedCostUsd),
      unpriced: m.estimatedCostUsd === null,
    })),
  };
}
