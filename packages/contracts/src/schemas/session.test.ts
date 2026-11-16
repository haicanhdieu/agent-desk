import { describe, expect, it } from 'vitest';
import { PutAgentRequest, canResume, hasKeptSession, isSettled } from '../index';

const now = new Date('2026-11-15T12:00:00Z');
const later = '2026-11-16T12:00:00.000Z';
const earlier = '2026-11-15T11:59:59.000Z';

describe('hasKeptSession', () => {
  it('is true only for a future expiry', () => {
    expect(hasKeptSession({ sessionExpiresAt: later }, now)).toBe(true);
    expect(hasKeptSession({ sessionExpiresAt: earlier }, now)).toBe(false);
    expect(hasKeptSession({ sessionExpiresAt: null }, now)).toBe(false);
  });
});

describe('canResume', () => {
  const ending = '2026-11-15T11:59:00.000Z';
  const base = { sessionExpiresAt: null, sessionEndingAt: null };
  it.each([
    ['paused', { status: 'paused', sessionExpiresAt: later, sessionEndingAt: null }, true],
    ['succeeded with a kept session', { status: 'succeeded', sessionExpiresAt: later, sessionEndingAt: null }, true],
    ['succeeded without a session', { status: 'succeeded', ...base }, false],
    [
      'succeeded with an expired session',
      { status: 'succeeded', sessionExpiresAt: earlier, sessionEndingAt: null },
      false,
    ],
    ['idle whose session is ending', { status: 'idle', sessionExpiresAt: null, sessionEndingAt: ending }, true],
    ['running whose session is ending', { status: 'running', sessionExpiresAt: null, sessionEndingAt: ending }, true],
    ['done whose session is ending', { status: 'done', sessionExpiresAt: null, sessionEndingAt: ending }, true],
    ['idle without sessionEndingAt', { status: 'idle', ...base }, false],
    ['running without sessionEndingAt', { status: 'running', ...base }, false],
    [
      'starting whose sessionEndingAt is set',
      { status: 'starting', sessionExpiresAt: null, sessionEndingAt: ending },
      false,
    ],
    ['failed with a kept session', { status: 'failed', sessionExpiresAt: later, sessionEndingAt: null }, false],
    ['failed with sessionEndingAt set', { status: 'failed', sessionExpiresAt: null, sessionEndingAt: ending }, false],
    [
      'cancelled with sessionEndingAt set',
      { status: 'cancelled', sessionExpiresAt: later, sessionEndingAt: ending },
      false,
    ],
    ['expired without a session', { status: 'expired', ...base }, false],
  ] as const)('%s', (_name, run, expected) => {
    expect(canResume(run, now)).toBe(expected);
  });
});

describe('isSettled', () => {
  it('is true for a final run with no kept session', () => {
    expect(isSettled({ status: 'expired', sessionExpiresAt: null }, now)).toBe(true);
  });
  it('is false while a session is kept or the run is not final', () => {
    expect(isSettled({ status: 'succeeded', sessionExpiresAt: later }, now)).toBe(false);
    expect(isSettled({ status: 'paused', sessionExpiresAt: later }, now)).toBe(false);
  });
});

describe('PutAgentRequest keep settings', () => {
  it('rejects a paused keep time under 1 hour with a plain message', () => {
    const r = PutAgentRequest.safeParse({ model: 'm', timeoutSeconds: 60, pausedKeepSeconds: 3599 });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('A paused run must be kept between 1 hour and 30 days');
  });
  it('rejects a done keep time over 7 days with a plain message', () => {
    const r = PutAgentRequest.safeParse({ model: 'm', timeoutSeconds: 60, doneKeepSeconds: 604801 });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("A finished run's session can be kept for at most 7 days");
  });
  it('accepts 0 for done keep and absent values', () => {
    expect(PutAgentRequest.safeParse({ model: 'm', timeoutSeconds: 60, doneKeepSeconds: 0 }).success).toBe(true);
    expect(PutAgentRequest.safeParse({ model: 'm', timeoutSeconds: 60 }).success).toBe(true);
  });
});
