import { describe, expect, it } from 'vitest';
import {
  HISTORY_EVENT_LIMIT_DEFAULT,
  TOKEN_REFRESH_INTERVAL_SECONDS_DEFAULT,
  historyTooLong,
  nextRefreshDelaySeconds,
  refreshWaitSeconds,
} from '../src/workflows/token-refresh';

describe('refreshWaitSeconds', () => {
  it('after a success uses the override, then the planned delay, then the default', () => {
    expect(refreshWaitSeconds({ failures: 0, overrideSeconds: 1, plannedSeconds: 2000 })).toBe(1);
    expect(refreshWaitSeconds({ failures: 0, plannedSeconds: 2000 })).toBe(2000);
    expect(refreshWaitSeconds({ failures: 0 })).toBe(TOKEN_REFRESH_INTERVAL_SECONDS_DEFAULT);
    expect(TOKEN_REFRESH_INTERVAL_SECONDS_DEFAULT).toBe(2700);
  });

  it('retries every 60 s for the first 15 failures, then every 300 s', () => {
    expect(refreshWaitSeconds({ failures: 1, overrideSeconds: 1, plannedSeconds: 2000 })).toBe(60);
    expect(refreshWaitSeconds({ failures: 15 })).toBe(60);
    expect(refreshWaitSeconds({ failures: 16 })).toBe(300);
    expect(refreshWaitSeconds({ failures: 500 })).toBe(300);
  });
});

describe('nextRefreshDelaySeconds', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const at = (seconds: number) => new Date(now.getTime() + seconds * 1000);
  it('is 75% of the time left: a one hour token refreshes after 45 minutes', () => {
    expect(nextRefreshDelaySeconds(at(3600), now)).toBe(2700);
    expect(nextRefreshDelaySeconds(at(1000), now)).toBe(750);
  });
  it('never goes below 60 s, even for an expired or invalid expiry', () => {
    expect(nextRefreshDelaySeconds(at(10), now)).toBe(60);
    expect(nextRefreshDelaySeconds(at(-500), now)).toBe(60);
    expect(nextRefreshDelaySeconds(new Date('nope'), now)).toBe(TOKEN_REFRESH_INTERVAL_SECONDS_DEFAULT);
  });
});

describe('historyTooLong', () => {
  it('trips at the limit, defaulting to 45000 events', () => {
    expect(HISTORY_EVENT_LIMIT_DEFAULT).toBe(45_000);
    expect(historyTooLong(44_999, undefined)).toBe(false);
    expect(historyTooLong(45_000, undefined)).toBe(true);
    expect(historyTooLong(30, 30)).toBe(true);
    expect(historyTooLong(29, 30)).toBe(false);
  });
});
