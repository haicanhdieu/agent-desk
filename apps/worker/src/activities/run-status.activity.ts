import { eq, sql } from 'drizzle-orm';
import { notifyRunStatus, runEvents, runs, withOrg, type Db } from '@agentdesk/db';

export const RUN_STATUSES = [
  'queued',
  'starting',
  'running',
  'idle',
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const FINAL_STATUSES: readonly RunStatus[] = ['succeeded', 'failed', 'cancelled', 'timed_out'];

const isFinal = (s: string): boolean => (FINAL_STATUSES as readonly string[]).includes(s);

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
  const { orgId, runId, status } = input;
  if (!(RUN_STATUSES as readonly string[]).includes(status)) throw new Error(`unknown run status: ${status}`);
  const at = new Date(input.at);
  if (Number.isNaN(at.getTime())) throw new Error('setRunStatus: invalid timestamp');

  return withOrg(db, orgId, async (tx) => {
    const [run] = await tx
      .select({ status: runs.status, startedAt: runs.startedAt })
      .from(runs)
      .where(eq(runs.id, runId))
      .for('update');
    if (!run) throw new Error('setRunStatus: run not found');

    const [max] = await tx
      .select({ seq: sql<number>`coalesce(max(${runEvents.seq}), 0)::int` })
      .from(runEvents)
      .where(eq(runEvents.runId, runId));
    const current = max?.seq ?? 0;
    if (isFinal(run.status)) return { seq: current };

    const seq = current + 1;
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
    await tx.insert(runEvents).values({
      orgId,
      runId,
      seq,
      ts: at,
      type: 'status',
      payload: { status, exitCode: input.exitCode ?? null, failureReason: input.failureReason ?? null },
    });
    await notifyRunStatus(tx, { orgId, runId, seq });
    return { seq };
  });
}
