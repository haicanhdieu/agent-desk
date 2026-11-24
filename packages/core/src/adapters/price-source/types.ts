import type { GuardedGetOptions } from '../../net/guarded-http';

/** Injectable GET; the default is `guardedGetJson`. */
export type GuardedGet = (url: URL, opts: GuardedGetOptions) => Promise<{ status: number; json: unknown }>;

/** One model's list rates, USD per million tokens, for one provider slug. */
export interface SourceRateRecord {
  provider: string;
  modelId: string;
  inputPerMTokUsd: number;
  outputPerMTokUsd: number;
  cacheReadPerMTokUsd: number;
  cacheWritePerMTokUsd: number;
  cacheWriteLongPerMTokUsd: number;
}

export interface PriceSourceResult {
  records: SourceRateRecord[];
  /** Entries of the requested providers the source offered. */
  seen: number;
  /** Of those, entries dropped because they were incomplete or invalid. */
  skipped: number;
}

export interface PriceSource {
  readonly kind: string;
  fetchPrices(input: { providers: readonly string[] }): Promise<PriceSourceResult>;
}

export type PriceSourceErrorKind = 'unreachable' | 'too_large' | 'bad_shape' | 'rejected';

/** The message is the kind only: a source's body or url never reaches logs or events. */
export class PriceSourceError extends Error {
  readonly kind: PriceSourceErrorKind;
  constructor(kind: PriceSourceErrorKind) {
    super(`price source: ${kind}`);
    this.name = 'PriceSourceError';
    this.kind = kind;
  }
}
