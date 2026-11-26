import { and, eq, gt, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { runs } from '@agentdesk/db';
import { FINAL_RUN_STATUSES } from '@agentdesk/contracts';

/**
 * Runs that still need their agent (BR-30): a run that is not final, or a succeeded run whose kept session can
 * still be reopened. Shared by the usage count and the delete check.
 */
export function blockingRunsCondition(): SQL {
  const condition = or(
    notInArray(runs.status, [...FINAL_RUN_STATUSES]),
    and(eq(runs.status, 'succeeded'), gt(runs.sessionExpiresAt, sql`now()`)),
  );
  if (!condition) throw new Error('unreachable: blocking-runs condition is never empty');
  return condition;
}
