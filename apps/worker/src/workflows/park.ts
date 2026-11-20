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

/** What a cancel does in this phase. `automatic`: the current resume was started by the workflow; a cancel before its session is up stops the run. */
export function cancelEffect(
  phase: RunPhase,
  kind: ParkKind | undefined,
  sessionUp: boolean,
  automatic = false,
): 'stop_run' | 'abort_resume' | 'ignore' {
  if (phase === 'resuming' && !sessionUp && !automatic) return 'abort_resume';
  if (phase === 'parked' && kind === 'done') return 'ignore';
  return 'stop_run';
}

/**
 * A Finish on a session re-opened from a kept `done` session re-parks it (same deadline) instead of deleting the volume,
 * while that deadline is still ahead. Any other Finish ends the run and deletes the volume.
 */
export function shouldRepark(input: {
  finishRequested: boolean;
  kept: { kind: ParkKind; expiresAt: string } | undefined;
  nowMs: number;
}): boolean {
  if (!input.finishRequested || input.kept === undefined || input.kept.kind !== 'done') return false;
  return Date.parse(input.kept.expiresAt) > input.nowMs;
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

/** Mirrors UNEXPECTED_END_KINDS in @agentdesk/core (workflow code cannot import core); a test asserts equality. */
export const UNEXPECTED_END_KINDS = ['killed', 'lost', 'signal', 'session_gone', 'agent_exit'] as const;
export type UnexpectedEndKind = (typeof UNEXPECTED_END_KINDS)[number];
export interface UnexpectedEnd {
  kind: UnexpectedEndKind;
  exitCode?: number;
  podReason?: string;
}

const killed = (input: { exitCode: number; podReason?: string }): UnexpectedEnd => ({
  kind: 'killed',
  exitCode: input.exitCode,
  ...(input.podReason !== undefined ? { podReason: input.podReason } : {}),
});

/** The kind of unexpected end and its facts, in `endOutcome`'s order; undefined for any end that is not unexpected. */
export function unexpectedEndOf(input: EndOutcomeInput & { podReason?: string }): UnexpectedEnd | undefined {
  if (input.ending) return undefined;
  if (input.podLost) return { kind: 'lost' };
  if (input.endReason === undefined) {
    if (input.exitCode === 0) return undefined;
    return killed(input);
  }
  if (input.endReason === 'signal') return { kind: 'signal' };
  if (input.endReason === 'session_gone') return { kind: 'session_gone' };
  if (input.endReason === 'stop_request') return killed(input);
  if (input.exitCode === 0) return undefined;
  return { kind: 'agent_exit', exitCode: input.exitCode };
}

export type AutoResumeDecision = 'resume' | 'gave_up' | 'off';

/** off: max <= 0 or the park kind is done; gave_up: streak >= max; else resume. */
export function autoResumeDecision(streak: number, max: number, parkKind: ParkKind): AutoResumeDecision {
  if (max <= 0 || parkKind === 'done') return 'off';
  return streak >= max ? 'gave_up' : 'resume';
}

export const AUTO_RESUME_WAIT_MAX_SECONDS = 600;

/** Wait before the next try after `failedStarts` tries in a row whose pod could not start: 60, 120, 240, 480, then 600. */
export function autoResumeWaitSeconds(failedStarts: number): number {
  return Math.min(AUTO_RESUME_WAIT_MAX_SECONDS, 60 * 2 ** Math.max(0, failedStarts - 1));
}
