import { describe, expect, it } from 'vitest';
import { PrState } from '../enums';
import { PR_STATES_MAX_REFS, PrStatesQuery, PrStatesResponse } from './tickets';

describe('PrState', () => {
  it('accepts the four states and rejects other spellings', () => {
    for (const s of ['open', 'draft', 'merged', 'closed']) expect(PrState.safeParse(s).success).toBe(true);
    for (const s of ['MERGED', 'locked']) expect(PrState.safeParse(s).success).toBe(false);
  });
});

describe('PrStatesQuery', () => {
  it('turns one ref key into a one-item array', () => {
    expect(PrStatesQuery.parse({ ref: '12' })).toEqual({ ref: ['12'] });
  });
  it('drops duplicates and keeps first-seen order', () => {
    expect(PrStatesQuery.parse({ ref: ['15', '12', '15'] })).toEqual({ ref: ['15', '12'] });
  });
  it('rejects refs that are not plain ticket numbers', () => {
    for (const bad of ['0', '-1', '1.5', 'abc', '012', '12345678901']) {
      expect(PrStatesQuery.safeParse({ ref: bad }).success, bad).toBe(false);
    }
  });
  it('rejects an empty list and a missing ref', () => {
    expect(PrStatesQuery.safeParse({ ref: [] }).success).toBe(false);
    expect(PrStatesQuery.safeParse({}).success).toBe(false);
  });
  it('accepts exactly 100 refs and rejects 101', () => {
    const refs = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1));
    expect(PR_STATES_MAX_REFS).toBe(100);
    expect(PrStatesQuery.parse({ ref: refs(100) }).ref).toHaveLength(100);
    expect(PrStatesQuery.safeParse({ ref: refs(101) }).success).toBe(false);
  });
});

describe('PrStatesResponse', () => {
  it('parses an empty and a filled list', () => {
    expect(PrStatesResponse.parse({ items: [] })).toEqual({ items: [] });
    const one = { items: [{ ref: '12', prState: 'merged' }] };
    expect(PrStatesResponse.parse(one)).toEqual(one);
  });
  it('rejects an unknown state', () => {
    expect(PrStatesResponse.safeParse({ items: [{ ref: '12', prState: 'unknown' }] }).success).toBe(false);
  });
});
