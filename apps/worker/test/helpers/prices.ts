import {
  validateSourceRecords,
  writePriceVersion,
  type PriceSource,
  type PriceSourceErrorKind,
  PriceSourceError,
  type SourceRateRecord,
} from '@agentdesk/core';
import type { Db } from '@agentdesk/db';

/** A price source that plays one step per call (the last step repeats): a record list or an error kind to throw. */
export function scriptedPriceSource(
  steps: Array<SourceRateRecord[] | PriceSourceErrorKind>,
  kind = 'scripted',
): PriceSource & { calls: number; inputs: Array<{ providers: readonly string[] }> } {
  const source = {
    kind,
    calls: 0,
    inputs: [] as Array<{ providers: readonly string[] }>,
    async fetchPrices(input: { providers: readonly string[] }) {
      const step = steps[Math.min(source.calls, steps.length - 1)];
      source.calls += 1;
      source.inputs.push(input);
      if (step === undefined) throw new PriceSourceError('unreachable');
      if (typeof step === 'string') throw new PriceSourceError(step);
      return { records: step, seen: step.length, skipped: 0 };
    },
  };
  return source;
}

/** Writes a price version through the real validation and store; returns its id. */
export async function seedPriceVersion(
  db: Db,
  input: { source: string; checkedAt: Date; rates: SourceRateRecord[] },
): Promise<string> {
  const { records } = validateSourceRecords(input.rates);
  const out = await writePriceVersion(db, { source: input.source, records, now: input.checkedAt });
  return out.versionId;
}
