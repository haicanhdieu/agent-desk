import { eq, sql } from 'drizzle-orm';
import { runEvents, runs, type Tx } from '@agentdesk/db';
import { appendSeqEvent } from './follow-core';

export interface AppendRunEventInput {
  runId: string;
  type: 'lifecycle' | 'status' | 'scrollback' | 'comment';
  payload: Record<string, unknown>;
  ts?: Date;
}

/**
 * Appends a run_event with the next per-run seq. Takes the run row lock (SELECT ... FOR UPDATE) so concurrent
 * appenders on one run serialise and seqs stay unique and gapless. Must run inside `withOrg`.
 * Returns null when the run does not exist.
 */
export async function appendRunEvent(
  tx: Tx,
  orgId: string,
  input: AppendRunEventInput,
): Promise<{ seq: number } | null> {
  return appendSeqEvent(tx, {
    lockOwner: async (t) =>
      (await t.select({ id: runs.id }).from(runs).where(eq(runs.id, input.runId)).for('update')).length > 0,
    maxSeq: (t) => currentSeq(t, input.runId),
    insert: async (t, seq) => {
      await t.insert(runEvents).values({
        orgId,
        runId: input.runId,
        seq,
        ts: input.ts ?? new Date(),
        type: input.type,
        payload: input.payload,
      });
    },
  });
}

/** Highest seq for the run (0 when none). Call after taking the row lock for a stable answer. */
export async function currentSeq(tx: Tx, runId: string): Promise<number> {
  const [max] = await tx
    .select({ seq: sql<number>`coalesce(max(${runEvents.seq}), 0)::int` })
    .from(runEvents)
    .where(eq(runEvents.runId, runId));
  return max?.seq ?? 0;
}
