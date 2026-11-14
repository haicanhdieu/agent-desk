import type { ProjectConnectionDto, ProjectDto } from '@agentdesk/contracts';
import { describe, expect, it } from 'vitest';
import { pollIntervalLabel, toConnectionStatus, toProject, toProjectMenuItems } from './map';

const now = new Date('2026-11-12T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

const project = {
  triggerMode: 'webhook',
  pollIntervalSeconds: 300,
  createdAt: ago(30 * DAY),
} as const;
const polling = (over: Partial<NonNullable<ProjectConnectionDto['polling']>> = {}): ProjectConnectionDto => ({
  mode: 'polling',
  webhook: null,
  polling: {
    intervalSeconds: 300,
    lastCheckedAt: ago(60_000),
    lastError: null,
    pausedReason: null,
    nextPollAt: null,
    ...over,
  },
});
const webhook = (lastEventAt: string | null): ProjectConnectionDto => ({
  mode: 'webhook',
  webhook: {
    lastEventAt,
    lastEventAction: lastEventAt ? 'issue_comment' : null,
  },
  polling: null,
});

describe('pollIntervalLabel', () => {
  it.each([
    [300, '5 min'],
    [600, '10 min'],
    [900, '15 min'],
    [1800, '30 min'],
  ] as const)('%i s is %s', (seconds, label) => {
    expect(pollIntervalLabel(seconds)).toBe(label);
  });
});

describe('toConnectionStatus', () => {
  it.each([
    ['healthy polling', polling(), { ...project, triggerMode: 'polling' }, 'polling', 'ok', 'Polling every 5 min'],
    [
      'revoked token',
      polling({ pausedReason: 'token_revoked' }),
      project,
      'polling',
      'err',
      'Polling failed: token revoked',
    ],
    ['last error', polling({ lastError: 'rate limited' }), project, 'polling', 'err', 'Polling failed: rate limited'],
    ['webhook silent for 3 days', webhook(ago(3 * DAY)), project, 'webhook', 'warn', 'No webhooks for 2 days'],
    ['webhook never heard, project old', webhook(null), project, 'webhook', 'warn', 'No webhooks for 2 days'],
    ['webhook recent', webhook(ago(DAY)), project, 'webhook', 'ok', 'Connected'],
    ['webhook silent exactly 2 days', webhook(ago(2 * DAY)), project, 'webhook', 'warn', 'No webhooks for 2 days'],
    ['webhook silent 2 days minus 1 ms', webhook(ago(2 * DAY - 1)), project, 'webhook', 'ok', 'Connected'],
    [
      'webhook never heard, project exactly 2 days old',
      webhook(null),
      { ...project, createdAt: ago(2 * DAY) },
      'webhook',
      'warn',
      'No webhooks for 2 days',
    ],
    [
      'webhook never heard, project new',
      webhook(null),
      { ...project, createdAt: ago(DAY) },
      'webhook',
      'ok',
      'Connected',
    ],
  ] as const)('%s', (_name, dto, proj, mode, tone, text) => {
    expect(toConnectionStatus(dto, proj, now)).toEqual({ mode, tone, text });
  });

  it('uses the polling interval from the connection', () => {
    expect(toConnectionStatus(polling({ intervalSeconds: 900 }), project, now).text).toBe('Polling every 15 min');
  });
});

describe('toProject', () => {
  const dto: ProjectDto = {
    id: 'p1',
    name: 'invoicer-api',
    repoPath: 'harbor-labs/invoicer-api',
    codeConnectionId: 'c1',
    boardConnectionId: 'c1',
    triggerMode: 'webhook',
    pollIntervalSeconds: 300,
    maxConcurrentRuns: 2,
    maxRunsPerTicket: 10,
    setupStep: 'ready',
    createdAt: ago(30 * DAY),
    counts: { needsYou: 1, running: 2, queued: 3 },
    lastRunAt: ago(2 * 60_000),
  };
  const conn = { mode: 'webhook', tone: 'ok', text: 'Connected' } as const;

  it('maps names, counts (running without the idle runs, as needs you holds them) and a relative last run', () => {
    expect(toProject(dto, conn, 'alice', now)).toEqual({
      id: 'p1',
      org: 'alice',
      name: 'invoicer-api',
      repo: 'harbor-labs/invoicer-api',
      connection: conn,
      needsYou: 1,
      running: 1,
      queued: 3,
      lastRun: '2 min ago',
    });
  });

  it('shows a dash when the project never ran', () => {
    expect(toProject({ ...dto, lastRunAt: null }, conn, 'alice', now).lastRun).toBe('—');
  });
});

describe('toProjectMenuItems', () => {
  const base = {
    codeConnectionId: 'c1',
    boardConnectionId: 'c1',
    triggerMode: 'webhook',
    pollIntervalSeconds: 300,
    maxConcurrentRuns: 2,
    maxRunsPerTicket: 10,
    setupStep: 'ready',
    createdAt: ago(30 * DAY),
    lastRunAt: null,
  } as const;
  const dtos: ProjectDto[] = [
    {
      ...base,
      id: 'p1',
      name: 'invoicer-api',
      repoPath: 'o/invoicer-api',
      counts: { needsYou: 2, running: 2, queued: 0 },
    },
    { ...base, id: 'p2', name: 'docs-site', repoPath: 'o/docs-site', counts: { needsYou: 0, running: 0, queued: 0 } },
  ];

  it('marks the current project and links each row through the given href', () => {
    expect(toProjectMenuItems(dtos, 'p2', (id) => `/runs/${id}`)).toEqual([
      { name: 'invoicer-api', needsYou: 2, current: false, href: '/runs/p1' },
      { name: 'docs-site', needsYou: 0, current: true, href: '/runs/p2' },
    ]);
  });

  it('gives an empty list for no projects', () => {
    expect(toProjectMenuItems([], 'p1', (id) => id)).toEqual([]);
  });
});
