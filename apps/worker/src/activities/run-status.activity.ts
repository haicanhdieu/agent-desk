import { ApplicationFailure } from '@temporalio/activity';
import { eq } from 'drizzle-orm';
import { FINAL_RUN_STATUSES, RunStatus } from '@agentdesk/contracts';
import { notifyRunStatus, runs, withOrg, type Db, type Tx } from '@agentdesk/db';
import { appendRunEvent, currentSeq } from './run-events';

const isFinal = (s: string): boolean => (FINAL_RUN_STATUSES as readonly string[]).includes(s);

export interface SetRunStatusInput {
  orgId: string;
  runId: string;
  status: RunStatus;
  exitCode?: number;
  failureReason?: string;
  /** ISO timestamp of the transition. */
  at: string;
}

export interface SetRunStatusResult {
  seq: number;
}

/**
 * The only writer of `runs.status` after insert. One transaction: lock the run row, update it, append a `status`
 * run_event with the next per-run seq, and queue the NOTIFY. A transition out of a final status is a no-op.
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

  const [run] = await tx
    .select({ status: runs.status, startedAt: runs.startedAt })
    .from(runs)
    .where(eq(runs.id, runId))
    .for('update');
  if (!run) throw ApplicationFailure.nonRetryable('setRunStatus: run not found');
  const previous = RunStatus.parse(run.status);
  if (isFinal(previous) || (opts.onlyFrom && !opts.onlyFrom.includes(previous))) {
    return { seq: await currentSeq(tx, runId), changed: false, previous };
  }

  await tx
    .update(runs)
    .set({
      status,
      ...(status === 'running' && run.startedAt === null ? { startedAt: at } : {}),
      ...(isFinal(status) ? { finishedAt: at } : {}),
      idleSince: status === 'idle' ? at : null,
      ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
      ...(input.failureReason !== undefined ? { failureReason: input.failureReason } : {}),
    })
    .where(eq(runs.id, runId));
  const ev = await appendRunEvent(tx, orgId, {
    runId,
    type: 'status',
    payload: { status, exitCode: input.exitCode ?? null, failureReason: input.failureReason ?? null },
    ts: at,
  });
  if (!ev) throw ApplicationFailure.nonRetryable('setRunStatus: run not found');
  await notifyRunStatus(tx, { orgId, runId, seq: ev.seq });
  return { seq: ev.seq, changed: true, previous };
}
