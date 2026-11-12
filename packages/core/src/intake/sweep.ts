import { queuedRunsWithoutWorkflow, type Db } from '@agentdesk/db';
import { startRunWorkflow, type IntakeLogger, type WorkflowStarter } from './start-run';

export const SWEEP_MIN_AGE_SECONDS = 30;

/**
 * Outbox sweep: starts `RunWorkflow` for runs left `queued` without a workflow (api crash or Temporal outage between
 * the insert and the start). The age cut-off is evaluated by the database clock; returns how many runs were started.
 */
export async function sweepOutbox(
  deps: { db: Db; starter: WorkflowStarter; log?: IntakeLogger },
  olderThanSeconds: number = SWEEP_MIN_AGE_SECONDS,
): Promise<number> {
  const pending = await queuedRunsWithoutWorkflow(deps.db, olderThanSeconds);
  let started = 0;
  for (const { orgId, runId } of pending) {
    if (await startRunWorkflow(deps.starter, deps.db, orgId, runId, deps.log)) started += 1;
  }
  return started;
}
