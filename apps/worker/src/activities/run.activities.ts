import type { PauseReason, RunStatus } from '@agentdesk/contracts';
import type { EndReason } from '@agentdesk/core';
import type { TokenRefreshPlan } from '../workflows/token-refresh';
import type { SetRunStatusInput, SetRunStatusResult } from './run-status.activity';

/**
 * Activity interface for `RunWorkflow` (spec §6.2). Type-only: workflow code imports it with `import type`, so nothing
 * here may need a runtime import. Implementations live in `run.activities.impl.ts` (Task 14) except `requestSlot`
 * (`slot.activity.ts`).
 *
 * Everything that crosses this boundary is stored in Temporal history, so no argument or result may carry a credential
 * value or a workspace token (ruling R19): the token is minted inside `createRunSecretAndJob` and goes straight into the
 * run Secret. Run output crosses it only redacted.
 */

/** What the workflow needs to know about a run; loaded once by `loadRun`. */
export interface RunContext {
  orgId: string;
  runId: string;
  projectId: string;
  /** Null when the agent row was deleted after the run was queued. */
  agentId: string | null;
  /** Current `runs.status`; a final status makes the workflow return without doing anything. */
  status: RunStatus;
  /** Hard timer, seconds (60 to 604800; the workspace token is refreshed while the run lasts, ADR 0021). */
  timeoutSeconds: number;
  /** The project's `max_concurrent_runs`; seeds the gate when this run starts it. */
  maxConcurrentRuns: number;
  /** Idle end, seconds. The agent's `idleEndSeconds` (default `IDLE_END_SECONDS`, 1800); a field so the policy is not baked into workflow code. */
  idleEndSeconds?: number;
  /** Seconds an `ending` session may take before the Job is deleted (normally `ENDING_DEADLINE_SECONDS`, 90); a test seam. */
  endingDeadlineSeconds?: number;
  /** Seconds an attach lease lives without a renewal (normally `TERMINAL_LEASE_TTL_SECONDS`, 300); a test seam like `idleEndSeconds`. */
  leaseTtlSeconds?: number;
  /** Seconds between workspace-token refreshes. Normally 2700 (45 min of the token's hour); a field like `idleEndSeconds`. */
  tokenRefreshSeconds?: number;
  /** Floor of a resumed pod's allowance, seconds (default `RESUME_MIN_SECONDS`, 3600); a test seam like `idleEndSeconds`. */
  resumeMinSeconds?: number;
  /** History length at which the run is finished as failed (default 45000, below Temporal's 51,200); a test seam. */
  historyEventLimit?: number;
}

export interface RequestSlotInput {
  projectId: string;
  runId: string;
  /** Used only when this call starts the gate workflow. */
  limit: number;
}

export type CommentKind = 'queued' | 'start' | 'finish' | 'paused';

/** What `requestSlot` knows about the gate once it has seen the request. */
export interface RequestSlotResult {
  /** Every slot is taken: the run waits in the gate's queue. */
  queued: boolean;
}

export type ParkKind = 'needs_input' | 'done';
export interface ParkResult {
  status: 'paused' | 'succeeded';
  /** Null: nothing kept (doneKeepSeconds = 0). */
  sessionExpiresAt: string | null;
}

/** Passed with the `finish` comment. */
export interface FinishDetails {
  status: RunStatus;
  exitCode?: number;
  failureReason?: string;
  /** Where a failed run failed; `setup` changes the wording of the finish comment. */
  failureStage?: 'setup' | 'agent';
  /** Redacted tail of the final scrollback; only on failure. */
  scrollbackTail?: string;
}

export interface FollowPodLogsResult {
  /** Container exit code. */
  exitCode: number;
  /** Redacted tail of the final scrollback (bounded by the activity), when the runner printed one. */
  scrollbackTail?: string;
  /**
   * `setup` when no `session_started` is stored and the runner reported setup failing (`setup_failed` or
   * `setup_timed_out` event) or exited with its dedicated setup-failure code 78 (the runner stopped the run before the
   * agent started). Decided from the database, so it survives activity retries.
   */
  failureStage?: 'setup';
  /** A resumed pod exited 79 before `session_started`: there was no saved session to continue. Only with `resume: true`. */
  resumeFailed?: true;
  /** `session_started` is stored for the run: the agent (or idle shell) began. False means the pod died before that. */
  agentStarted?: boolean;
  /** The setup script's exit code from the stored `setup_failed` event, the runner's 78 when it exited so without a marker; absent when setup timed out. */
  setupExitCode?: number;
  /** The reason of the last `session_ended` line the runner printed (read from the stored event, so it survives retries). */
  endReason?: EndReason;
  /**
   * After `session_started` the pod no longer exists, or ended with no exit code; `exitCode` is then -1. `endReason`
   * may still be present (an end line stored before the pod was lost).
   */
  podLost?: true;
  /**
   * With `podLost`: why the pod is gone, as a failure text ("the run pod disappeared before it reported an exit code" or
   * "the run pod ended (<phase>) without an exit code: <reason>"). Runs that started before `pod-lost-parks` fail with it.
   */
  lostText?: string;
  /**
   * With `podLost`: the cluster stayed unreachable for the whole reconnect window, so nothing is known about the pod.
   * The run parks with its volume kept instead of failing.
   */
  contactLost?: true;
}

