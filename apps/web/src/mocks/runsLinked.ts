import { bot, user } from './projects';
import { runsById, ticketGroups, tickets } from './runs';
import type { Label, RunSummary, Ticket, TicketGroup } from './types';

// Prototype boards: RunsLinkedSeveralPrs, RunsLinkedSplitPr, RunsLinkedFiltered, RunsLinkedLongChain,
// RunsPagedLinkedPrOnly, RunsPagedLinkedIssueOnly, RunsPageLoadingLinked. The plain RunsLinked board uses `ticketGroups`.
const GH = 'https://github.com/';
const story: Label = { name: 'user-story', color: '#7C8FD8' };
const api: Label = { name: 'api', color: '#52C4D9' };
const base = { agent: 'Claude', model: 'opus' } as const;
const MAX = 10;

const pr = (number: number, title: string, labels: Label[] = [story]): Ticket => ({
  kind: 'pr',
  number,
  title,
  labels,
  state: 'Open',
  href: GH,
});
const run = (r: Pick<RunSummary, 'id' | 'ticket' | 'startedAt'> & Partial<RunSummary>): RunSummary => {
  const isPr = r.ticket.kind === 'pr';
  const skill = isPr ? 'code-review' : 'code-build';
  return {
    ...base,
    status: 'succeeded',
    command: `/${skill}`,
    skill,
    triggeredBy: user,
    ...r,
  };
};

// The idle run's wait text on these boards ends the run after 10 minutes.
const run62: RunSummary = { ...runsById[62], statusNote: 'Waiting 3m. Auto-finish after 10m unattended' };
const [, issue139, issue151, issue131, issue127, issue120] = ticketGroups;
const tail = [issue139, issue151, issue131, issue127, issue120];
const tailWithout = (...drop: TicketGroup[]) => tail.filter((g) => !drop.includes(g));

const pr150 = pr(150, tickets.issue142.title);
const run58 = run({
  id: 58,
  ticket: tickets.issue142,
  startedAt: '13:20',
  duration: '6m 12s',
});
const run59 = run({ id: 59, ticket: pr150, startedAt: '13:45', duration: '6m 12s', triggeredBy: bot });
const run60Pr150 = run({
  id: 60,
  ticket: pr150,
  startedAt: '14:02',
  duration: '5m 41s',
  statusNote: 'Re-issued by comment',
});

const severalPrs: TicketGroup[] = [
  {
    ticket: tickets.issue142,
    chainNote: 'Issue #142 (1 of 10 runs) → PR #148 (1 of 10 runs), PR #150 (2 of 10 runs)',
    runsUsed: 1,
    runsMax: MAX,
    linked: [
      { ticket: { kind: 'pr', number: 148 }, runsUsed: 1 },
      { ticket: { kind: 'pr', number: 150 }, runsUsed: 2 },
    ],
    runs: [run58, run59, run60Pr150, run62],
  },
  ...tail,
];

const pr148Own = pr(148, 'Add CSV export to the billing page');
const run60 = runsById[60];
const run47 = run({ id: 47, ticket: pr148Own, startedAt: 'Nov 20', duration: '3m 48s' });
// Run 62 is linked to issue #142 and run 47 is older, from before the link: one PR in two groups.
const splitPr: TicketGroup[] = [
  {
    ticket: tickets.issue142,
    chainNote: 'Issue #142 (1 of 10 runs) → PR #148 (2 of 10 runs)',
    runsUsed: 1,
    runsMax: MAX,
    linked: [{ ticket: { kind: 'pr', number: 148 }, runsUsed: 2 }],
    runs: [run60, run62],
  },
  ...tailWithout(issue120),
  { ticket: pr148Own, runsUsed: 2, runsMax: MAX, runs: [run47] },
];

// The screen applies the Needs you filter; run 62 is the only one left, under the full chain note.
const filtered: TicketGroup[] = [
  {
    ticket: tickets.issue142,
    chainNote: 'Issue #142 (1 of 10 runs) → PR #148 (1 of 10 runs)',
    runsUsed: 1,
    runsMax: MAX,
    linked: [{ ticket: { kind: 'pr', number: 148 }, runsUsed: 1 }],
    runs: [run60, run62],
  },
  ...tail,
];

