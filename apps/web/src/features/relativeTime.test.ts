import { describe, expect, it } from 'vitest';
import { relativeTime } from './relativeTime';

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
