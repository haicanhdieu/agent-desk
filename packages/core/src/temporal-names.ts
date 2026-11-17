/** Temporal identifiers shared by the api (client side) and the worker, so neither imports the other. */
export const TASK_QUEUE = 'agentdesk';

export const WORKFLOW = {
  run: 'RunWorkflow',
  projectGate: 'ProjectGateWorkflow',
  pollOnce: 'PollOnceWorkflow',
  /** One-shot timer: unpauses a project's poll Schedule when its rate limit lifts. */
  resumePoll: 'resumePollWorkflow',
  outboxSweep: 'OutboxSweepWorkflow',
  reconcile: 'ReconcileWorkflow',
  setupTest: 'SetupTestWorkflow',
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
  /** RunWorkflow: the agent declared its state. Args: ['working' | 'waiting' | 'needs_input' | 'done']. */
  agentState: 'agentState',
  turnFinished: 'turnFinished',
  resumed: 'resumed',
  /** RunWorkflow: the runner reported `session_started` (the run's pod is up). */
  sessionStarted: 'sessionStarted',
  /** RunWorkflow: drop a kept done-session (the per-project cap); ignored for a paused run. */
  dropSession: 'dropSession',
  terminalAttached: 'terminalAttached',
  terminalDetached: 'terminalDetached',
  /** RunWorkflow: the connection ids of the sockets the API holds open for this run. Args: [string[]]. */
  terminalLease: 'terminalLease',
  finish: 'finish',
  cancel: 'cancel',
  /** SetupTestWorkflow: end the test now (cancels setup, then deletes the workspace). */
  endSetupTest: 'endSetupTest',
} as const;

export const UPDATE = {
  /** RunWorkflow: end an idle or done run; resolves `{ accepted: true }` or fails `NotFinishable`. */
  finishRun: 'finishRun',
  /** RunWorkflow: resume a paused run, or re-open a succeeded run with a kept session. */
  resumeRun: 'resumeRun',
} as const;

export const QUERY = {
  /** RunWorkflow: `{ phase, terminalAttached }`. */
  runState: 'state',
  /** ProjectGateWorkflow: `{ limit, queue, active, settled }`. */
  gateState: 'gateState',
} as const;

/** RunWorkflow ends an idle session after this long with no terminal attached. */
export const IDLE_END_SECONDS = 1800;

/** The API tells a run's workflow which terminal sockets are open this often (seconds). */
export const TERMINAL_LEASE_INTERVAL_SECONDS = 120;

/** RunWorkflow drops a terminal connection id it has not heard about for this long (seconds): an API crash stops blocking the idle timer. */
export const TERMINAL_LEASE_TTL_SECONDS = 300;

/** After the session end begins (`ending`), RunWorkflow waits this long for the pod to exit, then deletes the Job. */
export const ENDING_DEADLINE_SECONDS = 90;

/** Gate state is carried through continueAsNew after this many handled signals. */
export const GATE_CONTINUE_AS_NEW_AFTER = 1000;

export const runWorkflowId = (runId: string): string => `run-${runId}`;
export const setupTestWorkflowId = (setupTestId: string): string => `setup-test-${setupTestId}`;
export const gateWorkflowId = (projectId: string): string => `gate-${projectId}`;
export const pollScheduleId = (projectId: string): string => `poll-${projectId}`;
export const pollResumeWorkflowId = (projectId: string): string => `poll-resume-${projectId}`;
export const OUTBOX_SWEEP_SCHEDULE_ID = 'outbox-sweep';
export const RECONCILE_SCHEDULE_ID = 'reconcile-daily';
