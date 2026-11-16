import type { RunDto, RunEventDto } from '@agentdesk/contracts';
import { ids } from './ids';
import { runFixtures } from './runs';

// Runs of invoicer-api in the states of the run terminal lifecycle redesign (spec 2026-11-16 §3, §5, §7). They are
// seeded into the browser mock only (startMockWorker), so the unit tests' run lists and counts stay as they were; the
// mocked e2e specs open them by number.

/** The session is ending (idle timer or Finish): the page says so and greys the last scrollback. */
export const ENDING_RUN = 67;
/** The agent exited non-zero on its own: paused with the reason agent_crashed and the exit code. */
export const CRASHED_RUN = 68;
/** Finished, then a Resume sent while the session was ending found nothing kept: succeeded, with the failure shown. */
export const RESUME_FAILED_RUN = 69;
/** Paused, resumed, and the new session is up with no new turn yet: the "Resumed. The agent asked: ..." banner. */
export const RESUMED_RUN = 70;

const LAST_WORDS = ['$ claude', 'Exporting invoices to CSV...', 'Wrote 142 rows to export.csv'].join('\n');

const base = (() => {
  const run = runFixtures.find((r) => r.number === 64);
  if (!run) throw new Error('fixture run 64 missing');
  return run;
})();

const HOUR_MS = 3_600_000;
const START = '2026-11-12T13:30:00.000Z';
const plus = (s: number) => new Date(Date.parse(START) + s * 1000).toISOString();

const live = (number: number, title: string, over: Partial<RunDto>): RunDto => ({
  ...base,
  id: ids.run(1, number),
  number,
  ticket: { ...base.ticket, ref: String(100 + number), number: 100 + number, title },
  pausedAt: null,
  sessionExpiresAt: null,
  sessionEndingAt: null,
  pauseReason: null,
  ...over,
});

export const lifecycleRunFixtures: RunDto[] = [
  live(ENDING_RUN, 'Sort the export by date', {
    status: 'idle',
    idleSince: plus(1000),
    sessionEndingAt: plus(2000),
    agentNote: 'Should the export be sorted newest first?',
  }),
  live(CRASHED_RUN, 'Export totals per customer', {
    status: 'paused',
    pausedAt: plus(1502),
    pauseReason: 'agent_crashed',
    sessionExpiresAt: new Date(Date.now() + 6 * 24 * HOUR_MS).toISOString(),
    agentNote: null,
  }),
  live(RESUME_FAILED_RUN, 'Add a CSV header row', {
    status: 'succeeded',
    finishedAt: plus(1801),
    exitCode: 0,
    agentNote: null,
  }),
  live(RESUMED_RUN, 'Quote fields with commas', {
    status: 'idle',
    idleSince: plus(3021),
    agentNote: 'Should quotes inside a field be doubled?',
  }),
];

/** Events as the worker writes them for each case; a run's seq starts at 1. */
function eventsOf(run: RunDto): RunEventDto[] {
  const out: RunEventDto[] = [];
  const push = (s: number, type: RunEventDto['type'], payload: Record<string, unknown>) =>
    out.push({ seq: out.length + 1, ts: plus(s), type, payload });
  push(0, 'status', { status: 'queued' });
  push(10, 'status', { status: 'starting' });
  push(20, 'lifecycle', { text: 'Pod running' });
  push(21, 'status', { status: 'running' });
  push(30, 'lifecycle', { text: 'Claude Code started' });
  switch (run.number) {
    case ENDING_RUN:
      push(1000, 'status', { status: 'idle' });
      push(2000, 'scrollback', { text: LAST_WORDS });
      break;
    case CRASHED_RUN:
      push(1500, 'lifecycle', { kind: 'session_ended', reason: 'agent_exit', code: 3, text: 'Session ended' });
      push(1501, 'scrollback', { text: LAST_WORDS });
      push(1502, 'status', { status: 'paused' });
      break;
    case RESUME_FAILED_RUN:
      push(1700, 'status', { status: 'idle' });
      push(1800, 'scrollback', { text: LAST_WORDS });
      push(1801, 'status', { status: 'succeeded', exitCode: 0, failureReason: null });
      push(1802, 'lifecycle', {
        kind: 'resume_failed',
        reason: 'nothing was kept to resume from',
        text: 'The resume could not run: nothing was kept to resume from.',
      });
      break;
    case RESUMED_RUN:
      push(1000, 'status', { status: 'idle' });
      push(1500, 'status', { status: 'paused' });
      push(3000, 'lifecycle', { text: 'Resume requested by alice' });
      push(3001, 'status', { status: 'queued' });
      push(3010, 'status', { status: 'starting' });
      push(3020, 'lifecycle', { text: 'Session resumed' });
      push(3021, 'status', { status: 'idle' });
      break;
  }
  return out;
}

export const lifecycleEventFixtures: Record<string, RunEventDto[]> = Object.fromEntries(
  lifecycleRunFixtures.map((run) => [run.id, eventsOf(run)]),
);
