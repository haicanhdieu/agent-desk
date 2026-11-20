import {
  hasKeptSession,
  type PauseReason,
  type ProjectDto,
  type RunDto,
  type RunEventDto,
  type RunStatus,
} from '@agentdesk/contracts';
import { z } from 'zod';
import type { ChainStep, ConnectionState, TermLine } from '@/components';
import { statusTokens } from '@/ds';
import type { RunDetailData, RunDetailKey } from '@/mocks/types';
import { clockElapsed, formatLimit } from '../duration';
import { relativeTime, timeLeft } from '../relativeTime';
import { dateTime, duration, formatDuration, idleEndsAt, idleSlotNote, isFinal, safeHref, toRunSummary } from './map';
import type { CachedRunDetail, RunCore } from './queries';
import type { TerminalState } from './useTerminal';

// Run detail view model (spec §3.2): one RunDetailData per run, for the eight RunDetail boards.

const pad = (n: number) => String(n).padStart(2, '0');

/** Local "HH:mm:ss". */
const clockSeconds = (iso: string): string => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/** "7:40", "1:05:03" or "1d 01:01:01", the top bar's running clock. */
const clock = clockElapsed;

/** The board each status is drawn on; a running (or idle) run whose terminal lost its socket shows RunReconnect. */
export function runDetailKey(status: RunStatus, terminalState?: 'reconnect'): RunDetailKey {
  switch (status) {
    case 'queued':
    case 'starting':
      return 'RunStarting';
    case 'running':
    case 'idle':
    case 'done':
      if (terminalState === 'reconnect') return 'RunReconnect';
      return status === 'running' ? 'RunRunning' : status === 'idle' ? 'RunIdle' : 'RunDone';
    case 'succeeded':
      return 'RunSucceeded';
    case 'failed':
      return 'RunFailed';
    case 'timed_out':
      return 'RunTimedOut';
    case 'cancelled':
      return 'RunCancelled';
    case 'paused':
      return 'RunPaused';
    case 'expired':
      return 'RunExpired';
  }
}

/**
 * What the terminal area of a run shows: the live terminal; "Pausing" while the session is ending (no socket);
 * the saved scrollback of a paused run; a Resume in progress (a queued or starting run that ran before);
 * a new run starting; a final run's scrollback; or the expired note.
 */
export type TerminalArea = 'live' | 'pausing' | 'paused' | 'resuming' | 'starting' | 'ended' | 'expired';

export function terminalArea(
  run: Pick<RunDto, 'status' | 'sessionEndingAt'>,
  events: RunEventDto[] = [],
): TerminalArea {
  switch (run.status) {
    case 'running':
    case 'idle':
    case 'done':
      return run.sessionEndingAt === null ? 'live' : 'pausing';
    case 'paused':
      return 'paused';
    case 'queued':
    case 'starting':
      return parkedBefore(events) ? 'resuming' : 'starting';
    case 'expired':
      return 'expired';
    case 'succeeded':
    case 'failed':
    case 'timed_out':
    case 'cancelled':
      return 'ended';
  }
}

/** Why a run is paused, as the end of a sentence about when it paused ("Paused 2 min ago, <this>"). */
export function pauseReasonText(reason: PauseReason): string {
  switch (reason) {
    case 'idle_timeout':
      return 'after 30 min with nobody attached';
    case 'pod_lost':
      return 'the pod stopped unexpectedly (out of memory / evicted)';
    case 'agent_crashed':
      return 'the agent crashed';
    case 'stopped':
      return 'stopped by you';
  }
}

// Event payloads are untrusted: only these shapes are read, anything else is skipped.
const TextPayload = z.object({ text: z.string() });
const StatusPayload = z.object({ status: z.string() });
const SessionEndedKind = z.object({ kind: z.literal('session_ended') });
/**
 * The agent's exit code from the runner's end line. The agent shares the container and could print a forged end line,
 * so only an `agent_exit` end with a plausible exit code (0 to 255) is read, and the number is shown as information.
 */
const AgentExitPayload = z.object({
  kind: z.literal('session_ended'),
  reason: z.literal('agent_exit'),
  code: z.number().int().min(0).max(255),
});
const PodExitKind = z.object({ kind: z.literal('pod_exit') });
/**
 * The exit code the cluster reported for a pod that was lost (written by the worker, not by anything in the pod);
 * null when the pod vanished and there was no code.
 */
