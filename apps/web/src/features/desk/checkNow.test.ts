import type { ProjectConnectionDto } from '@agentdesk/contracts';
import { describe, expect, it, vi } from 'vitest';
import { CheckNowTimeout, waitForPoll } from './checkNow';

const polling = (lastCheckedAt: string | null): ProjectConnectionDto => ({
  mode: 'polling',
  webhook: null,
  polling: { intervalSeconds: 300, lastCheckedAt, lastError: null, pausedReason: null, nextPollAt: null },
});
const fast = { intervalMs: 1, timeoutMs: 50 };

describe('waitForPoll', () => {
  it('keeps checking until Last checked moves, then returns that connection', async () => {
    const seen = [polling('a'), polling('a'), polling('b')];
    const fetchConnection = vi.fn(async () => seen.shift() ?? polling('b'));
    await expect(waitForPoll(fetchConnection, 'a', fast)).resolves.toEqual(polling('b'));
    expect(fetchConnection).toHaveBeenCalledTimes(3);
  });

  it('gives up with CheckNowTimeout when Last checked never moves', async () => {
    await expect(waitForPoll(async () => polling('a'), 'a', fast)).rejects.toBeInstanceOf(CheckNowTimeout);
  });
});
