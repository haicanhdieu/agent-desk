// Pure decisions for the parked phase of RunWorkflow. Workflow-safe: type imports only, no clocks or randomness.
import type { PauseReason } from '@agentdesk/contracts';
import type { EndReason } from './run.workflow';
import type { RunPhase } from './signals';

export type { PauseReason };

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

/** Seconds the next pod may run: the unused part of the limit, never less than RESUME_MIN_SECONDS on a resume (`minSeconds` is a test seam). */
export function sessionAllowanceSeconds(
  limitSeconds: number,
  usedSeconds: number,
  isResume: boolean,
  minSeconds: number = RESUME_MIN_SECONDS,
): number {
  const left = Math.max(0, limitSeconds - usedSeconds);
  return isResume ? Math.max(left, minSeconds) : left;
}

/** Why a resume is refused, or `undefined` when allowed. Allowed in phase `parked`, and in `ending` (queued until the park). */
export function resumeRejection(phase: RunPhase): string | undefined {
  if (phase === 'parked' || phase === 'ending') return undefined;
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

/** The park kind of a pod that ended without our asking: what the run was doing (anything but `agent_done` needs a person). */
const lostKindOf = (phase: RunPhase): ParkKind => parkKindOf(phase) ?? 'needs_input';

export interface EndOutcomeInput {
  /** The workflow began ending the session (a person Finish or the idle timer). */
  ending: boolean;
  finishRequested: boolean;
  /** The run's phase when the pod ended. */
  phase: RunPhase;
  /** What the run was doing when the idle timer began the end. */
  parkKind?: ParkKind;
  /** Why the ending session parks (a person's Stop: 'stopped'); absent means the idle timer. */
  parkReason?: PauseReason;
  /** The runner's end line reason: a hint from the pod's own output, never authority. */
  endReason?: EndReason;
  /** The pod vanished, or ended with no exit code, after the session started. */
  podLost: boolean;
  /** The pod's real exit code (-1 when unknown). */
  exitCode: number;
}

export type EndOutcome =
  { kind: 'park'; parkKind: ParkKind; reason: PauseReason } | { kind: 'succeeded' } | { kind: 'failed' };

/**
 * What a pod that ended after its session started means for the run. Decided in this order:
 * 1. We were ending it: a person Finish succeeds, the idle timer parks (`idle_timeout`).
 * 2. The pod was lost, or ended with no end line and a non-zero code (OOMKilled, evicted, Job deleted), or ended through
 *    a path we did not ask for (`signal`, `session_gone`): park (`pod_lost`), keeping the work.
 * 3. The agent exited by itself: code 0 succeeds; any other code parks (`agent_crashed`), keeping the work (D1).
 * The pod's real exit code decides 3; the end line is only a hint, since the agent can print a forged one.
 * A legacy runner (no end line) that exited 0 succeeds as before. No rule fails a started session today, so `failed` is
 * kept in the type only for callers that handle it.
 */
export function endOutcome(input: EndOutcomeInput): EndOutcome {
  if (input.ending) {
    if (input.finishRequested || input.parkKind === undefined) return { kind: 'succeeded' };
    return { kind: 'park', parkKind: input.parkKind, reason: input.parkReason ?? 'idle_timeout' };
  }
  const parkKind = lostKindOf(input.phase);
  if (input.podLost) return { kind: 'park', parkKind, reason: 'pod_lost' };
  if (input.endReason === undefined) {
    if (input.exitCode === 0) return { kind: 'succeeded' };
    return { kind: 'park', parkKind, reason: 'pod_lost' };
  }
  if (input.endReason !== 'agent_exit') return { kind: 'park', parkKind, reason: 'pod_lost' };
  if (input.exitCode === 0) return { kind: 'succeeded' };
  return { kind: 'park', parkKind, reason: 'agent_crashed' };
}