const PodExitPayload = z.object({ kind: z.literal('pod_exit'), code: z.number().int().min(0).max(255).nullable() });
const ResumeFailedPayload = z.object({ kind: z.literal('resume_failed'), reason: z.string().optional() });
/** The worker's note that automatic resume ran out of tries (written by the worker, not by anything in the pod). */
const AutoResumeGaveUpPayload = z.object({
  kind: z.literal('auto_resume_gave_up'),
  tries: z.number().int().min(1).max(10),
});

const textOf = (e: RunEventDto): string | undefined => TextPayload.safeParse(e.payload).data?.text;

// Escape sequences, stripped before the text is split into lines:
// - string sequences (OSC, DCS, SOS, PM, APC; 7-bit `ESC ] P X ^ _` or 8-bit) with their payload, up to BEL or ST;
// - CSI (7-bit `ESC [` or 8-bit), then any other two-byte `ESC x`.
const ESCAPES =
  // eslint-disable-next-line no-control-regex -- matching control characters is the point.
  /(?:\u001b[\]PX^_]|[\u0090\u0098\u009d\u009e\u009f])[^\u0007\u001b\u009c]*(?:\u0007|\u001b\\|\u009c)?|(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]|\u001b[ -~]?/g;
// Remaining C0 controls (tab and newline stay), DEL, C1 controls and the bidi embeddings, overrides and isolates.
// eslint-disable-next-line no-control-regex -- matching control characters is the point.
const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

/** At most this many scrollback lines (the newest) are rendered. */
export const SCROLLBACK_MAX_LINES = 5000;

/**
 * Untrusted terminal text as plain lines for the static terminal (rendered as text, never as markup), the newest
 * SCROLLBACK_MAX_LINES only. Escape sequences and controls are dropped.
 */
export function plainLines(text: string): TermLine[] {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(ESCAPES, '')
    .split('\n')
    .slice(-SCROLLBACK_MAX_LINES)
    .map((line) => {
      const plain = plainText(line);
      return plain === '' ? [] : [{ text: plain }];
    });
}

/** Untrusted text without C0/C1 controls (tab and newline kept) and bidi embeddings, overrides and isolates. */
export function plainText(text: string): string {
  return text.replace(CONTROLS, '');
}

/**
 * The stored final scrollback as plain text lines for the static terminal (rendered as text, never as markup), the
 * newest SCROLLBACK_MAX_LINES only. Escape sequences and controls are dropped; the live terminal (Task 14) renders
 * them.
 */
export function scrollbackLines(events: RunEventDto[]): TermLine[] | undefined {
  const event = events.filter((e) => e.type === 'scrollback').at(-1);
  const text = event && textOf(event);
  return text === undefined ? undefined : plainLines(text);
}

/**
 * The stored final scrollback as terminal input for the read-only live terminal: escape sequences kept (xterm
 * renders them), line ends as CRLF (a lone CR stays a carriage return), the newest SCROLLBACK_MAX_LINES only.
 * Undefined when no scrollback was stored.
 */
export function scrollbackText(events: RunEventDto[]): string | undefined {
  const event = events.filter((e) => e.type === 'scrollback').at(-1);
  const text = event && textOf(event);
  if (text === undefined) return undefined;
  return text.split(/\r?\n/).slice(-SCROLLBACK_MAX_LINES).join('\r\n');
}

const statusOf = (e: RunEventDto | undefined): string | undefined =>
  e?.type === 'status' ? StatusPayload.safeParse(e.payload).data?.status : undefined;

/**
 * The events of the current start: a resumed run's log still holds every step of its earlier starts, which must not
 * count. Scanning back from the newest, a `queued` status opens the current start; a parked status (`paused`, or a
 * kept `succeeded`) reached first means the resume has not logged anything yet. `resumed` says the run had already
 * run, so its `started_at` belongs to an earlier start.
 */
