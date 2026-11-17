import type { RunStatusEvent } from '@agentdesk/contracts';

/**
 * Two status frames with the same key are the same frame: only a change in one of these is worth sending. The pausing
 * state (`sessionEndingAt`) and the pause reason change without a status or seq change, so they are part of the key.
 */
export function statusFrameKey(s: RunStatusEvent): string {
  return JSON.stringify([s.status, s.seq, s.exitCode, s.failureReason, s.sessionEndingAt, s.pauseReason]);
}
