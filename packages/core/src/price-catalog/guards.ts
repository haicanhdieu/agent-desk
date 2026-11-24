export type RateField = 'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'cacheWriteLong';
/** Numbers, or six-decimal strings as Postgres returns them; compared with `Number`. */
export type RateValues = Record<RateField, number | string>;
export type NormalizedRate = { provider: string; modelKey: string } & Record<RateField, number>;

export const GUARD_MOVED_SHARE = 0.05;
export const GUARD_MOVE_FACTOR = 5;
export const GUARD_COUNT_DROP = 0.2;

const FIELDS: readonly RateField[] = ['input', 'output', 'cacheRead', 'cacheWrite', 'cacheWriteLong'];

export function rateKey(provider: string, modelKey: string): string {
  return `${provider}\u0000${modelKey}`;
}

function moved(a: number, b: number): boolean {
  if (a === b) return false;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (lo === 0) return true;
  return hi / lo > GUARD_MOVE_FACTOR;
}

export type GuardResult =
  | { ok: true; skipped: 'first' | 'source_change' | null }
  | { ok: false; reason: 'moved' | 'count_drop' | 'zero_match' };

export function checkChangeGuards(
  previous: { source: string; rates: ReadonlyMap<string, RateValues> } | null,
  next: { source: string; records: readonly NormalizedRate[] },
): GuardResult {
  if (next.records.length === 0) return { ok: false, reason: 'zero_match' };
  if (previous === null) return { ok: true, skipped: 'first' };
  if (previous.source !== next.source) return { ok: true, skipped: 'source_change' };

  const prevCount = previous.rates.size;
  if (prevCount > 0 && next.records.length < prevCount * (1 - GUARD_COUNT_DROP)) {
    return { ok: false, reason: 'count_drop' };
  }

  let shared = 0;
  let movedCount = 0;
  for (const rec of next.records) {
    const old = previous.rates.get(rateKey(rec.provider, rec.modelKey));
    if (!old) continue;
    shared += 1;
    if (FIELDS.some((f) => moved(Number(old[f]), rec[f]))) movedCount += 1;
  }
  if (shared > 0 && movedCount / shared > GUARD_MOVED_SHARE) return { ok: false, reason: 'moved' };
  return { ok: true, skipped: null };
}
