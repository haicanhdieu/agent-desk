import type { RunDto, TicketDto } from '@agentdesk/contracts';
import { runsById } from '../runs';
import type { RunSummary, Ticket } from '../types';
import { ids } from './ids';

// Built from mocks/runs.ts so the Runs board and the mock API tell the same story: same numbers, statuses,
// commands, tickets and start times (the boards' HH:MM are taken as UTC on the fixture day).
const DAY = '2026-11-12';
const at = (hhmm: string, plusSeconds = 0) =>
  new Date(Date.parse(`${DAY}T${hhmm}:00.000Z`) + plusSeconds * 1000).toISOString();
const seconds = (duration: string | undefined) => {
  const m = /^(\d+)m (\d+)s$/.exec(duration ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};

const repoPath = 'harbor-labs/invoicer-api';
const ticketDto = (t: Ticket, repo = repoPath): TicketDto => ({
  ref: String(t.number),
  kind: t.kind,
  number: t.number,
  title: t.title,
  url: `https://github.com/${repo}/${t.kind === 'pr' ? 'pull' : 'issues'}/${t.number}`,
  labels: t.labels.map((l) => ({ name: l.name, color: l.color.replace('#', '').toLowerCase() })),
});

const ruleByCommand: Record<string, string> = {
  'code-build': ids.rule.r1,
  'code-review': ids.rule.r2,
  'code-e2e': ids.rule.r3,
};

const failure: Partial<Record<RunSummary['status'], { exitCode: number | null; failureReason: string | null }>> = {
  succeeded: { exitCode: 0, failureReason: null },
  failed: { exitCode: 1, failureReason: 'API authentication failed (401)' },
  timed_out: { exitCode: null, failureReason: 'Timed out after 30 min' },
  cancelled: { exitCode: null, failureReason: null },
};

function fromSummary(r: RunSummary): RunDto {
  const command = r.command.replace(/^\//, '');
  const queued = r.status === 'queued';
  const final = failure[r.status];
  const duration = seconds(r.duration);
  return {
    id: ids.run(1, r.id),
    number: r.id,
    projectId: ids.project.invoicerApi,
    ruleId: ruleByCommand[command] ?? null,
    command,
    skillName: r.skill,
    agent: { name: r.agent, model: r.model },
    ticket: ticketDto(r.ticket),
    args: null,
    status: r.status,
    triggerSource: 'webhook',
    triggeredBy: r.triggeredBy.login,
    queuedAt: queued ? at(r.startedAt) : at(r.startedAt, -20),
    startedAt: queued ? null : at(r.startedAt),
    finishedAt: final ? at(r.startedAt, duration) : null,
    exitCode: final?.exitCode ?? null,
    failureReason: final?.failureReason ?? null,
    failureStage: null,
    setupScriptVersion: null,
    costUsd: final ? Math.round(duration * 0.35) / 100 : null,
    timeoutSeconds: 1800,
    idleSince: r.status === 'idle' ? at('14:11') : null,
  };
}

const ended = (
  projectIndex: number,
  projectId: string,
  repo: string,
  number: number,
  queuedAt: string,
  ticket: Ticket,
): RunDto => ({
  id: ids.run(projectIndex, number),
  number,
  projectId,
  ruleId: null,
  command: 'code-build',
  skillName: 'code-build',
  agent: { name: 'Claude', model: 'opus' },
  ticket: ticketDto(ticket, repo),
  args: null,
  status: 'succeeded',
  triggerSource: 'webhook',
  triggeredBy: 'kim-hale',
  queuedAt,
  startedAt: queuedAt,
  finishedAt: new Date(Date.parse(queuedAt) + 6 * 60_000).toISOString(),
  exitCode: 0,
  failureReason: null,
  failureStage: null,
  setupScriptVersion: null,
  costUsd: 1.2,
  timeoutSeconds: 1800,
  idleSince: null,
});

const issue = (number: number, title: string): Ticket => ({ kind: 'issue', number, title, labels: [], href: '' });

export const runFixtures: RunDto[] = [
  ...Object.values(runsById).map(fromSummary),
  // Last runs of the other projects (Projects board: "Run 19, yesterday", "Run 4, 12 Oct", "Run 31, 3 hours ago").
  ended(
    2,
    ids.project.invoicerWeb,
    'harbor-labs/invoicer-web',
    19,
    '2026-11-11T16:30:00.000Z',
    issue(88, 'Invoice list paging'),
  ),
  ended(
    3,
    ids.project.docsSite,
    'kim-hale/docs-site',
    4,
    '2026-10-12T10:00:00.000Z',
    issue(12, 'Document the CSV export'),
  ),
  ended(
    4,
    ids.project.billingJobs,
    'harbor-labs/billing-jobs',
    31,
    '2026-11-12T11:14:00.000Z',
    issue(64, 'Nightly payout report'),
  ),
];
