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
  parks: { kind: string }[];
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
  a.parkRun = (_c: RunContext, input: { kind: string }): Promise<ParkResult> => {
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

  it('a re-opened succeeded run whose agent then fails ends failed, with its finish comment', async () => {
    const h = start();
    await toParked(h, 'done');
    await resumeToSessionUp(h);
    h.pods[1]?.exit({ exitCode: 1, agentStarted: true });

    await expect(h.done).resolves.toEqual({
      status: 'failed',
      exitCode: 1,
      failureReason: 'agent exited with code 1',
    });
    expect(h.statuses.at(-1)).toMatchObject({ status: 'failed', failureStage: 'agent', session: null });
    expect(h.comments.at(-1)).toMatchObject({ kind: 'finish', details: { status: 'failed', failureStage: 'agent' } });
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
