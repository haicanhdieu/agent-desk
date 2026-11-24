import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * Model price catalog versions. Documented exception to "every table has org_id": public price data, no org, no RLS,
 * touched only by the worker. The app role may SELECT, INSERT and UPDATE (`checked_at`, `is_current`).
 */
export const modelPriceVersions = pgTable(
  'model_price_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: text('source').notNull(),
    fetchedAt: ts('fetched_at').notNull(),
    checkedAt: ts('checked_at').notNull(),
    entryCount: integer('entry_count').notNull(),
    isCurrent: boolean('is_current').notNull().default(false),
  },
  (t) => [
    uniqueIndex('model_price_versions_current_key')
      .on(t.isCurrent)
      .where(sql`${t.isCurrent}`),
  ],
);

/** Immutable rates of one version, USD per million tokens. No org_id, no RLS; the app role may SELECT and INSERT only. */
export const modelPrices = pgTable(
  'model_prices',
  {
    versionId: uuid('version_id')
      .notNull()
      .references(() => modelPriceVersions.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    modelKey: text('model_key').notNull(),
    priceInput: numeric('price_input', { precision: 12, scale: 6, mode: 'string' }).notNull(),
    priceOutput: numeric('price_output', { precision: 12, scale: 6, mode: 'string' }).notNull(),
    priceCacheRead: numeric('price_cache_read', { precision: 12, scale: 6, mode: 'string' }).notNull(),
    priceCacheWrite: numeric('price_cache_write', { precision: 12, scale: 6, mode: 'string' }).notNull(),
    priceCacheWriteLong: numeric('price_cache_write_long', { precision: 12, scale: 6, mode: 'string' }).notNull(),
  },
  (t) => [
    primaryKey({ name: 'model_prices_pkey', columns: [t.versionId, t.provider, t.modelKey] }),
    check('model_prices_model_key_check', sql`${t.modelKey} ~ '^[a-z0-9._:/@-]{1,128}$'`),
    check('model_prices_input_check', sql`${t.priceInput} between 0 and 1000`),
    check('model_prices_output_check', sql`${t.priceOutput} between 0 and 1000`),
    check('model_prices_cache_read_check', sql`${t.priceCacheRead} between 0 and 1000`),
    check('model_prices_cache_write_check', sql`${t.priceCacheWrite} between 0 and 1000`),
    check('model_prices_cache_write_long_check', sql`${t.priceCacheWriteLong} between 0 and 1000`),
  ],
);
