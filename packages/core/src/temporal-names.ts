/** Temporal identifiers shared by the api (client side) and the worker, so neither imports the other. */
export const TASK_QUEUE = 'agentdesk';

export const WORKFLOW = {
  run: 'RunWorkflow',
  projectGate: 'ProjectGateWorkflow',
  pollOnce: 'PollOnceWorkflow',
  outboxSweep: 'OutboxSweepWorkflow',
  reconcile: 'ReconcileWorkflow',
} as const;

export const SIGNAL = {
  /** ProjectGateWorkflow: change the concurrency limit. Args: [limit]. */
  setLimit: 'setLimit',
  /** ProjectGateWorkflow: a run asks for a slot. Args: [runId]. */
  requestSlot: 'requestSlot',
  /** ProjectGateWorkflow: a run gives its slot back (or leaves the queue). Args: [runId]. */
  releaseSlot: 'releaseSlot',
  /** RunWorkflow: the gate granted a slot. */
  granted: 'granted',
  turnFinished: 'turnFinished',
  resumed: 'resumed',
  terminalAttached: 'terminalAttached',
  terminalDetached: 'terminalDetached',
  finish: 'finish',
  cancel: 'cancel',
} as const;

export const QUERY = {
  /** RunWorkflow: `{ phase, terminalAttached }`. */
  runState: 'state',
  /** ProjectGateWorkflow: `{ limit, queue, active, settled }`. */
  gateState: 'gateState',
} as const;

/** RunWorkflow ends an idle session after this long with no terminal attached. */
export const IDLE_END_SECONDS = 600;

/** Gate state is carried through continueAsNew after this many handled signals. */
export const GATE_CONTINUE_AS_NEW_AFTER = 1000;

export const runWorkflowId = (runId: string): string => `run-${runId}`;
export const gateWorkflowId = (projectId: string): string => `gate-${projectId}`;
export const pollScheduleId = (projectId: string): string => `poll-${projectId}`;
export const OUTBOX_SWEEP_SCHEDULE_ID = 'outbox-sweep';
export const RECONCILE_SCHEDULE_ID = 'reconcile-daily';
