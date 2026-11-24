import { expect } from 'vitest';

/** The agent-neutral usage wire shape every runner adapter prints (disjoint buckets). */
export interface UsageWire {
  id: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheWriteLongTokens: number;
  reasoningTokens?: number;
}

/** Fixed rates, USD per million tokens, used to compare agents at equal rates. */
const RATES = { input: 3, cacheRead: 0.3, cacheWrite: 3.75, cacheWriteLong: 6, output: 15 };

/** The core cost formula (docs spec "Cost"), inlined: reasoning tokens are inside output and never priced. */
export const usageCost = (u: UsageWire): number =>
  (u.inputTokens * RATES.input +
    u.cacheReadTokens * RATES.cacheRead +
    u.cacheWriteTokens * RATES.cacheWrite +
    u.cacheWriteLongTokens * RATES.cacheWriteLong +
    u.outputTokens * RATES.output) /
  1e6;

export const totalTokens = (u: UsageWire): number =>
  u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens + u.cacheWriteLongTokens + u.outputTokens;

/**
 * Any agent's mapper, given its own raw log row for "2048 uncached input, 1800 cache read, 248 cache write, 500
 * output", must print the same disjoint buckets: input 2048, cache read 1800, cache write 248, output 500, total 4596.
 */
export function expectConformingUsageMapper(
  map: (raw: unknown) => UsageWire | undefined,
  sample: { claudeStyle: unknown } | { subsetStyle: unknown },
): UsageWire {
  const raw = 'claudeStyle' in sample ? sample.claudeStyle : sample.subsetStyle;
  const u = map(raw);
  expect(u).toBeDefined();
  if (!u) throw new Error('unreachable');
  expect(u.inputTokens).toBe(2048);
  expect(u.cacheReadTokens).toBe(1800);
  expect(u.cacheWriteTokens).toBe(248);
  expect(u.cacheWriteLongTokens).toBe(0);
  expect(u.outputTokens).toBe(500);
  expect(totalTokens(u)).toBe(4596);
  if ('subsetStyle' in sample) expect(u.reasoningTokens).toBe(300);
  return u;
}
