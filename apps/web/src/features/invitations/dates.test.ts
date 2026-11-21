import { describe, expect, it } from 'vitest';
import { formatFullDate, formatShortDate } from './dates';

describe('invitation dates', () => {
  it('formats the short date as day, month, 24-hour time in the given zone', () => {
    expect(formatShortDate('2026-11-23T14:05:00Z', 'UTC')).toBe('23 Nov, 14:05');
    expect(formatShortDate('2026-11-23T14:05:00Z', 'Asia/Tokyo')).toBe('23 Nov, 23:05');
  });

  it('formats the full date with the year', () => {
    expect(formatFullDate('2026-11-23T14:05:00Z', 'UTC')).toBe('23 Nov 2026, 14:05');
  });

  it('shows midnight as 00:00, not 24:00', () => {
    expect(formatShortDate('2026-11-23T00:00:00Z', 'UTC')).toBe('23 Nov, 00:00');
    expect(formatFullDate('2026-11-23T00:00:00Z', 'UTC')).toBe('23 Nov 2026, 00:00');
  });

  it('crosses a year boundary by the zone, not by the UTC date', () => {
    expect(formatFullDate('2026-12-31T23:30:00Z', 'UTC')).toBe('31 Dec 2026, 23:30');
    expect(formatFullDate('2026-12-31T23:30:00Z', 'Asia/Tokyo')).toBe('1 Jan 2027, 08:30');
  });

  it('uses single-digit days without a leading zero', () => {
    expect(formatShortDate('2026-11-03T09:07:00Z', 'UTC')).toBe('3 Nov, 09:07');
  });
});
