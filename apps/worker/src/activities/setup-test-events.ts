import { and, eq, inArray, sql } from 'drizzle-orm';
import { setupTestEvents, setupTests, type Tx } from '@agentdesk/db';
import { appendSeqEvent, storeLineEvent, type LineEventTable } from './follow-core';

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
  return appendSeqEvent(tx, {
    lockOwner: async (t) =>
      (await t.select({ id: setupTests.id }).from(setupTests).where(eq(setupTests.id, input.setupTestId)).for('update'))
        .length > 0,
    maxSeq: async (t) => {
      const [max] = await t
        .select({ seq: sql<number>`coalesce(max(${setupTestEvents.seq}), 0)::int` })
        .from(setupTestEvents)
        .where(eq(setupTestEvents.setupTestId, input.setupTestId));
      return max?.seq ?? 0;
    },
    insert: async (t, seq) => {
      await t.insert(setupTestEvents).values({
        orgId,
        setupTestId: input.setupTestId,
        seq,
        ts: input.ts ?? new Date(),
        type: input.type,
        payload: input.payload,
      });
    },
  });
}

/** The test's events as the shared line-event store sees them. */
const setupTestEventTable = (orgId: string, setupTestId: string): LineEventTable<'lifecycle'> => ({
  lock: async (tx) => {
    await tx.select({ id: setupTests.id }).from(setupTests).where(eq(setupTests.id, setupTestId)).for('update');
  },
  hasLine: async (tx, types, line) => {
    const [dup] = await tx
      .select({ seq: setupTestEvents.seq })
      .from(setupTestEvents)
      .where(
        and(
          eq(setupTestEvents.setupTestId, setupTestId),
          inArray(setupTestEvents.type, [...types]),
          sql`(${setupTestEvents.payload} ->> 'line')::int = ${line}`,
        ),
      )
      .limit(1);
    return dup !== undefined;
  },
  append: async (tx, type, payload) => (await appendSetupTestEvent(tx, orgId, { setupTestId, type, payload })) !== null,
});

/**
 * Inserts a lifecycle row for pod log line `line` unless one exists (the dedupe key of a retried or re-attached
 * follow). Returns whether it inserted. Must run inside `withOrg`.
 */
export function storeSetupLineEvent(
  tx: Tx,
  orgId: string,
  setupTestId: string,
  line: number,
  payload: Record<string, unknown>,
): Promise<boolean> {
  return storeLineEvent(tx, setupTestEventTable(orgId, setupTestId), ['lifecycle'], 'lifecycle', line, payload);
}
