import { defineQuery, defineSignal, defineUpdate } from '@temporalio/workflow';

// Signal names are the literals shared with the api via @agentdesk/core's SIGNAL (workflow code must not import
// core: it pulls in node-only modules). A test asserts the two stay equal.

// Gate signals
export const requestSlot = defineSignal<[string]>('requestSlot');
export const releaseSlot = defineSignal<[string]>('releaseSlot');
export const setLimit = defineSignal<[number]>('setLimit');

// Run signals
export const granted = defineSignal<[]>('granted');
/** The agent declared its state (agentdesk protocol); mapped to the run phase by RunWorkflow. */
export const agentState = defineSignal<['working' | 'waiting' | 'needs_input' | 'done']>('agentState');
// Legacy: kept registered so histories recorded before `agentState` still replay.
export const turnFinished = defineSignal<[]>('turnFinished');
export const resumed = defineSignal<[]>('resumed');
export const terminalAttached = defineSignal<[]>('terminalAttached');
export const terminalDetached = defineSignal<[]>('terminalDetached');
export const finish = defineSignal<[]>('finish');
export interface FinishRunResult {
  accepted: true;
}
/** Ends an idle or done run; resolves once the workflow has begun ending the session (the workflow's real answer). */
export const finishRun = defineUpdate<FinishRunResult>('finishRun');
export const cancel = defineSignal<[]>('cancel');

// Setup test signals
export const endSetupTest = defineSignal<[]>('endSetupTest');

export interface GateState {
  limit: number;
  queue: string[];
  active: string[];
  settled: boolean;
}
export const gateState = defineQuery<GateState>('gateState');

/** RunWorkflow phases as seen by the `state` query (workflow-side view; `runs.status` is the durable one). */
export type RunPhase =
  | 'loading'
  | 'waiting_slot'
  | 'starting'
  | 'running'
  | 'idle'
  /** The agent declared it is done (distinct from `done`, which means the workflow ended). */
  | 'agent_done'
  | 'ending'
  | 'finalizing'
  | 'done';

export interface RunState {
  phase: RunPhase;
  terminalAttached: number;
}
export const runState = defineQuery<RunState>('state');
