import { describe, expect, it } from 'vitest';
import {
  GUARD_COUNT_DROP,
  GUARD_MOVED_SHARE,
  GUARD_MOVE_FACTOR,
  checkChangeGuards,
  rateKey,
  type NormalizedRate,
  type RateValues,
} from '../../src/price-catalog';

function norm(i: number, input = 1): NormalizedRate {
  return { provider: 'p', modelKey: `m${i}`, input, output: 1, cacheRead: 1, cacheWrite: 1, cacheWriteLong: 1 };
}
function vals(input: number | string = 1): RateValues {
  return { input, output: 1, cacheRead: 1, cacheWrite: 1, cacheWriteLong: 1 };
}
function prev(n: number, source = 's') {
  const rates = new Map<string, RateValues>();
  for (let i = 0; i < n; i++) rates.set(rateKey('p', `m${i}`), vals());
  return { source, rates };
}
function next(n: number, movedCount = 0, factor = 6, source = 's') {
  const records: NormalizedRate[] = [];
  for (let i = 0; i < n; i++) records.push(norm(i, i < movedCount ? factor : 1));
  return { source, records };
}

describe('checkChangeGuards', () => {
  it('constants', () => {
    expect([GUARD_MOVED_SHARE, GUARD_MOVE_FACTOR, GUARD_COUNT_DROP]).toEqual([0.05, 5, 0.2]);
  });
  it('rateKey joins with NUL', () => {
    expect(rateKey('a', 'b')).toBe('a\u0000b');
  });
  it('skips the first version', () => {
    expect(checkChangeGuards(null, next(3, 3))).toEqual({ ok: true, skipped: 'first' });
  });
  it('skips on source change even with big moves, but not with zero records', () => {
    expect(checkChangeGuards(prev(100, 'a'), next(100, 100, 50, 'b'))).toEqual({ ok: true, skipped: 'source_change' });
    expect(checkChangeGuards(prev(100, 'a'), next(0, 0, 1, 'b'))).toEqual({ ok: false, reason: 'zero_match' });
  });
  it('passes 5 of 100 moved 6x, fails 6', () => {
    expect(checkChangeGuards(prev(100), next(100, 5))).toEqual({ ok: true, skipped: null });
    expect(checkChangeGuards(prev(100), next(100, 6))).toEqual({ ok: false, reason: 'moved' });
  });
  it('does not count exactly 5x as moved', () => {
    expect(checkChangeGuards(prev(100), next(100, 100, 5))).toEqual({ ok: true, skipped: null });
  });
  it('counts a move down as moved', () => {
    const p = prev(100);
    const n = next(100);
    for (let i = 0; i < 6; i++) n.records[i] = norm(i, 1 / 6);
    expect(checkChangeGuards(p, n)).toEqual({ ok: false, reason: 'moved' });
  });
  it('allows a count drop to 80 of 100, fails 79', () => {
    expect(checkChangeGuards(prev(100), next(80))).toEqual({ ok: true, skipped: null });
    expect(checkChangeGuards(prev(100), next(79))).toEqual({ ok: false, reason: 'count_drop' });
  });
  it('fails on zero records', () => {
    expect(checkChangeGuards(prev(10), next(0))).toEqual({ ok: false, reason: 'zero_match' });
  });
  it('treats 0 -> 0 as unchanged and 0 -> 1 or 1 -> 0 as moved', () => {
    const allZero = (i: number): NormalizedRate => ({
      ...norm(i, 0),
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cacheWriteLong: 0,
    });
    const zeroRates = new Map<string, RateValues>();
    for (let i = 0; i < 10; i++) {
      zeroRates.set(rateKey('p', `m${i}`), {
        input: '0.000000',
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cacheWriteLong: 0,
      });
    }
    const zeros = Array.from({ length: 10 }, (_, i) => allZero(i));
    expect(checkChangeGuards({ source: 's', rates: zeroRates }, { source: 's', records: zeros })).toEqual({
      ok: true,
      skipped: null,
    });
    expect(
      checkChangeGuards({ source: 's', rates: zeroRates }, { source: 's', records: [norm(0, 1), ...zeros.slice(1)] }),
    ).toEqual({
      ok: false,
      reason: 'moved',
    });
    const one = new Map<string, RateValues>([[rateKey('p', 'm0'), vals('1.000000')]]);
    expect(checkChangeGuards({ source: 's', rates: one }, { source: 's', records: [norm(0, 0)] })).toEqual({
      ok: false,
      reason: 'moved',
    });
  });
});
