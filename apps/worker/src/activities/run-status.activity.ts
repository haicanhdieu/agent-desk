import { ApplicationFailure } from '@temporalio/activity';
import { eq } from 'drizzle-orm';
import { FINAL_RUN_STATUSES, RunStatus, toAgentNote, type WaitingOn } from '@agentdesk/contracts';
import { notifyRunStatus, runs, withOrg, type Db, type Tx } from '@agentdesk/db';
import { appendRunEvent, currentSeq } from './run-events';

const isFinal = (s: string): boolean => (FINAL_RUN_STATUSES as readonly string[]).includes(s);

export interface SetRunStatusInput {
  orgId: string;
  runId: string;
  status: RunStatus;
  exitCode?: number;
  failureReason?: string;
  /** Written with the final status: `setup` (workspace setup failed), `agent` (the agent exited non-zero); else null. */
  failureStage?: 'setup' | 'agent';
  /** Why a `running` run is not busy with the agent itself. Written only with `running`; else cleared. */
  waitingOn?: WaitingOn | null;
  /** Agent's note, already redacted. Written only with `idle` or `done` (collapsed to one line, capped); else cleared. */
  agentNote?: string | null;
  /** Set or clear the kept session. `{ expiresAt }` sets session_expires_at and paused_at = at; `null` clears session_expires_at. Absent leaves both alone. */
  session?: { expiresAt: string } | null;
  /** Leave agent_note as it is (used for paused, and for the statuses of a resume). */
  keepAgentNote?: boolean;
  /** Allow leaving `succeeded` when the row has session_expires_at in the future at `at` (re-open). */
  reopen?: boolean;
  /** ISO timestamp of the transition. */
  at: string;
}

export interface SetRunStatusResult {
  seq: number;
}

/**
 * The only writer of `runs.status` after insert. One transaction: lock the run row, update it, append a `status`
 * run_event with the next per-run seq, and queue the NOTIFY. A transition out of a final status is a no-op, except
 * re-opening a `succeeded` run that still has a kept session (`reopen`).
 */
export async function setRunStatus(db: Db, input: SetRunStatusInput): Promise<SetRunStatusResult> {
  const { seq } = await withOrg(db, input.orgId, (tx) => setRunStatusTx(tx, input));
  return { seq };
}

export interface SetRunStatusTxOptions {
  /** Write only when the current status is one of these (checked under the row lock); otherwise a no-op. */
  onlyFrom?: readonly RunStatus[];
}

/**
 * `setRunStatus` inside an existing `withOrg` transaction, so a caller can make the status change atomic with its own
 * writes. `changed` is false when nothing was written (final status, or `onlyFrom` did not match); `previous` is the
 * status found under the lock.
 */
export async function setRunStatusTx(
  tx: Tx,
  input: SetRunStatusInput,
  opts: SetRunStatusTxOptions = {},
): Promise<SetRunStatusResult & { changed: boolean; previous: RunStatus }> {
  const { orgId, runId } = input;
  const parsed = RunStatus.safeParse(input.status);
  if (!parsed.success) throw ApplicationFailure.nonRetryable(`unknown run status: ${String(input.status)}`);
  const status = parsed.data;
  const at = new Date(input.at);
  if (Number.isNaN(at.getTime())) throw ApplicationFailure.nonRetryable('setRunStatus: invalid timestamp');

  let sessionExpiresAt: Date | null | undefined;
  if (input.session) {
    sessionExpiresAt = new Date(input.session.expiresAt);
    if (Number.isNaN(sessionExpiresAt.getTime())) {
      throw ApplicationFailure.nonRetryable('setRunStatus: invalid session expiry');
    }
  } else if (input.session === null) {
    sessionExpiresAt = null;
  }

  const [run] = await tx
    .select({
      status: runs.status,
      startedAt: runs.startedAt,
      agentNote: runs.agentNote,
      pausedAt: runs.pausedAt,
      sessionExpiresAt: runs.sessionExpiresAt,
    })
    .from(runs)
    .where(eq(runs.id, runId))
    .for('update');
  if (!run) throw ApplicationFailure.nonRetryable('setRunStatus: run not found');
  const previous = RunStatus.parse(run.status);
  const reopening =
    input.reopen === true &&
    previous === 'succeeded' &&
    status === 'queued' &&
    run.sessionExpiresAt !== null &&
    run.sessionExpiresAt.getTime() > at.getTime();
  if ((isFinal(previous) && !reopening) || (opts.onlyFrom && !opts.onlyFrom.includes(previous))) {
    return { seq: await currentSeq(tx, runId), changed: false, previous };
  }

  const parked = status === 'idle' || status === 'done';
  const waitingOn = status === 'running' ? (input.waitingOn ?? null) : null;
  const agentNote = input.keepAgentNote
    ? run.agentNote
    : parked && input.agentNote != null
      ? toAgentNote(input.agentNote)
      : null;
  // A final status other than `succeeded` ends the kept session; `succeeded` keeps whatever is set or given.
  const endsSession = isFinal(status) && status !== 'succeeded';
  const newExpiry = endsSession ? null : sessionExpiresAt === undefined ? run.sessionExpiresAt : sessionExpiresAt;
  // paused_at means "the pod was last stopped by the idle timer". A session sets it; `session: null` on a live status
  // (the resume succeeded, the kept session is over) clears it. Everything else keeps it: queued/starting are written
  // mid-resume and a failed resume restores the parked run as it was, and finals keep it as history.
  const pausedAt = input.session ? at : input.session === null && !isFinal(status) ? null : run.pausedAt;

  await tx
    .update(runs)
    .set({
      status,
      ...(status === 'running' && run.startedAt === null ? { startedAt: at } : {}),
      ...(isFinal(status) ? { finishedAt: at } : {}),
      ...(reopening ? { finishedAt: null, exitCode: null } : {}),
      pausedAt,
      ...(endsSession || sessionExpiresAt !== undefined ? { sessionExpiresAt: newExpiry } : {}),
      // The session end is over once the run is parked or final; `endSession` sets it again for the next one.
      ...(status === 'paused' || isFinal(status) ? { sessionEndingAt: null } : {}),
      // The resume made the run live again: the pause reason no longer applies. Finals keep it as history.
      ...(input.session === null && !isFinal(status) ? { pauseReason: null } : {}),
      // `paused` is parked: idle_since stays as the idle write left it.
      ...(status === 'paused' ? {} : { idleSince: parked ? at : null }),
      waitingOn,
      agentNote,
      ...(input.exitCode !== undefined && !reopening ? { exitCode: input.exitCode } : {}),
      ...(input.failureReason !== undefined ? { failureReason: input.failureReason } : {}),
      ...(input.failureStage !== undefined && isFinal(status) ? { failureStage: input.failureStage } : {}),
    })
    .where(eq(runs.id, runId));
  const ev = await appendRunEvent(tx, orgId, {
    runId,
    type: 'status',
    payload: {
      status,
      exitCode: input.exitCode ?? null,
      failureReason: input.failureReason ?? null,
      waitingOn,
      agentNote,
      pausedAt: pausedAt?.toISOString() ?? null,
      sessionExpiresAt: newExpiry?.toISOString() ?? null,
    },
    ts: at,
  });
  if (!ev) throw ApplicationFailure.nonRetryable('setRunStatus: run not found');
  await notifyRunStatus(tx, { orgId, runId, seq: ev.seq });
  return { seq: ev.seq, changed: true, previous };
}
