import type { RunStatus } from '@agentdesk/contracts';
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
  /** Hard timer, seconds (≤ 3300, so the one-hour workspace token outlives the run). */
  timeoutSeconds: number;
  /** The project's `max_concurrent_runs`; seeds the gate when this run starts it. */
  maxConcurrentRuns: number;
  /** Idle end, seconds. Normally `IDLE_END_SECONDS` (600); a field so the policy is not baked into workflow code. */
  idleEndSeconds?: number;
}

export interface RequestSlotInput {
  projectId: string;
  runId: string;
  /** Used only when this call starts the gate workflow. */
  limit: number;
}

export type CommentKind = 'start' | 'finish';

/** Passed with the `finish` comment. */
export interface FinishDetails {
  status: RunStatus;
  exitCode?: number;
  failureReason?: string;
  /** Redacted tail of the final scrollback; only on failure. */
  scrollbackTail?: string;
}

export interface FollowPodLogsResult {
  /** Container exit code. */
  exitCode: number;
  /** Redacted tail of the final scrollback (bounded by the activity), when the runner printed one. */
  scrollbackTail?: string;
}

/** Non-retryable `ApplicationFailure` type thrown by `followPodLogs` when the pod stays Pending for over 2 min. */
export const POD_PENDING_TIMEOUT = 'PodPendingTimeout';

export interface RunActivities {
  /** Reads the run, its project and agent under `withOrg`. Non-retryable when the run does not exist. */
  loadRun(orgId: string, runId: string): Promise<RunContext>;
  /** `signalWithStart` on `gate-{projectId}` with `requestSlot(runId)`; idempotent (the gate de-duplicates). */
  requestSlot(input: RequestSlotInput): Promise<void>;
  /** The only writer of `runs.status` (Task 12). */
  setRunStatus(input: SetRunStatusInput): Promise<SetRunStatusResult>;
  /**
   * Mints the workspace token (CodeHostAdapter.mintWorkspaceToken) and creates Secret and Job `run-{runId}` with it;
   * already exists → success. The token never leaves the activity.
   */
  createRunSecretAndJob(ctx: RunContext): Promise<void>;
  /** Idempotent via `runs.outbox.{kind}`. */
  postComment(ctx: RunContext, kind: CommentKind, details?: FinishDetails): Promise<void>;
  /**
   * Long-running, heartbeating. Writes `running` on the first log line and `idle` + signals `turnFinished` on each
   * Stop-hook line; stores lifecycle lines and the final scrollback. Completes with the container exit code.
   * Throws a non-retryable `PodPendingTimeout` failure (message: the pod event) after 2 min Pending.
   */
  followPodLogs(ctx: RunContext): Promise<FollowPodLogsResult>;
  /** `tmux kill-session -t agent` in the pod; the entrypoint then prints the scrollback and exits. */
  endSession(ctx: RunContext): Promise<void>;
  /** Deletes Job and Secret `run-{runId}`; missing → success. */
  deleteJob(ctx: RunContext): Promise<void>;
  /** After the pod exited on its own: make sure the Job is completed or gone (and the Secret deleted). */
  ensureJobGone(ctx: RunContext): Promise<void>;
}
