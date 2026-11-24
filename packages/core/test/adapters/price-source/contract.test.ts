import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  PriceSourceError,
  createFakePriceSource,
  createLitellmPriceSource,
  type GuardedGet,
  type PriceSource,
} from '../../../src/adapters/price-source';

const small: unknown = JSON.parse(
  readFileSync(join(__dirname, '../../fixtures/price-source/litellm-small.json'), 'utf8'),
);
const dir = mkdtempSync(join(tmpdir(), 'price-contract-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const ok: GuardedGet = async () => ({ status: 200, json: small });
const boom: GuardedGet = async () => {
  throw new Error('network down');
};

const cases: { kind: string; make: (failing: boolean) => PriceSource }[] = [
  { kind: 'fake', make: () => createFakePriceSource({ stateDir: dir }) },
  { kind: 'litellm', make: (failing) => createLitellmPriceSource({ http: failing ? boom : ok }) },
];

describe.each(cases)('price source contract: $kind', ({ kind, make }) => {
  it('returns well-formed records for the requested providers', async () => {
    const src = make(false);
    expect(src.kind).toBe(kind);
    const providers = ['anthropic'];
    const { records } = await src.fetchPrices({ providers });
    expect(records.length).toBeGreaterThan(0);
    for (const r of records) {
      expect(providers).toContain(r.provider);
      expect(r.modelId.length).toBeGreaterThan(0);
      for (const v of [
        r.inputPerMTokUsd,
        r.outputPerMTokUsd,
        r.cacheReadPerMTokUsd,
        r.cacheWritePerMTokUsd,
        r.cacheWriteLongPerMTokUsd,
      ]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1000);
      }
    }
  });

  it('rejects a failing transport with a PriceSourceError', async () => {
    if (kind === 'fake') {
      // The fake's transport is its state file: an outage file is its failing transport.
      const { writeFileSync } = await import('node:fs');
      writeFileSync(join(dir, 'price-source.json'), JSON.stringify({ mode: 'outage' }));
    }
    const err = await make(true)
      .fetchPrices({ providers: ['anthropic'] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PriceSourceError);
    const e = err as PriceSourceError;
    expect(['unreachable', 'too_large', 'bad_shape', 'rejected']).toContain(e.kind);
    expect(e.message).toBe(`price source: ${e.kind}`);
  });
});