function currentStart(events: RunEventDto[]): { events: RunEventDto[]; resumed: boolean } {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const status = statusOf(events[i]);
    if (status === 'queued') {
      const resumed = events.slice(0, i).some((e) => statusOf(e) === 'running');
      return { events: events.slice(i), resumed };
    }
    if (status === 'paused' || status === 'succeeded') return { events: [], resumed: true };
  }
  return { events, resumed: false };
}

/** When each startup step happened, from the status and lifecycle events of the current start (and the run itself). */
function startupMarks(run: RunCore, all: RunEventDto[]) {
  const { events, resumed } = currentStart(all);
  const statusAt = (s: RunStatus) => events.find((e) => statusOf(e) === s)?.ts;
  const lifecycleAt = (re: RegExp) => events.find((e) => e.type === 'lifecycle' && re.test(textOf(e) ?? ''))?.ts;
  return {
    queued: statusAt('queued') ?? run.queuedAt,
    slot: statusAt('starting') ?? (resumed ? undefined : (run.startedAt ?? undefined)),
    pod: lifecycleAt(/^pod running/i),
    agent: lifecycleAt(/^(session started|claude code started)/i),
    attached: statusAt('running'),
  };
}

function startup(run: RunCore, events: RunEventDto[]): NonNullable<RunDetailData['startup']> {
  const m = startupMarks(run, events);
  const steps: { label: string; at: string | undefined; detail?: string }[] = [
    {
      label: 'Queued',
      at: m.queued,
      detail:
        m.slot === undefined
          ? 'Waiting for a slot'
          : `Waited ${formatDuration(Date.parse(m.slot) - Date.parse(m.queued))} for a free slot`,
    },
    { label: 'Slot claimed, token and secret created', at: m.slot },
    { label: 'Pod running', at: m.pod },
    { label: 'Claude Code started', at: m.agent },
    { label: 'Terminal attaches', at: m.attached },
  ];
  // Every step up to the last one reached is done; the next is in progress (the queued step until a slot is free).
  const reached = steps.reduce((last, s, i) => (i > 0 && s.at !== undefined ? i : last), 0);
  return steps.map((s, i) => {
    const state =
      m.slot === undefined
        ? i === 0
          ? 'active'
          : 'pending'
        : i <= reached
          ? 'done'
          : i === reached + 1
            ? 'active'
            : 'pending';
    return {
      label: s.label,
      ...(s.detail !== undefined && { detail: s.detail }),
      ...(state !== 'pending' && s.at !== undefined && (state === 'done' || i === 0) && { at: clockSeconds(s.at) }),
      state,
    };
  });
}

function chainNote(r: RunCore, now: Date): string {
  const label = statusTokens[r.status].label;
  const took = isFinal(r.status) ? duration(r, now) : undefined;
  return took === undefined ? label : `${label} in ${took}`;
}

function chain(run: RunCore, ticketRuns: RunCore[], runsHref: string, now: Date): ChainStep[] {
  const runs = ticketRuns.some((r) => r.number === run.number)
    ? ticketRuns.map((r) => (r.number === run.number ? run : r))
    : [...ticketRuns, run];
  return [...runs]
    .sort((a, b) => a.number - b.number)
    .map((r) => {
      const here = r.number === run.number;
      return {
        runId: r.number,
        command: `/${r.command}`,
        ticket: { kind: r.ticket.kind, number: r.ticket.number },
        note: here ? 'This run' : chainNote(r, now),
        status: r.status,
        ...(here ? { here: true } : { href: `${runsHref}/${r.number}` }),
      };
    });
}

export interface RunDetailLinks {
  /** The project's runs list; a run is `${runs}/<number>`. */
  runs: string;
  /** Agent & settings (the time limit). */
  agent: string;
  /** Desk workspace setup, for a run that failed in setup. */
  setup?: string;
}

type EndNote = NonNullable<RunDetailData['endNote']>;

/** A run that failed before the agent started, in the setup script. */
const failedInSetup = (run: RunCore): boolean => run.status === 'failed' && run.failureStage === 'setup';

/**
 * When the run's work began. `started_at` is set once the session starts, so a run that failed in setup has none:
 * the slot claim (the `starting` status) stands in, then the queue time.
 */
function workStart(run: RunCore, events: RunEventDto[]): string {
  if (run.startedAt !== null) return run.startedAt;
  return (run.failureStage === 'setup' ? startupMarks(run, events).slot : undefined) ?? run.queuedAt;
}

