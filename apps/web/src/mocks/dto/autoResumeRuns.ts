import type { RunDto, RunEventDto } from '@agentdesk/contracts';
import { ids } from './ids';
import { runFixtures } from './runs';

// Runs of invoicer-api in the states of automatic resume after an unexpected pod end (spec 2026-11-20-pod-crash-auto-resume
// §3, §7). Built like lifecycleRuns.ts: seeded into the browser mock only (startMockWorker), so the unit tests' run
// lists and counts stay as they were; the mocked e2e specs open them by number.

/** Pod lost, automatic resume ran out after 5 tries: paused with the gave-up line. */
export const GAVE_UP_RUN = 99;
/** Pod lost, automatic resume gave up after 1 try ("1 time"). */
export const GAVE_UP_ONCE_RUN = 100;
/** The agent crashed (exit code 1) and automatic resume gave up after 5 tries. */
export const CRASHED_GAVE_UP_RUN = 101;
/** Between tries: the automatic resume could not start the pod, so the run is parked again and waits for the next try. */
export const AUTO_WAITING_RUN = 102;
/** The last automatic try could not start the pod: the Resume failed bar and the gave-up line, and the paused comment. */
export const AUTO_FAILED_GAVE_UP_RUN = 103;
/** Running again after an automatic resume: the Lifecycle list holds the automatic resume line. */
export const AUTO_RESUMED_RUNNING_RUN = 104;

const LAST_WORDS = ['$ claude', 'Exporting invoices to CSV...', 'Wrote 142 rows to export.csv'].join('\n');
const KILLED_LINE = 'The last session was killed (OOMKilled, exit 137, limit 3Gi). Resuming automatically, try 1 of 5.';
const POD_START = 'the pod could not start';

const base = (() => {
  const run = runFixtures.find((r) => r.number === 64);
  if (!run) throw new Error('fixture run 64 missing');
  return run;
})();

const HOUR_MS = 3_600_000;
const START = '2026-11-12T13:30:00.000Z';
const plus = (s: number) => new Date(Date.parse(START) + s * 1000).toISOString();

const make = (number: number, title: string, over: Partial<RunDto>): RunDto => ({
  ...base,
  id: ids.run(1, number),
  number,
  ticket: { ...base.ticket, ref: String(100 + number), number: 100 + number, title },
  pausedAt: null,
  sessionExpiresAt: null,
  sessionEndingAt: null,
  pauseReason: null,
  agentNote: null,
  ...over,
});

const pausedLost = (): Partial<RunDto> => ({
  status: 'paused',
  pausedAt: plus(2503),
  pauseReason: 'pod_lost',
  sessionExpiresAt: new Date(Date.now() + 6 * 24 * HOUR_MS).toISOString(),
});

export const autoResumeRunFixtures: RunDto[] = [
  make(GAVE_UP_RUN, 'Reconcile payments after a pod loss', pausedLost()),
  make(GAVE_UP_ONCE_RUN, 'Reconcile refunds after a pod loss', pausedLost()),
  make(CRASHED_GAVE_UP_RUN, 'Export totals after a crash', {
    status: 'paused',
    pausedAt: plus(2503),
    pauseReason: 'agent_crashed',
    sessionExpiresAt: new Date(Date.now() + 6 * 24 * HOUR_MS).toISOString(),
  }),
  make(AUTO_WAITING_RUN, 'Reconcile invoices between tries', pausedLost()),
  make(AUTO_FAILED_GAVE_UP_RUN, 'Reconcile credits, last try failed', pausedLost()),
  make(AUTO_RESUMED_RUNNING_RUN, 'Reconcile payouts, resumed by itself', { status: 'running' }),
];

/** Events as the worker writes them for each case; a run's seq starts at 1. */
function eventsOf(run: RunDto): RunEventDto[] {
  const out: RunEventDto[] = [];
  const push = (s: number, type: RunEventDto['type'], payload: Record<string, unknown>) =>
    out.push({ seq: out.length + 1, ts: plus(s), type, payload });
  const gaveUp = (s: number, tries: number) =>
    push(s, 'lifecycle', {
      kind: 'auto_resume_gave_up',
      tries,
      text: `Gave up resuming automatically after ${tries} tries.`,
    });
  const autoResume = (s: number, text = KILLED_LINE) =>
    push(s, 'lifecycle', { kind: 'auto_resume', try: 1, max: 5, text });
  const podLost = () => {
    push(2500, 'status', { status: 'running' });
    push(2501, 'scrollback', { text: LAST_WORDS });
    push(2502, 'lifecycle', { kind: 'pod_exit', code: 137 });
  };
  push(0, 'status', { status: 'queued' });
  push(10, 'status', { status: 'starting' });
  push(20, 'lifecycle', { text: 'Pod running' });
  push(21, 'status', { status: 'running' });
  push(30, 'lifecycle', { text: 'Claude Code started' });
  switch (run.number) {
    case GAVE_UP_RUN:
      podLost();
      gaveUp(2503, 5);
      push(2504, 'status', { status: 'paused' });
      break;
    case GAVE_UP_ONCE_RUN:
      podLost();
      gaveUp(2503, 1);
      push(2504, 'status', { status: 'paused' });
      break;
    case CRASHED_GAVE_UP_RUN:
      push(2500, 'lifecycle', { kind: 'session_ended', reason: 'agent_exit', code: 1, text: 'Session ended' });
      push(2501, 'scrollback', { text: LAST_WORDS });
      gaveUp(2502, 5);
      push(2503, 'status', { status: 'paused' });
      break;
    case AUTO_WAITING_RUN:
    case AUTO_FAILED_GAVE_UP_RUN:
      podLost();
      autoResume(2503);
      push(2504, 'status', { status: 'queued' });
      push(2510, 'status', { status: 'starting' });
      push(2520, 'status', { status: 'paused' });
      push(2521, 'lifecycle', {
        kind: 'resume_failed',
        reason: POD_START,
        text: `The resume could not run: ${POD_START}.`,
      });
      if (run.number === AUTO_FAILED_GAVE_UP_RUN) {
        gaveUp(2522, 5);
        push(2523, 'comment', { kind: 'paused', commentId: 'c-paused' });
      }
      break;
    case AUTO_RESUMED_RUNNING_RUN:
      podLost();
      autoResume(2503);
      push(2504, 'status', { status: 'queued' });
      push(2510, 'status', { status: 'starting' });
      push(2520, 'lifecycle', { text: 'Pod running' });
      push(2521, 'lifecycle', { text: 'Session resumed' });
      push(2522, 'status', { status: 'running' });
      break;
  }
  return out;
}

export const autoResumeEventFixtures: Record<string, RunEventDto[]> = Object.fromEntries(
  autoResumeRunFixtures.map((run) => [run.id, eventsOf(run)]),
);
