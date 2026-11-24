import { inArray, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { RunUsageDetail } from '@agentdesk/contracts';
import { runUsageEntries as u, type Tx } from '@agentdesk/db';
import { summarizeUsage, type UsageGroup } from '@agentdesk/core';

const sumInt = (col: AnyPgColumn) => sql<number>`coalesce(sum(${col}), 0)::float8`;

/**
 * Usage of each run, from the price snapshot stored on its entries (never the price tables), in one grouped query.
 * Runs without entries are absent from the map.
 */
export async function usageFor(tx: Tx, runIds: readonly string[]): Promise<Map<string, RunUsageDetail>> {
  const out = new Map<string, RunUsageDetail>();
  if (runIds.length === 0) return out;
  const rows = await tx
    .select({
      runId: u.runId,
      model: u.model,
      priceInput: u.priceInput,
      priceOutput: u.priceOutput,
      priceCacheRead: u.priceCacheRead,
      priceCacheWrite: u.priceCacheWrite,
      priceCacheWriteLong: u.priceCacheWriteLong,
      inputTokens: sumInt(u.inputTokens),
      outputTokens: sumInt(u.outputTokens),
      cacheReadTokens: sumInt(u.cacheReadTokens),
      cacheWriteTokens: sumInt(u.cacheWriteTokens),
      cacheWriteLongTokens: sumInt(u.cacheWriteLongTokens),
      reasoningTokens: sql<number | null>`sum(${u.reasoningTokens})::float8`,
      entries: sql<number>`count(*)::int`,
      earliest: sql<Date | string | null>`min(${u.priceAsOf})`,
      latest: sql<Date | string | null>`max(${u.priceAsOf})`,
      source: sql<string | null>`(array_agg(${u.priceSource} order by ${u.priceAsOf} desc nulls last))[1]`,
    })
    .from(u)
    .where(inArray(u.runId, [...runIds]))
    .groupBy(u.runId, u.model, u.priceInput, u.priceOutput, u.priceCacheRead, u.priceCacheWrite, u.priceCacheWriteLong);

  const byRun = new Map<string, UsageGroup[]>();
  for (const r of rows) {
    const priced =
      r.priceInput !== null &&
      r.priceOutput !== null &&
      r.priceCacheRead !== null &&
      r.priceCacheWrite !== null &&
      r.priceCacheWriteLong !== null;
    const group: UsageGroup = {
      model: r.model,
      inputTokens: Number(r.inputTokens),
      outputTokens: Number(r.outputTokens),
      cacheReadTokens: Number(r.cacheReadTokens),
      cacheWriteTokens: Number(r.cacheWriteTokens),
      cacheWriteLongTokens: Number(r.cacheWriteLongTokens),
      reasoningTokens: r.reasoningTokens === null ? null : Number(r.reasoningTokens),
      rates: priced
        ? {
            input: Number(r.priceInput),
            output: Number(r.priceOutput),
            cacheRead: Number(r.priceCacheRead),
            cacheWrite: Number(r.priceCacheWrite),
            cacheWriteLong: Number(r.priceCacheWriteLong),
          }
        : null,
      priceAsOfEarliest: r.earliest === null ? null : new Date(r.earliest),
      priceAsOfLatest: r.latest === null ? null : new Date(r.latest),
      priceSource: r.source,
      entries: r.entries,
    };
    const list = byRun.get(r.runId);
    if (list) list.push(group);
    else byRun.set(r.runId, [group]);
  }
  for (const [runId, groups] of byRun) {
    const detail = summarizeUsage(groups);
    if (detail) out.set(runId, detail);
  }
  return out;
}
