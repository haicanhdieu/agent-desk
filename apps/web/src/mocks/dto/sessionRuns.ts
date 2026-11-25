import type { RunDto, RunEventDto, RunTranscriptEntryDto } from '@agentdesk/contracts';
import { TRANSCRIPT_LIMIT_NOTICE } from '@agentdesk/contracts';
import { ids } from './ids';
import { runFixtures } from './runs';

// Runs of invoicer-api for stop session and the saved Transcript (spec 2026-11-19): stopped runs, runs with a
// transcript in each state, and runs with only scrollback. They are seeded into the browser mock only
// (startMockWorker), like lifecycleRuns.ts, so the unit tests' run lists and counts stay as they were; the mocked e2e
// specs open them by number under a clock fixed at SESSION_MOCK_NOW (e2e/mock/mock.ts declares the same constants).

/** The fixed "now" of the mocked e2e specs that open these runs. */
export const SESSION_MOCK_NOW = '2026-11-19T14:20:00.000Z';

/** How the mock answers the transcript route for a run: after 3 s, with a 500, with a 500 and no request id, or a 500 once. */
export type TranscriptBehaviour = 'slow' | 'fail' | 'failNoRequestId' | 'failOnce';

export const STOP_RUNNING_RUN = 72;
export const STOP_IDLE_RUN = 73;
export const STOP_DONE_RUN = 74;
export const STOP_RUNNING_ENDING_RUN = 75;
export const STOP_DONE_ENDING_RUN = 76;
export const STOPPED_RUN = 77;
export const STOPPED_ISSUE_RUN = 78;
export const STOPPED_DAY_RUN = 79;
export const STOPPED_NOW_RUN = 80;
export const STOPPED_LATE_RUN = 81;
export const FINISHED_AFTER_PAUSE_RUN = 82;
export const EXPIRED_STOPPED_RUN = 83;
export const TRANSCRIPT_RICH_RUN = 84;
export const TRANSCRIPT_LONG_RUN = 85;
export const TRANSCRIPT_FAILED_RUN = 86;
export const TRANSCRIPT_TIMED_OUT_RUN = 87;
export const TRANSCRIPT_CANCELLED_RUN = 88;
export const TRANSCRIPT_RESUMING_RUN = 89;
export const TRANSCRIPT_SLOW_RUN = 90;
export const TRANSCRIPT_ERROR_RUN = 91;
export const TRANSCRIPT_ERROR_NO_ID_RUN = 92;
export const TRANSCRIPT_FLAKY_RUN = 93;
export const SCROLLBACK_PAUSED_RUN = 94;
export const SCROLLBACK_ENDED_RUN = 95;
export const NOTHING_ENDED_RUN = 96;
export const NOTHING_PAUSED_RUN = 97;
export const PAUSED_TRANSCRIPT_RUN = 98;
/** Failed at start because its agent had no credential: the end note offers Replace credential (BR-60). */
export const NO_CREDENTIAL_RUN = 121;

/** Transcript behaviours by run number. */
export const transcriptBehaviours: Record<number, TranscriptBehaviour> = {
  [STOP_RUNNING_ENDING_RUN]: 'slow',
  [STOP_DONE_ENDING_RUN]: 'slow',
  [TRANSCRIPT_SLOW_RUN]: 'slow',
  [TRANSCRIPT_ERROR_RUN]: 'fail',
  [TRANSCRIPT_ERROR_NO_ID_RUN]: 'failNoRequestId',
  [TRANSCRIPT_FLAKY_RUN]: 'failOnce',
  [SCROLLBACK_PAUSED_RUN]: 'slow',
};

/** Runs whose finish and cancel answer after 3000 ms, so the "Finishing…" and "Cancelling…" notes can be seen. */
export const slowActionRuns: ReadonlySet<number> = new Set([STOP_RUNNING_RUN, STOP_IDLE_RUN]);