function setupEndNote(run: RunCore, took: string, links: RunDetailLinks): EndNote {
  const timedOut = /timed out/i.test(run.failureReason ?? '');
  const cause = timedOut
    ? 'the setup script timed out'
    : run.exitCode === null
      ? 'the setup script failed'
      : `the setup script exited with code ${run.exitCode}`;
  const version = run.setupScriptVersion === null ? 'The setup script' : `Setup version ${run.setupScriptVersion}`;
  const href = safeHref(run.ticket.url);
  const ticket = `${run.ticket.kind === 'pr' ? 'PR' : 'issue'} #${run.ticket.number}`;
  return {
    title: `Setup failed after ${took}: ${cause}`,
    body: `The agent did not start. ${version} failed. Fix the script and test it, then comment the command again on the ${run.ticket.kind === 'pr' ? 'PR' : 'issue'}.`,
    actions: [
      ...(links.setup ? [{ label: 'Open workspace setup', href: links.setup, icon: 'terminal' as const }] : []),
      ...(href ? [{ label: `Open ${ticket}`, href, icon: 'external' as const }] : []),
    ],
  };
}

/** A Finish ended a parked run: it paused before its last `succeeded` status, and no session is kept. */
function finishedAfterPause(run: RunCore, events: RunEventDto[]): boolean {
  if (run.sessionExpiresAt !== null) return false;
  const statuses = events.flatMap((e) => {
    const status = e.type === 'status' ? StatusPayload.safeParse(e.payload).data?.status : undefined;
    return status === undefined ? [] : [status];
  });
  const last = statuses.lastIndexOf('succeeded');
  return last > 0 && statuses.slice(0, last).includes('paused');
}

function endNote(
  run: RunCore,
  ticketRuns: RunCore[],
  links: RunDetailLinks,
  now: Date,
  events: RunEventDto[],
): EndNote | undefined {
  // An expired run says so in its session lines, not in an end note.
  if (!isFinal(run.status) || run.status === 'expired') return undefined;
  const took =
    (failedInSetup(run) && run.finishedAt
      ? formatDuration(Date.parse(run.finishedAt) - Date.parse(workStart(run, events)))
      : duration(run, now)) ?? formatDuration(0);
  const endedAt = run.finishedAt ? clockSeconds(run.finishedAt) : undefined;
  if (failedInSetup(run)) return setupEndNote(run, took, links);
  switch (run.status) {
    case 'succeeded': {
      const next = ticketRuns.filter((r) => r.number > run.number).sort((a, b) => a.number - b.number)[0];
      return {
        title: `Succeeded in ${took}.`,
        body: finishedAfterPause(run, events)
          ? 'Finished. The session was deleted and cannot be resumed.'
          : endedAt
            ? `Finished at ${endedAt}.`
            : '',
        actions: next
          ? [{ label: `Go to run ${next.number}`, href: `${links.runs}/${next.number}`, icon: 'chevron-right' }]
          : [],
      };
    }
    case 'failed': {
      const href = safeHref(run.ticket.url);
      const ticket = `${run.ticket.kind === 'pr' ? 'PR' : 'issue'} #${run.ticket.number}`;
      return {
        title: run.failureReason ? `Failed after ${took}: ${run.failureReason}` : `Failed after ${took}`,
        body: run.exitCode === null ? '' : `Claude Code exited with code ${run.exitCode}.`,
        actions: href ? [{ label: `Open ${ticket}`, href, icon: 'external' }] : [],
      };
    }
    case 'timed_out':
      return {
        title: `Timed out at the ${formatLimit(run.timeoutSeconds)} limit`,
        body: run.failureReason ?? '',
        actions: [{ label: 'Change time limit', href: links.agent, icon: 'clock' }],
      };
    default:
      return { title: endedAt ? `Cancelled at ${endedAt}.` : 'Cancelled.', body: '', actions: [] };
  }
}

/** The run event stream's state as the terminal bar's indicator (a run that is not final). */
export function streamConnection(state: ConnectionState): RunDetailData['connection'] {
  switch (state) {
    case 'live':
      return { state, label: 'Live' };
    case 'reconnecting':
      return { state, label: 'Reconnecting…' };
    case 'ended':
      return { state, label: 'Ended' };
    case 'none':
      return { state, label: 'No terminal yet' };
  }
}

