import { describe, expect, it } from 'vitest';
import { PICKER_DEBOUNCE_MS, PICKER_PAGE_SIZE, memberSearchQuery, pickerQuery } from './picker';

const P = 'b7000000-0000-4000-8000-000000000001';

describe('memberSearchQuery (BR-7)', () => {
  it.each(['', '   '])('leaves q out for %j', (q) => {
    expect(memberSearchQuery(q, P, 1)).toEqual({ excludeProject: P, page: 1, pageSize: PICKER_PAGE_SIZE });
    expect('q' in memberSearchQuery(q, P, 1)).toBe(false);
  });

  it('trims q and carries the page', () => {
    expect(memberSearchQuery(' al ', P, 2)).toEqual({ q: 'al', excludeProject: P, page: 2, pageSize: 20 });
  });

  it('debounces 250 ms', () => {
    expect(PICKER_DEBOUNCE_MS).toBe(250);
  });
});

describe('pickerQuery', () => {
  it('keys the infinite list by project and search text', () => {
    expect(pickerQuery('alice', 'org-1', P, 'al').queryKey).toEqual([
      'org',
      'alice',
      'members',
      'list',
      'infinite',
      { excludeProject: P, q: 'al' },
    ]);
  });

  it('asks for the next page only while the pages loaded fall short of the total', () => {
    const next = pickerQuery('alice', 'org-1', P, '').getNextPageParam;
    const page = (n: number, total: number) => ({ items: [], page: n, pageSize: 20, total });
    expect(next(page(1, 45), [page(1, 45)], 1, [1])).toBe(2);
    expect(next(page(3, 45), [page(1, 45), page(2, 45), page(3, 45)], 3, [1, 2, 3])).toBeUndefined();
    expect(next(page(1, 20), [page(1, 20)], 1, [1])).toBeUndefined();
  });
});