const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const NOW_MS = Date.parse(SESSION_MOCK_NOW);
const ago = (ms: number) => new Date(NOW_MS - ms).toISOString();
const plus = (iso: string, s: number) => new Date(Date.parse(iso) + s * 1000).toISOString();

const base = (() => {
  const run = runFixtures.find((r) => r.number === 64);
  if (!run) throw new Error('fixture run 64 missing');
  return run;
})();

type Ticket = { kind: 'pr' | 'issue'; title: string };

const session = (number: number, ticket: Ticket, over: Partial<RunDto>): RunDto => {
  const ref = 100 + number;
  return {
    ...base,
    id: ids.run(1, number),
    number,
    ticket: {
      ...base.ticket,
      ref: String(ref),
      kind: ticket.kind,
      number: ref,
      title: ticket.title,
      url: `https://github.com/harbor-labs/invoicer-api/${ticket.kind === 'pr' ? 'pull' : 'issues'}/${ref}`,
    },
    status: 'running',
    queuedAt: ago(35 * MIN_MS),
    startedAt: ago(30 * MIN_MS),
    finishedAt: null,
    exitCode: null,
    costUsd: null,
    failureReason: null,
    idleSince: null,
    agentNote: null,
    pausedAt: null,
    sessionExpiresAt: null,
    sessionEndingAt: null,
    pauseReason: null,
    pausedKeepSeconds: 604800,
    ...over,
  };
};

const issue = (title: string): Ticket => ({ kind: 'issue', title });
const pr = (title: string): Ticket => ({ kind: 'pr', title });

/** A run stopped by a person `agoMs` before SESSION_MOCK_NOW, kept for 7 days. */
const stopped = (number: number, ticket: Ticket, agoMs: number, over: Partial<RunDto> = {}): RunDto => {
  const pausedAt = ago(agoMs);
  return session(number, ticket, {
    status: 'paused',
    startedAt: new Date(Date.parse(pausedAt) - 30 * MIN_MS).toISOString(),
    queuedAt: new Date(Date.parse(pausedAt) - 35 * MIN_MS).toISOString(),
    pausedAt,
    pauseReason: 'stopped',
    sessionExpiresAt: new Date(Date.parse(pausedAt) + 7 * DAY_MS).toISOString(),
    ...over,
  });
};

const ENDING_AT = ago(10_000);
const RESUME_REQUESTED = ago(5 * MIN_MS);