/**
 * The indicator for an active run's terminal: the event stream's state while the terminal socket is open, otherwise
 * the socket's (connecting, retrying, given up, or no access).
 */
export function terminalConnection(terminal: TerminalState, stream: ConnectionState): RunDetailData['connection'] {
  switch (terminal) {
    case 'open':
      return streamConnection(stream);
    case 'connecting':
      return { state: 'reconnecting', label: 'Connecting…' };
    case 'retrying':
      return { state: 'reconnecting', label: 'Reconnecting…' };
    case 'gave_up':
      return { state: 'reconnecting', label: 'Disconnected' };
    case 'forbidden':
      return { state: 'none', label: 'No access' };
    case 'ended':
      return { state: 'ended', label: 'Session ended' };
    case 'inactive':
      return { state: 'none', label: 'Closed for inactivity' };
  }
}

function connection(run: RunCore, lines: TermLine[] | undefined): RunDetailData['connection'] {
  if (terminalArea(run) === 'pausing') return { state: 'none', label: 'Ending…' };
  if (run.status === 'paused') {
    return {
      state: 'ended',
      label: lines === undefined ? 'Paused' : `Paused, read-only, ${lines.length.toLocaleString('en-US')} lines`,
    };
  }
  if (!isFinal(run.status)) return { state: 'none', label: 'No terminal yet' };
  if (lines === undefined) return { state: 'ended', label: 'Ended' };
  return { state: 'ended', label: `Ended, read-only, ${lines.length.toLocaleString('en-US')} lines` };
}

/** The exit code in the newest `session_ended` event of the log; undefined if there is none or it is malformed. */
function agentExitCode(events: RunEventDto[]): number | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e?.type !== 'lifecycle' || !SessionEndedKind.safeParse(e.payload).success) continue;
    return AgentExitPayload.safeParse(e.payload).data?.code;
  }
  return undefined;
}

/** The exit code in the newest `pod_exit` event of the log; undefined if there is none or it is malformed. */
function podExitCode(events: RunEventDto[]): number | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e?.type !== 'lifecycle' || !PodExitKind.safeParse(e.payload).success) continue;
    return PodExitPayload.safeParse(e.payload).data?.code ?? undefined;
  }
  return undefined;
}

/** SIGKILL: what the kernel's out-of-memory kill leaves as a container's exit code. */
const SIGKILL_EXIT_CODE = 137;

/** The paused headline of a pod that was lost: what happened, and only claims a cause the exit code supports. */
function lostPodHeadline(code: number | undefined): string {
  if (code === undefined) return 'Paused: the pod stopped unexpectedly';
  if (code === SIGKILL_EXIT_CODE) return `Paused: the pod was killed, most likely out of memory (exit code ${code})`;
  return `Paused: the pod stopped unexpectedly (exit code ${code})`;
}

const DAY_MS = 86_400_000;

/**
 * Whether the run was parked (`paused`, or a kept `succeeded`) and has not started a turn since: scanning the status
 * events back from the newest, a parked status comes before any `running`.
 */
function parkedBefore(events: RunEventDto[]): boolean {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    const status = e?.type === 'status' ? StatusPayload.safeParse(e.payload).data?.status : undefined;
    if (status === 'running') return false;
    if (status === 'paused' || status === 'succeeded') return true;
  }
  return false;
}

/** The banner of a run that was resumed and has not started a new turn (the agent's note is untrusted text). */
function resumedNote(run: RunCore, events: RunEventDto[]): string | undefined {
  if ((run.status !== 'idle' && run.status !== 'done') || !parkedBefore(events)) return undefined;
  const said = run.agentNote ? `The agent ${run.status === 'done' ? 'said' : 'asked'}: ${run.agentNote}. ` : '';
  return `Resumed. ${said}Background tasks and sub-agents that were running when it paused were stopped.`;
}

const isGaveUp = (e: RunEventDto): boolean =>
  e.type === 'lifecycle' && AutoResumeGaveUpPayload.safeParse(e.payload).success;

