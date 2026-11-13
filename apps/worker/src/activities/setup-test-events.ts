import { and, eq, sql } from 'drizzle-orm';
import { setupTestEvents, setupTests, type Tx } from '@agentdesk/db';

export interface AppendSetupTestEventInput {
  setupTestId: string;
  type: 'lifecycle' | 'status';
  payload: Record<string, unknown>;
  ts?: Date;
}

/**
 * Appends a setup_test_event with the next per-test seq. Takes the test row lock (SELECT ... FOR UPDATE) so concurrent
 * appenders (a retried activity next to its predecessor, the finalizer) serialise and seqs stay unique and gapless.
 * Must run inside `withOrg`. Returns null when the test does not exist.
 */
export async function appendSetupTestEvent(
  tx: Tx,
  orgId: string,
  input: AppendSetupTestEventInput,
): Promise<{ seq: number } | null> {
  const locked = await tx
    .select({ id: setupTests.id })
    .from(setupTests)
    .where(eq(setupTests.id, input.setupTestId))
    .for('update');
  if (locked.length === 0) return null;
  const [max] = await tx
    .select({ seq: sql<number>`coalesce(max(${setupTestEvents.seq}), 0)::int` })
    .from(setupTestEvents)
    .where(eq(setupTestEvents.setupTestId, input.setupTestId));
  const next = (max?.seq ?? 0) + 1;
  await tx.insert(setupTestEvents).values({
    orgId,
    setupTestId: input.setupTestId,
    seq: next,
    ts: input.ts ?? new Date(),
    type: input.type,
    payload: input.payload,
  });
  return { seq: next };
}

/**
 * Inserts a lifecycle row for pod log line `line` unless one exists (the dedupe key of a retried or re-attached
 * follow: the same log line always has the same number). Returns whether it inserted. Must run inside `withOrg`.
 */
export async function storeSetupLineEvent(
  tx: Tx,
  orgId: string,
  setupTestId: string,
  line: number,
  payload: Record<string, unknown>,
): Promise<boolean> {
  await tx.select({ id: setupTests.id }).from(setupTests).where(eq(setupTests.id, setupTestId)).for('update');
  const [dup] = await tx
    .select({ seq: setupTestEvents.seq })
    .from(setupTestEvents)
    .where(
      and(
        eq(setupTestEvents.setupTestId, setupTestId),
        eq(setupTestEvents.type, 'lifecycle'),
        sql`(${setupTestEvents.payload} ->> 'line')::int = ${line}`,
      ),
    )
    .limit(1);
  if (dup) return false;
  return (
    (await appendSetupTestEvent(tx, orgId, { setupTestId, type: 'lifecycle', payload: { line, ...payload } })) !== null
  );
}
