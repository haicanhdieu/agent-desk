// RunWorkflow run in-process against the fake `@temporalio/workflow` (see test/helpers/fake-workflow-runtime.ts), so its
// pause/resume code is measured by v8 coverage. The real-runtime checks (ordering, retries, cancellation, replay) are
// in run.workflow.test.ts; this file asserts the workflow's own decisions: which activities run, with what, in what order.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  failedActivity,
  fireTimer,
  pendingTimers,
  resetRuntime,
  runQuery,
  runtime,
  sendSignal,
  sendUpdate,
  settle,
  waitFor,
} from './helpers/fake-workflow-runtime';

vi.mock('@temporalio/workflow', () => import('./helpers/fake-workflow-runtime'));

import { HISTORY_TOO_LONG_REASON, RunWorkflow, type RunOutcome } from '../src/workflows/run.workflow';
import {
  agentState,
  cancel,
  dropSession,
  finishRun,
  granted,
  resumeRun,
  runState,
  sessionStarted,
  terminalAttached,
  terminalDetached,
  terminalLease,
  type RunState,
} from '../src/workflows/signals';
import type {
  CommentKind,
  FinishDetails,
  FollowPodLogsResult,
  ParkResult,
  RunContext,
} from '../src/activities/run.activities';
import type { SetRunStatusInput } from '../src/activities/run-status.activity';

const T0 = new Date('2026-01-01T00:00:00.000Z');
const KEEP = 3600;

interface Pod {
  opts: { resume?: boolean } | undefined;
  exit: (result: FollowPodLogsResult) => void;
}

interface Harness {
  ctx: RunContext;
  /** Every activity call, as `name` or `name:detail`, in order. */
  calls: string[];
  statuses: SetRunStatusInput[];
  comments: { kind: CommentKind; details?: FinishDetails }[];
  pods: Pod[];
  createOpts: ({ resume?: boolean; deadlineSeconds?: number } | undefined)[];
  parks: { kind: string; reason?: string; resumeQueued?: boolean }[];
  restores: { kind: string; sessionExpiresAt: string; reason: string }[];
  kept: string[];
  /** `parkRun` keeps the session this many seconds; undefined keeps nothing. */
  keepSeconds: number | undefined;
  /** A resume's createRunSecretAndJob throws this. */
  resumeCreateError: Error | undefined;
  /** A resume's requestSlot is not granted until `grant` is called. */
  holdResumeSlot: boolean;
  slotRequests: number;
  grant: () => void;
  outcome: RunOutcome | undefined;
  failure: unknown;
  done: Promise<RunOutcome>;
}

const ORG = 'org1';
const RUN = 'run1';

function start(
  overrides: Partial<RunContext> = {},
  config: { keepSeconds?: number | null; loadRun?: () => Promise<RunContext> } = {},
): Harness {
  const h: Harness = {
    ctx: {
      orgId: ORG,
      runId: RUN,
      projectId: 'p1',
      agentId: 'a1',
      status: 'queued',
      timeoutSeconds: 7200,
      maxConcurrentRuns: 2,
      idleEndSeconds: 600,
      ...overrides,
    },
    calls: [],
    statuses: [],
    comments: [],
    pods: [],
    createOpts: [],
    parks: [],
    restores: [],
    kept: [],
    keepSeconds: config.keepSeconds === null ? undefined : (config.keepSeconds ?? KEEP),
    resumeCreateError: undefined,
    holdResumeSlot: false,
    slotRequests: 0,
    grant: () => sendSignal(granted),
    outcome: undefined,
    failure: undefined,
    done: Promise.resolve({ status: 'failed' }),
  };
  runtime.manualTime = true;
  const a = runtime.activities;
  a.loadRun = () => {
    h.calls.push('loadRun');
    return config.loadRun ? config.loadRun() : Promise.resolve(h.ctx);
  };
  a.requestSlot = () => {
    h.slotRequests += 1;
    h.calls.push('requestSlot');
    if (!(h.holdResumeSlot && h.slotRequests > 1)) queueMicrotask(h.grant);
    return Promise.resolve();
  };
  a.setRunStatus = (input: SetRunStatusInput) => {
    h.statuses.push(input);
    h.calls.push(`setRunStatus:${input.status}`);
    return Promise.resolve({});
  };
  a.createRunSecretAndJob = (_c: RunContext, opts?: { resume?: boolean; deadlineSeconds?: number }) => {
    h.createOpts.push(opts);
    h.calls.push(opts?.resume ? 'createRunSecretAndJob:resume' : 'createRunSecretAndJob');
    if (opts?.resume && h.resumeCreateError) return Promise.reject(h.resumeCreateError);
    return Promise.resolve(undefined);
  };
  a.postComment = (_c: RunContext, kind: CommentKind, details?: FinishDetails) => {
    h.comments.push({ kind, ...(details ? { details } : {}) });
    h.calls.push(`postComment:${kind}${details ? `:${details.status}` : ''}`);
    return Promise.resolve();
  };
  a.followPodLogs = (_c: RunContext, opts?: { resume?: boolean }) =>
    new Promise<FollowPodLogsResult>((resolve) => {
      h.calls.push(opts?.resume ? 'followPodLogs:resume' : 'followPodLogs');
      h.pods.push({ opts, exit: resolve });
    });
  a.endSession = () => {
    h.calls.push('endSession');
    // As the runner does: ending the session makes the pod exit cleanly.
    h.pods[h.pods.length - 1]?.exit({ exitCode: 0, agentStarted: true });
    return Promise.resolve();
  };
  for (const name of ['deleteJob', 'ensureJobGone', 'deleteRunVolume', 'refreshWorkspaceToken']) {
    a[name] = () => {
      h.calls.push(name);
      return Promise.resolve(undefined);
    };
  }
  a.parkRun = (
    _c: RunContext,
    input: { kind: string; reason?: string; resumeQueued?: boolean; podExitCode?: number },
  ): Promise<ParkResult> => {
    h.parks.push(input);
    h.calls.push(`parkRun:${input.kind}`);
    const expiry = h.keepSeconds === undefined ? null : new Date(Date.now() + h.keepSeconds * 1000).toISOString();
    return Promise.resolve({ status: input.kind === 'done' ? 'succeeded' : 'paused', sessionExpiresAt: expiry });
  };
  a.endKeptSession = (_c: RunContext, reason: string) => {
    h.kept.push(reason);
    h.calls.push(`endKeptSession:${reason}`);
    return Promise.resolve();
  };
  a.restoreParked = (_c: RunContext, input: { kind: string; sessionExpiresAt: string; reason: string }) => {
    h.restores.push(input);
    h.calls.push('restoreParked');
    return Promise.resolve();
  };
  h.done = RunWorkflow({ orgId: ORG, runId: RUN });
  h.done.then(
    (o) => (h.outcome = o),
    (e: unknown) => (h.failure = e),
  );
  return h;
}