/**
 * The line saying automatic resume ran out of tries: the `auto_resume_gave_up` event, found scanning back from the
 * newest event before any status other than `paused` (a later status means the run moved on).
 */
function autoResumeGaveUpLine(events: RunEventDto[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e === undefined) continue;
    if (e.type === 'status') {
      if (StatusPayload.safeParse(e.payload).data?.status !== 'paused') return undefined;
      continue;
    }
    const gaveUp = e.type === 'lifecycle' ? AutoResumeGaveUpPayload.safeParse(e.payload) : undefined;
    if (gaveUp?.success) {
      const { tries } = gaveUp.data;
      return `Tried to resume automatically ${tries} ${tries === 1 ? 'time' : 'times'}.`;
    }
  }
  return undefined;
}

/** The reason of a resume that fell back, when it is the latest event of the run apart from comments (the run is parked again). */
function resumeFailure(events: RunEventDto[]): string | undefined {
  // The park appends the failure and then posts the ticket comment (a `comment` event), so the newest event that is
  // not a comment decides; a later status or lifecycle event means the run moved on.
  const last = events.filter((e) => e.type !== 'comment' && !isGaveUp(e)).at(-1);
  const failed = last?.type === 'lifecycle' ? ResumeFailedPayload.safeParse(last.payload) : undefined;
  if (!failed?.success) return undefined;
  return failed.data.reason ? `Resume failed: ${failed.data.reason}` : 'Resume failed';
}

/** The kept (paused, or succeeded with a session that is still kept) or expired session of a run (ADR 0022). */
function sessionOf(run: RunCore, events: RunEventDto[], now: Date): RunDetailData['session'] {
  if (run.status === 'expired') {
    const days =
      run.pausedAt !== null && run.finishedAt !== null
        ? Math.round((Date.parse(run.finishedAt) - Date.parse(run.pausedAt)) / DAY_MS)
        : 0;
    return {
      state: 'expired',
      headline:
        days >= 1
          ? `Nobody resumed this run within ${days} ${days === 1 ? 'day' : 'days'}. The saved session was deleted.`
          : 'Nobody resumed this run in time. The saved session was deleted.',
    };
  }
  const failure = resumeFailure(events);
  const failed = failure === undefined ? {} : { resumeFailure: failure };
  if (run.status === 'paused') {
    // A run paused before the reason was recorded was paused by the idle timer.
    const reason = run.pauseReason ?? 'idle_timeout';
    const crashed = reason === 'agent_crashed';
    const lost = reason === 'pod_lost';
    const left = run.sessionExpiresAt === null ? undefined : timeLeft(run.sessionExpiresAt, now);
    const code = crashed ? agentExitCode(events) : undefined;
    // A crashed or lost run's headline says what happened; the keep time moves to the line below it.
    const stopped = reason === 'stopped';
    const resumable = (crashed || lost) && left !== undefined ? `Can be resumed for ${left}.` : undefined;
    const when =
      run.pausedAt === null ? undefined : `Paused ${relativeTime(run.pausedAt, now)}, ${pauseReasonText(reason)}`;
    const stoppedDetail = run.pausedAt === null ? undefined : `Stopped by you ${relativeTime(run.pausedAt, now)}.`;
    const detail = stopped
      ? stoppedDetail
      : when === undefined
        ? resumable
        : resumable === undefined
          ? when
          : `${when}. ${resumable}`;
    const headline = stopped
      ? left === undefined
        ? undefined
        : `Stopped: can be resumed for ${left}.`
      : crashed
        ? `Paused: agent crashed${code === undefined ? '' : ` (exit code ${code})`}`
        : lost
          ? lostPodHeadline(podExitCode(events))
          : left === undefined
            ? undefined
            : `Paused: waiting for your answer. Can be resumed for ${left}.`;
    const gaveUp = crashed || lost ? autoResumeGaveUpLine(events) : undefined;
    return {
      state: 'paused',
      ...(stopped && { stopped: true as const }),
      ...(headline !== undefined && { headline }),
      ...(detail !== undefined && { detail }),
      ...(gaveUp !== undefined && { autoResumeGaveUp: gaveUp }),
      ...failed,
    };
  }
  if (run.status === 'succeeded' && run.sessionExpiresAt !== null && hasKeptSession(run, now)) {
    return { state: 'kept', detail: `Session kept until ${dateTime(run.sessionExpiresAt)}`, ...failed };
  }
  // A Resume queued behind the ending found nothing kept: the run is succeeded, and the person sees why.
  if (run.status === 'succeeded' && failure !== undefined) return { state: 'none', ...failed };
  return undefined;
}

