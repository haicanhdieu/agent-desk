/** Temporal identifiers shared by the api (client side) and the worker, so neither imports the other. */
export const TASK_QUEUE = 'agentdesk';

export const WORKFLOW = {
  run: 'RunWorkflow',
  projectGate: 'ProjectGateWorkflow',
  pollOnce: 'PollOnceWorkflow',
} as const;

export const SIGNAL = {
  /** ProjectGateWorkflow: change the concurrency limit. Args: [limit]. */
  setLimit: 'setLimit',
} as const;

export const runWorkflowId = (runId: string): string => `run-${runId}`;
export const gateWorkflowId = (projectId: string): string => `gate-${projectId}`;
export const pollScheduleId = (projectId: string): string => `poll-${projectId}`;
