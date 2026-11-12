import { describe, expect, it } from 'vitest';
import { parseSearch, stringifySearch } from './searchParams';

describe('search params', () => {
  it('keeps number-like and boolean-like values as plain strings', () => {
    expect(parseSearch('?ticket=12&on=true&filter=needs_you')).toEqual({
      ticket: '12',
      on: 'true',
      filter: 'needs_you',
    });
    expect(stringifySearch({ ticket: '12', filter: 'needs_you' })).toBe('?ticket=12&filter=needs_you');
  });

  it('drops undefined values and round-trips encoded text', () => {
    expect(stringifySearch({ a: undefined })).toBe('');
    const redirect = '/o/alice/projects?x=1&y=two words';
    expect(parseSearch(stringifySearch({ redirect }))).toEqual({ redirect });
  });

  it('takes the first value of a repeated key', () => {
    expect(parseSearch('a=1&a=2')).toEqual({ a: '1' });
  });
});