const longIssue: Ticket = {
  ...tickets.issue142,
  title: 'Export invoices as CSV from the billing page, with date range, currency and tax columns',
  labels: [story, api],
};
const longPrs = [
  [148, 1],
  [150, 2],
  [153, 1],
  [157, 3],
  [160, 1],
  [164, 2],
] as const;
const longChain: TicketGroup[] = [
  {
    ticket: longIssue,
    chainNote: `Issue #142 (1 of 10 runs) → ${longPrs.map(([n, used]) => `PR #${n} (${used} of 10 runs)`).join(', ')}`,
    runsUsed: 1,
    runsMax: MAX,
    linked: longPrs.map(([number, runsUsed]) => ({ ticket: { kind: 'pr', number }, runsUsed })),
    runs: [run60, run62],
  },
  ...tail,
];

// Page 4 of 4 of 63 runs: issue #12 and PR #13 share a group; the other ticket's runs sit on earlier pages.
const issue12: Ticket = {
  kind: 'issue',
  number: 12,
  title: 'Add a health check endpoint for the load balancer',
  labels: [story],
  state: 'Open',
  href: GH,
};
const pr13 = pr(13, issue12.title);
const issue8: Ticket = {
  kind: 'issue',
  number: 8,
  title: 'Set up the project skeleton and CI',
  labels: [story],
  state: 'Open',
  href: GH,
};
const pagedRun1 = run({
  id: 1,
  ticket: issue8,
  status: 'failed',
  statusNote: 'Setup script exited with 1',
  startedAt: 'Oct 1',
  duration: '2m 40s',
});
const pagedTail: TicketGroup = { ticket: issue8, runsUsed: 1, runsMax: MAX, runs: [pagedRun1] };
const linked13 = (runsUsed: number) => [{ ticket: { kind: 'pr' as const, number: 13 }, runsUsed }];

const pagedPrOnly: TicketGroup[] = [
  {
    ticket: issue12,
    chainNote: 'Issue #12 (1 of 10 runs) → PR #13 (2 of 10 runs)',
    runsUsed: 1,
    runsMax: MAX,
    linked: linked13(2),
    runs: [
      run({ id: 3, ticket: pr13, startedAt: 'Oct 2', duration: '3m 02s', triggeredBy: bot }),
      run({
        id: 4,
        ticket: pr13,
        startedAt: 'Oct 3',
        duration: '2m 37s',
        triggeredBy: bot,
        statusNote: 'Re-issued by comment',
      }),
    ],
  },
  pagedTail,
];

const pagedIssueOnly: TicketGroup[] = [
  {
    ticket: issue12,
    chainNote: 'Issue #12 (2 of 10 runs) → PR #13 (1 of 10 runs)',
    runsUsed: 2,
    runsMax: MAX,
    linked: linked13(1),
    runs: [
      run({ id: 3, ticket: issue12, startedAt: 'Oct 2', duration: '9m 14s' }),
      run({ id: 4, ticket: issue12, startedAt: 'Oct 3', duration: '7m 05s', statusNote: 'Re-issued by comment' }),
    ],
  },
  pagedTail,
];

const pageLoading: TicketGroup[] = [
  {
    ticket: issue12,
    chainNote: 'Issue #12 (2 of 10 runs) → PR #13 (2 of 10 runs)',
    runsUsed: 2,
    runsMax: MAX,
    linked: linked13(2),
    runs: [
      run({ id: 2, ticket: issue12, startedAt: 'Oct 2', duration: '9m 14s' }),
      run({ id: 3, ticket: pr13, startedAt: 'Oct 2', duration: '3m 02s', triggeredBy: bot }),
    ],
  },
  pagedTail,
];

/** Group lists for the linked-runs boards of `Screens/Runs`, keyed by what each one shows. */
export const linkedGroups: Record<
  'severalPrs' | 'splitPr' | 'filtered' | 'longChain' | 'pagedPrOnly' | 'pagedIssueOnly' | 'pageLoading',
  TicketGroup[]
> = { severalPrs, splitPr, filtered, longChain, pagedPrOnly, pagedIssueOnly, pageLoading };
