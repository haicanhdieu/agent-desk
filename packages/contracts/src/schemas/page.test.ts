import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PageQuery, pageOf, pageRange, pageWindow, slicePage, toPage } from './page';

const letters = 'abcdefghijklmnopqrstuv'.split('');

describe('PageQuery', () => {
  it('defaults to page 1 at 20 rows', () => {
    expect(PageQuery.parse({})).toEqual({ page: 1, pageSize: 20 });
  });
  it('coerces query-string values', () => {
    expect(PageQuery.parse({ page: '3', pageSize: '50' })).toEqual({ page: 3, pageSize: 50 });
  });
  it.each(['0', '-1', '1.5', 'abc', '2147483648'])('rejects page %s', (page) => {
    expect(PageQuery.safeParse({ page }).success).toBe(false);
  });
  it.each(['0', '101'])('rejects pageSize %s', (pageSize) => {
    expect(PageQuery.safeParse({ pageSize }).success).toBe(false);
  });
  it('accepts the bounds', () => {
    expect(PageQuery.safeParse({ page: '2147483647' }).success).toBe(true);
    expect(PageQuery.safeParse({ pageSize: '1' }).success).toBe(true);
    expect(PageQuery.safeParse({ pageSize: '100' }).success).toBe(true);
  });
});

describe('pageOf', () => {
  const schema = pageOf(z.object({ id: z.string() }));
  it('parses an envelope', () => {
    const v = { items: [{ id: 'a' }], page: 1, pageSize: 20, total: 1 };
    expect(schema.parse(v)).toEqual(v);
  });
  it('rejects a negative total, page 0 and a missing total', () => {
    expect(schema.safeParse({ items: [], page: 1, pageSize: 20, total: -1 }).success).toBe(false);
    expect(schema.safeParse({ items: [], page: 0, pageSize: 20, total: 0 }).success).toBe(false);
    expect(schema.safeParse({ items: [], page: 1, pageSize: 20 }).success).toBe(false);
  });
});

describe('pageWindow', () => {
  it('maps page and size to limit and offset', () => {
    expect(pageWindow({ page: 1, pageSize: 20 })).toEqual({ limit: 20, offset: 0 });
    expect(pageWindow({ page: 25, pageSize: 20 })).toEqual({ limit: 20, offset: 480 });
  });
  it('keeps the largest offset a safe integer', () => {
    const { offset } = pageWindow({ page: 2147483647, pageSize: 100 });
    expect(offset).toBe(214748364600);
    expect(Number.isSafeInteger(offset)).toBe(true);
  });
});

describe('toPage', () => {
  it('builds the envelope', () => {
    expect(toPage(['a'], 21, { page: 2, pageSize: 20 })).toEqual({
      items: ['a'],
      page: 2,
      pageSize: 20,
      total: 21,
    });
  });
});

describe('slicePage', () => {
  it('returns the tail page', () => {
    const p = slicePage(letters, { page: 2, pageSize: 20 });
    expect(p.items).toEqual(['u', 'v']);
    expect(p.total).toBe(22);
  });
  it('returns an empty page past the end with the real total', () => {
    const p = slicePage(letters, { page: 3, pageSize: 20 });
    expect(p.items).toEqual([]);
    expect(p.total).toBe(22);
  });
  it('returns everything at size 100', () => {
    expect(slicePage(letters, { page: 1, pageSize: 100 }).items).toHaveLength(22);
  });
});

describe('pageRange', () => {
  it.each([
    [25, 20, 1000, { first: 481, last: 500, pageCount: 50 }],
    [4, 20, 63, { first: 61, last: 63, pageCount: 4 }],
    [1, 20, 0, { first: 0, last: 0, pageCount: 0 }],
    [5, 20, 63, { first: 0, last: 0, pageCount: 4 }],
    [51, 20, 1004, { first: 1001, last: 1004, pageCount: 51 }],
  ])('page %i size %i total %i', (page, size, total, want) => {
    expect(pageRange(page, size, total)).toEqual(want);
  });
});
