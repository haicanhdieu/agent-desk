import type { ProjectDto, RunDto, RunEventDto, RunStatus } from '@agentdesk/contracts';
import { z } from 'zod';
import type { ChainStep, ConnectionState, TermLine } from '@/components';
import { statusTokens } from '@/ds';
import type { RunDetailData, RunDetailKey } from '@/mocks/types';
import { duration, formatDuration, idleEndsAt, idleSlotNote, isFinal, safeHref, toRunSummary } from './map';
import type { CachedRun } from './queries';
import type { TerminalState } from './useTerminal';

// Run detail view model (spec §3.2): one RunDetailData per run, for the eight RunDetail boards.

const pad = (n: number) => String(n).padStart(2, '0');

/** Local "HH:mm:ss". */
const clockSeconds = (iso: string): string => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/** "7:40", the top bar's running clock. */
const clock = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${pad(total % 60)}`;
};

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
  }
}

// Event payloads are untrusted: only these shapes are read, anything else is skipped.
const TextPayload = z.object({ text: z.string() });
const StatusPayload = z.object({ status: z.string() });

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
      const plain = line.replace(CONTROLS, '');
      return plain === '' ? [] : [{ text: plain }];
    });
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

/** When each startup step happened, from the status and lifecycle events (and the run itself). */
function startupMarks(run: RunDto, events: RunEventDto[]) {
  const statusAt = (s: RunStatus) =>
    events.find((e) => e.type === 'status' && StatusPayload.safeParse(e.payload).data?.status === s)?.ts;
  const lifecycleAt = (re: RegExp) => events.find((e) => e.type === 'lifecycle' && re.test(textOf(e) ?? ''))?.ts;
  return {
    queued: statusAt('queued') ?? run.queuedAt,
    slot: statusAt('starting') ?? run.startedAt ?? undefined,
    pod: lifecycleAt(/^pod running/i),
    agent: lifecycleAt(/^(session started|claude code started)/i),
    attached: statusAt('running'),
  };
}

function startup(run: RunDto, events: RunEventDto[]): NonNullable<RunDetailData['startup']> {
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

function chainNote(r: RunDto, now: Date): string {
  const label = statusTokens[r.status].label;
  const took = isFinal(r.status) ? duration(r, now) : undefined;
  return took === undefined ? label : `${label} in ${took}`;
}

function chain(run: RunDto, ticketRuns: RunDto[], runsHref: string, now: Date): ChainStep[] {
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
const failedInSetup = (run: RunDto): boolean => run.status === 'failed' && run.failureStage === 'setup';

/**
 * When the run's work began. `started_at` is set once the session starts, so a run that failed in setup has none:
 * the slot claim (the `starting` status) stands in, then the queue time.
 */
function workStart(run: RunDto, events: RunEventDto[]): string {
  if (run.startedAt !== null) return run.startedAt;
  return (run.failureStage === 'setup' ? startupMarks(run, events).slot : undefined) ?? run.queuedAt;
}

function setupEndNote(run: RunDto, took: string, links: RunDetailLinks): EndNote {
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

function endNote(
  run: RunDto,
  ticketRuns: RunDto[],
  links: RunDetailLinks,
  now: Date,
  events: RunEventDto[],
): EndNote | undefined {
  if (!isFinal(run.status)) return undefined;
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
        body: endedAt ? `Finished at ${endedAt}.` : '',
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
        title: `Timed out at the ${Math.round(run.timeoutSeconds / 60)} minute limit`,
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
  }
}

function connection(run: RunDto, lines: TermLine[] | undefined): RunDetailData['connection'] {
  if (!isFinal(run.status)) return { state: 'none', label: 'No terminal yet' };
  if (lines === undefined) return { state: 'ended', label: 'Ended' };
  return { state: 'ended', label: `Ended, read-only, ${lines.length.toLocaleString('en-US')} lines` };
}

/**
 * The run detail screen's data. `ticketRuns` are the runs on the same ticket (the chain, oldest first); `events` the
 * stored run log. Times are local; the top bar's elapsed is "m:ss" (start, or queue time, to now or to the end).
 */
export function toRunDetail(
  run: CachedRun,
  events: RunEventDto[],
  project: ProjectDto,
  ticketRuns: RunDto[],
  now: Date,
  links: RunDetailLinks,
): RunDetailData {
  const final = isFinal(run.status);
  const startIso = workStart(run, events);
  const endMs = final && run.finishedAt ? Date.parse(run.finishedAt) : now.getTime();
  const elapsedMs = endMs - Date.parse(startIso);
  const lines = final ? scrollbackLines(events) : undefined;
  const lifecycle = events.flatMap((e) => {
    const text = e.type === 'lifecycle' ? textOf(e) : undefined;
    return text === undefined ? [] : [{ at: clockSeconds(e.ts), text }];
  });
  const timed = run.startedAt !== null && (run.status === 'running' || run.status === 'timed_out');
  const end = final && run.finishedAt ? clockSeconds(run.finishedAt) : undefined;
  const note = endNote(run, ticketRuns, links, now, events);
  return {
    run: toRunSummary(run, now),
    elapsed: clock(elapsedMs),
    rule: `/${run.command}`,
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
          endsAt: idleEndsAt(run.idleSince),
          slotNote: idleSlotNote(project.maxConcurrentRuns, undefined),
        },
      }),
    ...(timed && {
      time: {
        elapsed: clock(elapsedMs),
        limit: clock(run.timeoutSeconds * 1000),
        percent: Math.min(100, Math.round((elapsedMs / (run.timeoutSeconds * 1000)) * 100)),
      },
    }),
    ...((run.status === 'idle' || run.status === 'done') && run.agentNote !== null && { agentNote: run.agentNote }),
    connection: connection(run, lines),
    ...(note && { endNote: note }),
  };
}
