import { eq, sql } from 'drizzle-orm';
import { modelPrices, modelPriceVersions, type Db } from '@agentdesk/db';
import { rateKey, type NormalizedRate, type RateField } from './guards';

/** Six-decimal strings as Postgres returns them; assignable to `RateValues`. */
export type StoredRates = Record<RateField, string>;

export interface PriceVersion {
  id: string;
  source: string;
  checkedAt: Date;
  /** Keyed by `rateKey(provider, modelKey)`. */
  rates: ReadonlyMap<string, StoredRates>;
}

// Fixed key for the transaction-level advisory lock that serialises catalog writes (also covers the empty table).
const WRITE_LOCK_KEY = 248_001;

const FIELDS: readonly RateField[] = ['input', 'output', 'cacheRead', 'cacheWrite', 'cacheWriteLong'];

function toStored(r: {
  priceInput: string;
  priceOutput: string;
  priceCacheRead: string;
  priceCacheWrite: string;
  priceCacheWriteLong: string;
}): StoredRates {
  return {
    input: r.priceInput,
    output: r.priceOutput,
    cacheRead: r.priceCacheRead,
    cacheWrite: r.priceCacheWrite,
    cacheWriteLong: r.priceCacheWriteLong,
  };
}

/** The current price version with its rates, or null before the first write. Global table: no `withOrg`. */
export async function loadCurrentPriceVersion(db: Db): Promise<PriceVersion | null> {
  const [version] = await db.orm.select().from(modelPriceVersions).where(eq(modelPriceVersions.isCurrent, true));
  if (!version) return null;
  const rows = await db.orm.select().from(modelPrices).where(eq(modelPrices.versionId, version.id));
  const rates = new Map<string, StoredRates>();
  for (const r of rows) rates.set(rateKey(r.provider, r.modelKey), toStored(r));
  return { id: version.id, source: version.source, checkedAt: version.checkedAt, rates };
}

function sameRates(stored: ReadonlyMap<string, StoredRates>, records: readonly NormalizedRate[]): boolean {
  if (stored.size !== records.length) return false;
  return records.every((rec) => {
    const old = stored.get(rateKey(rec.provider, rec.modelKey));
    return old !== undefined && FIELDS.every((f) => Number(old[f]).toFixed(6) === rec[f].toFixed(6));
  });
}

const INSERT_CHUNK = 1000;

/**
 * Writes the catalog in one transaction on the pool. Documented exception to `withOrg`: the price tables are global
 * public data with no org. Same source and identical rates only moves `checked_at`; anything else inserts a new
 * version and makes it current. Old versions and their entries are never changed or deleted.
 */
export async function writePriceVersion(
  db: Db,
  input: { source: string; records: readonly NormalizedRate[]; now: Date },
): Promise<{ outcome: 'created' | 'confirmed'; versionId: string }> {
  return db.orm.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${WRITE_LOCK_KEY})`);
    const [current] = await tx
      .select()
      .from(modelPriceVersions)
      .where(eq(modelPriceVersions.isCurrent, true))
      .for('update');

    if (current && current.source === input.source) {
      const rows = await tx.select().from(modelPrices).where(eq(modelPrices.versionId, current.id));
      const stored = new Map<string, StoredRates>();
      for (const r of rows) stored.set(rateKey(r.provider, r.modelKey), toStored(r));
      if (sameRates(stored, input.records)) {
        await tx.update(modelPriceVersions).set({ checkedAt: input.now }).where(eq(modelPriceVersions.id, current.id));
        return { outcome: 'confirmed' as const, versionId: current.id };
      }
    }

    if (current) {
      await tx.update(modelPriceVersions).set({ isCurrent: false }).where(eq(modelPriceVersions.id, current.id));
    }
    const [created] = await tx
      .insert(modelPriceVersions)
      .values({
        source: input.source,
        fetchedAt: input.now,
        checkedAt: input.now,
        entryCount: input.records.length,
        isCurrent: true,
      })
      .returning({ id: modelPriceVersions.id });
    if (!created) throw new Error('price version insert returned no row');
    const rows = input.records.map((r) => ({
      versionId: created.id,
      provider: r.provider,
      modelKey: r.modelKey,
      priceInput: r.input.toFixed(6),
      priceOutput: r.output.toFixed(6),
      priceCacheRead: r.cacheRead.toFixed(6),
      priceCacheWrite: r.cacheWrite.toFixed(6),
      priceCacheWriteLong: r.cacheWriteLong.toFixed(6),
    }));
    // Postgres caps one statement at 65535 bind parameters (8 per row here).
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      await tx.insert(modelPrices).values(rows.slice(i, i + INSERT_CHUNK));
    }
    return { outcome: 'created' as const, versionId: created.id };
  });
}
