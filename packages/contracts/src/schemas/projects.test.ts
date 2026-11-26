import { describe, expect, it } from 'vitest';
import { UpdateProjectRequest } from './projects';

const message = (body: Record<string, number>) => {
  const r = UpdateProjectRequest.safeParse(body);
  return r.success ? undefined : r.error.issues[0]?.message;
};

describe('UpdateProjectRequest limits carry the readable messages', () => {
  it('names the bound of each refused limit', () => {
    expect(message({ timeoutSeconds: 604801 })).toBe('The run time limit can be at most 7 days');
    expect(message({ timeoutSeconds: 59 })).toBe('The run time limit must be at least 1 minute');
    expect(message({ pausedKeepSeconds: 2592001 })).toBe('A paused run must be kept between 1 hour and 30 days');
    expect(message({ doneKeepSeconds: 604801 })).toBe("A finished run's session can be kept for at most 7 days");
    expect(message({ idleEndSeconds: 299 })).toBe('Idle runs must end after between 5 minutes and 7 days');
    expect(message({ autoResumeMax: 11 })).toBe('Automatic resumes must be between 0 and 10');
  });

  it('accepts values in range', () => {
    expect(UpdateProjectRequest.safeParse({ timeoutSeconds: 3600, autoResumeMax: 0, doneKeepSeconds: 0 }).success).toBe(
      true,
    );
  });

  it('runs per ticket: 0 means unlimited, up to 50, whole numbers only', () => {
    const ok = (n: number) => UpdateProjectRequest.safeParse({ maxRunsPerTicket: n }).success;
    expect(ok(0)).toBe(true);
    expect(ok(1)).toBe(true);
    expect(ok(50)).toBe(true);
    expect(ok(-1)).toBe(false);
    expect(ok(1.5)).toBe(false);
    expect(ok(51)).toBe(false);
  });

  it('runs per ticket: a bad value gets a readable message', () => {
    const msg = (n: number) => {
      const r = UpdateProjectRequest.safeParse({ maxRunsPerTicket: n });
      return r.success ? '' : r.error.issues.map((i) => i.message).join('|');
    };
    const want = 'Runs per ticket must be a whole number from 0 to 50 (0 is unlimited)';
    expect(msg(-1)).toBe(want);
    expect(msg(1.5)).toBe(want);
    expect(msg(51)).toBe(want);
  });
});
