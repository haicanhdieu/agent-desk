import {
  ActivityCancellationType,
  ActivityFailure,
  ApplicationFailure,
  CancellationScope,
  condition,
  getExternalWorkflowHandle,
  isCancellation,
  log,
  patched,
  proxyActivities,
  setHandler,
  sleep,
  workflowInfo,
} from '@temporalio/workflow';
import type { RunStatus } from '@agentdesk/contracts';
import type { FinishDetails, FollowPodLogsResult, RunActivities, RunContext } from '../activities/run.activities';
import {
  agentState,
  cancel,
  dropSession,
  finish,
  finishRun,
  granted,
  releaseSlot,
  resumed,
  resumeRun,
  runState,
  sessionStarted,
  terminalAttached,
  terminalDetached,
  terminalLease,
  turnFinished,
  type RunPhase,
} from './signals';
import {
  LEASE_TTL_MS,
  attach as attachLease,
  count as leaseCount,
  detach as detachLease,
  expire as expireLeases,
  nextExpiryMs,
  renew as renewLeases,
  type Leases,
} from './attach-leases';
import {
  cancelEffect,
  endOutcome,
  parkKindOf,
  phaseOfParkKind,
  resumeRejection,
  sessionAllowanceSeconds,
  statusOfParkKind,
  type ParkKind,
  type PauseReason,
} from './park';
import { ACTIVITY_RETRY as RETRY } from './retry';
import { historyTooLong, refreshWaitSeconds, type TokenRefreshPlan } from './token-refresh';

export { TOKEN_REFRESH_INTERVAL_SECONDS_DEFAULT } from './token-refresh';
import {
  acceptsLegacyFinish,
  atTurnBoundary,
  finishRunRejection,
  finishRunSettled,
  idleFixStatus,
  idleTimerApplies,
  nextTurnState,
  stoppedStatus,
  type TurnEvent,
} from './agent-phase';

/** Mirrors IDLE_END_SECONDS in @agentdesk/core (workflow code cannot import core); used when loadRun gives none. */
export const IDLE_END_SECONDS_DEFAULT = 1800;

/** Mirrors END_REASONS / EndReason in @agentdesk/core (workflow code cannot import core); a test asserts equality. */
export const END_REASONS = ['stop_request', 'agent_exit', 'session_gone', 'signal'] as const;
export type EndReason = (typeof END_REASONS)[number];
/** Mirrors ENDING_DEADLINE_SECONDS in @agentdesk/core; used when loadRun gives none. */
export const ENDING_DEADLINE_SECONDS_DEFAULT = 90;
/** Mirrors POD_PENDING_TIMEOUT in ../activities/run.activities (a value import would pull activity code in). */
const POD_PENDING_TIMEOUT = 'PodPendingTimeout';
/** Mirrors the type `createRunSecretAndJob` throws for a resume whose agent or credential is gone. */
const NO_AGENT_CREDENTIAL = 'NoAgentCredential';
/** followPodLogs may run for the whole run; it gets this much beyond the hard timer before Temporal gives up. */
const LOGS_TIMEOUT_MARGIN_SECONDS = 300;
/** Marks runs that refresh their token, so a run started before this existed replays unchanged. */
const TOKEN_REFRESH_PATCH = 'token-refresh';
/** Marks runs whose cleanup deletes the run volume, so a run already in `finalize` at deploy time replays unchanged. */
const RUN_VOLUME_PATCH = 'run-volume';
/** Marks runs whose `ending` has a deadline (then the Job is deleted), so a run already `ending` at deploy time replays unchanged. */
const ENDING_DEADLINE_PATCH = 'ending-deadline';
/** Marks runs that park a pod that was lost or whose agent crashed, and queue a resume sent while `ending`; read once, right after `pauseResume`. */
const POD_LOST_PATCH = 'pod-lost-parks';
/** Marks runs whose terminal attach state is a set of expiring leases, not a counter; read once, right after `podLostParks`. */
const ATTACH_LEASES_PATCH = 'attach-leases';
/** Marks runs that park on idle instead of ending; evaluated once, right after `loadRun`. */
const PAUSE_RESUME_PATCH = 'pause-resume';
/** Plain-language reason shown on the run when its history grew too long. */
export const HISTORY_TOO_LONG_REASON =
  'The run was stopped because its activity log grew too long for the scheduler to keep tracking. Start a new run to continue.';
