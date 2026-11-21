import { describe, expect, it } from 'vitest';
import type { RunStatusEvent } from '@agentdesk/contracts';
import { statusFrameKey } from './status-key';

const base: RunStatusEvent = {
  runId: '11111111-1111-4111-8111-111111111111',
  number: 1,
  status: 'idle',
  seq: 5,
  exitCode: null,
  failureReason: null,
  waitingOn: null,
  agentNote: null,
  pausedAt: null,
  sessionExpiresAt: null,
  sessionEndingAt: null,
  pauseReason: null,
  reopenedAt: null,
};

describe('statusFrameKey', () => {
  it('is the same for identical frames, so a repeat is not sent again', () => {
    expect(statusFrameKey({ ...base })).toBe(statusFrameKey({ ...base }));
  });

  it.each([
    ['sessionEndingAt (the pausing state starts)', { sessionEndingAt: '2026-11-16T10:00:00.000Z' }],
    ['pauseReason', { pauseReason: 'idle_timeout' }],
    ['reopenedAt', { reopenedAt: '2026-11-21T09:00:00.000Z' }],
    ['status', { status: 'paused' }],
    ['seq', { seq: 6 }],
    ['exitCode', { exitCode: 1 }],
    ['failureReason', { failureReason: 'boom' }],
  ] as const)('differs when only %s differs, so a new frame is sent', (_name, over) => {
    expect(statusFrameKey({ ...base, ...over })).not.toBe(statusFrameKey(base));
  });

  it('differs when sessionEndingAt is cleared again (the park finished)', () => {
    const ending = { ...base, sessionEndingAt: '2026-11-16T10:00:00.000Z' };
    expect(statusFrameKey({ ...ending, sessionEndingAt: null })).not.toBe(statusFrameKey(ending));
  });
});
