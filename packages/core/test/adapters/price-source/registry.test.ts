import { describe, expect, it } from 'vitest';
import { LITELLM_DEFAULT_URL, createPriceSourceRegistry, type GuardedGet } from '../../../src/adapters/price-source';

function spy() {
  const urls: string[] = [];
  const http: GuardedGet = async (url) => {
    urls.push(url.href);
    return { status: 200, json: {} };
  };
  return { urls, http };
}

describe('price source registry', () => {
  it('litellm uses MODEL_PRICES_URL when set', async () => {
    const { urls, http } = spy();
    const src = createPriceSourceRegistry(
      { MODEL_PRICES_SOURCE: 'litellm', MODEL_PRICES_URL: 'https://example.com/p.json', FAKE_STATE_DIR: '/x' },
      { http },
    ).source();
    expect(src?.kind).toBe('litellm');
    await src?.fetchPrices({ providers: ['anthropic'] });
    expect(urls).toEqual(['https://example.com/p.json']);
  });

  it('litellm uses the default url otherwise', async () => {
    const { urls, http } = spy();
    const src = createPriceSourceRegistry(
      { MODEL_PRICES_SOURCE: 'litellm', MODEL_PRICES_URL: undefined, FAKE_STATE_DIR: '/x' },
      { http },
    ).source();
    await src?.fetchPrices({ providers: ['anthropic'] });
    expect(urls).toEqual([LITELLM_DEFAULT_URL]);
  });

  it('fake gives the fake source', () => {
    const src = createPriceSourceRegistry({
      MODEL_PRICES_SOURCE: 'fake',
      MODEL_PRICES_URL: undefined,
      FAKE_STATE_DIR: '/x',
    }).source();
    expect(src?.kind).toBe('fake');
  });

  it('off gives undefined', () => {
    expect(
      createPriceSourceRegistry({
        MODEL_PRICES_SOURCE: 'off',
        MODEL_PRICES_URL: undefined,
        FAKE_STATE_DIR: '/x',
      }).source(),
    ).toBeUndefined();
  });
});
