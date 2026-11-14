import { bot, user } from './projects';
import type { Label, RunSummary, Ticket, TicketGroup } from './types';

// Prototype board: Runs (grouped table), RunsProblems; ticket titles/states from the Run*.dc.html side panels.
const GH = 'https://github.com/';
const story: Label = { name: 'user-story', color: '#7C8FD8' };
const api: Label = { name: 'api', color: '#52C4D9' };
const bug: Label = { name: 'bug', color: '#F2776B' };
const e2e: Label = { name: 'e2e', color: '#C8A2F0' };

export const tickets = {
  issue142: {
    kind: 'issue',
    number: 142,
    title: 'Export invoices as CSV from the billing page',
    labels: [story],
    state: 'Open',
    href: GH,
  },
  pr148: {
    kind: 'pr',
    number: 148,
    title: 'Export invoices as CSV from the billing page',
    labels: [story],
    state: 'Open, review pending',
    href: GH,
  },
  issue139: {
    kind: 'issue',
    number: 139,
    title: 'Rate-limit the public webhook endpoint',
    labels: [story, api],
    state: 'Open',
    href: GH,
  },
  issue151: {
    kind: 'issue',
    number: 151,
    title: 'Retry failed Stripe payouts with backoff',
    labels: [story],
    state: 'Open',
    href: GH,
  },
  issue131: {
    kind: 'issue',
    number: 131,
    title: 'Add tenant id to audit log entries',
    labels: [story],
    state: 'Open',
    href: GH,
  },
  pr133: {
    kind: 'pr',
    number: 133,
    title: 'Add tenant id to audit log entries',
    labels: [story],
    state: 'Merged',
    href: GH,
  },
  issue127: {
    kind: 'issue',
    number: 127,
    title: 'Flaky e2e: invoice PDF download times out',
    labels: [bug, e2e],
    state: 'Open',
    href: GH,
  },
  issue120: {
    kind: 'issue',
    number: 120,
    title: 'Dark mode for the customer portal',
    labels: [story],
    state: 'Open',
    href: GH,
  },
} satisfies Record<string, Ticket>;

const base = { agent: 'Claude', model: 'opus' } as const;

const run52: RunSummary = {
  ...base,
  id: 52,
  status: 'cancelled',
  statusNote: 'Cancelled by kim-hale',
  command: '/code-build',
  skill: 'code-build',
  ticket: tickets.issue120,
  triggeredBy: user,
  startedAt: '13:02',
  duration: '7m 50s',
};
const run54: RunSummary = {
  ...base,
  id: 54,
  status: 'timed_out',
  command: '/code-e2e',
  skill: 'code-e2e',
  ticket: tickets.issue127,
  triggeredBy: user,
  startedAt: '10:02',
  duration: '30m 00s',
};
const run55: RunSummary = {
  ...base,
  id: 55,
  status: 'succeeded',
  command: '/code-build',
  skill: 'code-build',
  ticket: tickets.issue131,
  triggeredBy: user,
  startedAt: '11:20',
  duration: '8m 03s',
};
const run56: RunSummary = {
  ...base,
  id: 56,
  status: 'failed',
  statusNote: 'API authentication failed (401)',
  command: '/code-review',
  skill: 'code-review',
  ticket: tickets.pr133,
  triggeredBy: bot,
  startedAt: '11:29',
  duration: '1m 10s',
};
const run57: RunSummary = {
  ...base,
  id: 57,
  status: 'succeeded',
  statusNote: 'Re-issued by comment',
  command: '/code-review',
  skill: 'code-review',
  ticket: tickets.pr133,
  triggeredBy: user,
  startedAt: '11:52',
  duration: '5m 41s',
};
const run60: RunSummary = {
  ...base,
  id: 60,
  status: 'succeeded',
  command: '/code-build',
  skill: 'code-build',
  ticket: tickets.issue142,
  triggeredBy: user,
  startedAt: '14:02',
  duration: '6m 12s',
};
const run61: RunSummary = {
  ...base,
  id: 61,
  status: 'running',
  command: '/code-build',
  skill: 'code-build',
  ticket: tickets.issue139,
  triggeredBy: user,
  startedAt: '14:05',
  duration: '7m 40s',
};
const run62: RunSummary = {
  ...base,
  id: 62,
  status: 'idle',
  statusNote: 'Waiting 3m. Auto-finish after 10m unattended',
  command: '/code-review',
  skill: 'code-review',
  ticket: tickets.pr148,
  triggeredBy: bot,
  startedAt: '14:09',
  duration: '4m 51s',
};
const run63: RunSummary = {
  ...base,
  id: 63,
  status: 'queued',
  statusNote: 'Next in line. 2 of 2 slots busy (1 needs you)',
  command: '/code-build',
  skill: 'code-build',
  ticket: tickets.issue151,
  triggeredBy: user,
  startedAt: '14:12',
};

export const runsById = {
  52: run52,
  54: run54,
  55: run55,
  56: run56,
  57: run57,
  60: run60,
  61: run61,
  62: run62,
  63: run63,
};

// Board order of the grouped table.
export const ticketGroups: TicketGroup[] = [
  { ticket: tickets.issue142, chainNote: 'Issue #142 → PR #148', runsUsed: 2, runsMax: 10, runs: [run60, run62] },
  { ticket: tickets.issue139, runsUsed: 1, runsMax: 10, runs: [run61] },
  { ticket: tickets.issue151, runsUsed: 1, runsMax: 10, runs: [run63] },
  {
    ticket: tickets.issue131,
    chainNote: 'Issue #131 → PR #133',
    runsUsed: 3,
    runsMax: 10,
    runs: [run55, run56, run57],
  },
  { ticket: tickets.issue127, runsUsed: 1, runsMax: 10, runs: [run54] },
  { ticket: tickets.issue120, runsUsed: 1, runsMax: 10, runs: [run52] },
];

export const runs: RunSummary[] = [run52, run54, run55, run56, run57, run60, run61, run62, run63];