export const sessionRunFixtures: RunDto[] = [
  session(STOP_RUNNING_RUN, issue('Stop a running session'), {}),
  session(STOP_IDLE_RUN, issue('Stop an idle session'), {
    status: 'idle',
    idleSince: ago(5 * MIN_MS),
    agentNote: 'Should the report include refunds?',
  }),
  session(STOP_DONE_RUN, issue('Stop a done session'), {
    status: 'done',
    agentNote: 'Opened PR #160 with the report.',
  }),
  session(STOP_RUNNING_ENDING_RUN, issue('A running session that is ending'), { sessionEndingAt: ENDING_AT }),
  session(STOP_DONE_ENDING_RUN, issue('A done session that is ending'), {
    status: 'done',
    agentNote: 'Opened PR #161 with the report.',
    sessionEndingAt: ENDING_AT,
  }),
  stopped(STOPPED_RUN, pr('Add a refunds column to the report'), 2 * MIN_MS),
  stopped(STOPPED_ISSUE_RUN, issue('Add a refunds column to the report, issue'), 2 * MIN_MS),
  stopped(STOPPED_DAY_RUN, issue('Stopped a day ago'), DAY_MS),
  stopped(STOPPED_NOW_RUN, issue('Stopped just now'), 0),
  stopped(STOPPED_LATE_RUN, issue('Stopped almost a week ago'), 6 * DAY_MS + 23 * HOUR_MS),
  session(FINISHED_AFTER_PAUSE_RUN, issue('Finished after a pause'), {
    status: 'succeeded',
    finishedAt: ago(10 * MIN_MS),
    exitCode: 0,
    pausedAt: ago(2 * HOUR_MS),
    pauseReason: 'stopped',
    sessionExpiresAt: null,
  }),
  stopped(EXPIRED_STOPPED_RUN, issue('Expired after a stop'), 8 * DAY_MS, {
    status: 'expired',
    finishedAt: ago(DAY_MS),
  }),
  stopped(TRANSCRIPT_RICH_RUN, issue('A rich transcript'), MIN_MS),
  stopped(TRANSCRIPT_LONG_RUN, issue('A long transcript'), 30 * MIN_MS),
  session(TRANSCRIPT_FAILED_RUN, issue('A failed run'), {
    status: 'failed',
    finishedAt: ago(20 * MIN_MS),
    exitCode: 1,
    failureReason: 'API authentication failed (401)',
  }),
  session(TRANSCRIPT_TIMED_OUT_RUN, issue('A timed out run'), { status: 'timed_out', finishedAt: ago(20 * MIN_MS) }),
  session(TRANSCRIPT_CANCELLED_RUN, issue('A cancelled run'), {
    status: 'cancelled',
    finishedAt: '2026-11-19T13:10:41.000Z',
  }),
  session(TRANSCRIPT_RESUMING_RUN, issue('Resuming after a park'), {
    status: 'starting',
    queuedAt: RESUME_REQUESTED,
    pausedAt: ago(HOUR_MS),
    pauseReason: 'stopped',
  }),
  stopped(TRANSCRIPT_SLOW_RUN, issue('A slow transcript'), 30 * MIN_MS),
  stopped(TRANSCRIPT_ERROR_RUN, issue('A transcript that fails to load'), 30 * MIN_MS),
  stopped(TRANSCRIPT_ERROR_NO_ID_RUN, issue('A transcript that fails with no request id'), 30 * MIN_MS),
  stopped(TRANSCRIPT_FLAKY_RUN, issue('A transcript that fails once'), 30 * MIN_MS),
  session(SCROLLBACK_PAUSED_RUN, issue('Paused with scrollback only'), {
    status: 'paused',
    pausedAt: ago(30 * MIN_MS),
    pauseReason: 'idle_timeout',
    sessionExpiresAt: ago(-6 * DAY_MS),
    agentNote: 'Which database?',
  }),
  session(SCROLLBACK_ENDED_RUN, issue('Ended with scrollback only'), {
    status: 'succeeded',
    finishedAt: ago(30 * MIN_MS),
    exitCode: 0,
  }),
  session(NOTHING_ENDED_RUN, issue('Ended with nothing saved'), {
    status: 'succeeded',
    finishedAt: ago(30 * MIN_MS),
    exitCode: 0,
  }),
  session(NOTHING_PAUSED_RUN, issue('Paused with nothing saved'), {
    status: 'paused',
    pausedAt: ago(30 * MIN_MS),
    pauseReason: 'idle_timeout',
    sessionExpiresAt: ago(-6 * DAY_MS),
    agentNote: 'Which database?',
  }),
  session(PAUSED_TRANSCRIPT_RUN, issue('Paused by the idle timeout, with a transcript'), {
    status: 'paused',
    pausedAt: ago(30 * MIN_MS),
    pauseReason: 'idle_timeout',
    sessionExpiresAt: ago(-6 * DAY_MS),
    agentNote: 'Which database?',
  }),
  session(NO_CREDENTIAL_RUN, issue('Failed for a missing credential'), {
    status: 'failed',
    finishedAt: ago(20 * MIN_MS),
    exitCode: null,
    failureReason: 'createRunSecretAndJob failed: the agent has no credential set',
    failureCode: 'no_credential',
  }),
];

const SCROLLBACK_LINES = 412;
const scrollback = Array.from(
  { length: SCROLLBACK_LINES },
  (_, i) => `$ output line ${i + 1} of ${SCROLLBACK_LINES}`,
).join('\n');
const SCROLLBACK_RUNS: ReadonlySet<number> = new Set([SCROLLBACK_PAUSED_RUN, SCROLLBACK_ENDED_RUN]);

