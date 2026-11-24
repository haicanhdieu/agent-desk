import type { RunDto, TicketDto } from '@agentdesk/contracts';
import { TRIAGE_PROMPT, promptSystemLines } from '../rules';
import { runsById } from '../runs';
import type { RunSummary, Ticket } from '../types';
import { ids } from './ids';

// Built from mocks/runs.ts so the Runs board and the mock API tell the same story: same numbers, statuses,
// commands, tickets and start times (the boards' HH:MM are taken as UTC on the fixture day).
const DAY = '2026-11-12';
const at = (hhmm: string, plusSeconds = 0) =>
  new Date(Date.parse(`${DAY}T${hhmm}:00.000Z`) + plusSeconds * 1000).toISOString();
const seconds = (duration: string | undefined) => {
  const m = /^(\d+)m(?: (\d+)s)?$/.exec(duration ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2] ?? 0) : 0;
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

const RUN_60_FINAL_PROMPT = [
  'Use the skill "code-build" on issue #142 in harbor-labs/invoicer-api.',
  'Read the ticket and all its comments with the gh CLI before you start.',
  'Arguments from the user: use the existing CSV helper in src/export',
  'When done, report on the ticket as the skill instructs.',
  'RULE: RAM is capped (/sys/fs/cgroup/memory.max); exceeding it kills the pod. You MUST check memory before heavy tasks and order parallel work to fit, and MUST kill unused processes and shells and delete temp files.',
  'Before you end a turn, run `agentdesk-status done "<one-line summary>"` if the task is complete, or `agentdesk-status needs_input "<your question>"` if you need an answer from the human.',
].join('\n');

const failure: Partial<Record<RunSummary['status'], { exitCode: number | null; failureReason: string | null }>> = {
  succeeded: { exitCode: 0, failureReason: null },
  failed: { exitCode: 1, failureReason: 'API authentication failed (401)' },
  timed_out: { exitCode: null, failureReason: 'Timed out after 30 min' },
  cancelled: { exitCode: null, failureReason: null },
};

/** A mock DB run: the DTO plus the issue refs it was linked to when created (mirrors runs.linked_issue_refs). */
export type MockRun = RunDto & { linkedIssueRefs?: string[] };

/** Fixture links: PR #148 closes issue #142, PR #133 closes issue #131. */
const linkedRefsOf = (ticket: Ticket): string[] | undefined => {
  if (ticket.kind !== 'pr') return undefined;
  if (ticket.number === 148) return ['142'];
  return ticket.number === 133 ? ['131'] : undefined;
};

