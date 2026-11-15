import { describe, expect, it } from 'vitest';
import { minutesIn, splitMinutes } from './duration';

describe('splitMinutes / minutesIn', () => {
  it.each([
    [30, '30', 'minutes'],
    [90, '90', 'minutes'],
    [60, '1', 'hours'],
    [1440, '24', 'hours'],
    [2160, '36', 'hours'],
    [2880, '2', 'days'],
    [10080, '7', 'days'],
    [2940, '49', 'hours'],
  ] as const)('%i min → %s %s', (minutes, value, unit) => {
    expect(splitMinutes(minutes)).toEqual({ value, unit });
  });

  it('minutesIn converts a typed value back, and is NaN for a value that is not a number', () => {
    expect(minutesIn('24', 'hours')).toBe(1440);
    expect(minutesIn('7', 'days')).toBe(10080);
    expect(minutesIn('45', 'minutes')).toBe(45);
    expect(Number.isNaN(minutesIn('abc', 'hours'))).toBe(true);
  });

  it('round-trips every split', () => {
    for (const m of [1, 59, 60, 61, 1440, 2880, 2940, 10080]) {
      const { value, unit } = splitMinutes(m);
      expect(minutesIn(value, unit)).toBe(m);
    }
  });
});
