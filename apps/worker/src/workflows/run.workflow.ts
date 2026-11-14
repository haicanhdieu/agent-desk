import {
  ActivityCancellationType,
  ActivityFailure,
  ApplicationFailure,
  CancellationScope,
  condition,
  getExternalWorkflowHandle,
  isCancellation,
  log,
  proxyActivities,
  setHandler,
  sleep,
} from '@temporalio/workflow';
import type { RunStatus } from '@agentdesk/contracts';
import type { FinishDetails, FollowPodLogsResult, RunActivities, RunContext } from '../activities/run.activities';
import {
  agentState,
  cancel,
  finish,
  finishRun,
  granted,
  releaseSlot,
  resumed,
  runState,
  terminalAttached,
  terminalDetached,
  turnFinished,
  type RunPhase,
} from './signals';
import { ACTIVITY_RETRY as RETRY } from './retry';

/** Mirrors IDLE_END_SECONDS in @agentdesk/core (workflow code cannot import core); used when loadRun gives none. */
export const IDLE_END_SECONDS_DEFAULT = 600;
/** Mirrors POD_PENDING_TIMEOUT in ../activities/run.activities (a value import would pull activity code in). */
const POD_PENDING_TIMEOUT = 'PodPendingTimeout';
/** followPodLogs may run for the whole run; it gets this much beyond the hard timer before Temporal gives up. */
const LOGS_TIMEOUT_MARGIN_SECONDS = 300;
const FAILURE_REASON_MAX = 1000;
/** Spec cap on `timeout_seconds` (the workspace token lives one hour); the hard timer never exceeds it. */
const TIMEOUT_SECONDS_MAX = 3300;
const SCROLLBACK_TAIL_MAX = 4000;

type FinalStatus = 'succeeded' | 'failed' | 'cancelled' | 'timed_out';
const FINAL: readonly string[] = ['succeeded', 'failed', 'cancelled', 'timed_out'] satisfies FinalStatus[];
const isFinal = (s: RunStatus): s is FinalStatus => FINAL.includes(s);
const ALREADY_FINAL = 'already_final';

export interface RunWorkflowInput {
  orgId: string;
  runId: string;
}

export interface RunOutcome {
  status: FinalStatus;
  exitCode?: number;
  failureReason?: string;
}

interface Outcome extends RunOutcome {
  /** The container exited on its own, so the Job only needs to be confirmed gone; otherwise it is deleted. */
  podExited: boolean;
  scrollbackTail?: string;
  failureStage?: 'setup' | 'agent';
}

const act = proxyActivities<RunActivities>({ startToCloseTimeout: '2 minutes', retry: RETRY });
/**
 * Activities whose side effect must be settled before `finalize` runs: on cancel or hard timeout the workflow waits for
 * the in-flight attempt to finish (or acknowledge the cancel) instead of abandoning it. Otherwise a Job created after
 * finalize's `deleteJob` would be orphaned with live credentials, and a slot request landing after `releaseSlot` would
 * re-queue a dead run. Cancelling still stops retries.
 */
const settled = proxyActivities<Pick<RunActivities, 'requestSlot' | 'createRunSecretAndJob' | 'postComment'>>({
  startToCloseTimeout: '2 minutes',
  retry: RETRY,
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
});

function failureReason(err: unknown): string {
  let reason: string;
  if (err instanceof ActivityFailure) {
    const cause = err.cause;
    if (cause instanceof ApplicationFailure && cause.type === POD_PENDING_TIMEOUT) reason = cause.message;
    else reason = `${err.activityType ?? 'activity'} failed: ${cause?.message ?? err.message}`;
  } else if (err instanceof Error) {
    reason = err.message;
  } else {
    reason = 'unknown error';
  }
  return reason.slice(0, FAILURE_REASON_MAX);
}

/**
 * Spec §6.2. One run: acquire a project slot, create the Job, follow its logs, react to signals, and always finish
 * through `finalize` (non-cancellable), which removes the Job, writes the final status, posts the finish comment once
 * and releases the slot once.
 *
 * Cancellation model: everything before `finalize` runs in `body`. The `cancel` signal and the hard timer cancel that
 * scope; so does a Temporal-level cancellation of the workflow. The cancellation reaches whatever is in flight
 * (waiting for the slot, a starting activity, the main loop, followPodLogs) and lands in the same `finalize`.
 *
 * Status writes: the workflow writes `starting`, `running` after `resumed` (plus `idle` again when the next turn ends,
 * since followPodLogs' `idle` may have landed before that `running`), and the final status. `followPodLogs` writes
 * `running` on the first log line and `idle` on each Stop-hook line (then signals `turnFinished`); it signals `resumed` on each UserPromptSubmit-hook line.
 */
