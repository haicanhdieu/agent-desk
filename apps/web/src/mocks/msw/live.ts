import {
  FINAL_RUN_STATUSES,
  type ProjectRunEvent,
  type RunDto,
  type RunEventDto,
  type RunStatus,
  type RunStatusEvent,
  type SetupTestDto,
} from '@agentdesk/contracts';
import { mockDb } from './db';

// Live run changes in the mock store: appending run events and changing a run's status notify the open event
// streams (stream-handlers.ts, browser only), and scripted runs (`scenarios.runScript`) change over time. Everything
// here is reset with the store.

export type RunStreamMessage =
  | { event: 'event'; id: string; data: RunEventDto }
  // No id on status frames, as the API: only events advance the browser's Last-Event-ID.
  | { event: 'status'; data: RunStatusEvent };

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
  // The worker's `status` run event payload.
  const payload = { status, exitCode: run.exitCode, failureReason: run.failureReason };
  const { seq } = appendRunEvent(run, 'status', payload);
  notify(runListeners, run.id, { event: 'status', data: statusMessage(run, seq) });
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

// Setup tests: like runs, appending an event or changing the test's status notifies its open streams (stream-handlers.ts,
// browser only), and a test plays a short scripted setup (`playSetupTest`) once its first stream opens.

export type SetupTestStreamMessage =
  { event: 'event'; id: string; data: RunEventDto } | { event: 'status'; data: SetupTestDto };

const setupTestListeners = new Map<string, Set<Listener<SetupTestStreamMessage>>>();
const playedSetupTests = new Set<string>();
/** The script text each test was created with (the DTO never carries it); only the scripted play reads it. */
const testScripts = new Map<string, string>();

export const rememberSetupTestScript = (testId: string, script: string): void => {
  testScripts.set(testId, script);
};
const setupTestTimers: ReturnType<typeof setTimeout>[] = [];

export const subscribeSetupTest = (id: string, fn: Listener<SetupTestStreamMessage>): (() => void) =>
  subscribe(setupTestListeners, id, fn);

const setupTestRow = (id: string) => mockDb.state.setupTests.find((t) => t.id === id);

/** Appends a lifecycle event (next seq) to the test's log and sends it to the test's open streams. */
export function appendSetupTestEvent(testId: string, payload: Record<string, unknown>): RunEventDto {
  const list = mockDb.state.setupTestEvents[testId] ?? [];
  const event: RunEventDto = { seq: (list.at(-1)?.seq ?? 0) + 1, ts: now(), type: 'lifecycle', payload };
  list.push(event);
  mockDb.state.setupTestEvents[testId] = list;
  notify(setupTestListeners, testId, { event: 'event', id: String(event.seq), data: event });
  return event;
}

/** Sends the test's current state to its open streams. */
export function notifySetupTest(test: SetupTestDto): void {
  notify(setupTestListeners, test.id, { event: 'status', data: structuredClone(test) });
}

const SETUP_TEST_TTL_MS = 15 * 60_000;

/** A setup script with a line `exit <non-zero>` fails in the mock; every other script passes. */
const failsInMock = (script: string) => /^\s*exit\s+[1-9]/m.test(script);

/**
 * Plays a short setup on the queued test: checkout, the plugins the project's repo enables, a few lines of script
 * output, then passed or failed with the workspace open for 15 minutes. Once per test; a store reset drops it.
 */
export function playSetupTest(testId: string): void {
  if (playedSetupTests.has(testId)) return;
  playedSetupTests.add(testId);
  let at = 0;
  const step = (afterMs: number, run: (test: SetupTestDto) => void) => {
    at += afterMs;
    setupTestTimers.push(
      setTimeout(() => {
        const test = setupTestRow(testId);
        // A test ended meanwhile stays as it is.
        if (test && test.status !== 'ended') run(test);
      }, at),
    );
  };
  const marker = (kind: string, text: string, extra: Record<string, unknown> = {}) =>
    appendSetupTestEvent(testId, { kind, text, ...extra });
  const plugins = mockDb.state.plugins[setupTestRow(testId)?.projectId ?? '']?.plugins ?? [];
  const sha = 'a91c3e2'.padEnd(40, '0');
  step(600, (t) => {
    t.status = 'running';
    t.checkoutSha = sha;
    marker('checkout', `agentdesk: checkout ${sha}`, { sha });
    notifySetupTest(t);
  });
  step(400, () => marker('plugins_begin', 'agentdesk: plugins begin'));
  for (const p of plugins) {
    step(300, (t) => {
      if (p.state === 'blocked') {
        t.plugins.skipped.push(p.id);
        marker('plugin_skipped', `agentdesk: plugin skipped ${p.id} (store not approved)`, { pluginId: p.id });
      } else {
        t.plugins.installed.push(p.id);
        marker('plugin_installed', `agentdesk: plugin installed ${p.id}`, { pluginId: p.id });
      }
      notifySetupTest(t);
    });
  }
  step(300, () => marker('plugins_end', 'agentdesk: plugins end'));
  step(300, () => marker('setup_begin', 'agentdesk: setup begin'));
  const fails = failsInMock(testScripts.get(testId) ?? '');
  step(500, () =>
    appendSetupTestEvent(testId, { kind: 'setup_output', text: '+ set -euo pipefail\n', truncated: false }),
  );
  step(600, () =>
    appendSetupTestEvent(testId, {
      kind: 'setup_output',
      text: fails ? 'error: restore failed\n' : 'Restore complete\n',
      truncated: false,
    }),
  );
  step(400, (t) => {
    const exitCode = fails ? 1 : 0;
    if (fails) marker('setup_failed', `agentdesk: setup failed exit=${exitCode}`, { exitCode });
    else marker('setup_passed', 'agentdesk: setup passed');
    const finished = now();
    t.status = fails ? 'failed' : 'passed';
    t.exitCode = exitCode;
    t.finishedAt = finished;
    t.endsAt = new Date(Date.parse(finished) + SETUP_TEST_TTL_MS).toISOString();
    notifySetupTest(t);
  });
}

mockDb.onReset(() => {
  for (const t of setupTestTimers) clearTimeout(t);
  setupTestTimers.length = 0;
  playedSetupTests.clear();
  testScripts.clear();
  setupTestListeners.clear();
});