const FAILURE_REASON_MAX = 1000;
const SCROLLBACK_TAIL_MAX = 4000;

type FinalStatus = 'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'expired';
const FINAL: readonly string[] = ['succeeded', 'failed', 'cancelled', 'timed_out', 'expired'] satisfies FinalStatus[];
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

/** One pod's `followPodLogs`, filled in when it ends. */
interface Pod {
  done: boolean;
  result?: FollowPodLogsResult;
  error?: unknown;
  /** `followPodLogs` runs inside it; cancelling it stops following a pod that will not exit. */
  scope: CancellationScope;
  /** The ending deadline passed: the pod was deleted and `done` set without a result. */
  abandoned: boolean;
}

interface Outcome extends RunOutcome {
  /** The container exited on its own, so the Job only needs to be confirmed gone; otherwise it is deleted. */
  podExited: boolean;
  /** The status and finish comment are already written (a parked run that ended): skip `finalize`. */
  settled?: true;
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

/** Why a resume sent while the session is ending cannot be queued, or `undefined` when it can. */
function queuedResumeRejection(
  finishRequested: boolean,
  alreadyQueued: boolean,
  willPark: boolean,
): string | undefined {
  if (finishRequested) return 'This run is being finished';
  if (alreadyQueued) return 'This run is already being resumed';
  if (!willPark) return 'Only a paused run, or a finished run whose session is still kept, can be resumed';
  return undefined;
}

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
 * Status writes: the workflow writes `starting`, `running` after an agent `working` state (or the legacy `resumed`),
 * the final status, and re-writes `idle` or `done` after a turn ends when it had written `running` since (followPodLogs'
 * write may be older). `followPodLogs` writes `running` on the first log line and on each agent_state line (`working`,
 * and `waiting` with `waitingOn`), `idle` for `needs_input`, `done` for `done`, and signals `agentState` for each; the
 * workflow never writes `running` for `waiting`, so `waitingOn` survives. A declared `done` is the `agent_done` phase
 * (the idle timer and `finishRun` apply), distinct from the workflow's own `done`.
 */
export async function RunWorkflow(input: RunWorkflowInput): Promise<RunOutcome> {
  const { orgId, runId } = input;
  let phase: RunPhase = 'loading';
  /** Attach signals without a connection id (API pods that predate leases): a plain counter. */
  let legacyAttached = 0;
  /** Terminal connections by id, each with the time its lease runs out; used only with `attachLeases`. */
  let leases: Leases = new Map();
  /** `patched('attach-leases')`, read once right after `podLostParks`; false keeps the counter for runs that started before. */
  let attachLeases = false;
  let leaseTtlMs = LEASE_TTL_MS;
  /** Terminals the workflow counts as attached: the id-less counter plus the leases that have not run out. */
  const attached = (): number => legacyAttached + leaseCount(leases);
  /** A signal carries an id when the API is new enough to send one; null is how JSON spells "none". */
  const hasId = (id: string | null | undefined): id is string => id !== undefined && id !== null;
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
  /** `patched('pause-resume')`, read once after `loadRun`; false keeps today's behaviour for runs that started before. */
  let pauseResume = false;
  /** `patched('ending-deadline')`, read once right after `pauseResume`. */
  let endingDeadline = false;
  /** `patched('pod-lost-parks')`, read once right after `endingDeadline`. */
  let podLostParks = false;
  /** When the session end began (workflow time); the deadline counts from it. */
  let endingStartedMs = 0;
  /** What the run was doing when the idle timer fired; set only with `pauseResume`. */
  let parkKind: ParkKind | undefined;
  /** `dropSession` arrived for a run that is (or is about to be) parked as done. */
  let dropRequested = false;
  /** Seconds the run's pods have used so far; the next pod's allowance is the rest of the limit. */
  let usedSeconds = 0;
  let podStartedMs = 0;

  let ctx: RunContext | undefined;
  let slotRequested = false;
  let jobMayExist = false;

  const currentPhase = (): RunPhase => phase;
  const body = new CancellationScope();
  let hardTimer = new CancellationScope();
  /** A resume was accepted and not yet acted on; the parked wait turns the expiry timer off while it is set. */
  let resumeAccepted = false;
  /** Cancels the resume attempt only (the kept session survives); set while a resume is queued or starting. */
  let resumeScope: CancellationScope | undefined;
  /** Why the resume attempt was aborted from outside (a cancel); a plain reason for the run's event. */
  let resumeAbortReason: string | undefined;
  /** The resumed session reported it started. */
  let sessionUp = false;
  const stop = (reason: 'cancelled' | 'timed_out'): void => {
    if (stopReason !== undefined || phase === 'finalizing' || phase === 'done') return;
    if (reason === 'cancelled') {
      const effect = cancelEffect(phase, parkKind, sessionUp);
      // A parked done run is a finished run: cancel does nothing to it.
      if (effect === 'ignore') return;
      // Before the resumed session is up a cancel only gives up the resume; the kept session stays.
      if (effect === 'abort_resume') {
        resumeAbortReason ??= 'the resume was cancelled';
        resumeScope?.cancel();
        return;
      }
    }
    if (reason === 'timed_out' && phase === 'resuming' && !sessionUp) {
      resumeAbortReason ??= 'the pod could not start';
      resumeScope?.cancel();
      return;
    }
    stopReason = reason;
    if (reason === 'timed_out') phaseAtTimeout = phase;
    body.cancel();
  };

  setHandler(runState, () => ({ phase, terminalAttached: attached() }));
  // A `granted` that arrives after the run stopped waiting (cancelled, or already granted) changes nothing.
  setHandler(granted, () => {
    isGranted = true;
  });
  // The decisions live in ./agent-phase (pure, unit-tested); this only applies the result and restarts the idle timer.
  const onTurn = (event: TurnEvent): void => {
    const next = nextTurnState({ phase, finishRequested, resumePending, wroteRunningSinceTurn, idleFixPending }, event);
    if (next === undefined) return;
    ({ phase, resumePending, wroteRunningSinceTurn, idleFixPending } = next);
    epoch += 1;
  };
  setHandler(agentState, onTurn);
  // Legacy signals, kept for histories recorded before `agentState`.
  setHandler(turnFinished, () => onTurn('needs_input'));
  setHandler(resumed, () => onTurn('working'));
  // Pure decisions live in ./attach-leases. An id (malformed ones are ignored there) is a lease; no id is the old counter.
  setHandler(terminalAttached, (connectionId?: string) => {
    if (attachLeases && hasId(connectionId)) leases = attachLease(leases, connectionId, Date.now(), leaseTtlMs);
    else legacyAttached += 1;
    epoch += 1;
  });
  setHandler(terminalDetached, (connectionId?: string) => {
    if (attachLeases && hasId(connectionId)) leases = detachLease(leases, connectionId);
    else legacyAttached = Math.max(0, legacyAttached - 1);
    epoch += 1;
  });
  // A renewal changes no count, so it does not restart the idle timer; the lease wait below re-reads the expiry.
  setHandler(terminalLease, (connectionIds: string[]) => {
    if (!attachLeases || !Array.isArray(connectionIds)) return;
    leases = renewLeases(leases, connectionIds, Date.now(), leaseTtlMs);
  });
  // Legacy signal: honoured only while idle or done; a finish sent while running is dropped, not deferred.
  setHandler(finish, () => {
    if (acceptsLegacyFinish(phase)) finishRequested = true;
  });
  // The API's finish: rejected unless the run needs a person or is done, else answered once the session is ending.
  setHandler(
    finishRun,
    async () => {
      finishRequested = true;
      await condition(() => finishRunSettled(ending, phase));
      // The run was finalized (pod exit, cancel, timeout) before the session could be ended.
      if (!ending) {
        throw ApplicationFailure.nonRetryable('The run finished before it could be ended', 'NotFinishable');
      }
      return { accepted: true as const };
    },
    {
      validator: () => {
        const rejection = finishRunRejection(phase, ending, parkKind);
        if (rejection !== undefined) throw ApplicationFailure.nonRetryable(rejection, 'NotFinishable');
      },
    },
  );
  // Accepted at once: the API does not wait for the pod. The attempt itself runs from the parked wait.
  setHandler(
    resumeRun,
    () => {
      // A resume sent while the session is ending is queued: the phase stays `ending` until the pod's end is handled,
      // and the park loop runs the resume right after the park.
      if (phase !== 'ending') phase = 'resuming';
      resumeAccepted = true;
      resumeScope = new CancellationScope();
      resumeAbortReason = undefined;
      return { accepted: true as const };
    },
    {
      validator: () => {
        const rejection = resumeRejection(phase);
        if (rejection !== undefined) throw ApplicationFailure.nonRetryable(rejection, 'NotResumable');
        if (phase === 'ending') {
          // A queued resume only makes sense when the end will park the run: the idle timer began it (`parkKind` is set
          // only then), not a person Finish.
          const queuedRejection = queuedResumeRejection(finishRequested, resumeAccepted, parkKind !== undefined);
          if (queuedRejection !== undefined) throw ApplicationFailure.nonRetryable(queuedRejection, 'NotResumable');
        }
      },
    },
  );
  // Only matters while a resume waits for its session; the first pod's and repeated signals change nothing.
  let sessionStartedFlag = false;
  setHandler(sessionStarted, () => {
    if (phase !== 'resuming') return;
    sessionStartedFlag = true;
    // From here a cancel ends the run instead of only giving up the resume.
    sessionUp = true;
  });
  setHandler(cancel, () => stop('cancelled'));
  // Only a done run's kept session is dropped (the per-project cap, a deleted project); a paused run keeps its own.
  setHandler(dropSession, () => {
    if (parkKind === 'done') dropRequested = true;
  });

  const status = (
    s: RunStatus,
    extra: {
      exitCode?: number;
      failureReason?: string;
      failureStage?: 'setup' | 'agent';
      session?: null;
      keepAgentNote?: boolean;
      reopen?: boolean;
    } = {},
  ) => act.setRunStatus({ orgId, runId, status: s, ...extra, at: new Date().toISOString() });

  async function run(): Promise<Outcome | typeof ALREADY_FINAL> {
    ctx = await act.loadRun(orgId, runId);
    const c = ctx;
    // A run another execution already finished (a reset, or a start racing a finished run) is left alone.
    if (isFinal(c.status)) return ALREADY_FINAL;
    pauseResume = patched(PAUSE_RESUME_PATCH);
    endingDeadline = patched(ENDING_DEADLINE_PATCH);
    podLostParks = patched(POD_LOST_PATCH);
    attachLeases = patched(ATTACH_LEASES_PATCH);
    if (c.leaseTtlSeconds !== undefined) leaseTtlMs = c.leaseTtlSeconds * 1000;

    // 1. Acquire a slot.
    phase = 'waiting_slot';
    slotRequested = true;
    // Race note: a cancel here waits for the request to land (WAIT_CANCELLATION_COMPLETED), so finalize's releaseSlot
    // is always signalled after requestSlot and the gate drops the run. A `granted` the gate sent before it saw the
    // release only flips `isGranted`, which nobody reads any more.
    await settled.requestSlot({ projectId: c.projectId, runId, limit: c.maxConcurrentRuns });
    await condition(() => isGranted);

    // 2-3. Start. The hard timer covers everything from here on (up to 7 days; the token is refreshed meanwhile).
    phase = 'starting';
    const timeoutSeconds = c.timeoutSeconds;
    startHardTimer(timeoutSeconds, false);
    await status('starting');
    // The workspace token is minted inside this activity and never enters workflow history (ruling R19).
    jobMayExist = true;
    podStartedMs = Date.now();
    const created = await settled.createRunSecretAndJob(c);
    await settled.postComment(c, 'start');

    // 4. Follow the logs.
    phase = 'running';
    let pod = followPod(c, timeoutSeconds, created, false);
    // One pass per pod: a parked run that is resumed comes back here with the new pod.
    for (;;) {
      // 5. Main loop.
      const idleMs = (c.idleEndSeconds ?? IDLE_END_SECONDS_DEFAULT) * 1000;
      const current = pod;
      while (!current.done) {
        // Temporal ends a workflow at 51,200 events with no cleanup; finish as failed well before that (spec, History size).
        if (historyTooLong(workflowInfo().historyLength, c.historyEventLimit)) {
          throw ApplicationFailure.nonRetryable(HISTORY_TOO_LONG_REASON);
        }
        if (resumePending) {
          resumePending = false;
          wroteRunningSinceTurn = true;
          await status('running');
          continue;
        }
        if (idleFixPending) {
          idleFixPending = false;
          const fix = idleFixStatus(currentPhase());
          if (fix !== undefined) await status(fix);
          continue;
        }
        if (!ending && finishRequested) {
          ending = true;
          endingStartedMs = Date.now();
          phase = 'ending';
          await act.endSession(c);
          continue;
        }
        // An id nobody renewed stops counting, even if no timer was running when it ran out (the run was busy).
        if (attachLeases) leases = expireLeases(leases, Date.now());
        const seen = epoch;
        // Every term must turn false once handled, or condition() resolves at once and the loop spins.
        const wake = () =>
          epoch !== seen ||
          historyTooLong(workflowInfo().historyLength, c.historyEventLimit) ||
          current.done ||
          (finishRequested && !ending) ||
          resumePending ||
          idleFixPending;
        // phase is read through a call: signal handlers change it between awaits, which TS narrowing cannot see.
        const p = currentPhase();
        if (idleTimerApplies(p, attached(), ending)) {
          if (!(await condition(wake, idleMs))) {
            // Recorded before `ending`: once the session end has begun nothing may bring the run back to `running`.
            if (pauseResume) parkKind = parkKindOf(currentPhase());
            ending = true;
            endingStartedMs = Date.now();
            phase = 'ending';
            await act.endSession(c);
          }
        } else if (ending && endingDeadline) {
          const left =
            endingStartedMs + (c.endingDeadlineSeconds ?? ENDING_DEADLINE_SECONDS_DEFAULT) * 1000 - Date.now();
          if (left <= 0 || !(await condition(wake, left))) await abandonPod(c, current);
        } else if (attachLeases && !ending && leases.size > 0 && atTurnBoundary(p)) {
          // Only where the idle timer would otherwise run: while the agent works no timer is needed (each costs history
          // events), and the `expireLeases` above drops ids that ran out the next time the loop runs.
          // Wake when the earliest lease runs out (its id may have been renewed meanwhile: the next pass re-reads it).
          const left = (nextExpiryMs(leases) ?? 0) - Date.now();
          await condition(wake, left);
        } else {
          await condition(wake);
        }
      }
      if (current.error !== undefined) throw current.error;
      if (current.result === undefined && !current.abandoned) {
        throw ApplicationFailure.nonRetryable('followPodLogs returned nothing');
      }
      // An abandoned pod has no result: it is treated as exited while `ending`, so it parks or succeeds below.
      const { exitCode, scrollbackTail, failureStage, setupExitCode, agentStarted, endReason, podLost } =
        current.result ?? {};
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
      // Only a pod that reported its agent started is parked or judged by `endOutcome`; a pod that died earlier (or a
      // result without the field) is a failure below.
      if (podLostParks && agentStarted === true) {
        const decision = endOutcome({
          ending,
          finishRequested,
          phase: currentPhase(),
          ...(parkKind !== undefined ? { parkKind } : {}),
          ...(endReason !== undefined ? { endReason } : {}),
          podLost: podLost === true,
          exitCode: exitCode ?? -1,
        });
        if (decision.kind === 'park') {
          // Recorded so a `dropSession` and the cancel rules treat the parked run like any other.
          parkKind = decision.parkKind;
          const parked = await park(c, decision.parkKind, decision.reason);
          if ('pod' in parked) {
            pod = parked.pod;
            continue;
          }
          return parked;
        }
        if (decision.kind === 'succeeded') {
          return { status: 'succeeded', ...(exitCode !== undefined ? { exitCode } : {}), podExited: true };
        }
        // `failed` falls through to the failure below.
      }
      if (pauseResume && ending && parkKind !== undefined && !finishRequested) {
        const parked = await park(c, parkKind, 'idle_timeout');
        if ('pod' in parked) {
          pod = parked.pod;
          continue;
        }
        return parked;
      }
      // Ended by us (finish or idle end): the session was idle, so the run succeeded whatever tmux's exit status was.
      if (ending || exitCode === 0) {
        return { status: 'succeeded', ...(exitCode !== undefined ? { exitCode } : {}), podExited: true };
      }
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
  }

  /**
   * The ending deadline passed with the pod still running: delete the Job (the fallback that always ends it), stop
   * following its logs, say so in the run's events, and let the loop carry on as if the pod had exited.
   */
  async function abandonPod(c: RunContext, pod: Pod): Promise<void> {
    // A pod that exited on its own needs no abandon.
    if (pod.done) return;
    // Before the delete: while the Job is being killed the log follower may reject with "pod disappeared", and that
    // must not fail the run.
    pod.abandoned = true;
    pod.scope.cancel();
    // If deleteJob itself fails the run fails: the Job may still exist, so nothing may report it parked or done.
    await act.deleteJob(c);
    pod.done = true;
    try {
      await act.recordEndingDeadline(c, {
        scrollbackSaved: pod.result?.scrollbackTail !== undefined,
        at: new Date().toISOString(),
      });
    } catch (err) {
      // A cancel that lands while the event is being written wins; any other failure is informational only (the Job
      // is already gone, so the run must still park or succeed).
      if (isCancellation(err)) throw err;
    }
  }

  /** The hard timer for one pod. The first pod uses the scope made up front, so a run that never parks replays unchanged. */
  function startHardTimer(seconds: number, fresh: boolean): void {
    if (fresh) hardTimer = new CancellationScope();
    hardTimer
      .run(() => sleep(seconds * 1000))
      .then(
        () => stop('timed_out'),
        () => undefined,
      );
  }

  /** Starts `followPodLogs` (and the token refresh loop) for a pod; the result lands in the returned object. */
  function followPod(
    c: RunContext,
    allowanceSeconds: number,
    created: TokenRefreshPlan | undefined,
    resume: boolean,
  ): Pod {
    const logsActs = proxyActivities<Pick<RunActivities, 'followPodLogs'>>({
      startToCloseTimeout: (allowanceSeconds + LOGS_TIMEOUT_MARGIN_SECONDS) * 1000,
      heartbeatTimeout: '60s',
      retry: { ...RETRY, nonRetryableErrorTypes: [POD_PENDING_TIMEOUT] },
    });
    const pod: Pod = { done: false, scope: new CancellationScope(), abandoned: false };
    pod.scope
      .run(() => (resume ? logsActs.followPodLogs(c, { resume: true }) : logsActs.followPodLogs(c)))
      .then(
        (r) => {
          pod.result = r;
          pod.done = true;
        },
        (err: unknown) => {
          // Cancelling the scope of an abandoned pod is not a failure of the run.
          if (!pod.abandoned) pod.error = err;
          pod.done = true;
        },
      );

    // 4b. Keep the workspace token fresh for as long as the pod runs (ADR 0021). A workflow that started before this
    // existed replays without it.
    if (patched(TOKEN_REFRESH_PATCH)) {
      // `created` is undefined for a result recorded before the activity reported a delay.
      void refreshTokenWhileRunning(c, created?.nextRefreshSeconds, () => pod.done);
    }
    return pod;
  }

  /**
   * The idle timer stopped the pod: delete its Job and Secret (a finished Job left behind would be adopted by the resume's
   * `ensureJob`, so the resume would follow the old exited pod) and free the slot, keep the volume, then wait in `parked` for a finish, a cancel,
   * a drop or the expiry, or for a resume, which returns the resumed pod to the main loop.
   */
  async function park(c: RunContext, kind: ParkKind, reason: PauseReason): Promise<Outcome | { pod: Pod }> {
    hardTimer.cancel();
    usedSeconds += Math.max(0, Math.floor((Date.now() - podStartedMs) / 1000));
    legacyAttached = 0;
    leases = new Map();
    sessionUp = false;
    log.info('run parked', { usedSeconds });
    await act.deleteJob(c);
    slotRequested = false;
    await attempt('releaseSlot', () => getExternalWorkflowHandle(`gate-${c.projectId}`).signal(releaseSlot, runId));
    // `resumeAccepted` here is a Resume queued behind the ending: the activity records it if nothing is kept to resume from.
    const parked = await act.parkRun(c, {
      kind,
      at: new Date().toISOString(),
      reason,
      ...(resumeAccepted ? { resumeQueued: true } : {}),
    });
    if (kind === 'needs_input') await act.postComment(c, 'paused');
    else await act.postComment(c, 'finish', { status: 'succeeded' });
    // `ending` described the pod's session end, which is over; a person Finish sets it again.
    ending = false;
    phase = 'parked';
    if (parked.sessionExpiresAt === null) {
      await act.deleteRunVolume(c);
      return { status: 'succeeded', podExited: true, settled: true };
    }
    const expiresAt = parked.sessionExpiresAt;
    const expiresMs = Date.parse(expiresAt);
    for (;;) {
      if (resumeAccepted) {
        resumeAccepted = false;
        // A resume queued behind the ending left the phase alone; from here it is under way.
        phase = 'resuming';
        // The expiry timer is off while the resume runs; a failed attempt re-arms it with the same deadline.
        const resumedPod = await resumeAttempt(c, kind, expiresAt);
        if (resumedPod !== undefined) return { pod: resumedPod };
        continue;
      }
      const left = expiresMs - Date.now();
      if (left > 0 && !finishRequested && !dropRequested) {
        await condition(() => finishRequested || dropRequested || resumeAccepted, left);
        continue;
      }
      if (finishRequested) {
        // Person Finish on a paused run: nothing more to keep.
        ending = true;
        await act.deleteRunVolume(c);
        await status('succeeded', { session: null });
        await act.postComment(c, 'finish', { status: 'succeeded' });
        return { status: 'succeeded', podExited: true, settled: true };
      }
      const reason = dropRequested ? 'dropped' : 'expired';
      await act.endKeptSession(c, reason, new Date().toISOString());
      await act.deleteRunVolume(c);
      if (kind === 'needs_input') {
        await act.postComment(c, 'finish', { status: 'expired' });
        return { status: 'expired', podExited: true, settled: true };
      }
      return { status: 'succeeded', podExited: true, settled: true };
    }
  }

  /**
   * Resume: queue through the gate, start a Job on the kept volume and wait for the runner to report the session. Returns
   * the new pod once the session is up (the main loop then supervises it); otherwise puts the run back as it was (the kept session is only given up
   * once the resumed session is really up) and returns `undefined`.
   */
  async function resumeAttempt(c: RunContext, kind: ParkKind, expiresAt: string): Promise<Pod | undefined> {
    sessionStartedFlag = false;
    let pod: Pod | undefined;
    let reason: string | undefined;
    try {
      pod = await (resumeScope ?? new CancellationScope()).run(async () => {
        await status('queued', { reopen: true, keepAgentNote: true });
        slotRequested = true;
        isGranted = false;
        await settled.requestSlot({ projectId: c.projectId, runId, limit: c.maxConcurrentRuns });
        await condition(() => isGranted);
        await status('starting');
        const allowance = sessionAllowanceSeconds(c.timeoutSeconds, usedSeconds, true, c.resumeMinSeconds);
        podStartedMs = Date.now();
        jobMayExist = true;
        const created = await settled.createRunSecretAndJob(c, { resume: true, deadlineSeconds: allowance });
        startHardTimer(allowance, true);
        const started = followPod(c, allowance, created, true);
        await condition(() => sessionStartedFlag || started.done);
        return started;
      });
      if (!sessionStartedFlag)
        reason = pod.result?.resumeFailed ? 'no saved session was found' : 'the pod could not start';
    } catch (err) {
      // A cancellation that is not the resume's own (a run-level stop) belongs to finalize.
      if (isCancellation(err) && resumeAbortReason === undefined) throw err;
      reason =
        resumeAbortReason ??
        (err instanceof ActivityFailure &&
        err.cause instanceof ApplicationFailure &&
        err.cause.type === NO_AGENT_CREDENTIAL
          ? 'the agent or its credential is missing'
          : 'the pod could not start');
    }
    if (reason === undefined && pod !== undefined) {
      resumeScope = undefined;
      dropRequested = false;
      parkKind = undefined;
      legacyAttached = 0;
      leases = new Map();
      wroteRunningSinceTurn = false;
      resumePending = false;
      idleFixPending = false;
      phase = phaseOfParkKind(kind);
      epoch += 1;
      await status(statusOfParkKind(kind), { keepAgentNote: true, session: null });
      return pod;
    }
    // Back to the kept state: no Job, no slot, no time counted for the failed pod.
    hardTimer.cancel();
    await CancellationScope.nonCancellable(async () => {
      await act.deleteJob(c);
      if (slotRequested) {
        slotRequested = false;
        await attempt('releaseSlot', () => getExternalWorkflowHandle(`gate-${c.projectId}`).signal(releaseSlot, runId));
      }
      await act.restoreParked(c, {
        kind,
        sessionExpiresAt: expiresAt,
        reason: reason ?? '',
        at: new Date().toISOString(),
      });
    });
    resumeScope = undefined;
    resumeAbortReason = undefined;
    sessionUp = false;
    sessionStartedFlag = false;
    phase = 'parked';
    return undefined;
  }

  let outcome: Outcome | typeof ALREADY_FINAL;
  try {
    outcome = await body.run(run);
  } catch (err) {
    if (isCancellation(err)) {
      outcome = { status: stoppedStatus(stopReason, phaseAtTimeout), podExited: false };
    } else outcome = { status: 'failed', failureReason: failureReason(err), podExited: false };
  }
  if (outcome === ALREADY_FINAL) {
    phase = 'done';
    hardTimer.cancel();
    return { status: ctx?.status && isFinal(ctx.status) ? ctx.status : 'failed' };
  }
  if (outcome.settled) {
    phase = 'done';
    return { status: outcome.status };
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
        // The claim is only deleted after the Job is gone, so no pod still has it mounted.
        if (patched(RUN_VOLUME_PATCH)) await attempt('deleteRunVolume', () => act.deleteRunVolume(c));
      }
      statusError = await attempt('setRunStatus', () =>
        status(o.status, {
          ...(pauseResume ? { session: null } : {}),
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
 * Replaces the run's workspace token as often as `refreshWaitSeconds` says until `logsDone`. Durable timers, so a worker restart changes
 * nothing. A failure after the activity's retries is logged (the error kind only) and tried again; a failure that can
 * never succeed (the Secret is gone) ends the loop. A missed refresh never ends the run: git and `gh` only fail if the
 * token really expires. Cancelling the run cancels the wait.
 */
async function refreshTokenWhileRunning(
  c: RunContext,
  firstPlannedSeconds: number | undefined,
  isDone: () => boolean,
): Promise<void> {
  let failures = 0;
  let plannedSeconds = firstPlannedSeconds;
  try {
    for (;;) {
      const waitSeconds = refreshWaitSeconds({ failures, overrideSeconds: c.tokenRefreshSeconds, plannedSeconds });
      if (await condition(isDone, waitSeconds * 1000)) return;
      try {
        const plan: TokenRefreshPlan | undefined = await act.refreshWorkspaceToken(c);
        plannedSeconds = plan?.nextRefreshSeconds;
        failures = 0;
      } catch (err) {
        if (isCancellation(err)) return;
        failures += 1;
        log.warn('workspace token refresh failed', { error: errorKind(err), failures });
        if (err instanceof ActivityFailure && err.cause instanceof ApplicationFailure && err.cause.nonRetryable) return;
      }
    }
  } catch (err) {
    if (!isCancellation(err)) log.warn('workspace token refresh loop stopped', { error: errorKind(err) });
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
