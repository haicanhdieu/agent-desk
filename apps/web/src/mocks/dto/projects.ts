import type { IgnoredEventDto, ProjectConnectionDto, ProjectDto } from '@agentdesk/contracts';
import { ids } from './ids';

// Mirrors mocks/projects.ts and mocks/connection.ts: invoicer-api (webhook, connected), invoicer-web (polling every
// 5 min), docs-site (webhook silent for 2 days), billing-jobs (polling rate limited), plus acme's storefront.
// `counts` and `lastRunAt` match mocks/dto/runs.ts; the MSW store recomputes them from the runs it holds.
const base = {
  maxConcurrentRuns: 2,
  maxRunsPerTicket: 10,
  setupStep: 'ready',
} as const;

export const projectFixtures: ProjectDto[] = [
  {
    ...base,
    id: ids.project.invoicerApi,
    name: 'invoicer-api',
    repoPath: 'harbor-labs/invoicer-api',
    codeConnectionId: ids.connection.harbor,
    boardConnectionId: ids.connection.harbor,
    triggerMode: 'webhook',
    pollIntervalSeconds: 300,
    createdAt: '2026-09-02T09:20:00.000Z',
    counts: { needsYou: 1, running: 2, queued: 1 },
    lastRunAt: '2026-11-12T14:12:00.000Z',
  },
  {
    ...base,
    id: ids.project.invoicerWeb,
    name: 'invoicer-web',
    repoPath: 'harbor-labs/invoicer-web',
    codeConnectionId: ids.connection.harbor,
    boardConnectionId: ids.connection.harbor,
    triggerMode: 'polling',
    pollIntervalSeconds: 300,
    createdAt: '2026-09-10T09:00:00.000Z',
    counts: { needsYou: 0, running: 0, queued: 0 },
    lastRunAt: '2026-11-11T16:30:00.000Z',
  },
  {
    ...base,
    id: ids.project.docsSite,
    name: 'docs-site',
    repoPath: 'kim-hale/docs-site',
    codeConnectionId: ids.connection.kim,
    boardConnectionId: ids.connection.kim,
    triggerMode: 'webhook',
    pollIntervalSeconds: 300,
    createdAt: '2026-10-01T08:10:00.000Z',
    counts: { needsYou: 0, running: 0, queued: 0 },
    lastRunAt: '2026-10-12T10:00:00.000Z',
  },
  {
    ...base,
    id: ids.project.billingJobs,
    name: 'billing-jobs',
    repoPath: 'harbor-labs/billing-jobs',
    codeConnectionId: ids.connection.harbor,
    boardConnectionId: ids.connection.harbor,
    triggerMode: 'polling',
    pollIntervalSeconds: 300,
    createdAt: '2026-09-20T09:00:00.000Z',
    counts: { needsYou: 0, running: 0, queued: 0 },
    lastRunAt: '2026-11-12T11:14:00.000Z',
  },
  {
    ...base,
    id: ids.project.storefront,
    name: 'storefront',
    repoPath: 'acme-co/storefront',
    codeConnectionId: ids.connection.acme,
    boardConnectionId: ids.connection.acme,
    triggerMode: 'webhook',
    pollIntervalSeconds: 300,
    createdAt: '2026-10-20T10:05:00.000Z',
    counts: { needsYou: 0, running: 0, queued: 0 },
    lastRunAt: null,
  },
];

/** Org that owns each project. */
export const projectOrg: Record<string, string> = {
  [ids.project.invoicerApi]: ids.org.alice,
  [ids.project.invoicerWeb]: ids.org.alice,
  [ids.project.docsSite]: ids.org.alice,
  [ids.project.billingJobs]: ids.org.alice,
  [ids.project.storefront]: ids.org.acme,
};

export const projectConnectionFixtures: Record<string, ProjectConnectionDto> = {
  [ids.project.invoicerApi]: {
    mode: 'webhook',
    webhook: { lastEventAt: '2026-11-12T14:12:00.000Z', lastEventAction: 'issue_comment.created' },
    polling: null,
  },
  [ids.project.invoicerWeb]: {
    mode: 'polling',
    webhook: null,
    polling: {
      intervalSeconds: 300,
      lastCheckedAt: '2026-11-12T14:11:00.000Z',
      lastError: null,
      pausedReason: null,
      nextPollAt: '2026-11-12T14:16:00.000Z',
    },
  },
  [ids.project.docsSite]: {
    mode: 'webhook',
    webhook: { lastEventAt: '2026-11-10T11:42:00.000Z', lastEventAction: 'issue_comment.created' },
    polling: null,
  },
  [ids.project.billingJobs]: {
    mode: 'polling',
    webhook: null,
    polling: {
      intervalSeconds: 300,
      lastCheckedAt: '2026-11-12T11:42:00.000Z',
      lastError: 'rate limited, retry in 5 min',
      pausedReason: null,
      nextPollAt: '2026-11-12T14:19:00.000Z',
    },
  },
  [ids.project.storefront]: { mode: 'webhook', webhook: { lastEventAt: null, lastEventAction: null }, polling: null },
};

// Mirrors mocks/ignored.ts (RunsProblems "Ignored commands"). `outcome` is the router's `ignored_*` value the mapper words.
const ignored = (
  n: number,
  receivedAt: string,
  ticket: { kind: 'issue' | 'pr'; number: number },
  command: string,
  author: string,
  outcome: string,
  detail: string,
): IgnoredEventDto => ({
  id: ids.ignored(n),
  receivedAt,
  ticketRef: String(ticket.number),
  ticketKind: ticket.kind,
  command,
  author,
  outcome,
  detail,
});

export const ignoredFixtures: Record<string, IgnoredEventDto[]> = {
  [ids.project.invoicerApi]: [
    ignored(
      1,
      '2026-11-12T14:16:00.000Z',
      { kind: 'issue', number: 160 },
      'code-build',
      'octo-visitor',
      'ignored_unauthorized',
      'octo-visitor is not a collaborator on the repo.',
    ),
    ignored(
      2,
      '2026-11-12T13:58:00.000Z',
      { kind: 'pr', number: 133 },
      'code-review',
      'agent-desk[bot]',
      'ignored_max_runs',
      'PR #133 already has 10 runs. Raise the limit or start a new ticket.',
    ),
    ignored(
      3,
      '2026-11-12T13:41:00.000Z',
      { kind: 'pr', number: 148 },
      'code-review',
      'kim-hale',
      'ignored_active_run',
      'Run 62 (code-review) is still active on this ticket.',
    ),
    ignored(
      4,
      '2026-11-12T12:07:00.000Z',
      { kind: 'issue', number: 158 },
      'code-build',
      'kim-hale',
      'ignored_labels',
      'Rule needs label user-story. The issue has: bug.',
    ),
    ignored(
      5,
      '2026-11-12T11:15:00.000Z',
      { kind: 'issue', number: 131 },
      'deploy',
      'kim-hale',
      'ignored_no_rule',
      'No enabled rule uses /deploy.',
    ),
  ],
};
