import { defineQuery, defineSignal } from '@temporalio/workflow';

// Signal names are the literals shared with the api via @agentdesk/core's SIGNAL (workflow code must not import
// core: it pulls in node-only modules). A test asserts the two stay equal.

// Gate signals
export const requestSlot = defineSignal<[string]>('requestSlot');
export const releaseSlot = defineSignal<[string]>('releaseSlot');
export const setLimit = defineSignal<[number]>('setLimit');

// Run signals
export const granted = defineSignal<[]>('granted');
export const turnFinished = defineSignal<[]>('turnFinished');
export const resumed = defineSignal<[]>('resumed');
export const terminalAttached = defineSignal<[]>('terminalAttached');
export const terminalDetached = defineSignal<[]>('terminalDetached');
export const finish = defineSignal<[]>('finish');
export const cancel = defineSignal<[]>('cancel');

export interface GateState {
  limit: number;
  queue: string[];
  active: string[];
  settled: boolean;
}
export const gateState = defineQuery<GateState>('gateState');

/** RunWorkflow phases as seen by the `state` query (workflow-side view; `runs.status` is the durable one). */
export type RunPhase = 'loading' | 'waiting_slot' | 'starting' | 'running' | 'idle' | 'ending' | 'finalizing' | 'done';

export interface RunState {
  phase: RunPhase;
  terminalAttached: number;
}
export const runState = defineQuery<RunState>('state');
