import { ApplicationFailure } from '@temporalio/activity';
import { eq } from 'drizzle-orm';
import { FINAL_RUN_STATUSES, RunStatus } from '@agentdesk/contracts';
import { notifyRunStatus, runs, withOrg, type Db } from '@agentdesk/db';
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
  const { orgId, runId } = input;
  const parsed = RunStatus.safeParse(input.status);
  if (!parsed.success) throw ApplicationFailure.nonRetryable(`unknown run status: ${String(input.status)}`);
  const status = parsed.data;
  const at = new Date(input.at);
  if (Number.isNaN(at.getTime())) throw ApplicationFailure.nonRetryable('setRunStatus: invalid timestamp');

  return withOrg(db, orgId, async (tx) => {
    const [run] = await tx
      .select({ status: runs.status, startedAt: runs.startedAt })
      .from(runs)
      .where(eq(runs.id, runId))
      .for('update');
    if (!run) throw ApplicationFailure.nonRetryable('setRunStatus: run not found');
    if (isFinal(run.status)) return { seq: await currentSeq(tx, runId) };

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
    return { seq: ev.seq };
  });
}
