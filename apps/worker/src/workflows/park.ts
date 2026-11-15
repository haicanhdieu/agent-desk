// Pure decisions for the parked phase of RunWorkflow. Workflow-safe: type imports only, no clocks or randomness.
import type { RunPhase } from './signals';

/** A resumed pod's time allowance is never less than this. */
export const RESUME_MIN_SECONDS = 3600;

/** What the run was doing when the idle timer stopped its pod. */
export type ParkKind = 'needs_input' | 'done';

/** The park kind of a phase at a turn boundary, or `undefined` for any other phase. */
export function parkKindOf(phase: RunPhase): ParkKind | undefined {
  if (phase === 'idle') return 'needs_input';
  if (phase === 'agent_done') return 'done';
  return undefined;
}

export const phaseOfParkKind = (kind: ParkKind): 'idle' | 'agent_done' =>
  kind === 'needs_input' ? 'idle' : 'agent_done';

export const statusOfParkKind = (kind: ParkKind): 'idle' | 'done' => (kind === 'needs_input' ? 'idle' : 'done');

/** Seconds the next pod may run: the unused part of the limit, never less than RESUME_MIN_SECONDS on a resume. */
export function sessionAllowanceSeconds(limitSeconds: number, usedSeconds: number, isResume: boolean): number {
  const left = Math.max(0, limitSeconds - usedSeconds);
  return isResume ? Math.max(left, RESUME_MIN_SECONDS) : left;
}

/** Why a resume is refused, or `undefined` when allowed. Allowed only in phase `parked`. */
export function resumeRejection(phase: RunPhase): string | undefined {
  if (phase === 'parked') return undefined;
  if (phase === 'resuming') return 'This run is already being resumed';
  return 'Only a paused run, or a finished run whose session is still kept, can be resumed';
}

/** What a cancel does in this phase. */
export function cancelEffect(
  phase: RunPhase,
  kind: ParkKind | undefined,
  sessionUp: boolean,
): 'stop_run' | 'abort_resume' | 'ignore' {
  if (phase === 'resuming' && !sessionUp) return 'abort_resume';
  if (phase === 'parked' && kind === 'done') return 'ignore';
  return 'stop_run';
}
