import type { WorkflowClient } from '@temporalio/client';
import { SIGNAL, TASK_QUEUE, WORKFLOW, gateWorkflowId } from '@agentdesk/core';
import type { RequestSlotInput } from './run.activities';

/** The slice of the Temporal workflow client `requestSlot` needs (`client.workflow` satisfies it). */
export type GateSignaller = Pick<WorkflowClient, 'signalWithStart'>;

/**
 * Spec §6.2 step 1: `signalWithStart` on `gate-{projectId}` with `requestSlot(runId)`. Workflow code cannot start
 * another workflow without making it a child, so this is an activity. Safe to retry: the gate keeps one queue entry
 * per run and re-sends `granted` to a run that is already active.
 */
export async function requestSlot(client: GateSignaller, input: RequestSlotInput): Promise<void> {
  await client.signalWithStart(WORKFLOW.projectGate, {
    workflowId: gateWorkflowId(input.projectId),
    taskQueue: TASK_QUEUE,
    args: [{ projectId: input.projectId, limit: input.limit }],
    signal: SIGNAL.requestSlot,
    signalArgs: [input.runId],
  });
}
