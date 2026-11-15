import { describe, expect, it } from 'vitest';
import { clockElapsed, formatLimit } from './duration';

describe('formatLimit', () => {
  it.each([
    [60, '1 min'],
    [1800, '30 min'],
    [3600, '1 h'],
    [5400, '1 h 30 min'],
    [86400, '24 h'],
    [129600, '36 h'],
    [172800, '2 d'],
    [176400, '2 d 1 h'],
    [183600, '2 d 3 h'],
    [604800, '7 d'],
  ])('%i s → %s', (seconds, text) => {
    expect(formatLimit(seconds)).toBe(text);
  });

  it('rounds to whole minutes, like the limit field does', () => {
    expect(formatLimit(1829)).toBe('30 min');
  });

  it('shows seconds under a minute and never goes negative or non-finite', () => {
    expect(formatLimit(45)).toBe('45 s');
    expect(formatLimit(-5)).toBe('0 s');
    expect(formatLimit(Number.NaN)).toBe('0 s');
  });
});

describe('clockElapsed', () => {
  it.each([
    [0, '0:00'],
    [460_000, '7:40'],
    [3_599_000, '59:59'],
    [3_903_000, '1:05:03'],
    [86_399_000, '23:59:59'],
    [90_061_000, '1d 01:01:01'],
  ])('%i ms → %s', (ms, text) => {
    expect(clockElapsed(ms)).toBe(text);
  });
});
