import { describe, expect, it } from 'vitest';
import { expiresView, formatFullDate, formatShortDate } from './dates';

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

const NOW = new Date('2026-11-21T12:00:00.000Z');
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('expiresView (BR-30, BR-51)', () => {
  it.each([
    ['pending, in 2 days', 'pending', 2 * DAY, 'Expires in 2 days'],
    ['pending, in 1 day', 'pending', DAY, 'Expires in 1 day'],
    ['pending, in 5 hours', 'pending', 5 * HOUR, 'Expires in 5 hours'],
    ['pending, in 1 hour', 'pending', HOUR, 'Expires in 1 hour'],
    ['pending, in 1 minute', 'pending', 60_000, 'Expires in less than an hour'],
    ['expired 1 day ago', 'expired', -DAY, 'Expired 1 day ago'],
    ['expired 5 hours ago', 'expired', -5 * HOUR, 'Expired 5 hours ago'],
    ['expired 2 days 23 hours ago', 'expired', -(2 * DAY + 23 * HOUR), 'Expired 2 days ago'],
    ['expired exactly 3 days ago', 'expired', -3 * DAY, 'Expired 3 days ago'],
  ] as const)('%s is relative with the full date as the title', (_name, status, offset, text) => {
    const view = expiresView(at(offset), status, NOW, 'UTC');
    expect(view.kind).toBe('relative');
    expect(view.text).toBe(text);
    expect(view.title).toBe(formatFullDate(at(offset), 'UTC'));
    expect(view.dateTime).toBe(at(offset));
  });

  it.each([
    ['3 days 1 hour ago', -(3 * DAY + HOUR), '18 Nov, 11:00'],
    ['5 days ago', -5 * DAY, '16 Nov, 12:00'],
  ])('expired %s is the exact date, with the full date as the title', (_name, offset, text) => {
    expect(expiresView(at(offset), 'expired', NOW, 'UTC')).toEqual({
      kind: 'exact',
      text,
      title: formatFullDate(at(offset), 'UTC'),
      dateTime: at(offset),
    });
  });

  it.each(['accepted', 'declined', 'revoked'] as const)('%s shows a dash and no date', (status) => {
    expect(expiresView(at(2 * DAY), status, NOW, 'UTC')).toEqual({ kind: 'none', text: '–' });
  });

  it('shows the date in the pinned zone', () => {
    expect(expiresView(at(-5 * DAY), 'expired', NOW, 'Asia/Tokyo').text).toBe('16 Nov, 21:00');
  });
});
