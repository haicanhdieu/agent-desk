import type { AgentState } from '@agentdesk/contracts';
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
export const agentState = defineSignal<[AgentState]>('agentState');
// Legacy: kept registered so histories recorded before `agentState` still replay.
export const turnFinished = defineSignal<[]>('turnFinished');
export const resumed = defineSignal<[]>('resumed');
/**
 * A terminal socket opened / closed. The API sends its own connection id (a UUID); no argument is the legacy counter
 * path, still sent by API pods that predate attach leases.
 */
export const terminalAttached = defineSignal<[connectionId?: string]>('terminalAttached');
export const terminalDetached = defineSignal<[connectionId?: string]>('terminalDetached');
/** The connection ids of every terminal socket the API holds open for this run; sent every 2 minutes while any is open. */
export const terminalLease = defineSignal<[connectionIds: string[]]>('terminalLease');
export const finish = defineSignal<[]>('finish');
export interface FinishRunResult {
  accepted: true;
}
/** Ends an idle or done run; resolves once the workflow has begun ending the session (the workflow's real answer). */
export const finishRun = defineUpdate<FinishRunResult>('finishRun');
export const cancel = defineSignal<[]>('cancel');
/** The runner reported the (resumed) session is up. May arrive repeatedly; repeats are ignored. */
export const sessionStarted = defineSignal<[]>('sessionStarted');
/** Drop the kept session (volume) and close; sent when the project is deleted. */
export const dropSession = defineSignal<[]>('dropSession');
/** A person typed in the run's terminal (the API sends it); resets the automatic-resume count. */
export const personInput = defineSignal<[]>('personInput');
export interface ResumeRunResult {
  accepted: true;
}
/** Resumes a parked run; resolves once the workflow has accepted it (the workflow's real answer). */
export const resumeRun = defineUpdate<ResumeRunResult>('resumeRun');

export interface StopSessionResult {
  accepted: true;
}
/** Ends a live session so the run parks as paused (reason `stopped`); resolves once the session is ending. */
export const stopSession = defineUpdate<StopSessionResult>('stopSession');

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
  | 'done'
  /** The pod is stopped and the slot freed; the run waits for resume, finish, cancel or expiry. */
  | 'parked'
  /** A resume was accepted and is queued or starting; no session is up yet. */
  | 'resuming';

export interface RunState {
  phase: RunPhase;
  terminalAttached: number;
}
export const runState = defineQuery<RunState>('state');
