import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { projectsQueries } from '../projects/queries';
import { runsKey, runsQueries, type CachedRun, type RunList } from './queries';

// Cancel and finish (spec §4.3): an optimistic status note on the run, wherever it is cached; the final status comes
// from the run event stream (Task 13) or a refetch. On error only that run's note is removed and the caller toasts.

export const CANCELLING = 'Cancelling…';
export const FINISHING = 'Finishing…';

export interface RunRef {
  /** The run's id (cancel and finish take it). */
  id: string;
  /** The per-project run number (the cache keys use it). */
  number: number;
}

const withNote = (r: CachedRun, statusNote: string | undefined): CachedRun => ({ ...r, statusNote });

/** Sets (or, with `undefined`, removes) the note on one run: its detail and its row in every cached runs list. */
function setRunNote(qc: QueryClient, org: string, projectId: string, number: number, note: string | undefined) {
  qc.setQueryData(runsQueries.detail(org, projectId, number).queryKey, (r) => r && withNote(r, note));
  qc.setQueriesData<RunList>({ queryKey: [...runsKey(org, projectId), 'list'] }, (list) =>
    list?.items.some((r) => r.number === number)
      ? { ...list, items: list.items.map((r) => (r.number === number ? withNote(r, note) : r)) }
      : list,
  );
}

/** Runs with a cancel or finish in flight, per QueryClient: a second click (or the other action) is ignored. */
const busyRuns = new WeakMap<QueryClient, Set<string>>();
const busyOf = (qc: QueryClient) => {
  const set = busyRuns.get(qc) ?? new Set<string>();
  busyRuns.set(qc, set);
  return set;
};

type RunAction = 'cancel' | 'finish';
const NOTE: Record<RunAction, string> = { cancel: CANCELLING, finish: FINISHING };

function useRunAction(action: RunAction, org: string, projectId: string, onError?: (e: unknown) => void) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (run: RunRef) =>
      action === 'cancel'
        ? api.runs.cancel({ params: { runId: run.id } })
        : api.runs.finish({ params: { runId: run.id } }),
    onMutate: async (run) => {
      // A refetch landing now would bring the run back without the note.
      await qc.cancelQueries({ queryKey: runsKey(org, projectId) });
      setRunNote(qc, org, projectId, run.number, NOTE[action]);
    },
    onError: (e, run) => {
      setRunNote(qc, org, projectId, run.number, undefined);
      onError?.(e);
    },
    onSettled: async (_res, _e, run) => {
      busyOf(qc).delete(run.id);
      // Until the event stream patches the run (Task 13), refetch it, its log, the lists and the project counts.
      await Promise.all([
        qc.invalidateQueries({ queryKey: runsQueries.detail(org, projectId, run.number).queryKey }),
        qc.invalidateQueries({ queryKey: [...runsKey(org, projectId), 'list'] }),
        qc.invalidateQueries({ queryKey: projectsQueries.detail(org, projectId).queryKey, exact: true }),
      ]);
    },
  });
  /** Starts the action unless one is already in flight for this run. */
  const run = (target: RunRef) => {
    const busy = busyOf(qc);
    if (busy.has(target.id)) return;
    busy.add(target.id);
    mutation.mutate(target);
  };
  return { run, isPending: mutation.isPending };
}

/** Cancel a run: "Cancelling…" at once; `onError` (a toast) after the note is removed. */
export const useCancelRun = (org: string, projectId: string, { onError }: { onError?(e: unknown): void } = {}) =>
  useRunAction('cancel', org, projectId, onError);

/** Finish an idle (or running) run as succeeded: "Finishing…" at once; `onError` after the note is removed. */
export const useFinishRun = (org: string, projectId: string, { onError }: { onError?(e: unknown): void } = {}) =>
  useRunAction('finish', org, projectId, onError);
