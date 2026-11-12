import { FINAL_RUN_STATUSES, type RunDto } from '@agentdesk/contracts';
import type { QueryClient } from '@tanstack/react-query';

// Pending cancel / finish actions (spec §4.3). From the click until the run is final, the run carries the note
// ("Cancelling…") in every cached copy, even across refetches: the run queries' queryFns re-apply it to fresh data.
// An entry ends when a loaded run is final, on rollback after an error, through `clearPendingAction` (the run event
// stream, Task 13, calls it on a final status) or after PENDING_ACTION_TIMEOUT_MS, so a note never sticks.

export type RunAction = 'cancel' | 'finish';
export const RUN_ACTION_NOTE: Record<RunAction, string> = { cancel: 'Cancelling…', finish: 'Finishing…' };
export const PENDING_ACTION_TIMEOUT_MS = 60_000;

interface PendingAction {
  action: RunAction;
  timer: ReturnType<typeof setTimeout>;
  /** Removes the note from the cached copies of the run. */
  strip(): void;
}

const registry = new WeakMap<QueryClient, Map<string, PendingAction>>();
const entriesOf = (qc: QueryClient) => {
  const map = registry.get(qc) ?? new Map<string, PendingAction>();
  registry.set(qc, map);
  return map;
};

const isFinal = (status: RunDto['status']) => FINAL_RUN_STATUSES.some((s) => s === status);

/** True while a cancel or finish of the run is pending (a second one is ignored). */
export const hasPendingAction = (qc: QueryClient, runId: string): boolean => entriesOf(qc).has(runId);

/** Registers a pending action; `strip` removes its note from the cache when the entry ends. */
export function setPendingAction(qc: QueryClient, runId: string, action: RunAction, strip: () => void): void {
  clearPendingAction(qc, runId);
  const timer = setTimeout(() => clearPendingAction(qc, runId), PENDING_ACTION_TIMEOUT_MS);
  entriesOf(qc).set(runId, { action, timer, strip });
}

/** Ends the run's pending action, if any, and removes its note from the cache. */
export function clearPendingAction(qc: QueryClient, runId: string): void {
  const entry = entriesOf(qc).get(runId);
  if (!entry) return;
  clearTimeout(entry.timer);
  entriesOf(qc).delete(runId);
  entry.strip();
}

/**
 * Fresh run data with the pending note re-applied. A final run ends the entry instead (and keeps no note). Run
 * queryFns pass every loaded run through this.
 */
export function withPendingNote<T extends RunDto>(qc: QueryClient, run: T): T & { statusNote?: string } {
  const entry = entriesOf(qc).get(run.id);
  if (!entry) return run;
  if (isFinal(run.status)) {
    clearPendingAction(qc, run.id);
    return run;
  }
  return { ...run, statusNote: RUN_ACTION_NOTE[entry.action] };
}
