import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import { eq } from 'drizzle-orm';
import { runs, withOrg, type Db } from '@agentdesk/db';
import { TASK_QUEUE, WORKFLOW, runWorkflowId } from '../temporal-names';

/** The slice of the Temporal workflow client the intake uses (`client.workflow` satisfies it). */
export interface WorkflowStarter {
  start(
    workflowType: string,
    options: { taskQueue: string; workflowId: string; args: [{ orgId: string; runId: string }] },
  ): Promise<unknown>;
}

export interface IntakeLogger {
  warn(obj: object, msg: string): void;
}

/**
 * Starts `RunWorkflow` for a queued run, then records the workflow id. An already-started workflow counts as
 * started. Any other Temporal failure is logged and swallowed: the run stays `queued` with no `workflow_id`, which
 * is exactly what the outbox sweep looks for.
 * Resolves true when the workflow is running (started now or earlier), false when the start failed.
 */
export async function startRunWorkflow(
  starter: WorkflowStarter,
  db: Db,
  orgId: string,
  runId: string,
  log?: IntakeLogger,
): Promise<boolean> {
  const workflowId = runWorkflowId(runId);
  try {
    await starter.start(WORKFLOW.run, { taskQueue: TASK_QUEUE, workflowId, args: [{ orgId, runId }] });
  } catch (err) {
    if (!(err instanceof WorkflowExecutionAlreadyStartedError)) {
      log?.warn(
        { runId, err: err instanceof Error ? err.name : 'unknown' },
        'starting run workflow failed; sweep will retry',
      );
      return false;
    }
  }
  try {
    await withOrg(db, orgId, (tx) => tx.update(runs).set({ workflowId }).where(eq(runs.id, runId)));
  } catch (err) {
    // The workflow is running; the sweep would only re-issue an already-started start.
    log?.warn({ runId, err: err instanceof Error ? err.name : 'unknown' }, 'recording workflow id failed');
  }
  return true;
}
