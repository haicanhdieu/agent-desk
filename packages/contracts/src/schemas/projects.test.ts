import { describe, expect, it } from 'vitest';
import { ProjectDto, UpdateProjectRequest } from './projects';

const project = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'app',
  repoPath: 'acme/app',
  defaultBranch: 'main',
  codeConnectionId: '00000000-0000-4000-8000-000000000002',
  boardConnectionId: '00000000-0000-4000-8000-000000000002',
  triggerMode: 'webhook',
  pollIntervalSeconds: 300,
  maxConcurrentRuns: 2,
  maxRunsPerTicket: 10,
  timeoutSeconds: 86400,
  pausedKeepSeconds: 604800,
  doneKeepSeconds: 86400,
  idleEndSeconds: 1800,
  autoResumeMax: 5,
  setupStep: 'ready',
  createdAt: '2026-11-12T00:00:00.000Z',
  counts: { needsYou: 0, running: 0, queued: 0 },
  lastRunAt: null,
} as const;

describe('ProjectDto repository link', () => {
  it('requires the connected repository home URL and code provider', () => {
    expect(
      ProjectDto.safeParse({ ...project, repoUrl: 'https://git.example.com/acme/app', codeProvider: 'github' }).success,
    ).toBe(true);
    expect(ProjectDto.safeParse(project).success).toBe(false);
    expect(ProjectDto.safeParse({ ...project, repoUrl: 'not a url', codeProvider: 'github' }).success).toBe(false);
    expect(ProjectDto.safeParse({ ...project, repoUrl: null, codeProvider: null }).success).toBe(true);
  });
});

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
