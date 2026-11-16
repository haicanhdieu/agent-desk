import type { ProjectConnectionDto } from '@agentdesk/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckNowTimeout, waitForPoll } from './checkNow';

const polling = (lastCheckedAt: string | null): ProjectConnectionDto => ({
  mode: 'polling',
  webhook: null,
  polling: { intervalSeconds: 300, lastCheckedAt, lastError: null, pausedReason: null, nextPollAt: null },
});
const timing = { intervalMs: 1000, timeoutMs: 20_000 };

describe('waitForPoll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps checking until Last checked moves, then returns that connection', async () => {
    const seen = [polling('a'), polling('a'), polling('b')];
    const fetchConnection = vi.fn(async () => seen.shift() ?? polling('b'));
    const result = waitForPoll(fetchConnection, 'a', timing);
    await vi.advanceTimersByTimeAsync(2 * timing.intervalMs);
    await expect(result).resolves.toEqual(polling('b'));
    expect(fetchConnection).toHaveBeenCalledTimes(3);
  });

  it('gives up with CheckNowTimeout when Last checked never moves', async () => {
    const result = expect(waitForPoll(async () => polling('a'), 'a', timing)).rejects.toBeInstanceOf(CheckNowTimeout);
    await vi.advanceTimersByTimeAsync(timing.timeoutMs);
    await result;
  });
});