/** Non-retryable `ApplicationFailure` type thrown by `followPodLogs` when the pod stays Pending for over 2 min. */
export const POD_PENDING_TIMEOUT = 'PodPendingTimeout';

export interface RunActivities {
  /** Reads the run, its project and agent under `withOrg`. Non-retryable when the run does not exist. */
  loadRun(orgId: string, runId: string): Promise<RunContext>;
  /**
   * `signalWithStart` on `gate-{projectId}` with `requestSlot(runId)`; idempotent (the gate de-duplicates). Says whether the
   * run is queued; a result recorded before it reported that is `undefined`.
   */
  requestSlot(input: RequestSlotInput): Promise<RequestSlotResult | undefined>;
  /** The only writer of `runs.status` (Task 12). */
  setRunStatus(input: SetRunStatusInput): Promise<SetRunStatusResult>;
  /**
   * Mints the workspace token (CodeHostAdapter.mintWorkspaceToken) and creates Secret and Job `run-{runId}` with it;
   * already exists → success. The token never leaves the activity; the result says when to refresh it.
   */
  createRunSecretAndJob(
    ctx: RunContext,
    opts?: { resume?: boolean; deadlineSeconds?: number },
  ): Promise<TokenRefreshPlan | undefined>;
  /**
   * Mints a new workspace token and writes it into the existing run Secret; the pod reads it from a mounted file, so
   * the pod keeps running (ADR 0021). A finished run is a no-op; a missing Secret fails non-retryably. The token never
   * leaves the activity.
   */
  refreshWorkspaceToken(ctx: RunContext): Promise<TokenRefreshPlan | undefined>;
  /** Idempotent via `runs.outbox.{kind}`. */
  postComment(ctx: RunContext, kind: CommentKind, details?: FinishDetails): Promise<void>;
  /**
   * Long-running, heartbeating. Writes `running` on the first log line and `idle` + signals `turnFinished` on each
   * Stop-hook line; stores lifecycle lines and the final scrollback. Completes with the container exit code.
   * Throws a non-retryable `PodPendingTimeout` failure (message: the pod event) after 2 min Pending.
   */
  followPodLogs(ctx: RunContext, opts?: { resume?: boolean }): Promise<FollowPodLogsResult>;
  /**
   * Records `session_ending_at` (kept if already set) and execs the fixed `agentdesk-end` in the pod, which asks the
   * entrypoint to end the session (a stop request); the entrypoint then prints the scrollback and exits. Only when that
   * exec exits 127 (an old pod image without the script) does it run `tmux kill-session -t agent` instead. The column is
   * cleared when the run parks or ends.
   */
  endSession(ctx: RunContext): Promise<void>;
  /** The ending deadline passed and the Job was deleted: appends a lifecycle event (the text says if scrollback was lost). */
  recordEndingDeadline(ctx: RunContext, input: { scrollbackSaved: boolean; at: string }): Promise<void>;
  /** Deletes Job and Secret `run-{runId}`; missing → success. */
  deleteJob(ctx: RunContext): Promise<void>;
  /** After the pod exited on its own: make sure the Job is completed or gone (and the Secret deleted). */
  ensureJobGone(ctx: RunContext): Promise<void>;
  /** Deletes the run's volume claim (`run-{runId}`); missing → success. Run after the Job is gone. */
  deleteRunVolume(ctx: RunContext): Promise<void>;
  /**
   * Reads the agent's keep setting (defaults when the agent row is gone), writes the parked status and session in one
   * transaction, and for kind `done` applies the per-project cap by signalling `dropSession` to the oldest kept ones.
   * Writes `pause_reason` (`idle_timeout` when absent: input scheduled by workflow code from before the reason existed) and clears `session_ending_at` (the session end is over).
   * `resumeQueued`: a Resume was accepted while the session was ending; when this park keeps nothing it appends a
   * `resume_failed` lifecycle event (fixed text) so the run says why the resume did not run.
   * `podExitCode`: with reason `pod_lost`, the exit code the cluster reported for the pod (137 is a SIGKILL, what the
   * kernel's out-of-memory kill leaves); stored as a `pod_exit` lifecycle event so the page can say why. Every `pod_lost` park
   * writes one; its code is null unless this is a whole number from 0 to 255.
   */
  parkRun(
    ctx: RunContext,
    input: { kind: ParkKind; at: string; reason?: PauseReason; resumeQueued?: boolean; podExitCode?: number },
  ): Promise<ParkResult>;
  /**
   * `expired`: paused → status expired; succeeded → clears session_expires_at and notifies. `dropped`: same for
   * succeeded; a paused run is never dropped.
   */
  endKeptSession(ctx: RunContext, reason: 'expired' | 'dropped', at: string): Promise<void>;
  /**
   * Puts a run whose resume failed back: status `paused` or `succeeded` with the same expiry, plus a `lifecycle` event
   * `resume_failed` with a redacted one-line reason.
   */
  restoreParked(
    ctx: RunContext,
    input: { kind: ParkKind; sessionExpiresAt: string; reason: string; at: string },
  ): Promise<void>;
}
