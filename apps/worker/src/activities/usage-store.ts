import { and, eq, sql } from 'drizzle-orm';
import { AgentKind, USAGE_ENTRY_CAP, type UsageWireEntry } from '@agentdesk/contracts';
import {
  agentAdapterFor,
  loadCurrentPriceVersion,
  normalizeModelKey,
  redact,
  rateKey,
  type AgentAdapter,
  type Clock,
  type PriceVersion,
  type StoredRates,
} from '@agentdesk/core';
import { agents, runs, runUsageEntries, withOrg, type Db, type Tx } from '@agentdesk/db';

/** How long a loaded price version is reused before the catalog is read again. */
export const USAGE_PRICE_CACHE_MS = 300_000;
const INSERT_ATTEMPTS = 3;

export interface UsageRow {
  sourceId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheWriteLongTokens: number;
  reasoningTokens: number | null;
  price: { rates: StoredRates; asOf: Date; source: string; versionId: string } | null;
}

/**
 * Inserts the row, or on a repeated `(run_id, source_id)` raises each counter to the greater value. `model` and the
 * price snapshot are fixed at the first insert and never updated. Must run inside `withOrg`.
 */
export async function upsertUsageEntry(tx: Tx, orgId: string, runId: string, row: UsageRow): Promise<void> {
  const { price, ...rest } = row;
  const t = runUsageEntries;
  await tx
    .insert(runUsageEntries)
    .values({
      orgId,
      runId,
      ...rest,
      priceInput: price?.rates.input ?? null,
      priceOutput: price?.rates.output ?? null,
      priceCacheRead: price?.rates.cacheRead ?? null,
      priceCacheWrite: price?.rates.cacheWrite ?? null,
      priceCacheWriteLong: price?.rates.cacheWriteLong ?? null,
      priceAsOf: price?.asOf ?? null,
      priceSource: price?.source ?? null,
      priceVersionId: price?.versionId ?? null,
    })
    .onConflictDoUpdate({
      target: [t.runId, t.sourceId],
      set: {
        inputTokens: sql`greatest(${t.inputTokens}, excluded.input_tokens)`,
        outputTokens: sql`greatest(${t.outputTokens}, excluded.output_tokens)`,
        cacheReadTokens: sql`greatest(${t.cacheReadTokens}, excluded.cache_read_tokens)`,
        cacheWriteTokens: sql`greatest(${t.cacheWriteTokens}, excluded.cache_write_tokens)`,
        cacheWriteLongTokens: sql`greatest(${t.cacheWriteLongTokens}, excluded.cache_write_long_tokens)`,
        // Postgres greatest() ignores nulls, so null only stays when both sides are null.
        reasoningTokens: sql`greatest(${t.reasoningTokens}, excluded.reasoning_tokens)`,
      },
    });
}

/**
 * One per follower attempt. Stores each usage entry with the rates of the price version current when its id was first
 * seen (cached for 5 minutes on the clock). Reads the catalog only, never fetches. Enforces the per-run id cap and
 * retries a failing write; failures and drops are logged as counts only (never a model or id).
 */
export function createUsageSink(deps: {
  db: Db;
  orgId: string;
  runId: string;
  clock: Clock;
  warn(msg: string, fields: Record<string, unknown>): void;
  adapterFor?: (kind: AgentKind) => AgentAdapter;
}): { store(entry: UsageWireEntry, secrets?: string[]): Promise<void> } {
  const adapterFor = deps.adapterFor ?? ((kind: AgentKind) => agentAdapterFor(kind));
  let agent: { adapter: AgentAdapter | null } | undefined;
  let cached: { at: number; version: PriceVersion | null } | undefined;
  let stored: number | undefined;
  let failed = 0;
  let dropped = 0;

  const adapterOfRun = async (tx: Tx): Promise<AgentAdapter | null> => {
    if (agent) return agent.adapter;
    const [r] = await tx
      .select({ provider: agents.provider })
      .from(runs)
      .leftJoin(agents, eq(agents.id, runs.agentId))
      .where(eq(runs.id, deps.runId));
    const kind = AgentKind.safeParse(r?.provider);
    agent = { adapter: kind.success ? adapterFor(kind.data) : null };
    return agent.adapter;
  };

  const currentVersion = async (): Promise<PriceVersion | null> => {
    const at = deps.clock.now().getTime();
    if (cached && at - cached.at < USAGE_PRICE_CACHE_MS) return cached.version;
    const version = await loadCurrentPriceVersion(deps.db);
    cached = { at, version };
    return version;
  };

  const priceOf = (adapter: AgentAdapter | null, version: PriceVersion | null, model: string): UsageRow['price'] => {
    const pricing = adapter?.pricing;
    if (!pricing || !version) return null;
    const rates = version.rates.get(rateKey(pricing.provider, (pricing.modelKey ?? normalizeModelKey)(model)));
    return rates ? { rates, asOf: version.checkedAt, source: version.source, versionId: version.id } : null;
  };

  const storeOnce = async (entry: UsageWireEntry): Promise<void> => {
    const version = await currentVersion();
    let added = false;
    await withOrg(deps.db, deps.orgId, async (tx) => {
      const adapter = await adapterOfRun(tx);
      if (stored === undefined) {
        const [n] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(runUsageEntries)
          .where(eq(runUsageEntries.runId, deps.runId));
        stored = n?.n ?? 0;
      }
      const [known] = await tx
        .select({ id: runUsageEntries.sourceId })
        .from(runUsageEntries)
        .where(and(eq(runUsageEntries.runId, deps.runId), eq(runUsageEntries.sourceId, entry.id)))
        .limit(1);
      if (!known && stored >= USAGE_ENTRY_CAP) {
        if (dropped === 0) deps.warn('usage cap reached', { dropped: 1 });
        dropped += 1;
        return;
      }
      await upsertUsageEntry(tx, deps.orgId, deps.runId, {
        sourceId: entry.id,
        model: entry.model,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        cacheReadTokens: entry.cacheReadTokens,
        cacheWriteTokens: entry.cacheWriteTokens,
        cacheWriteLongTokens: entry.cacheWriteLongTokens,
        reasoningTokens: entry.reasoningTokens ?? null,
        price: priceOf(adapter, version, entry.model),
      });
      added = !known;
    });
    // Counted only after the commit, so a rolled back attempt that is retried is not counted twice.
    if (added && stored !== undefined) stored += 1;
  };

  return {
    async store(entry, secrets = []) {
      // The model and id come from sandbox stdout: an entry that holds a known secret is dropped, never stored.
      if (redact(entry.model, secrets) !== entry.model || redact(entry.id, secrets) !== entry.id) {
        failed += 1;
        deps.warn('usage entry not stored', { failed });
        return;
      }
      for (let attempt = 1; attempt <= INSERT_ATTEMPTS; attempt += 1) {
        try {
          await storeOnce(entry);
          return;
        } catch {
          // Retry; the error is dropped on purpose.
        }
      }
      failed += 1;
      deps.warn('usage entry not stored', { failed });
    },
  };
}
