import { eq, sql } from 'drizzle-orm';
import { runEvents, runs, type Tx } from '@agentdesk/db';

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
  const locked = await tx.select({ id: runs.id }).from(runs).where(eq(runs.id, input.runId)).for('update');
  if (locked.length === 0) return null;
  const seq = await currentSeq(tx, input.runId);
  const next = seq + 1;
  await tx.insert(runEvents).values({
    orgId,
    runId: input.runId,
    seq: next,
    ts: input.ts ?? new Date(),
    type: input.type,
    payload: input.payload,
  });
  return { seq: next };
}

/** Highest seq for the run (0 when none). Call after taking the row lock for a stable answer. */
export async function currentSeq(tx: Tx, runId: string): Promise<number> {
  const [max] = await tx
    .select({ seq: sql<number>`coalesce(max(${runEvents.seq}), 0)::int` })
    .from(runEvents)
    .where(eq(runEvents.runId, runId));
  return max?.seq ?? 0;
}
