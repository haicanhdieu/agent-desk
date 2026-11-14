import { WorkflowNotFoundError, type Client } from '@temporalio/client';
import { QUERY, SIGNAL, WORKFLOW, gateWorkflowId, runWorkflowId } from '@agentdesk/core';
import type { GateState } from '../workflows/signals';
import type { ReconcileTemporal } from './reconcile.activity';
import type { RunSignaller } from './run.activities.impl';

const GATE_PREFIX = 'gate-';

/** Temporal client calls used by activities (signals to runs, reconcile's workflow checks). */
export function temporalOps(client: Client): RunSignaller & ReconcileTemporal {
  return {
    async signalRun(runId, signal, arg) {
      try {
        await client.workflow.getHandle(runWorkflowId(runId)).signal(signal, ...(arg !== undefined ? [arg] : []));
      } catch (err) {
        // The workflow closed (cancel, hard timeout) while this activity was still running: nobody to tell.
        if (!(err instanceof WorkflowNotFoundError)) throw err;
      }
    },
    async isWorkflowOpen(workflowId) {
      try {
        const d = await client.workflow.getHandle(workflowId).describe();
        return d.status.name === 'RUNNING';
      } catch (err) {
        if (err instanceof WorkflowNotFoundError) return false;
        throw err;
      }
    },
    async listOpenGateProjectIds() {
      const ids: string[] = [];
      const query = `WorkflowType = '${WORKFLOW.projectGate}' AND ExecutionStatus = 'Running'`;
      for await (const wf of client.workflow.list({ query })) {
        if (wf.workflowId.startsWith(GATE_PREFIX)) ids.push(wf.workflowId.slice(GATE_PREFIX.length));
      }
      return ids;
    },
    async gateRuns(projectId) {
      const s = await client.workflow.getHandle(gateWorkflowId(projectId)).query<GateState>(QUERY.gateState);
      return [...s.active, ...s.queue];
    },
    async releaseSlot(projectId, runId) {
      await client.workflow.getHandle(gateWorkflowId(projectId)).signal(SIGNAL.releaseSlot, runId);
    },
  };
}