function fromSummary(r: RunSummary): MockRun {
  const command = r.command.replace(/^\//, '');
  const queued = r.status === 'queued';
  const final = failure[r.status];
  const duration = seconds(r.duration);
  const linkedIssueRefs = linkedRefsOf(r.ticket);
  return {
    ...(linkedIssueRefs ? { linkedIssueRefs } : {}),
    id: ids.run(1, r.id),
    number: r.id,
    projectId: ids.project.invoicerApi,
    ruleId: ruleByCommand[command] ?? null,
    command,
    ruleKind: 'skill',
    skillName: r.skill,
    prompt: null,
    // Run 60 recorded its final prompt; the older runs started before prompts were recorded ("Not recorded").
    finalPrompt: r.id === 60 ? RUN_60_FINAL_PROMPT : null,
    agent: { name: r.agent, model: r.model },
    ticket: ticketDto(r.ticket),
    args: null,
    status: r.status,
    triggerSource: 'webhook',
    triggeredBy: r.triggeredBy.login,
    ownerUserId: null,
    queuedAt: queued ? at(r.startedAt) : at(r.startedAt, -20),
    startedAt: queued ? null : at(r.startedAt),
    finishedAt: final ? at(r.startedAt, duration) : null,
    exitCode: final?.exitCode ?? null,
    failureReason: final?.failureReason ?? null,
    failureStage: null,
    setupScriptVersion: null,
    costUsd: final ? Math.round(duration * 0.35) / 100 : null,
    timeoutSeconds: 1800,
    idleEndSeconds: 1800,
    pausedKeepSeconds: 604800,
    idleSince: r.status === 'idle' ? at('14:11') : null,
    waitingOn: null,
    agentNote: null,
    pausedAt: null,
    sessionExpiresAt: null,
    sessionEndingAt: null,
    pauseReason: null,
    reopenedAt: null,
    usage: null,
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
  ruleKind: 'skill',
  skillName: 'code-build',
  prompt: null,
  finalPrompt: null,
  agent: { name: 'Claude', model: 'opus' },
  ticket: ticketDto(ticket, repo),
  args: null,
  status: 'succeeded',
  triggerSource: 'webhook',
  triggeredBy: 'kim-hale',
  ownerUserId: null,
  queuedAt,
  startedAt: queuedAt,
  finishedAt: new Date(Date.parse(queuedAt) + 6 * 60_000).toISOString(),
  exitCode: 0,
  failureReason: null,
  failureStage: null,
  setupScriptVersion: null,
  costUsd: 1.2,
  timeoutSeconds: 1800,
  idleEndSeconds: 1800,
  pausedKeepSeconds: 604800,
  idleSince: null,
  waitingOn: null,
  agentNote: null,
  pausedAt: null,
  sessionExpiresAt: null,
  sessionEndingAt: null,
  pauseReason: null,
  reopenedAt: null,
  usage: null,
});

/** Run 52 ran the custom prompt rule /triage: no skill, the prompt and the final prompt as recorded. */
const asPromptRun = (r: MockRun): MockRun => ({
  ...r,
  ruleId: ids.rule.r6,
  command: 'triage',
  ruleKind: 'prompt',
  skillName: null,
  prompt: TRIAGE_PROMPT,
  finalPrompt: [TRIAGE_PROMPT, ...promptSystemLines.map((l) => l.replace('<issue or PR #number>', 'issue #120'))].join(
    '\n',
  ),
});

const issue = (number: number, title: string): Ticket => ({ kind: 'issue', number, title, labels: [], href: '' });

const inMs = (ms: number) => new Date(Date.now() + ms).toISOString();
const HOUR_MS = 3_600_000;

/** A run of invoicer-api (project 1) in a kept or expired state (ADR 0022), built on an ended run. */
const parked = (number: number, ticket: Ticket, over: Partial<RunDto>): RunDto => ({
  ...ended(1, ids.project.invoicerApi, repoPath, number, '2026-11-12T13:30:00.000Z', ticket),
  ...over,
});

export const runFixtures: MockRun[] = [
  ...Object.values(runsById).map((r) => (r.id === 52 ? asPromptRun(fromSummary(r)) : fromSummary(r))),
  // Run 64 paused by the idle timer, run 65 succeeded with its session kept, run 66 never resumed.
  parked(64, issue(150, 'Add an audit trail to the CSV export'), {
    status: 'paused',
    finishedAt: null,
    exitCode: null,
    costUsd: null,
    pausedAt: '2026-11-12T13:40:00.000Z',
    pauseReason: 'idle_timeout',
    sessionExpiresAt: inMs(5 * 24 * HOUR_MS + HOUR_MS),
    agentNote: 'Should the export include voided invoices?',
  }),
  parked(65, issue(153, 'Rename the export columns'), {
    // A long routing rule command, to show truncation in the Run List (e2e/mock/runs-board.spec.ts).
    command: 'code-build-with-a-very-long-routing-rule-command-name-that-overflows-the-cell',
    status: 'succeeded',
    sessionExpiresAt: inMs(20 * HOUR_MS),
    agentNote: 'Opened PR #148 with the CSV export and tests.',
  }),
  parked(66, issue(152, 'Drop the legacy invoice export'), {
    status: 'expired',
    exitCode: null,
    costUsd: null,
    pausedAt: '2026-11-04T13:40:00.000Z',
    finishedAt: '2026-11-11T13:40:00.000Z',
    sessionExpiresAt: null,
  }),
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