const phase = (): string => runQuery<RunState>(runState).phase;
const afterCalls = (h: Harness, name: string): string[] => h.calls.slice(h.calls.lastIndexOf(name) + 1);

/** Runs to the first pod's first line: the run is `running`. */
async function toRunning(h: Harness): Promise<void> {
  await waitFor('first pod', () => h.pods.length === 1);
  await waitFor('phase running', () => phase() === 'running');
}

/** The first pod reaches a turn boundary and the idle timer fires: the run parks. `usedSeconds` pass first. */
async function toParked(h: Harness, boundary: 'needs_input' | 'done', usedSeconds = 900): Promise<void> {
  await toRunning(h);
  sendSignal(agentState, boundary);
  await waitFor('idle timer', () => pendingTimers().includes(600_000));
  vi.setSystemTime(new Date(T0.getTime() + usedSeconds * 1000));
  fireTimer(600_000);
  await waitFor('parked', () => phase() === 'parked');
}

/** Accepts a resume and brings the resumed session up. */
async function resumeToSessionUp(h: Harness): Promise<void> {
  await expect(sendUpdate(resumeRun)).resolves.toEqual({ accepted: true });
  await waitFor('resumed pod', () => h.pods.length === 2);
  sendSignal(sessionStarted);
  await waitFor('resume finished', () => phase() !== 'resuming');
}

