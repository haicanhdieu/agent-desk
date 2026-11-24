import { z } from 'zod';
import { Timestamp } from './common';

/** Longest base64 body of one `agentdesk: usage` log line. */
export const USAGE_WIRE_MAX_BASE64 = 1000;
/** Most distinct usage ids stored per run. */
export const USAGE_ENTRY_CAP = 20000;
/** Largest value of any one token counter. */
export const USAGE_TOKENS_MAX = 100_000_000;

const tokens = z.number().int().min(0).max(USAGE_TOKENS_MAX);

/** One model call's token counts, as the runner prints it on the wire. Buckets are disjoint. */
export const UsageWireEntry = z
  .object({
    id: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/),
    model: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._:/@-]+$/),
    inputTokens: tokens,
    outputTokens: tokens,
    cacheReadTokens: tokens.default(0),
    cacheWriteTokens: tokens.default(0),
    cacheWriteLongTokens: tokens.default(0),
    reasoningTokens: tokens.optional(),
  })
  .strict()
  .refine((e) => e.reasoningTokens === undefined || e.reasoningTokens <= e.outputTokens, {
    message: 'reasoningTokens must not exceed outputTokens',
    path: ['reasoningTokens'],
  });
export type UsageWireEntry = z.infer<typeof UsageWireEntry>;

const count = z.number().int().min(0);

export const ModelUsageDto = z.object({
  model: z.string(),
  inputTokens: count,
  cacheReadTokens: count,
  cacheWriteTokens: count,
  outputTokens: count,
  reasoningTokens: count.nullable(),
  totalTokens: count,
  estimatedCostUsd: z.number().nullable(),
  costPartial: z.boolean(),
});
export type ModelUsageDto = z.infer<typeof ModelUsageDto>;

/** A run's usage totals, as a list shows them. */
export const RunUsageSummary = z.object({
  inputTokens: count,
  cacheReadTokens: count,
  cacheWriteTokens: count,
  outputTokens: count,
  reasoningTokens: count.nullable(),
  totalInputTokens: count,
  totalTokens: count,
  modelCount: count,
  estimatedCostUsd: z.number().nullable(),
  partial: z.boolean(),
});
export type RunUsageSummary = z.infer<typeof RunUsageSummary>;

/** A run's usage with the per-model split and the price provenance, as run detail shows it. */
export const RunUsageDetail = RunUsageSummary.extend({
  models: z.array(ModelUsageDto),
  priceAsOfEarliest: Timestamp.nullable(),
  priceAsOfLatest: Timestamp.nullable(),
  priceSource: z.string().nullable(),
});
export type RunUsageDetail = z.infer<typeof RunUsageDetail>;
