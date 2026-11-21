import { describe, expect, it } from 'vitest';
import { MAX_LINKED_REFS, normalizeLinkedRefs } from '../../src/adapters/linked-refs';

describe('normalizeLinkedRefs', () => {
  it('keeps only 1..2147483647 written as plain digits', () => {
    expect(normalizeLinkedRefs(['150', 142, '142', '9'])).toEqual(['9', '142', '150']);
    expect(
      normalizeLinkedRefs([
        '0',
        '-1',
        '007',
        ' 12',
        '12.5',
        '1e3',
        'abc',
        'acme/other#5',
        '',
        '2147483648',
        '99999999999',
        0,
        -3,
        1.5,
        Number.NaN,
      ]),
    ).toEqual([]);
    expect(normalizeLinkedRefs(['2147483647', 2147483647])).toEqual(['2147483647']);
    expect(normalizeLinkedRefs(Array.from({ length: 14 }, (_, i) => String(20 - i)))).toEqual([
      '7',
      '8',
      '9',
      '10',
      '11',
      '12',
      '13',
      '14',
      '15',
      '16',
    ]);
    expect(MAX_LINKED_REFS).toBe(10);
  });
});
