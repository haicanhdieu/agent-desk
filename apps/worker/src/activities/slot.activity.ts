import type { WorkflowClient } from '@temporalio/client';
import { QUERY, SIGNAL, TASK_QUEUE, WORKFLOW, gateWorkflowId } from '@agentdesk/core';
import type { RequestSlotInput, RequestSlotResult } from './run.activities';
import type { GateState } from '../workflows/signals';

/** The slice of the Temporal workflow client `requestSlot` needs (`client.workflow` satisfies it). */
export type GateSignaller = Pick<WorkflowClient, 'signalWithStart' | 'getHandle'>;

/** How long `requestSlot` waits for the gate to process the signal before it reads the queue. */
const GATE_SETTLE_POLLS = 40;
const GATE_SETTLE_POLL_MS = 25;

/**
 * Spec §6.2 step 1: `signalWithStart` on `gate-{projectId}` with `requestSlot(runId)`. Workflow code cannot start
 * another workflow without making it a child, so this is an activity. Safe to retry: the gate keeps one queue entry
 * per run and re-sends `granted` to a run that is already active.
 *
 * Reports whether the run is waiting in the gate's queue (every slot is taken) so the workflow can tell the ticket.
 * The answer is informational: when the gate cannot be read it says `queued: false` instead of failing the request.
 */
export async function requestSlot(client: GateSignaller, input: RequestSlotInput): Promise<RequestSlotResult> {
  const workflowId = gateWorkflowId(input.projectId);
  await client.signalWithStart(WORKFLOW.projectGate, {
    workflowId,
    taskQueue: TASK_QUEUE,
    args: [{ projectId: input.projectId, limit: input.limit }],
    signal: SIGNAL.requestSlot,
    signalArgs: [input.runId],
  });
  try {
    const gate = client.getHandle(workflowId);
    let state = await gate.query<GateState>(QUERY.gateState);
    // The gate grants in its main loop after the signal handler ran: wait until it has, or the run looks queued.
    for (let i = 0; !state.settled && i < GATE_SETTLE_POLLS; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, GATE_SETTLE_POLL_MS));
      state = await gate.query<GateState>(QUERY.gateState);
    }
    return { queued: state.settled && state.queue.includes(input.runId) };
  } catch {
    return { queued: false };
  }
}