/** Events as the worker writes them; a run's seq starts at 1. Runs with no transcript carry scrollback instead. */
function eventsOf(run: RunDto): RunEventDto[] {
  const out: RunEventDto[] = [];
  const push = (ts: string, type: RunEventDto['type'], payload: Record<string, unknown>) =>
    out.push({ seq: out.length + 1, ts, type, payload });
  const queued = run.queuedAt;
  const started = run.startedAt ?? run.queuedAt;
  push(queued, 'status', { status: 'queued' });
  push(plus(started, 0), 'status', { status: 'starting' });
  push(plus(started, 8), 'lifecycle', { text: 'Pod running' });
  push(plus(started, 9), 'status', { status: 'running' });
  push(plus(started, 16), 'lifecycle', { text: 'Claude Code started' });
  if (run.idleSince !== null) push(run.idleSince, 'status', { status: 'idle' });
  if (run.number === FINISHED_AFTER_PAUSE_RUN) {
    push(ago(2 * HOUR_MS), 'status', { status: 'paused' });
    push(ago(HOUR_MS), 'lifecycle', { text: 'Resume requested by alice' });
    push(ago(HOUR_MS - 10_000), 'status', { status: 'running' });
    push(ago(20 * MIN_MS), 'status', { status: 'idle' });
  } else if (run.number === TRANSCRIPT_RESUMING_RUN) {
    push(ago(HOUR_MS), 'status', { status: 'paused' });
    push(RESUME_REQUESTED, 'lifecycle', { text: 'Resume requested by alice' });
    push(RESUME_REQUESTED, 'status', { status: 'queued' });
    push(plus(RESUME_REQUESTED, 10), 'status', { status: 'starting' });
  } else if (run.pausedAt !== null) {
    if (SCROLLBACK_RUNS.has(run.number)) push(plus(run.pausedAt, -1), 'scrollback', { text: scrollback });
    push(run.pausedAt, 'status', { status: 'paused' });
  }
  if (run.finishedAt !== null) {
    if (SCROLLBACK_RUNS.has(run.number)) push(plus(run.finishedAt, -1), 'scrollback', { text: scrollback });
    push(run.finishedAt, 'status', {
      status: run.status,
      exitCode: run.exitCode,
      failureReason: run.failureReason,
    });
  }
  return out;
}

export const sessionEventFixtures: Record<string, RunEventDto[]> = Object.fromEntries(
  sessionRunFixtures.map((run) => [run.id, eventsOf(run)]),
);

type Spec = Pick<RunTranscriptEntryDto, 'kind' | 'text'> &
  Partial<Pick<RunTranscriptEntryDto, 'tool' | 'truncated'>> & {
    /** Seconds after the run started; the default is 20 s apart. */
    at?: number;
  };

const PROMPT = 'Add a refunds column to the weekly report. Read the ticket and its comments first.';

/** Entries with seq 1, 2, ... and times from `from`. */
function entriesFrom(from: string, specs: Spec[]): RunTranscriptEntryDto[] {
  // 20 s apart, squeezed so that even 1,000 entries end within the run's 25 minutes.
  const step = Math.min(20, 1500 / specs.length);
  return specs.map((s, i) => ({
    seq: i + 1,
    at: plus(from, s.at ?? Math.round(step * (i + 1))),
    kind: s.kind,
    tool: s.tool ?? null,
    text: s.text,
    truncated: s.truncated ?? false,
  }));
}

const defaultSpecs = (withCut: boolean): Spec[] => [
  { kind: 'user', text: PROMPT },
  { kind: 'agent', text: 'I will read the ticket, then add the column and its test.' },
  { kind: 'tool', tool: 'Bash', text: 'gh issue view 177 --comments' },
  { kind: 'agent', text: 'The report builds its rows in ReportBuilder.cs. I will add a Refunds field there.' },
  {
    kind: 'agent',
    text: withCut ? 'The summary below is long, so only its start was saved. '.repeat(3) : 'Done: the column is added.',
    truncated: withCut,
  },
];