beforeEach(() => {
  resetRuntime();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('parking on idle', () => {
  it('a run waiting for a person stops its pod, frees the slot, keeps the volume and waits paused', async () => {
    const h = start();
    await toParked(h, 'needs_input');

    expect(afterCalls(h, 'followPodLogs')).toEqual([
      'endSession',
      'deleteJob',
      'parkRun:needs_input',
      'postComment:paused',
    ]);
    expect(runtime.externalSignals).toContain('gate-p1:releaseSlot:run1');
    // The volume is kept and nothing is finalized: the workflow is still open.
    expect(h.calls).not.toContain('deleteRunVolume');
    expect(h.calls).not.toContain('ensureJobGone');
    expect(h.outcome).toBeUndefined();
    // The hard timer of the first pod is off.
    expect(pendingTimers()).not.toContain(7200 * 1000);
  });

  it('a run that declared done parks as succeeded with the finish comment', async () => {
    const h = start();
    await toParked(h, 'done');

    expect(h.parks).toEqual([expect.objectContaining({ kind: 'done' })]);
    expect(h.comments.at(-1)).toEqual({ kind: 'finish', details: { status: 'succeeded' } });
    expect(h.comments.map((c) => c.kind)).not.toContain('paused');
  });

  it('keeps nothing when the agent keeps no session: the volume goes and the run ends succeeded', async () => {
    const h = start({}, { keepSeconds: null });
    await toRunning(h);
    sendSignal(agentState, 'done');
    await waitFor('idle timer', () => pendingTimers().includes(600_000));
    fireTimer(600_000);

    await expect(h.done).resolves.toEqual({ status: 'succeeded' });
    expect(afterCalls(h, 'parkRun:done')).toEqual(['postComment:finish:succeeded', 'deleteRunVolume']);
    // The status and comment were written by parking: finalize is skipped.
    expect(h.calls).not.toContain('ensureJobGone');
    expect(h.statuses.map((s) => s.status)).toEqual(['starting']);
  });

  it('a person attached to the terminal holds the idle timer off', async () => {
    const h = start();
    await toRunning(h);
    sendSignal(agentState, 'needs_input');
    await waitFor('idle timer', () => pendingTimers().includes(600_000));
    sendSignal(terminalAttached);
    await settle();
    expect(pendingTimers()).not.toContain(600_000);
    expect(phase()).toBe('idle');
  });
});

describe('keep-time expiry and drop', () => {
  it('a paused run whose kept session runs out ends expired, with the volume deleted and a finish comment', async () => {
    const h = start();
    await toParked(h, 'needs_input');
    expect(pendingTimers()).toContain(KEEP * 1000);

    vi.setSystemTime(new Date(T0.getTime() + (900 + KEEP + 1) * 1000));
    fireTimer(KEEP * 1000);

    await expect(h.done).resolves.toEqual({ status: 'expired' });
    expect(afterCalls(h, 'postComment:paused')).toEqual([
      'endKeptSession:expired',
      'deleteRunVolume',
      'postComment:finish:expired',
    ]);
  });

  it('a done run whose kept session runs out stays succeeded and posts no second finish comment', async () => {
    const h = start();
    await toParked(h, 'done');
    vi.setSystemTime(new Date(T0.getTime() + (900 + KEEP + 1) * 1000));
    fireTimer(KEEP * 1000);

    await expect(h.done).resolves.toEqual({ status: 'succeeded' });
    expect(h.kept).toEqual(['expired']);
    expect(h.comments.filter((c) => c.kind === 'finish')).toHaveLength(1);
    expect(h.calls).toContain('deleteRunVolume');
  });

  it('dropSession on a kept succeeded run gives the session up at once', async () => {
    const h = start();
    await toParked(h, 'done');
    sendSignal(dropSession);

    await expect(h.done).resolves.toEqual({ status: 'succeeded' });
    expect(h.kept).toEqual(['dropped']);
    expect(afterCalls(h, 'postComment:finish:succeeded')).toEqual(['endKeptSession:dropped', 'deleteRunVolume']);
  });

  it('dropSession is ignored for a paused run, which keeps its own session', async () => {
    const h = start();
    await toParked(h, 'needs_input');
    sendSignal(dropSession);
    await settle();

    expect(h.kept).toEqual([]);
    expect(h.outcome).toBeUndefined();
    expect(phase()).toBe('parked');
  });
});

describe('cancel and finish while parked', () => {
  it('cancel on a paused run cancels it: Job and volume cleaned, session cleared, finish comment posted', async () => {
    const h = start();
    await toParked(h, 'needs_input');
    sendSignal(cancel);

    await expect(h.done).resolves.toEqual({ status: 'cancelled' });
    const last = h.statuses.at(-1);
    expect(last).toMatchObject({ status: 'cancelled', session: null });
    expect(h.comments.at(-1)).toEqual({ kind: 'finish', details: { status: 'cancelled' } });
    expect(h.calls).toContain('deleteRunVolume');
    // The slot was already freed when the run parked, so it is not released twice.
    expect(runtime.externalSignals.filter((s) => s.includes('releaseSlot'))).toHaveLength(1);
  });

  it('cancel does nothing to a parked done run: it is a finished run', async () => {
    const h = start();
    await toParked(h, 'done');
    const before = h.calls.length;
    sendSignal(cancel);
    await settle();

    expect(h.calls).toHaveLength(before);
    expect(h.outcome).toBeUndefined();
    expect(phase()).toBe('parked');
  });

  it('a person Finish on a paused run ends it succeeded, deleting the volume and clearing the session', async () => {
    const h = start();
    await toParked(h, 'needs_input');
    await expect(sendUpdate(finishRun)).resolves.toEqual({ accepted: true });

    await expect(h.done).resolves.toEqual({ status: 'succeeded' });
    expect(afterCalls(h, 'postComment:paused')).toEqual([
      'deleteRunVolume',
      'setRunStatus:succeeded',
      'postComment:finish:succeeded',
    ]);
    expect(h.statuses.at(-1)).toMatchObject({ status: 'succeeded', session: null });
  });

  it('Finish is refused on a parked done run (it already finished) and on a run that is not at a turn boundary', async () => {
    const h = start();
    await toParked(h, 'done');
    await expect(sendUpdate(finishRun)).rejects.toThrow('This run already finished');
  });

  it('Finish is refused while the agent is still working', async () => {
    const h = start();
    await toRunning(h);
    await expect(sendUpdate(finishRun)).rejects.toThrow('Only a run that needs you or is done can be finished');
  });
});

describe('resume', () => {
  it.each([
    ['needs_input', 'idle', 'idle'],
    ['done', 'agent_done', 'done'],
  ] as const)(
    'a parked %s run resumes: queued, starting, session up, back to %s with the session cleared',
    async (boundary, expectedPhase, expectedStatus) => {
      const h = start();
      await toParked(h, boundary);
      const slotsBefore = h.slotRequests;
      await resumeToSessionUp(h);

      expect(afterCalls(h, boundary === 'done' ? 'postComment:finish:succeeded' : 'postComment:paused')).toEqual([
        'setRunStatus:queued',
        'requestSlot',
        'setRunStatus:starting',
        'createRunSecretAndJob:resume',
        'followPodLogs:resume',
        `setRunStatus:${expectedStatus}`,
      ]);
      expect(h.slotRequests).toBe(slotsBefore + 1);
      expect(h.statuses.find((s) => s.status === 'queued')).toMatchObject({ reopen: true, keepAgentNote: true });
      expect(h.statuses.at(-1)).toMatchObject({ status: expectedStatus, keepAgentNote: true, session: null });
      expect(h.pods[1]?.opts).toEqual({ resume: true });
      expect(phase()).toBe(expectedPhase);
    },
  );

  it('the resumed pod gets the rest of the time limit, and a fresh hard timer for exactly that', async () => {
    const h = start({ timeoutSeconds: 7200 });
    await toParked(h, 'needs_input', 900);
    vi.setSystemTime(new Date(T0.getTime() + 900 * 1000));
    await resumeToSessionUp(h);

    expect(h.createOpts[1]).toEqual({ resume: true, deadlineSeconds: 6300 });
    expect(pendingTimers()).toContain(6300 * 1000);
  });

  it('a short remainder is raised to the resume floor', async () => {
    const h = start({ timeoutSeconds: 1000, resumeMinSeconds: 3600 });
    await toParked(h, 'needs_input', 900);
    await resumeToSessionUp(h);

    expect(h.createOpts[1]).toEqual({ resume: true, deadlineSeconds: 3600 });
  });

  it('a second resume is refused while one is under way, and one on a running run is refused', async () => {
    const h = start();
    await toRunning(h);
    await expect(sendUpdate(resumeRun)).rejects.toThrow('Only a paused run');

    sendSignal(agentState, 'needs_input');
    await waitFor('idle timer', () => pendingTimers().includes(600_000));
    fireTimer(600_000);
    await waitFor('parked', () => phase() === 'parked');
    h.holdResumeSlot = true;
    await sendUpdate(resumeRun);
    await expect(sendUpdate(resumeRun)).rejects.toThrow('already being resumed');
  });

  it('the resumed run then ends like any run: exit 0 finalizes succeeded and deletes the volume', async () => {
    const h = start();
    await toParked(h, 'needs_input');
    await resumeToSessionUp(h);
    h.pods[1]?.exit({ exitCode: 0, agentStarted: true });

    await expect(h.done).resolves.toMatchObject({ status: 'succeeded' });
    expect(afterCalls(h, 'setRunStatus:idle')).toEqual([
      'ensureJobGone',
      'deleteRunVolume',
      'setRunStatus:succeeded',
      'postComment:finish:succeeded',
    ]);
    expect(h.statuses.at(-1)).toMatchObject({ status: 'succeeded', session: null });
  });

  it('a re-opened succeeded run whose agent then crashes is parked again with its work kept (D1)', async () => {
    const h = start();
    await toParked(h, 'done');
    await resumeToSessionUp(h);
    h.pods[1]?.exit({ exitCode: 1, endReason: 'agent_exit', agentStarted: true });

    await waitFor('parked again', () => phase() === 'parked');
    expect(h.parks.at(-1)).toMatchObject({ kind: 'done', reason: 'agent_crashed' });
    expect(h.calls).not.toContain('deleteRunVolume');
    expect(h.outcome).toBeUndefined();
  });

  it('a resumed run can park again from the new pod, counting the time of both pods', async () => {
    const h = start({ timeoutSeconds: 7200 });
    await toParked(h, 'needs_input', 900);
    vi.setSystemTime(new Date(T0.getTime() + 1000 * 1000));
    await resumeToSessionUp(h);
    sendSignal(agentState, 'needs_input');
    await waitFor('idle timer', () => pendingTimers().includes(600_000));
    vi.setSystemTime(new Date(T0.getTime() + 1300 * 1000));
    fireTimer(600_000);
    await waitFor('parked again', () => phase() === 'parked' && h.parks.length === 2);

    // Pod one used 900 s, pod two 300 s: a third pod would get 7200 - 1200.
    await resumeToSessionUp3(h);
    expect(h.createOpts[2]).toEqual({ resume: true, deadlineSeconds: 6000 });
  });

  it('cancel after the resumed session is up ends the run, not just the resume', async () => {
    const h = start();
    await toParked(h, 'needs_input');
    await resumeToSessionUp(h);
    sendSignal(cancel);

    await expect(h.done).resolves.toEqual({ status: 'cancelled' });
    expect(h.calls).toContain('deleteRunVolume');
    expect(h.restores).toEqual([]);
  });
});

async function resumeToSessionUp3(h: Harness): Promise<void> {
  await expect(sendUpdate(resumeRun)).resolves.toEqual({ accepted: true });
  await waitFor('third pod', () => h.pods.length === 3);
  sendSignal(sessionStarted);
  await waitFor('resume finished', () => phase() !== 'resuming');
}

describe('a resume that fails goes back to the parked state', () => {
  const failsWith = async (h: Harness, reason: string, kind: 'needs_input' | 'done'): Promise<void> => {
    await waitFor('restoreParked', () => h.restores.length === 1);
    await waitFor('parked again', () => phase() === 'parked');
    expect(h.restores[0]).toMatchObject({ kind, reason });
    // The same deadline: the kept session is not extended by a failed attempt.
    expect(Date.parse(h.restores[0]?.sessionExpiresAt ?? '')).toBe(T0.getTime() + (900 + KEEP) * 1000);
    expect(h.outcome).toBeUndefined();
  };

  it('no saved session (the pod exited 79 before the session started)', async () => {
    const h = start();
    await toParked(h, 'needs_input');
    await sendUpdate(resumeRun);
    await waitFor('resumed pod', () => h.pods.length === 2);
    h.pods[1]?.exit({ exitCode: 79, resumeFailed: true });

    await failsWith(h, 'no saved session was found', 'needs_input');
    // Cleanup of the failed attempt, in order: Job gone, slot released, state restored.
    expect(afterCalls(h, 'followPodLogs:resume')).toEqual(['deleteJob', 'restoreParked']);
    expect(runtime.externalSignals.filter((s) => s.includes('releaseSlot'))).toHaveLength(2);
    // The kept volume survives: nothing deleted it.
    expect(h.calls).not.toContain('deleteRunVolume');
  });

  it('the pod exits without a session for another reason', async () => {
    const h = start();
    await toParked(h, 'done');
    await sendUpdate(resumeRun);
    await waitFor('resumed pod', () => h.pods.length === 2);
    h.pods[1]?.exit({ exitCode: 1 });

    await failsWith(h, 'the pod could not start', 'done');
  });

  it('the Job cannot be created', async () => {
    const h = start();
    await toParked(h, 'needs_input');
    h.resumeCreateError = failedActivity('createRunSecretAndJob', 'quota exceeded');
    await sendUpdate(resumeRun);

    await failsWith(h, 'the pod could not start', 'needs_input');
    expect(h.pods).toHaveLength(1);
  });

  it('the agent or its credential is gone', async () => {
    const h = start();
    await toParked(h, 'needs_input');
    h.resumeCreateError = failedActivity('createRunSecretAndJob', 'no credential', 'NoAgentCredential');
    await sendUpdate(resumeRun);

    await failsWith(h, 'the agent or its credential is missing', 'needs_input');
  });

  it('the pod never reports a session before the resume allowance runs out', async () => {
    const h = start({ timeoutSeconds: 7200 });
    await toParked(h, 'needs_input');
    await sendUpdate(resumeRun);
    await waitFor('resumed pod', () => h.pods.length === 2);
    fireTimer(6300 * 1000);

    await failsWith(h, 'the pod could not start', 'needs_input');
  });

  it('cancel while the resume is queued gives up the resume only: the run stays paused and can be resumed again', async () => {
    const h = start();
    await toParked(h, 'needs_input');
    h.holdResumeSlot = true;
    await sendUpdate(resumeRun);
    await waitFor('resume queued', () => h.slotRequests === 2);
    sendSignal(cancel);

    await failsWith(h, 'the resume was cancelled', 'needs_input');
    expect(h.calls).not.toContain('createRunSecretAndJob:resume');
    expect(h.calls).not.toContain('deleteRunVolume');
    expect(h.statuses.map((s) => s.status)).not.toContain('cancelled');

    // Still parked and resumable.
    h.holdResumeSlot = false;
    await expect(sendUpdate(resumeRun)).resolves.toEqual({ accepted: true });
  });
});

describe('the run ends before or without parking', () => {
  it('a cancel before loadRun returned still loads the run so the finish comment posts', async () => {
    // First loadRun never answers; the second (from finalize) does.
    let loads = 0;
    const h = start(
      {},
      {
        loadRun: () => {
          loads += 1;
          return loads === 1 ? new Promise<RunContext>(() => undefined) : Promise.resolve(h.ctx);
        },
      },
    );
    sendSignal(cancel);

    await expect(h.done).resolves.toEqual({ status: 'cancelled' });
    expect(h.comments.at(-1)).toEqual({ kind: 'finish', details: { status: 'cancelled' } });
    expect(h.calls).not.toContain('ensureJobGone');
  });

  it('a run another execution already finished is left alone', async () => {
    const h = start({ status: 'failed' });
    await expect(h.done).resolves.toEqual({ status: 'failed' });
    expect(h.calls).toEqual(['loadRun']);
  });

  it('a history near Temporal limit finishes the run failed with a plain reason', async () => {
    runtime.historyLength = 100;
    const h = start({ historyEventLimit: 50 });
    await expect(h.done).resolves.toMatchObject({ status: 'failed', failureReason: HISTORY_TOO_LONG_REASON });
  });

  it('a pod that fails setup finishes the run failed with the setup reason', async () => {
    const h = start();
    await waitFor('first pod', () => h.pods.length === 1);
    h.pods[0]?.exit({ exitCode: 78, failureStage: 'setup', setupExitCode: 3 });
    await expect(h.done).resolves.toEqual({ status: 'failed', exitCode: 3, failureReason: 'setup failed (exit 3)' });
  });

  it('the hard timer firing while the run is running times it out', async () => {
    const h = start({ timeoutSeconds: 600 });
    await toRunning(h);
    fireTimer(600 * 1000);
    await expect(h.done).resolves.toEqual({ status: 'timed_out' });
  });
});

describe('the ending deadline', () => {
  const DEADLINE_MS = 120 * 1000;
  /** ABANDON_GRACE_MS in the workflow: how long a follower that never returns is waited for after the Job delete. */
  const GRACE_MS = 5 * 1000;

  /** The deadline passes; a follower that never returns is given up on once the grace after the delete runs out. */
  async function passDeadlineAndGrace(): Promise<void> {
    await waitFor('deadline timer', () => pendingTimers().includes(DEADLINE_MS));
    fireTimer(DEADLINE_MS);
    await waitFor('grace timer', () => pendingTimers().includes(GRACE_MS));
    fireTimer(GRACE_MS);
  }

  /** A person Finish on a run that is waiting for them, with a pod that ignores the session end and keeps running. */
  async function finishWithStuckPod(h: Harness): Promise<void> {
    runtime.activities.endSession = () => {
      h.calls.push('endSession');
      return Promise.resolve();
    };
    await toRunning(h);
    sendSignal(agentState, 'needs_input');
    await expect(sendUpdate(finishRun)).resolves.toEqual({ accepted: true });
    await waitFor('ending', () => phase() === 'ending');
  }

  it('a pod still running when the deadline passes is abandoned: Job deleted, event recorded, run succeeds', async () => {
    const h = start({ endingDeadlineSeconds: 120 });
    const recorded: { scrollbackSaved: boolean; at: string }[] = [];
    runtime.activities.recordEndingDeadline = (_c: RunContext, input: { scrollbackSaved: boolean; at: string }) => {
      h.calls.push('recordEndingDeadline');
      recorded.push(input);
      return Promise.resolve();
    };
    await finishWithStuckPod(h);
    await passDeadlineAndGrace();

    await expect(h.done).resolves.toEqual({ status: 'succeeded' });
    expect(afterCalls(h, 'endSession').slice(0, 2)).toEqual(['deleteJob', 'recordEndingDeadline']);
    expect(recorded).toEqual([{ scrollbackSaved: false, at: expect.any(String) }]);
  });

  it('scrollback the pod prints while the Job is being deleted is kept: the follower is not cancelled first', async () => {
    const h = start({ endingDeadlineSeconds: 120 });
    const recorded: { scrollbackSaved: boolean; at: string }[] = [];
    runtime.activities.recordEndingDeadline = (_c: RunContext, input: { scrollbackSaved: boolean; at: string }) => {
      h.calls.push('recordEndingDeadline');
      recorded.push(input);
      return Promise.resolve();
    };
    // As the pod does on SIGTERM: the trap prints the scrollback, the follower reads it and returns.
    runtime.activities.deleteJob = () => {
      h.calls.push('deleteJob');
      h.pods[0]?.exit({ exitCode: 143, agentStarted: true, scrollbackTail: 'last lines' });
      return Promise.resolve();
    };
    await finishWithStuckPod(h);
    await waitFor('deadline timer', () => pendingTimers().includes(DEADLINE_MS));
    fireTimer(DEADLINE_MS);

    await expect(h.done).resolves.toMatchObject({ status: 'succeeded' });
    expect(recorded).toEqual([{ scrollbackSaved: true, at: expect.any(String) }]);
  });

  it('a deadline that has already passed abandons the pod without waiting for a timer', async () => {
    const h = start({ endingDeadlineSeconds: 120 });
    runtime.activities.recordEndingDeadline = () => {
      h.calls.push('recordEndingDeadline');
      return Promise.resolve();
    };
    await finishWithStuckPod(h);
    // The next loop turn reads a clock past the deadline.
    runtime.activities.endSession = () => Promise.resolve();
    vi.setSystemTime(new Date(T0.getTime() + 500 * 1000));
    h.pods[0]?.exit({ exitCode: 0 });
    await expect(h.done).resolves.toMatchObject({ status: 'succeeded' });
  });

  it('a failing event write does not fail the run: the Job is gone, so it still succeeds', async () => {
    const h = start({ endingDeadlineSeconds: 120 });
    runtime.activities.recordEndingDeadline = () => {
      h.calls.push('recordEndingDeadline');
      return Promise.reject(new Error('run not found'));
    };
    await finishWithStuckPod(h);
    await passDeadlineAndGrace();

    await expect(h.done).resolves.toEqual({ status: 'succeeded' });
    expect(h.calls).toContain('recordEndingDeadline');
  });

  it('a cancel that lands while the event is being written ends the run cancelled', async () => {
    const h = start({ endingDeadlineSeconds: 120 });
    runtime.activities.recordEndingDeadline = () => {
      h.calls.push('recordEndingDeadline');
      return new Promise<void>(() => undefined);
    };
    await finishWithStuckPod(h);
    await passDeadlineAndGrace();
    await waitFor('event write', () => h.calls.includes('recordEndingDeadline'));
    sendSignal(cancel);

    await expect(h.done).resolves.toEqual({ status: 'cancelled' });
  });

  it('a pod that exits on its own before the deadline needs no abandon', async () => {
    const h = start({ endingDeadlineSeconds: 120 });
    await finishWithStuckPod(h);
    h.pods[0]?.exit({ exitCode: 0 });

    await expect(h.done).resolves.toEqual({ status: 'succeeded', exitCode: 0 });
    expect(h.calls).not.toContain('recordEndingDeadline');
  });
});

describe('a pod that ends without being asked to', () => {
  /** The first pod reaches a turn boundary (or keeps working) and then ends by itself. */
  async function podEnds(h: Harness, result: FollowPodLogsResult, boundary?: 'needs_input' | 'done'): Promise<void> {
    await toRunning(h);
    if (boundary) {
      sendSignal(agentState, boundary);
      await waitFor('turn boundary', () => phase() === (boundary === 'done' ? 'agent_done' : 'idle'));
    }
    h.pods[0]?.exit(result);
    await waitFor('parked', () => phase() === 'parked');
  }

  it.each([
    ['running', undefined, { exitCode: 137, agentStarted: true }, 'needs_input'],
    ['idle', 'needs_input', { exitCode: 137, agentStarted: true }, 'needs_input'],
    [
      'running and the pod vanished',
      undefined,
      { exitCode: -1, agentStarted: true, podLost: true as const },
      'needs_input',
    ],
    ['done', 'done', { exitCode: 137, agentStarted: true }, 'done'],
    ['done and the pod vanished', 'done', { exitCode: -1, agentStarted: true, podLost: true as const }, 'done'],
  ] as const)('a pod lost while %s parks as pod_lost with the volume kept', async (_when, boundary, result, kind) => {
    const h = start();
    await podEnds(h, result, boundary);

    expect(h.parks).toEqual([expect.objectContaining({ kind, reason: 'pod_lost' })]);
    // The pod's real exit code goes with the park (137 is what an OOM kill leaves); the -1 placeholder of a vanished pod does not.
    if (result.exitCode >= 0) expect(h.parks[0]).toMatchObject({ podExitCode: result.exitCode });
    else expect(h.parks[0]).not.toHaveProperty('podExitCode');
    expect(afterCalls(h, 'followPodLogs')).toEqual([
      'deleteJob',
      `parkRun:${kind}`,
      kind === 'done' ? 'postComment:finish:succeeded' : 'postComment:paused',
    ]);
    expect(runtime.externalSignals).toContain('gate-p1:releaseSlot:run1');
    expect(h.calls).not.toContain('deleteRunVolume');
    expect(h.outcome).toBeUndefined();
  });

  it.each([
    ['running', undefined, 'needs_input'],
    ['idle', 'needs_input', 'needs_input'],
    ['done', 'done', 'done'],
  ] as const)(
    'an agent that exits non-zero while %s parks as agent_crashed with the volume kept (D1)',
    async (_w, boundary, kind) => {
      const h = start();
      await podEnds(h, { exitCode: 1, endReason: 'agent_exit', agentStarted: true }, boundary);

      expect(h.parks).toEqual([expect.objectContaining({ kind, reason: 'agent_crashed' })]);
      expect(h.calls).not.toContain('deleteRunVolume');
      expect(h.calls).not.toContain('ensureJobGone');
      expect(h.outcome).toBeUndefined();
    },
  );

  it('a crashed done run is a kept done run: a drop gives its session up', async () => {
    const h = start();
    await podEnds(h, { exitCode: 3, endReason: 'agent_exit', agentStarted: true }, 'done');
    sendSignal(dropSession);

    await expect(h.done).resolves.toEqual({ status: 'succeeded' });
    expect(h.kept).toEqual(['dropped']);
  });

  it('a crashed run can be resumed', async () => {
    const h = start();
    await podEnds(h, { exitCode: 1, endReason: 'agent_exit', agentStarted: true });
    await resumeToSessionUp(h);

    expect(h.pods[1]?.opts).toEqual({ resume: true });
    expect(phase()).toBe('idle');
  });

  it('an agent that exits 0 still succeeds and the run is finalized', async () => {
    const h = start();
    await toRunning(h);
    h.pods[0]?.exit({ exitCode: 0, endReason: 'agent_exit', agentStarted: true });

    await expect(h.done).resolves.toEqual({ status: 'succeeded', exitCode: 0 });
    expect(h.parks).toEqual([]);
    expect(h.calls).toContain('deleteRunVolume');
  });

  it('a pod that died before the agent started still fails the run', async () => {
    const h = start();
    await toRunning(h);
    h.pods[0]?.exit({ exitCode: 1, agentStarted: false });

    await expect(h.done).resolves.toMatchObject({
      status: 'failed',
      failureReason: 'run exited with code 1 before the agent started',
    });
    expect(h.parks).toEqual([]);
  });

  it('a run that started before pod-lost-parks existed keeps failing on a non-zero exit', async () => {
    runtime.unpatched.add('pod-lost-parks');
    const h = start();
    await toRunning(h);
    h.pods[0]?.exit({ exitCode: 137, agentStarted: true });

    await expect(h.done).resolves.toMatchObject({ status: 'failed', failureReason: 'agent exited with code 137' });
    expect(h.parks).toEqual([]);
  });

  // origin/main: `followPodLogs` threw these two texts, and the workflow wrote `failureReason(err)`, which prefixes the
  // activity name. No stage, no exit code, no scrollback tail.
  it.each([
    ['the pod disappeared', 'the run pod disappeared before it reported an exit code'],
    ['the pod ended without an exit code', 'the run pod ended (Unknown) without an exit code: NodeLost'],
  ])('a run that started before pod-lost-parks existed keeps the old failure text when %s', async (_name, lostText) => {
    runtime.unpatched.add('pod-lost-parks');
    const h = start();
    await toRunning(h);
    h.pods[0]?.exit({ exitCode: -1, agentStarted: true, podLost: true, lostText, scrollbackTail: 'last lines' });

    const outcome = await h.done;
    expect(outcome).toMatchObject({ status: 'failed', failureReason: `followPodLogs failed: ${lostText}` });
    expect(outcome).not.toHaveProperty('failureStage');
    expect(outcome).not.toHaveProperty('exitCode');
    expect(outcome).not.toHaveProperty('scrollbackTail');
    expect(h.parks).toEqual([]);
  });
});

describe('the session ending', () => {
  /** A pod that ignores the end request and keeps running until the test makes it exit. */
  async function endingWithStuckPod(h: Harness): Promise<void> {
    runtime.activities.endSession = () => {
      h.calls.push('endSession');
      return Promise.resolve();
    };
    await toRunning(h);
    sendSignal(agentState, 'needs_input');
    await waitFor('idle timer', () => pendingTimers().includes(600_000));
    fireTimer(600_000);
    await waitFor('ending', () => phase() === 'ending');
  }

  it('the idle timer parks the run with the idle_timeout reason', async () => {
    const h = start();
    await toParked(h, 'needs_input');
    expect(h.parks).toEqual([expect.objectContaining({ kind: 'needs_input', reason: 'idle_timeout' })]);
  });

  it('a run that started before pod-lost-parks existed still parks on the idle timer, with the idle_timeout reason', async () => {
    runtime.unpatched.add('pod-lost-parks');
    const h = start();
    await toParked(h, 'needs_input');
    expect(h.parks).toEqual([expect.objectContaining({ kind: 'needs_input', reason: 'idle_timeout' })]);
  });

  it('a resume sent while the session is ending is accepted and starts a new pod right after the park', async () => {
    const h = start();
    await endingWithStuckPod(h);
    await expect(sendUpdate(resumeRun)).resolves.toEqual({ accepted: true });
    // Still ending: the pod has not ended yet, so nothing is parked or started.
    expect(phase()).toBe('ending');
    expect(h.pods).toHaveLength(1);

    h.pods[0]?.exit({ exitCode: 0, agentStarted: true });
    await waitFor('resumed pod', () => h.pods.length === 2);
    sendSignal(sessionStarted);
    await waitFor('resume finished', () => phase() === 'idle');

    expect(afterCalls(h, 'endSession').slice(0, 4)).toEqual([
      'deleteJob',
      'parkRun:needs_input',
      'postComment:paused',
      'setRunStatus:queued',
    ]);
    expect(h.createOpts[1]).toMatchObject({ resume: true });
  });

  it('a queued resume that finds nothing kept is told to parkRun, so the run records why it could not run', async () => {
    const h = start({}, { keepSeconds: null }); // the park keeps nothing
    await endingWithStuckPod(h);
    await expect(sendUpdate(resumeRun)).resolves.toEqual({ accepted: true });
    h.pods[0]?.exit({ exitCode: 0, agentStarted: true });

    await expect(h.done).resolves.toMatchObject({ status: 'succeeded' });
    expect(h.parks).toEqual([expect.objectContaining({ kind: 'needs_input', resumeQueued: true })]);
    expect(h.pods).toHaveLength(1); // no pod was started
    expect(afterCalls(h, 'endSession').slice(0, 3)).toEqual(['deleteJob', 'parkRun:needs_input', 'postComment:paused']);
  });

  it('a park with no resume queued does not mention one', async () => {
    const h = start();
    await toParked(h, 'needs_input');
    expect(h.parks).toHaveLength(1);
    expect(h.parks[0]).not.toHaveProperty('resumeQueued');
  });

  it('a second resume while one is queued behind the ending is refused', async () => {
    const h = start();
    await endingWithStuckPod(h);
    await sendUpdate(resumeRun);
    await expect(sendUpdate(resumeRun)).rejects.toThrow('already being resumed');
  });

  it('a resume is refused while a person Finish is ending the session', async () => {
    const h = start();
    runtime.activities.endSession = () => {
      h.calls.push('endSession');
      return Promise.resolve();
    };
    await toRunning(h);
    sendSignal(agentState, 'needs_input');
    await sendUpdate(finishRun);
    await waitFor('ending', () => phase() === 'ending');
    await expect(sendUpdate(resumeRun)).rejects.toThrow('being finished');

    h.pods[0]?.exit({ exitCode: 0, agentStarted: true });
    await expect(h.done).resolves.toMatchObject({ status: 'succeeded' });
  });

  it('a resume is refused while a run that cannot park is ending (it started before pause and resume existed)', async () => {
    runtime.unpatched.add('pause-resume');
    const h = start();
    await endingWithStuckPod(h);
    await expect(sendUpdate(resumeRun)).rejects.toThrow('Only a paused run');
  });

  it('a cancel while the session is ending still wins: cancelled, Job and volume deleted, a queued resume dropped', async () => {
    const h = start();
    await endingWithStuckPod(h);
    await sendUpdate(resumeRun);
    sendSignal(cancel);

    await expect(h.done).resolves.toEqual({ status: 'cancelled' });
    expect(h.calls).toEqual(expect.arrayContaining(['deleteJob', 'deleteRunVolume']));
    expect(h.calls).not.toContain('createRunSecretAndJob:resume');
    expect(h.parks).toEqual([]);
  });
});

describe('attach leases (attach-leases)', () => {
  const ID_A = '11111111-1111-4111-8111-111111111111';
  const ID_B = '22222222-2222-4222-8222-222222222222';
  const TTL = 300_000;
  const attached = (): number => runQuery<RunState>(runState).terminalAttached;
  const at = (seconds: number): void => {
    vi.setSystemTime(new Date(T0.getTime() + seconds * 1000));
  };

  /** A running pod that needs a person, with the idle timer armed. */
  async function idleRun(overrides: Partial<RunContext> = {}): Promise<Harness> {
    const h = start(overrides);
    await toRunning(h);
    sendSignal(agentState, 'needs_input');
    await waitFor('idle timer', () => pendingTimers().includes(600_000));
    return h;
  }

  it('an id that never renews expires after the lease time and the idle timer then parks the run', async () => {
    const h = await idleRun();
    sendSignal(terminalAttached, ID_A);
    await waitFor('lease timer', () => pendingTimers().includes(TTL));
    expect(pendingTimers()).not.toContain(600_000);
    expect(attached()).toBe(1);

    at(300);
    fireTimer(TTL);
    await waitFor('idle timer back', () => pendingTimers().includes(600_000));
    expect(attached()).toBe(0);

    at(900);
    fireTimer(600_000);
    await waitFor('parked', () => phase() === 'parked');
    expect(h.parks).toEqual([expect.objectContaining({ kind: 'needs_input' })]);
  });

  it('a renewed id keeps the idle timer off until its renewed lease runs out', async () => {
    await idleRun();
    sendSignal(terminalAttached, ID_A);
    await waitFor('lease timer', () => pendingTimers().includes(TTL));

    at(120);
    sendSignal(terminalLease, [ID_A]);
    at(300);
    fireTimer(TTL);
    // The old timer fired, but the lease was renewed to 420 s: 120 s remain.
    await waitFor('shorter lease timer', () => pendingTimers().includes(120_000));
    expect(attached()).toBe(1);
    expect(pendingTimers()).not.toContain(600_000);

    at(420);
    fireTimer(120_000);
    await waitFor('idle timer back', () => pendingTimers().includes(600_000));
    expect(attached()).toBe(0);
  });

  it('a lease for an unknown id holds nothing, and a malformed id is ignored', async () => {
    await idleRun();
    sendSignal(terminalLease, [ID_A]);
    sendSignal(terminalAttached, 'not-an-id');
    sendSignal(terminalAttached, 42 as unknown as string);
    sendSignal(terminalLease, 'nope' as unknown as string[]);
    await settle();
    expect(attached()).toBe(0);
    await waitFor('idle timer', () => pendingTimers().includes(600_000));
  });

  it('a detach with the id frees the idle timer at once; a second detach and a detach before attach change nothing', async () => {
    await idleRun();
    sendSignal(terminalDetached, ID_B);
    sendSignal(terminalAttached, ID_A);
    await waitFor('lease timer', () => pendingTimers().includes(TTL));
    sendSignal(terminalDetached, ID_A);
    sendSignal(terminalDetached, ID_A);
    await waitFor('idle timer back', () => pendingTimers().includes(600_000));
    expect(attached()).toBe(0);
  });

  it('legacy signals without an id still count, next to leases', async () => {
    await idleRun();
    sendSignal(terminalAttached);
    sendSignal(terminalAttached, ID_A);
    await settle();
    expect(attached()).toBe(2);
    sendSignal(terminalDetached, ID_A);
    await settle();
    // The id-less attach is a plain counter: no lease expiry applies to it.
    expect(attached()).toBe(1);
    expect(pendingTimers()).not.toContain(600_000);
    sendSignal(terminalDetached);
    sendSignal(terminalDetached);
    await waitFor('idle timer back', () => pendingTimers().includes(600_000));
    expect(attached()).toBe(0);
  });

  it('the lease time is a test seam from loadRun', async () => {
    await idleRun({ leaseTtlSeconds: 60 });
    sendSignal(terminalAttached, ID_A);
    await waitFor('short lease timer', () => pendingTimers().includes(60_000));
  });

  it('a run that started before attach-leases counts every attach as a plain counter and ignores lease signals', async () => {
    runtime.unpatched.add('attach-leases');
    await idleRun();
    sendSignal(terminalAttached, ID_A);
    sendSignal(terminalLease, [ID_A]);
    await settle();
    expect(attached()).toBe(1);
    expect(pendingTimers()).not.toContain(TTL);
    expect(pendingTimers()).not.toContain(600_000);
    sendSignal(terminalDetached);
    await waitFor('idle timer back', () => pendingTimers().includes(600_000));
  });

  it('no lease timer is scheduled while the agent works: expired ids are dropped when the loop next runs', async () => {
    const h = start();
    await toRunning(h);
    sendSignal(terminalAttached, ID_A);
    await settle();
    expect(phase()).toBe('running');
    expect(attached()).toBe(1);
    expect(pendingTimers()).not.toContain(TTL);
    // A renewal while working also starts nothing.
    sendSignal(terminalLease, [ID_A]);
    await settle();
    expect(pendingTimers()).not.toContain(TTL);
    // At the turn boundary the lease timer starts, counting from the last renewal.
    sendSignal(agentState, 'needs_input');
    await waitFor('lease timer', () => pendingTimers().includes(TTL));
  });

  it('a lease that expires while the agent works is gone by the time the turn ends', async () => {
    const h = start();
    await toRunning(h);
    sendSignal(terminalAttached, ID_A);
    at(400);
    sendSignal(agentState, 'needs_input');
    await waitFor('idle timer', () => pendingTimers().includes(600_000));
    expect(attached()).toBe(0);
  });

  it('a pod that dies while a terminal is attached parks the run with no leases left', async () => {
    const h = start({}, { keepSeconds: 3600 });
    await toRunning(h);
    sendSignal(agentState, 'needs_input');
    await waitFor('idle', () => phase() === 'idle');
    sendSignal(terminalAttached, ID_A);
    await waitFor('lease timer', () => pendingTimers().includes(TTL));
    h.pods[0]?.exit({ exitCode: 137, agentStarted: true });
    await waitFor('parked', () => phase() === 'parked');
    expect(attached()).toBe(0);
  });
});
