import { describe, expect, it } from 'vitest';
import type { Clock } from '@agentdesk/core';
import { PrStateCache } from './pr-state-cache';

function makeClock(): Clock & { advance(ms: number): void } {
  let now = Date.parse('2026-01-01T00:00:00.000Z');
  return { now: () => new Date(now), advance: (ms) => (now += ms) };
}

describe('PrStateCache', () => {
  it('a hit at 60 s - 1 ms, a miss at 60 s + 1 ms', () => {
    const clock = makeClock();
    const cache = new PrStateCache(clock, { ttlMs: 60_000, maxEntries: 10 });
    cache.set('p', '1', 'open');
    clock.advance(59_999);
    expect(cache.get('p', '1')).toBe('open');
    clock.advance(2);
    expect(cache.get('p', '1')).toBeUndefined();
  });

  it('an entry is expired from exactly ttlMs', () => {
    const clock = makeClock();
    const cache = new PrStateCache(clock, { ttlMs: 60_000, maxEntries: 10 });
    cache.set('p', '1', 'open');
    clock.advance(60_000);
    expect(cache.get('p', '1')).toBeUndefined();
  });

  it('entry 10,001 evicts the oldest and keeps the newest', () => {
    const cache = new PrStateCache(makeClock(), { ttlMs: 60_000, maxEntries: 10_000 });
    for (let i = 1; i <= 10_001; i += 1) cache.set('p', String(i), 'merged');
    expect(cache.get('p', '1')).toBeUndefined();
    expect(cache.get('p', '2')).toBe('merged');
    expect(cache.get('p', '10001')).toBe('merged');
  });

  it("project A's entry is never served to project B", () => {
    const cache = new PrStateCache(makeClock(), { ttlMs: 60_000, maxEntries: 10 });
    cache.set('a', '7', 'draft');
    expect(cache.get('b', '7')).toBeUndefined();
    expect(cache.get('a', '7')).toBe('draft');
  });

  it('re-setting refreshes the time and the age order', () => {
    const clock = makeClock();
    const cache = new PrStateCache(clock, { ttlMs: 60_000, maxEntries: 2 });
    cache.set('p', '1', 'open');
    cache.set('p', '2', 'open');
    clock.advance(40_000);
    cache.set('p', '1', 'closed');
    cache.set('p', '3', 'open'); // evicts 2, the oldest now
    expect(cache.get('p', '2')).toBeUndefined();
    expect(cache.get('p', '1')).toBe('closed');
    clock.advance(30_000); // 1 was refreshed 30 s ago, 3 too
    expect(cache.get('p', '1')).toBe('closed');
  });
});
