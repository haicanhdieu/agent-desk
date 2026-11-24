import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { PriceSourceError, type PriceSource, type PriceSourceResult, type SourceRateRecord } from './types';

export const FAKE_PRICE_STATE_FILE = 'price-source.json';

export const FAKE_PRICE_RECORDS: readonly SourceRateRecord[] = [
  {
    provider: 'anthropic',
    modelId: 'fake-model-a',
    inputPerMTokUsd: 3,
    outputPerMTokUsd: 15,
    cacheReadPerMTokUsd: 0.3,
    cacheWritePerMTokUsd: 3.75,
    cacheWriteLongPerMTokUsd: 6,
  },
  {
    provider: 'anthropic',
    modelId: 'fake-model-b',
    inputPerMTokUsd: 1,
    outputPerMTokUsd: 5,
    cacheReadPerMTokUsd: 0.1,
    cacheWritePerMTokUsd: 1.25,
    cacheWriteLongPerMTokUsd: 2,
  },
];

const rate = z.number().finite().min(0);
const RecordSchema = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
  inputPerMTokUsd: rate,
  outputPerMTokUsd: rate,
  cacheReadPerMTokUsd: rate,
  cacheWritePerMTokUsd: rate,
  cacheWriteLongPerMTokUsd: rate,
});
const StateSchema = z.union([
  z.object({ mode: z.enum(['ok', 'outage', 'bad_shape']) }),
  z.object({ records: z.array(RecordSchema) }),
]);

function readState(file: string): z.infer<typeof StateSchema> | undefined {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return undefined;
    throw new PriceSourceError('unreachable');
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new PriceSourceError('bad_shape');
  }
  const parsed = StateSchema.safeParse(json);
  if (!parsed.success) throw new PriceSourceError('bad_shape');
  return parsed.data;
}

/** Test/e2e price source driven by `<stateDir>/price-source.json`, re-read on every fetch. */
export function createFakePriceSource(opts: { stateDir: string }): PriceSource {
  const file = join(opts.stateDir, FAKE_PRICE_STATE_FILE);
  return {
    kind: 'fake',
    async fetchPrices({ providers }): Promise<PriceSourceResult> {
      const state = readState(file);
      let all: readonly SourceRateRecord[] = FAKE_PRICE_RECORDS;
      if (state && 'mode' in state) {
        if (state.mode === 'outage') throw new PriceSourceError('unreachable');
        if (state.mode === 'bad_shape') throw new PriceSourceError('bad_shape');
      } else if (state) {
        all = state.records;
      }
      const wanted = new Set(providers);
      const records = all.filter((r) => wanted.has(r.provider)).map((r) => ({ ...r }));
      return { records, seen: records.length, skipped: 0 };
    },
  };
}
