import { z } from 'zod';
import { GuardedHttpError, guardedGetJson } from '../../net/guarded-http';
import {
  PriceSourceError,
  type GuardedGet,
  type PriceSource,
  type PriceSourceResult,
  type SourceRateRecord,
} from './types';

export const LITELLM_DEFAULT_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
export const LITELLM_MAX_BYTES = 15_000_000;
export const LITELLM_TIMEOUT_MS = 30_000;

/** Highest sane list rate, USD per million tokens. */
const MAX_PER_MTOK_USD = 1000;
/** LiteLLM's `litellm_provider` label -> our provider slug. */
const PROVIDER_LABELS: Readonly<Record<string, string>> = { anthropic: 'anthropic' };
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,199}$/;

export function perTokenToPerMTokUsd(x: number): number {
  return Math.round(x * 1e6 * 1e6) / 1e6;
}

/** A number or a numeric string; anything else (blank, text, NaN, Infinity, negative) fails. */
const rate = z.preprocess(
  (v) => (typeof v === 'string' ? (v.trim() === '' ? Number.NaN : Number(v)) : v),
  z.number().finite().min(0),
);

const EntrySchema = z.object({
  litellm_provider: z.string(),
  input_cost_per_token: rate,
  output_cost_per_token: rate,
  cache_read_input_token_cost: rate,
  cache_creation_input_token_cost: rate,
  cache_creation_input_token_cost_above_1hr: rate.optional(),
});

const BodySchema = z.record(z.string(), z.unknown());

function mapEntry(provider: string, modelId: string, raw: unknown): SourceRateRecord | undefined {
  if (!MODEL_ID.test(modelId)) return undefined;
  const e = EntrySchema.safeParse(raw);
  if (!e.success) return undefined;
  const d = e.data;
  const write = perTokenToPerMTokUsd(d.cache_creation_input_token_cost);
  const record: SourceRateRecord = {
    provider,
    modelId,
    inputPerMTokUsd: perTokenToPerMTokUsd(d.input_cost_per_token),
    outputPerMTokUsd: perTokenToPerMTokUsd(d.output_cost_per_token),
    cacheReadPerMTokUsd: perTokenToPerMTokUsd(d.cache_read_input_token_cost),
    cacheWritePerMTokUsd: write,
    cacheWriteLongPerMTokUsd:
      d.cache_creation_input_token_cost_above_1hr === undefined
        ? write
        : perTokenToPerMTokUsd(d.cache_creation_input_token_cost_above_1hr),
  };
  const rates = [
    record.inputPerMTokUsd,
    record.outputPerMTokUsd,
    record.cacheReadPerMTokUsd,
    record.cacheWritePerMTokUsd,
    record.cacheWriteLongPerMTokUsd,
  ];
  return rates.every((r) => r <= MAX_PER_MTOK_USD) ? record : undefined;
}

export function createLitellmPriceSource(opts: { url?: string; http?: GuardedGet }): PriceSource {
  const http: GuardedGet = opts.http ?? ((url, o) => guardedGetJson(url, o));
  const configured = opts.url ?? LITELLM_DEFAULT_URL;

  return {
    kind: 'litellm',
    async fetchPrices({ providers }): Promise<PriceSourceResult> {
      let url: URL;
      try {
        url = new URL(configured);
      } catch {
        throw new PriceSourceError('rejected');
      }

      let res: { status: number; json: unknown };
      try {
        res = await http(url, { headers: {}, maxBytes: LITELLM_MAX_BYTES, timeoutMs: LITELLM_TIMEOUT_MS });
      } catch (err) {
        if (err instanceof GuardedHttpError && err.kind === 'too_large') throw new PriceSourceError('too_large');
        throw new PriceSourceError('unreachable');
      }
      if (res.status === 401 || res.status === 403 || res.status === 404) throw new PriceSourceError('rejected');
      if (res.status < 200 || res.status >= 300) throw new PriceSourceError('unreachable');

      const body = BodySchema.safeParse(res.json);
      if (!body.success || Array.isArray(res.json)) throw new PriceSourceError('bad_shape');

      const wanted = new Set(providers);
      const records: SourceRateRecord[] = [];
      let seen = 0;
      let skipped = 0;
      for (const [key, raw] of Object.entries(body.data)) {
        if (key === 'sample_spec') continue;
        const label = z.object({ litellm_provider: z.string() }).safeParse(raw);
        if (!label.success) continue;
        const slug = PROVIDER_LABELS[label.data.litellm_provider];
        if (slug === undefined || !wanted.has(slug)) continue;
        seen += 1;
        const record = mapEntry(slug, key, raw);
        if (record) records.push(record);
        else skipped += 1;
      }
      return { records, seen, skipped };
    },
  };
}