export async function RunWorkflow(input: RunWorkflowInput): Promise<RunOutcome> {
  const { orgId, runId } = input;
  let phase: RunPhase = 'loading';
  let attached = 0;
  let isGranted = false;
  let finishRequested = false;
  let resumePending = false;
  /** The Job's session is being ended (finish, idle end); also what a `finishRun` update waits for. */
  let ending = false;
  /** The phase when the hard timer fired: a run that had declared done counts as succeeded. */
  let phaseAtTimeout: RunPhase | undefined;
  /** The workflow wrote `running` (after `resumed`) since the last turn ended. */
  let wroteRunningSinceTurn = false;
  /** A turn ended after (or while) the workflow wrote `running`: followPodLogs' `idle` may be older, so write it again. */
  let idleFixPending = false;
  /** Bumped on every state change the idle timer cares about; a changed value restarts the timer. */
  let epoch = 0;
  let stopReason: 'cancelled' | 'timed_out' | undefined;

  let ctx: RunContext | undefined;
  let slotRequested = false;
  let jobMayExist = false;

  const currentPhase = (): RunPhase => phase;
  const body = new CancellationScope();
  const hardTimer = new CancellationScope();
  const stop = (reason: 'cancelled' | 'timed_out'): void => {
    if (stopReason !== undefined || phase === 'finalizing' || phase === 'done') return;
    stopReason = reason;
    if (reason === 'timed_out') phaseAtTimeout = phase;
    body.cancel();
  };

  setHandler(runState, () => ({ phase, terminalAttached: attached }));
  // A `granted` that arrives after the run stopped waiting (cancelled, or already granted) changes nothing.
  setHandler(granted, () => {
    isGranted = true;
  });
  const turnEnded = (next: 'idle' | 'agent_done'): void => {
    if (phase !== 'running' && !(phase === 'idle' && next === 'agent_done')) return;
    phase = next;
    resumePending = false;
    if (wroteRunningSinceTurn) {
      wroteRunningSinceTurn = false;
      idleFixPending = true;
    }
    epoch += 1;
  };
  const resumeRunning = (): void => {
    if ((phase !== 'idle' && phase !== 'agent_done') || finishRequested) return;
    phase = 'running';
    resumePending = true;
    epoch += 1;
  };
  setHandler(agentState, (state) => {
    if (state === 'needs_input') turnEnded('idle');
    else if (state === 'done') turnEnded('agent_done');
    else resumeRunning();
  });
  // Legacy signals, kept for histories recorded before `agentState`.
  setHandler(turnFinished, () => turnEnded('idle'));
  setHandler(resumed, resumeRunning);
  setHandler(terminalAttached, () => {
    attached += 1;
    epoch += 1;
  });
  setHandler(terminalDetached, () => {
    attached = Math.max(0, attached - 1);
    epoch += 1;
  });
  // Legacy signal: honoured only while idle or done; a finish sent while running is dropped, not deferred.
  setHandler(finish, () => {
    if (phase === 'idle' || phase === 'agent_done') finishRequested = true;
  });
  // The API's finish: rejected unless the run needs a person or is done, else answered once the session is ending.
  setHandler(
    finishRun,
    async () => {
      finishRequested = true;
      await condition(() => ending);
      return { accepted: true as const };
    },
    {
      validator: () => {
        if ((phase !== 'idle' && phase !== 'agent_done') || ending) {
          throw ApplicationFailure.nonRetryable(
            `Only a run that needs you or is done can be finished (phase is ${phase})`,
            'NotFinishable',
          );
        }
      },
    },
  );
  setHandler(cancel, () => stop('cancelled'));

  const status = (
    s: RunStatus,
    extra: { exitCode?: number; failureReason?: string; failureStage?: 'setup' | 'agent' } = {},
  ) => act.setRunStatus({ orgId, runId, status: s, ...extra, at: new Date().toISOString() });

  async function run(): Promise<Outcome | typeof ALREADY_FINAL> {
    ctx = await act.loadRun(orgId, runId);
    const c = ctx;
    // A run another execution already finished (a reset, or a start racing a finished run) is left alone.
    if (isFinal(c.status)) return ALREADY_FINAL;

    // 1. Acquire a slot.
    phase = 'waiting_slot';
    slotRequested = true;
    // Race note: a cancel here waits for the request to land (WAIT_CANCELLATION_COMPLETED), so finalize's releaseSlot
    // is always signalled after requestSlot and the gate drops the run. A `granted` the gate sent before it saw the
    // release only flips `isGranted`, which nobody reads any more.
    await settled.requestSlot({ projectId: c.projectId, runId, limit: c.maxConcurrentRuns });
    await condition(() => isGranted);

    // 2-3. Start. The hard timer covers everything from here on (the workspace token lives one hour).
    phase = 'starting';
    const timeoutSeconds = Math.min(c.timeoutSeconds, TIMEOUT_SECONDS_MAX);
    hardTimer
      .run(() => sleep(timeoutSeconds * 1000))
      .then(
        () => stop('timed_out'),
        () => undefined,
      );
    await status('starting');
    // The workspace token is minted inside this activity and never enters workflow history (ruling R19).
    jobMayExist = true;
    await settled.createRunSecretAndJob(c);
    await settled.postComment(c, 'start');

    // 4. Follow the logs.
    phase = 'running';
    const logsActs = proxyActivities<Pick<RunActivities, 'followPodLogs'>>({
      startToCloseTimeout: (timeoutSeconds + LOGS_TIMEOUT_MARGIN_SECONDS) * 1000,
      heartbeatTimeout: '60s',
      retry: { ...RETRY, nonRetryableErrorTypes: [POD_PENDING_TIMEOUT] },
    });
    let logsDone = false;
    let logsResult: FollowPodLogsResult | undefined;
    let logsError: unknown;
    logsActs.followPodLogs(c).then(
      (r) => {
        logsResult = r;
        logsDone = true;
      },
      (err: unknown) => {
        logsError = err;
        logsDone = true;
      },
    );

    // 5. Main loop.
    const idleMs = (c.idleEndSeconds ?? IDLE_END_SECONDS_DEFAULT) * 1000;
    while (!logsDone) {
      if (resumePending) {
        resumePending = false;
        wroteRunningSinceTurn = true;
        await status('running');
        continue;
      }
      if (idleFixPending) {
        idleFixPending = false;
        const p = currentPhase();
        if (p === 'idle') await status('idle');
        else if (p === 'agent_done') await status('done');
        continue;
      }
      if (!ending && finishRequested) {
        ending = true;
        phase = 'ending';
        await act.endSession(c);
        continue;
      }
      const seen = epoch;
      // Every term must turn false once handled, or condition() resolves at once and the loop spins.
      const wake = () => epoch !== seen || logsDone || (finishRequested && !ending) || resumePending || idleFixPending;
      // phase is read through a call: signal handlers change it between awaits, which TS narrowing cannot see.
      const p = currentPhase();
      if (!ending && (p === 'idle' || p === 'agent_done') && attached === 0) {
        if (!(await condition(wake, idleMs))) {
          ending = true;
          phase = 'ending';
          await act.endSession(c);
        }
      } else {
        await condition(wake);
      }
    }
    if (logsError !== undefined) throw logsError;
    if (logsResult === undefined) throw ApplicationFailure.nonRetryable('followPodLogs returned nothing');
    const { exitCode, scrollbackTail, failureStage, setupExitCode, agentStarted } = logsResult;
    // The runner stopped the run before the agent started: report the setup failure. The run's exit code is the setup
    // script's (the runner's own 78 only when setup timed out or the script's code is unknown).
    if (failureStage === 'setup') {
      return {
        status: 'failed',
        exitCode: setupExitCode ?? exitCode,
        failureReason: setupExitCode !== undefined ? `setup failed (exit ${setupExitCode})` : 'setup timed out',
        failureStage: 'setup',
        podExited: true,
      };
    }
    // Ended by us (finish or idle end): the session was idle, so the run succeeded whatever tmux's exit status was.
    if (ending || exitCode === 0) return { status: 'succeeded', exitCode, podExited: true };
    return {
      status: 'failed',
      exitCode,
      // `agentStarted` absent (a result from before the field existed) keeps the old labelling. False: the pod died in
      // checkout, plugins or setup without a setup marker, so it is neither a setup nor an agent failure.
      ...(agentStarted === false
        ? { failureReason: `run exited with code ${exitCode} before the agent started` }
        : { failureReason: `agent exited with code ${exitCode}`, failureStage: 'agent' as const }),
      podExited: true,
      ...(scrollbackTail !== undefined ? { scrollbackTail: scrollbackTail.slice(-SCROLLBACK_TAIL_MAX) } : {}),
    };
  }

  let outcome: Outcome | typeof ALREADY_FINAL;
  try {
    outcome = await body.run(run);
  } catch (err) {
    if (isCancellation(err)) {
      const timedOutDone = stopReason === 'timed_out' && phaseAtTimeout === 'agent_done';
      outcome = { status: timedOutDone ? 'succeeded' : (stopReason ?? 'cancelled'), podExited: false };
    } else outcome = { status: 'failed', failureReason: failureReason(err), podExited: false };
  }
  if (outcome === ALREADY_FINAL) {
    phase = 'done';
    hardTimer.cancel();
    return { status: ctx?.status && isFinal(ctx.status) ? ctx.status : 'failed' };
  }
  return finalize(outcome);

  async function finalize(o: Outcome): Promise<RunOutcome> {
    phase = 'finalizing';
    hardTimer.cancel();
    if (ctx === undefined) {
      // Stopped before loadRun returned (a cancel while it was in flight): load the context now so the finish comment
      // still posts (spec step 6, ruling R20). Best effort: without it the comment is skipped.
      const late = await CancellationScope.nonCancellable(async (): Promise<RunContext | undefined> => {
        try {
          return await act.loadRun(orgId, runId);
        } catch (err) {
          log.warn('run finalize step failed', { step: 'loadRun', error: errorKind(err) });
          return undefined;
        }
      });
      ctx = late;
      if (late !== undefined && isFinal(late.status)) {
        // Another execution already finished this run: leave it alone, as `run` would have.
        phase = 'done';
        return { status: late.status };
      }
    }
    let statusError: unknown;
    await CancellationScope.nonCancellable(async () => {
      const c = ctx;
      if (c && jobMayExist) {
        await attempt(o.podExited ? 'ensureJobGone' : 'deleteJob', () =>
          o.podExited ? act.ensureJobGone(c) : act.deleteJob(c),
        );
      }
      statusError = await attempt('setRunStatus', () =>
        status(o.status, {
          ...(o.exitCode !== undefined ? { exitCode: o.exitCode } : {}),
          ...(o.failureReason !== undefined ? { failureReason: o.failureReason } : {}),
          ...(o.failureStage !== undefined ? { failureStage: o.failureStage } : {}),
        }),
      );
      if (c) {
        const details: FinishDetails = {
          status: o.status,
          ...(o.exitCode !== undefined ? { exitCode: o.exitCode } : {}),
          ...(o.failureReason !== undefined ? { failureReason: o.failureReason } : {}),
          ...(o.failureStage !== undefined ? { failureStage: o.failureStage } : {}),
          ...(o.status === 'failed' && o.scrollbackTail !== undefined ? { scrollbackTail: o.scrollbackTail } : {}),
        };
        await attempt('postComment(finish)', () => act.postComment(c, 'finish', details));
      }
      if (c && slotRequested) {
        slotRequested = false;
        await attempt('releaseSlot', () => getExternalWorkflowHandle(`gate-${c.projectId}`).signal(releaseSlot, runId));
      }
    });
    phase = 'done';
    if (statusError !== undefined) {
      throw ApplicationFailure.nonRetryable(`final setRunStatus(${o.status}) failed: ${failureReason(statusError)}`);
    }
    return {
      status: o.status,
      ...(o.exitCode !== undefined ? { exitCode: o.exitCode } : {}),
      ...(o.failureReason !== undefined ? { failureReason: o.failureReason } : {}),
    };
  }
}

/**
 * Runs one cleanup step; a failure (after the activity's own retries) must not skip the steps after it. Logs only the
 * step and the error's kind: messages can quote provider responses and are not logged.
 */
async function attempt(step: string, fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return undefined;
  } catch (err) {
    log.warn('run finalize step failed', { step, error: errorKind(err) });
    return err;
  }
}

function errorKind(err: unknown): string {
  if (err instanceof ActivityFailure) {
    const cause = err.cause;
    return `ActivityFailure(${cause instanceof ApplicationFailure ? (cause.type ?? cause.name) : (cause?.name ?? 'unknown')})`;
  }
  return err instanceof Error ? err.name : 'unknown';
}
