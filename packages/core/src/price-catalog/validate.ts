import { z } from 'zod';
import type { SourceRateRecord } from '../adapters/price-source/types';
import { normalizeModelKey } from './normalize';
import { rateKey } from './guards';
import type { NormalizedRate } from './guards';

const rate = z.number().finite().min(0).max(1000);

const normalizedSchema = z.object({
  provider: z.string().regex(/^[a-z0-9-]{1,64}$/),
  modelKey: z.string().regex(/^[a-z0-9._:/@-]{1,128}$/),
  input: rate,
  output: rate,
  cacheRead: rate,
  cacheWrite: rate,
  cacheWriteLong: rate,
});

/** Normalise and validate source records. Duplicates by (provider, modelKey): last wins. */
export function validateSourceRecords(records: readonly SourceRateRecord[]): {
  records: NormalizedRate[];
  dropped: number;
  duplicates: number;
} {
  const byKey = new Map<string, NormalizedRate>();
  let dropped = 0;
  let duplicates = 0;
  for (const r of records) {
    const parsed = normalizedSchema.safeParse({
      provider: r.provider,
      modelKey: normalizeModelKey(r.modelId),
      input: r.inputPerMTokUsd,
      output: r.outputPerMTokUsd,
      cacheRead: r.cacheReadPerMTokUsd,
      cacheWrite: r.cacheWritePerMTokUsd,
      cacheWriteLong: r.cacheWriteLongPerMTokUsd,
    });
    if (!parsed.success) {
      dropped += 1;
      continue;
    }
    const key = rateKey(parsed.data.provider, parsed.data.modelKey);
    if (byKey.has(key)) duplicates += 1;
    byKey.set(key, parsed.data);
  }
  return { records: [...byKey.values()], dropped, duplicates };
}
