// Pure run-phase decisions for RunWorkflow. Workflow-safe: no Node or I/O imports, no clocks or randomness, only type
// imports, so the same inputs always give the same answer on replay. It lives outside run.workflow.ts because workflow
// code runs in Temporal's sandbox, where coverage cannot see it; the workflow keeps only the Temporal glue.
import type { AgentState } from '@agentdesk/contracts';
import type { ParkKind } from './park';
import type { RunPhase } from './signals';

/** What the main loop reads and the signal handlers change; `phase` is the part the `state` query shows. */
export interface TurnState {
  phase: RunPhase;
  /** A finish was accepted: the session is about to end, so no signal may bring the run back to `running`. */
  finishRequested: boolean;
  /** The workflow must write `running` (the main loop does it and clears this). */
  resumePending: boolean;
  /** The workflow wrote `running` since the last turn ended. */
  wroteRunningSinceTurn: boolean;
  /** A turn ended after `running` was written: followPodLogs' `idle`/`done` may be older, so write it again. */
  idleFixPending: boolean;
}

/** The agent states, plus the legacy signals mapped onto them (`turnFinished` is `needs_input`, `resumed` is `working`). */
export type TurnEvent = AgentState;

/** True while the run sits at a turn boundary: waiting for a person, or declared done. */
export const atTurnBoundary = (phase: RunPhase): boolean => phase === 'idle' || phase === 'agent_done';

/**
 * The state after an agent state, or `undefined` when the event changes nothing (the caller then also leaves its epoch
 * alone). Rules:
 * - `needs_input` ends a running turn (`idle`); `done` ends a running turn, or an idle one (`agent_done`).
 * - `working` brings an idle or done run back to `running` and asks the workflow to write that; `waiting` (held by
 *   background tasks) moves the phase the same way but writes nothing, because followPodLogs already wrote `running`
 *   with `waitingOn` and a second write would clear it.
 * - Once a finish is requested neither of the two resumes the run.
 */
export function nextTurnState(s: TurnState, event: TurnEvent): TurnState | undefined {
  switch (event) {
    case 'needs_input':
      return turnEnded(s, 'idle');
    case 'done':
      return turnEnded(s, 'agent_done');
    case 'working':
      return resumed(s, true);
    case 'waiting':
      return resumed(s, false);
  }
}

function turnEnded(s: TurnState, next: 'idle' | 'agent_done'): TurnState | undefined {
  if (s.phase !== 'running' && !(s.phase === 'idle' && next === 'agent_done')) return undefined;
  return {
    ...s,
    phase: next,
    resumePending: false,
    wroteRunningSinceTurn: false,
    idleFixPending: s.idleFixPending || s.wroteRunningSinceTurn,
  };
}

function resumed(s: TurnState, writeRunning: boolean): TurnState | undefined {
  if (!atTurnBoundary(s.phase) || s.finishRequested) return undefined;
  return { ...s, phase: 'running', resumePending: writeRunning || s.resumePending };
}

/** The legacy `finish` signal counts only at a turn boundary; one sent while running is dropped, not deferred. */
export const acceptsLegacyFinish = (phase: RunPhase): boolean => atTurnBoundary(phase);

/** Why a `finishRun` update is refused (a message for the caller), or `undefined` when it is accepted. */
export function finishRunRejection(phase: RunPhase, ending: boolean, parkKind?: ParkKind): string | undefined {
  if (phase === 'parked' && !ending) {
    return parkKind === 'done' ? 'This run already finished' : parkKind === 'needs_input' ? undefined : generic(phase);
  }
  if (!atTurnBoundary(phase) || ending) return generic(phase);
  return undefined;
}

const generic = (phase: RunPhase): string => `Only a run that needs you or is done can be finished (phase is ${phase})`;

/** A `finishRun` update waits for this: the session is ending, or the run was finalized before it could be. */
export const finishRunSettled = (ending: boolean, phase: RunPhase): boolean =>
  ending || phase === 'finalizing' || phase === 'done';

/** The idle timer runs only at a turn boundary with nobody attached to the terminal and no session end under way. */
export const idleTimerApplies = (phase: RunPhase, attached: number, ending: boolean): boolean =>
  !ending && atTurnBoundary(phase) && attached === 0;

/** The status to write again after a turn ended (see `idleFixPending`), or `undefined` when none applies. */
export function idleFixStatus(phase: RunPhase): 'idle' | 'done' | undefined {
  if (phase === 'idle') return 'idle';
  if (phase === 'agent_done') return 'done';
  return undefined;
}

/**
 * The final status of a run that was stopped (cancel, hard timeout) before it ended on its own. A run that had declared
 * done when the hard timer fired succeeded: it had finished its work and only nobody ended the session.
 */
export function stoppedStatus(
  stopReason: 'cancelled' | 'timed_out' | undefined,
  phaseAtTimeout: RunPhase | undefined,
): 'succeeded' | 'cancelled' | 'timed_out' {
  if (stopReason === 'timed_out' && phaseAtTimeout === 'agent_done') return 'succeeded';
  return stopReason ?? 'cancelled';
}
