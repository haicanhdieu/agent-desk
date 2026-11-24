import { describe, expect, it } from 'vitest';
import { USAGE_ENTRY_CAP, USAGE_TOKENS_MAX, USAGE_WIRE_MAX_BASE64, UsageWireEntry } from './usage';

const entry = { id: 'msg_01:req_01', model: 'vendor-a/model-1@2', inputTokens: 10, outputTokens: 5 };
const ok = (over: Record<string, unknown>) => UsageWireEntry.safeParse({ ...entry, ...over }).success;

describe('UsageWireEntry', () => {
  it('parses a full entry', () => {
    const full = {
      ...entry,
      cacheReadTokens: 1,
      cacheWriteTokens: 2,
      cacheWriteLongTokens: 3,
      reasoningTokens: 4,
    };
    expect(UsageWireEntry.parse(full)).toEqual(full);
  });

  it('defaults the cache fields to 0', () => {
    const r = UsageWireEntry.parse(entry);
    expect([r.cacheReadTokens, r.cacheWriteTokens, r.cacheWriteLongTokens]).toEqual([0, 0, 0]);
    expect(r.reasoningTokens).toBeUndefined();
  });

  it.each([
    ['msg_01:req_01', true],
    ['vendor-a.x-1', true],
    ['a b', false],
    ['x;rm', false],
    ["x'", false],
    ['', false],
    ['a'.repeat(128), true],
    ['a'.repeat(129), false],
  ])('id %j -> %s', (id, valid) => {
    expect(ok({ id })).toBe(valid);
  });

  it.each([
    ['vendor-a/model-1@2', true],
    ['x; rm -rf /', false],
    ["x' OR '1'='1", false],
    ['a'.repeat(10240), false],
    ['model é', false],
    ['', false],
  ])('model %j -> %s', (model, valid) => {
    expect(ok({ model })).toBe(valid);
  });

  it.each([
    [-1, false],
    [1.5, false],
    [100000001, false],
    ['5', false],
    [0, true],
    [100000000, true],
  ])('inputTokens %j -> %s', (inputTokens, valid) => {
    expect(ok({ inputTokens })).toBe(valid);
  });

  it('refuses a bad count in any counter', () => {
    for (const k of ['outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'cacheWriteLongTokens']) {
      expect(ok({ [k]: -1 })).toBe(false);
    }
  });

  it('keeps reasoning at or below output', () => {
    expect(ok({ outputTokens: 500, reasoningTokens: 300 })).toBe(true);
    expect(ok({ outputTokens: 500, reasoningTokens: 500 })).toBe(true);
    expect(ok({ outputTokens: 500, reasoningTokens: 501 })).toBe(false);
  });

  it.each(['priceInput', 'costUsd'])('refuses unknown key %s', (key) => {
    expect(ok({ [key]: 1 })).toBe(false);
  });

  it('exports the limits', () => {
    expect(USAGE_WIRE_MAX_BASE64).toBe(1000);
    expect(USAGE_ENTRY_CAP).toBe(20000);
    expect(USAGE_TOKENS_MAX).toBe(100_000_000);
  });
});