/**
 * The run detail screen's data. `ticketRuns` are the runs on the same ticket (the chain, oldest first); `events` the
 * stored run log. Times are local; the top bar's elapsed is "m:ss" (start, or queue time, to now or to the end).
 */
export function toRunDetail(
  run: CachedRunDetail,
  events: RunEventDto[],
  project: ProjectDto,
  ticketRuns: RunCore[],
  now: Date,
  links: RunDetailLinks,
): RunDetailData {
  const final = isFinal(run.status);
  const startIso = workStart(run, events);
  // A paused run's clock stopped when its pod did.
  const stoppedAt = final ? run.finishedAt : run.status === 'paused' ? run.pausedAt : null;
  const endMs = stoppedAt ? Date.parse(stoppedAt) : now.getTime();
  const elapsedMs = endMs - Date.parse(startIso);
  const lines = final || run.status === 'paused' ? scrollbackLines(events) : undefined;
  const lifecycle = events.flatMap((e) => {
    const text = e.type === 'lifecycle' ? textOf(e) : undefined;
    return text === undefined ? [] : [{ at: clockSeconds(e.ts), text }];
  });
  const timed = run.startedAt !== null && (run.status === 'running' || run.status === 'timed_out');
  const end = final && run.finishedAt ? clockSeconds(run.finishedAt) : undefined;
  const note = endNote(run, ticketRuns, links, now, events);
  const session = sessionOf(run, events, now);
  const resumed = resumedNote(run, events);
  return {
    run: toRunSummary(run, now),
    elapsed: clock(elapsedMs),
    rule: `/${run.command}`,
    finalPrompt: run.finalPrompt,
    pausedKeep: timeLeft(new Date(now.getTime() + run.pausedKeepSeconds * 1000).toISOString(), now),
    triggerNote: run.triggerSource === 'manual' ? '' : 'comment',
    startedAt: clockSeconds(startIso),
    ...(end !== undefined && {
      endedAt: failedInSetup(run)
        ? `${end}, setup failed`
        : run.status === 'failed' && run.exitCode !== null
          ? `${end}, exit ${run.exitCode}`
          : end,
    }),
    ...(run.failureStage !== null && run.status === 'failed' && { failureStage: run.failureStage }),
    ...(run.setupScriptVersion !== null && {
      setup: {
        version: run.setupScriptVersion,
        ...(failedInSetup(run) && { note: run.exitCode === null ? 'failed' : `failed, exit ${run.exitCode}` }),
      },
    }),
    chain: chain(run, ticketRuns, links.runs, now),
    ...(lifecycle.length > 0 && { lifecycle }),
    ...((run.status === 'queued' || run.status === 'starting') && { startup: startup(run, events) }),
    ...(run.status === 'idle' &&
      run.idleSince && {
        idle: {
          since: clockSeconds(run.idleSince),
          endsAt: idleEndsAt(run.idleSince, run.idleEndSeconds),
          slotNote: idleSlotNote(project.maxConcurrentRuns, undefined, run.idleEndSeconds),
        },
      }),
    ...(timed && {
      time: {
        elapsed: clock(elapsedMs),
        limit: formatLimit(run.timeoutSeconds),
        percent: Math.min(100, Math.round((elapsedMs / (run.timeoutSeconds * 1000)) * 100)),
      },
    }),
    ...((run.status === 'idle' || run.status === 'done' || run.status === 'paused' || session?.state === 'kept') &&
      run.agentNote !== null && { agentNote: run.agentNote }),
    ...(session && { session }),
    ...(terminalArea(run) === 'pausing' && { pausing: true as const }),
    ...(terminalArea(run, events) === 'resuming' && { resuming: true as const }),
    ...(resumed !== undefined && { resumed }),
    connection: connection(run, lines),
    ...(note && { endNote: note }),
  };
}
