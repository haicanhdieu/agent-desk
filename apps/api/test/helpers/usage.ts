import { sql } from 'drizzle-orm';
import { runUsageEntries, withOrg, type Db } from '@agentdesk/db';

/** A usage row without its tenant keys; `insertUsage` adds the org and run. */
export type UsageInsert = Omit<typeof runUsageEntries.$inferInsert, 'orgId' | 'runId'>;

let seq = 0;

/** A usage row with neutral defaults: `model-a`, priced at 3/15/0.3/3.75/6 USD per million tokens. */
export function makeUsageEntry(over: Partial<UsageInsert> = {}): UsageInsert {
  seq += 1;
  return {
    sourceId: `u-${seq}`,
    model: 'model-a',
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 200,
    cacheWriteTokens: 100,
    cacheWriteLongTokens: 0,
    priceInput: '3',
    priceOutput: '15',
    priceCacheRead: '0.3',
    priceCacheWrite: '3.75',
    priceCacheWriteLong: '6',
    priceAsOf: new Date('2026-01-01T12:00:00Z'),
    priceSource: 'fake',
    ...over,
  };
}

export async function insertUsage(db: Db, orgId: string, runId: string, rows: UsageInsert[]): Promise<void> {
  if (rows.length === 0) return;
  await withOrg(db, orgId, async (tx) => {
    await tx.insert(runUsageEntries).values(rows.map((r) => ({ ...r, orgId, runId })));
  });
}

/** `n` priced one-token rows in one statement. */
export async function insertManyUsage(db: Db, orgId: string, runId: string, n: number): Promise<void> {
  await withOrg(db, orgId, async (tx) => {
    await tx.execute(sql`
      insert into run_usage_entries (org_id, run_id, source_id, model, input_tokens, output_tokens,
        price_input, price_output, price_cache_read, price_cache_write, price_cache_write_long, price_as_of, price_source)
      select ${orgId}::uuid, ${runId}::uuid, 'bulk-' || g, 'model-a', 1, 1, 3, 15, 0.3, 3.75, 6, '2026-01-01T12:00:00Z', 'fake'
      from generate_series(1, ${n}) g`);
  });
}
