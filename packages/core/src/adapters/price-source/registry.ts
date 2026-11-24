import type { Config } from '../../config';
import { createFakePriceSource } from './fake';
import { createLitellmPriceSource } from './litellm';
import type { GuardedGet, PriceSource } from './types';

export interface PriceSourceRegistry {
  /** The configured source, or `undefined` when price fetching is off. */
  source(): PriceSource | undefined;
}

export function createPriceSourceRegistry(
  config: Pick<Config, 'MODEL_PRICES_SOURCE' | 'MODEL_PRICES_URL' | 'FAKE_STATE_DIR'>,
  opts: { http?: GuardedGet } = {},
): PriceSourceRegistry {
  const mode = config.MODEL_PRICES_SOURCE;
  let source: PriceSource | undefined;
  switch (mode) {
    case 'litellm':
      source = createLitellmPriceSource({ url: config.MODEL_PRICES_URL, http: opts.http });
      break;
    case 'fake':
      source = createFakePriceSource({ stateDir: config.FAKE_STATE_DIR });
      break;
    case 'off':
      source = undefined;
      break;
    default: {
      const unreachable: never = mode;
      throw new Error(`unknown price source: ${String(unreachable)}`);
    }
  }
  return { source: () => source };
}