const richSpecs = (start: string): Spec[] => {
  // "Claude reply at 14:13" and "person message at 14:16" in the run's own clock.
  const at = (hhmm: string) => (Date.parse(`2026-11-19T${hhmm}:00.000Z`) - Date.parse(start)) / 1000;
  return [
    { kind: 'user', text: PROMPT, at: at('13:50') },
    { kind: 'agent', text: 'I will start with the report builder.', at: at('14:13') },
    { kind: 'user', text: 'Please also keep the totals row.', at: at('14:16') },
    { kind: 'tool', tool: 'Bash', text: 'dotnet test' },
    { kind: 'tool', tool: 'Edit', text: 'src/Reports/ReportBuilder.cs' },
    { kind: 'tool', tool: 'Write', text: 'tests/Reports/RefundsColumnTests.cs' },
    { kind: 'tool', tool: 'Read', text: 'src/Reports/ReportRow.cs' },
    { kind: 'notice', text: 'Conversation compacted' },
    { kind: 'notice', text: 'API Error: 401 invalid credential' },
    { kind: 'notice', text: TRANSCRIPT_LIMIT_NOTICE },
    { kind: 'agent', text: '<b>bold</b> <script>alert(1)</script>' },
    { kind: 'agent', text: '# Heading\n\n**strong**\n\n- one\n- two\n\n[a link](https://example.com)' },
    { kind: 'agent', text: 'a     b\n     c\n     d' },
    {
      kind: 'agent',
      text: [
        'Totals by column, with `inline_code` inside:',
        '',
        '| Name | Rows | Note |',
        '| --- | --- | --- |',
        '| refunds | 12 | the new column |',
        '',
        '```',
        `LONG_CODE_LINE ${'dotnet_test_filter_'.repeat(30)}`,
        '```',
      ].join('\n'),
    },
    { kind: 'agent', text: 'before ‮visible\u0007 after' },
    {
      kind: 'agent',
      text: 'This reply was cut after 8,000 bytes. '.repeat(4),
      truncated: true,
    },
  ];
};

const longSpecs = (): Spec[] =>
  Array.from({ length: 1000 }, (_, i) =>
    i === 0
      ? { kind: 'user', text: PROMPT }
      : i % 2 === 1
        ? { kind: 'agent', text: `Step ${i}: working through the report.` }
        : { kind: 'tool', tool: 'Bash', text: `dotnet test --filter Case${i}` },
  );

const specsOf = (run: RunDto): Spec[] | undefined => {
  switch (run.number) {
    case STOPPED_RUN:
      return defaultSpecs(true);
    case TRANSCRIPT_RICH_RUN:
      return richSpecs(run.startedAt ?? run.queuedAt);
    case TRANSCRIPT_LONG_RUN:
      return longSpecs();
    case TRANSCRIPT_FAILED_RUN:
      return [
        { kind: 'user', text: PROMPT },
        { kind: 'notice', text: 'API Error: 401 invalid credential' },
      ];
    case TRANSCRIPT_TIMED_OUT_RUN:
    case TRANSCRIPT_CANCELLED_RUN:
    case TRANSCRIPT_RESUMING_RUN:
      return defaultSpecs(false).slice(0, 3);
    case SCROLLBACK_PAUSED_RUN:
    case SCROLLBACK_ENDED_RUN:
    case NOTHING_ENDED_RUN:
    case NOTHING_PAUSED_RUN:
    case STOP_RUNNING_RUN:
    case STOP_IDLE_RUN:
    case STOP_DONE_RUN:
      return undefined;
    default:
      return defaultSpecs(false);
  }
};

/** Saved transcripts by run id. */
export const sessionTranscriptFixtures: Record<string, RunTranscriptEntryDto[]> = Object.fromEntries(
  sessionRunFixtures.flatMap((run) => {
    const specs = specsOf(run);
    return specs === undefined ? [] : [[run.id, entriesFrom(run.startedAt ?? run.queuedAt, specs)]];
  }),
);
