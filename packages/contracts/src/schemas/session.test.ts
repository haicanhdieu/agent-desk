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
  it('allows paused runs and succeeded runs with a kept session', () => {
    expect(canResume({ status: 'paused', sessionExpiresAt: later }, now)).toBe(true);
    expect(canResume({ status: 'succeeded', sessionExpiresAt: later }, now)).toBe(true);
  });
  it('refuses succeeded runs without a live session and other statuses', () => {
    expect(canResume({ status: 'succeeded', sessionExpiresAt: null }, now)).toBe(false);
    expect(canResume({ status: 'succeeded', sessionExpiresAt: earlier }, now)).toBe(false);
    expect(canResume({ status: 'failed', sessionExpiresAt: later }, now)).toBe(false);
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
