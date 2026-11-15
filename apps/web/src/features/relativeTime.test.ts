import { describe, expect, it } from 'vitest';
import { relativeTime, timeLeft } from './relativeTime';

const now = new Date('2026-11-12T12:00:00.000Z');
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('relativeTime', () => {
  it.each([
    ['just now', 30_000, 'just now'],
    ['1 minute', MIN, '1 min ago'],
    ['several minutes', 5 * MIN, '5 min ago'],
    ['1 hour', HOUR, '1 hour ago'],
    ['several hours', 3 * HOUR, '3 hours ago'],
    ['yesterday', DAY, 'yesterday'],
    ['just under 2 days', 2 * DAY - 1, 'yesterday'],
    ['2 days: date', 2 * DAY, '10 Nov'],
    ['older date', 31 * DAY, '12 Oct'],
  ])('%s', (_name, ms, text) => {
    expect(relativeTime(ago(ms), now)).toBe(text);
  });

  it('treats a future timestamp as just now', () => {
    expect(relativeTime(ago(-5 * MIN), now)).toBe('just now');
  });
});

describe('timeLeft', () => {
  const ahead = (ms: number) => new Date(now.getTime() + ms).toISOString();
  it.each([
    ['under a minute', 20_000, 'less than a minute'],
    ['1 minute', MIN, '1 min'],
    ['several minutes', 45 * MIN + 30_000, '45 min'],
    ['1 hour', HOUR, '1 hour'],
    ['several hours', 5 * HOUR + 59 * MIN, '5 hours'],
    ['1 day', DAY, '1 day'],
    ['several days', 6 * DAY + 23 * HOUR, '6 days'],
  ])('%s', (_name, ms, text) => {
    expect(timeLeft(ahead(ms), now)).toBe(text);
  });

  it('a time that has passed is "less than a minute"', () => {
    expect(timeLeft(ahead(-5 * MIN), now)).toBe('less than a minute');
  });
});
