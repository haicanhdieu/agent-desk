import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LITELLM_DEFAULT_URL,
  LITELLM_MAX_BYTES,
  LITELLM_TIMEOUT_MS,
  PriceSourceError,
  createLitellmPriceSource,
  perTokenToPerMTokUsd,
  type GuardedGet,
  type PriceSourceErrorKind,
} from '../../../src/adapters/price-source';
import { GuardedHttpError, type GuardedHttpErrorKind } from '../../../src/net/guarded-http';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, '../../fixtures/price-source', name), 'utf8'));

function serving(json: unknown, status = 200) {
  const calls: { url: URL; opts: Parameters<GuardedGet>[1] }[] = [];
  const http: GuardedGet = async (url, opts) => {
    calls.push({ url, opts });
    return { status, json };
  };
  return { http, calls };
}

const providers = ['anthropic'] as const;

async function kindOf(p: Promise<unknown>): Promise<{ kind: PriceSourceErrorKind; message: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof PriceSourceError) return { kind: e.kind, message: e.message };
    throw e;
  }
  throw new Error('did not throw');
}

describe('perTokenToPerMTokUsd', () => {
  it('converts and rounds float noise', () => {
    expect(perTokenToPerMTokUsd(3e-6)).toBe(3);
    expect(perTokenToPerMTokUsd(1.5000000000000002e-5)).toBe(15);
  });
});

describe('litellm price source', () => {
  it('has the litellm kind and the spec default url', () => {
    expect(createLitellmPriceSource({}).kind).toBe('litellm');
    expect(LITELLM_DEFAULT_URL).toBe(
      'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json',
    );
  });

  it('maps a good entry, falls back for the 1 h rate and skips entries without cache rates', async () => {
    const { http } = serving(fixture('litellm-small.json'));
    const r = await createLitellmPriceSource({ http }).fetchPrices({ providers });
    expect(r.records).toEqual([
      {
        provider: 'anthropic',
        modelId: 'claude-good-1',
        inputPerMTokUsd: 3,
        outputPerMTokUsd: 15,
        cacheReadPerMTokUsd: 0.3,
        cacheWritePerMTokUsd: 3.75,
        cacheWriteLongPerMTokUsd: 6,
      },
      {
        provider: 'anthropic',
        modelId: 'claude-no-long-2',
        inputPerMTokUsd: 1,
        outputPerMTokUsd: 5,
        cacheReadPerMTokUsd: 0.1,
        cacheWritePerMTokUsd: 1.25,
        cacheWriteLongPerMTokUsd: 1.25,
      },
    ]);
    expect(r.skipped).toBe(2);
    expect(r.seen).toBeGreaterThanOrEqual(r.records.length + r.skipped);
  });

  it('ignores other providers and the sample_spec entry', async () => {
    const { http } = serving(fixture('litellm-small.json'));
    const r = await createLitellmPriceSource({ http }).fetchPrices({ providers: ['vendor-z'] });
    expect(r.records).toEqual([]);
    expect(r.skipped).toBe(0);
  });

  it('skips odd values, coerces numeric strings and skips hostile keys', async () => {
    const { http } = serving(fixture('litellm-odd.json'));
    const r = await createLitellmPriceSource({ http }).fetchPrices({ providers });
    expect(r.records.map((x) => x.modelId)).toEqual(['odd-string-number']);
    expect(r.records[0]?.inputPerMTokUsd).toBe(3);
    expect(r.skipped).toBe(6);
  });

  it('requests with the size and time limits', async () => {
    const { http, calls } = serving({});
    await createLitellmPriceSource({ http }).fetchPrices({ providers });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.opts.maxBytes).toBe(15000000);
    expect(calls[0]?.opts.timeoutMs).toBe(30000);
    expect(LITELLM_MAX_BYTES).toBe(15_000_000);
    expect(LITELLM_TIMEOUT_MS).toBe(30_000);
    expect(calls[0]?.url.href).toBe(LITELLM_DEFAULT_URL);
  });

  it('requests the configured url host', async () => {
    const { http, calls } = serving({});
    await createLitellmPriceSource({ http, url: 'https://prices.example/x.json' }).fetchPrices({ providers });
    expect(calls[0]?.url.host).toBe('prices.example');
  });

  it('rejects before calling when the configured url cannot be parsed', async () => {
    const { http, calls } = serving({});
    const err = await kindOf(createLitellmPriceSource({ http, url: 'not a url' }).fetchPrices({ providers }));
    expect(err.kind).toBe('rejected');
    expect(calls).toHaveLength(0);
  });

  it.each([[null], [[]], ['text'], [7]])('throws bad_shape for a non-object body %j', async (body) => {
    const { http } = serving(body);
    expect((await kindOf(createLitellmPriceSource({ http }).fetchPrices({ providers }))).kind).toBe('bad_shape');
  });

  it('maps status codes', async () => {
    const s500 = serving({}, 500);
    expect((await kindOf(createLitellmPriceSource({ http: s500.http }).fetchPrices({ providers }))).kind).toBe(
      'unreachable',
    );
    const s403 = serving({}, 403);
    expect((await kindOf(createLitellmPriceSource({ http: s403.http }).fetchPrices({ providers }))).kind).toBe(
      'rejected',
    );
  });

  it.each<[GuardedHttpErrorKind, PriceSourceErrorKind]>([
    ['too_large', 'too_large'],
    ['redirect', 'unreachable'],
    ['timeout', 'unreachable'],
    ['network', 'unreachable'],
    ['blocked_address', 'unreachable'],
  ])('maps transport %s to %s without leaking text', async (from, to) => {
    const http: GuardedGet = async () => {
      throw new GuardedHttpError(from);
    };
    const err = await kindOf(createLitellmPriceSource({ http }).fetchPrices({ providers }));
    expect(err.kind).toBe(to);
    expect(err.message).toBe(`price source: ${to}`);
  });

  it('never puts fixture text in an error', async () => {
    const { http } = serving({ secret: 1 }, 500);
    const err = await kindOf(createLitellmPriceSource({ http }).fetchPrices({ providers }));
    expect(err.message).toBe('price source: unreachable');
  });
});
