import { describe, expect, it } from 'vitest';
import { normalizeModelKey } from '../../src/price-catalog/normalize';

describe('normalizeModelKey', () => {
  it.each([
    ['Vendor-A/Model.1:Beta', 'model-1'],
    ['model-a', 'model-a'],
    ['anthropic/x.y', 'x-y'],
    ['a/b/c', 'b/c'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeModelKey(input)).toBe(expected);
  });
});
