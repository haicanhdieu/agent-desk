import {
  FINAL_RUN_STATUSES,
  type ProjectRunEvent,
  type RunDto,
  type RunEventDto,
  type RunStatus,
  type RunStatusEvent,
} from '@agentdesk/contracts';
import { mockDb } from './db';

// Live run changes in the mock store: appending run events and changing a run's status notify the open event
// streams (stream-handlers.ts, browser only), and scripted runs (`scenarios.runScript`) change over time. Everything
// here is reset with the store.

export type RunStreamMessage =
  | { event: 'event'; id: string; data: RunEventDto }
  | { event: 'status'; id: string; data: RunStatusEvent };

type Listener<T> = (message: T) => void;

const runListeners = new Map<string, Set<Listener<RunStreamMessage>>>();
const projectListeners = new Map<string, Set<Listener<ProjectRunEvent>>>();

const isFinal = (s: RunStatus) => FINAL_RUN_STATUSES.some((f) => f === s);
const now = () => new Date().toISOString();

function subscribe<T>(map: Map<string, Set<Listener<T>>>, key: string, fn: Listener<T>): () => void {
  const set = map.get(key) ?? new Set<Listener<T>>();
  set.add(fn);
  map.set(key, set);
  return () => {
    set.delete(fn);
    if (set.size === 0) map.delete(key);
  };
}

function notify<T>(map: Map<string, Set<Listener<T>>>, key: string, message: T) {
  for (const fn of [...(map.get(key) ?? [])]) fn(message);
}

/** The run's status as the run stream sends it. */
export function statusMessage(run: RunDto, seq: number): RunStatusEvent {
  return {
    runId: run.id,
    number: run.number,
    status: run.status,
    seq,
    exitCode: run.exitCode,
    failureReason: run.failureReason,
  };
}

/** Appends a run event (next seq) and sends it to the run's open streams. */
export function appendRunEvent(run: RunDto, type: RunEventDto['type'], payload: Record<string, unknown>): RunEventDto {
  const list = mockDb.state.runEvents[run.id] ?? [];
  const event: RunEventDto = {
    seq: (list.at(-1)?.seq ?? 0) + 1,
    ts: now(),
    type,
    payload,
  };
  list.push(event);
  mockDb.state.runEvents[run.id] = list;
  notify(runListeners, run.id, {
    event: 'event',
    id: String(event.seq),
    data: event,
  });
  return event;
}

/**
 * Moves the run to `status` (with the timestamps a worker would set), logs the change as a run event and sends the
 * status to the run's streams and its project's streams. Exit code and failure reason are the caller's to set first.
 */
export function setRunStatus(run: RunDto, status: RunStatus): void {
  const at = now();
  run.status = status;
  if (status !== 'queued') run.startedAt ??= at;
  run.idleSince = status === 'idle' ? at : null;
  if (isFinal(status)) run.finishedAt ??= at;
  const payload = isFinal(status) ? { status, exitCode: run.exitCode, failureReason: run.failureReason } : { status };
  const { seq } = appendRunEvent(run, 'status', payload);
  notify(runListeners, run.id, {
    event: 'status',
    id: String(seq),
    data: statusMessage(run, seq),
  });
  notify(projectListeners, run.projectId, {
    runId: run.id,
    number: run.number,
    status,
    seq,
  });
}

/** One step of a scripted run: after `afterMs` (from the previous step), a lifecycle line and/or a status. */
export interface ScriptStep {
  afterMs: number;
  lifecycle?: string;
  status?: RunStatus;
}

interface Script {
  steps: ScriptStep[];
  timers: ReturnType<typeof setTimeout>[];
  started: boolean;
}

const scripts = new Map<string, Script>();

function play(runId: string, script: Script) {
  script.started = true;
  let at = 0;
  for (const step of script.steps) {
    at += step.afterMs;
    script.timers.push(
      setTimeout(() => {
        const run = mockDb.state.runs.find((r) => r.id === runId);
        // A run cancelled or finished meanwhile stays as it is.
        if (!run || isFinal(run.status)) return;
        if (step.lifecycle !== undefined) appendRunEvent(run, 'lifecycle', { text: step.lifecycle });
        if (step.status !== undefined) setRunStatus(run, step.status);
      }, at),
    );
  }
}

/** Plays `steps` on the run now, or (`onStream`) when the first event stream for the run opens. */
export function scriptRun(runId: string, steps: ScriptStep[], start: 'now' | 'onStream' = 'now'): void {
  const old = scripts.get(runId);
  for (const t of old?.timers ?? []) clearTimeout(t);
  const script: Script = { steps, timers: [], started: false };
  scripts.set(runId, script);
  if (start === 'now') play(runId, script);
}

/** Subscribes to the run's stream messages; starts a script waiting for a stream. */
export function subscribeRun(runId: string, fn: Listener<RunStreamMessage>): () => void {
  const unsubscribe = subscribe(runListeners, runId, fn);
  const script = scripts.get(runId);
  if (script && !script.started) play(runId, script);
  return unsubscribe;
}

/** Subscribes to the project's run status changes. */
export const subscribeProject = (projectId: string, fn: Listener<ProjectRunEvent>): (() => void) =>
  subscribe(projectListeners, projectId, fn);

mockDb.onReset(() => {
  for (const script of scripts.values()) for (const t of script.timers) clearTimeout(t);
  scripts.clear();
  runListeners.clear();
  projectListeners.clear();
});
