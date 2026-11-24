import { ApplicationFailure } from '@temporalio/common';
import {
  PriceSourceError,
  checkChangeGuards,
  loadCurrentPriceVersion,
  pricingProviders,
  validateSourceRecords,
  writePriceVersion,
  type Clock,
  type PriceSourceRegistry,
} from '@agentdesk/core';
import type { Db } from '@agentdesk/db';

export type SyncModelPricesResult = { outcome: 'off' } | { outcome: 'created' | 'confirmed'; entries: number };

export interface PriceSyncLogger {
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface PriceSyncDeps {
  db: Db;
  registry: PriceSourceRegistry;
  clock: Clock;
  log: PriceSyncLogger;
}

/** Retryable: the schedule's next run (or the workflow's retry) tries again. */
function failed(kind: string): ApplicationFailure {
  return ApplicationFailure.retryable(`price sync: ${kind}`, 'PriceSyncFailed', kind);
}

/**
 * Fetches list prices from the configured source and records them in the global catalog. Logs carry kinds and counts
 * only: never a model id, url or source body.
 */
export async function syncModelPrices(deps: PriceSyncDeps): Promise<SyncModelPricesResult> {
  const source = deps.registry.source();
  if (!source) return { outcome: 'off' };

  let fetched;
  try {
    fetched = await source.fetchPrices({ providers: pricingProviders() });
  } catch (err) {
    if (!(err instanceof PriceSourceError)) throw err;
    deps.log.warn('price sync: fetch failed', { kind: err.kind });
    throw failed(err.kind);
  }

  const { records, dropped, duplicates } = validateSourceRecords(fetched.records);
  const previous = await loadCurrentPriceVersion(deps.db);
  const guard = checkChangeGuards(previous, { source: source.kind, records });
  if (!guard.ok) {
    deps.log.error('price sync: change rejected', {
      kind: guard.reason,
      received: fetched.records.length,
      accepted: records.length,
      dropped,
      previous: previous?.rates.size ?? 0,
    });
    throw failed(guard.reason);
  }
  if (guard.skipped === 'source_change') {
    deps.log.warn('price sync: price source changed', { entries: records.length, duplicates });
  }

  const written = await writePriceVersion(deps.db, { source: source.kind, records, now: deps.clock.now() });
  return { outcome: written.outcome, entries: records.length };
}
