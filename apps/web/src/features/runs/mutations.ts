import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { projectsQueries } from '../projects/queries';
import { clearPendingAction, hasPendingAction, RUN_ACTION_NOTE, setPendingAction, type RunAction } from './pending';
import { runsKey, runsQueries, type CachedRun, type RunList } from './queries';

// Cancel and finish (spec §4.3): a status note on the run wherever it is cached, from the click until the run is
// final. The final status comes from the run event stream (Task 13) or a refetch; the note survives refetches of the
// still-active run (pending.ts). On error only that run's note is removed and the caller toasts.

export const CANCELLING = RUN_ACTION_NOTE.cancel;
export const FINISHING = RUN_ACTION_NOTE.finish;

export interface RunRef {
  /** The run's id (cancel and finish take it). */
  id: string;
  /** The per-project run number (the cache keys use it). */
  number: number;
}

const withNote = (r: CachedRun, statusNote: string | undefined): CachedRun => ({ ...r, statusNote });

const listsKey = (org: string, projectId: string) => [...runsKey(org, projectId), 'list'] as const;

/** Sets (or, with `undefined`, removes) the note on one run: its detail and its row in every cached runs list. */
function setRunNote(qc: QueryClient, org: string, projectId: string, number: number, note: string | undefined) {
  qc.setQueryData(runsQueries.detail(org, projectId, number).queryKey, (r) => r && withNote(r, note));
  qc.setQueriesData<RunList>({ queryKey: listsKey(org, projectId) }, (list) =>
    list?.items.some((r) => r.number === number)
      ? { ...list, items: list.items.map((r) => (r.number === number ? withNote(r, note) : r)) }
      : list,
  );
}

function useRunAction(action: RunAction, org: string, projectId: string, onError?: (e: unknown) => void) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (run: RunRef) =>
      action === 'cancel'
        ? api.runs.cancel({ params: { runId: run.id } })
        : api.runs.finish({ params: { runId: run.id } }),
    onMutate: async (run) => {
      // A fetch of this run already under way would land without the note: cancel it (its log too) and the lists.
      await Promise.all([
        qc.cancelQueries({ queryKey: runsQueries.detail(org, projectId, run.number).queryKey }),
        qc.cancelQueries({ queryKey: listsKey(org, projectId) }),
      ]);
      if (hasPendingAction(qc, run.id)) setRunNote(qc, org, projectId, run.number, RUN_ACTION_NOTE[action]);
    },
    onError: (e, run) => {
      clearPendingAction(qc, run.id);
      onError?.(e);
    },
    onSettled: async (_res, _e, run) => {
      // Until the event stream patches the run (Task 13), refetch it, its log, the lists and the project counts.
      // A run that is still active comes back with the note (the queryFns re-apply it).
      await Promise.all([
        qc.invalidateQueries({ queryKey: runsQueries.detail(org, projectId, run.number).queryKey }),
        qc.invalidateQueries({ queryKey: listsKey(org, projectId) }),
        qc.invalidateQueries({ queryKey: projectsQueries.detail(org, projectId).queryKey, exact: true }),
      ]);
    },
  });
  /** Starts the action unless a cancel or finish of this run is already pending. */
  return (target: RunRef) => {
    if (hasPendingAction(qc, target.id)) return;
    setPendingAction(qc, target.id, action, () => setRunNote(qc, org, projectId, target.number, undefined));
    mutation.mutate(target);
  };
}

/** Cancel a run: "Cancelling…" until it is final; `onError` (a toast) after the note is removed. */
export const useCancelRun = (org: string, projectId: string, { onError }: { onError?(e: unknown): void } = {}) =>
  useRunAction('cancel', org, projectId, onError);

/** Finish an idle (or running) run as succeeded: "Finishing…" until it is final; `onError` after the note is removed. */
export const useFinishRun = (org: string, projectId: string, { onError }: { onError?(e: unknown): void } = {}) =>
  useRunAction('finish', org, projectId, onError);
