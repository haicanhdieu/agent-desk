import {
  RunListFilter,
  type ProjectDto,
  type ProjectRunEvent,
  type RunEventDto,
  type RunStatus,
  type RunStatusEvent,
} from '@agentdesk/contracts';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { projectsQueries } from '../projects/queries';
import { isFinal } from './map';
import { clearPendingAction } from './pending';
import { runsKey, runsQueries, type CachedRun, type RunList } from './queries';

// Applying realtime messages (spec §5.1, §5.2) to the Query cache. Both streams patch through `applyRunStatus`, which
// is idempotent: the run stream and the project stream deliver the same status change, and the second one finds the
// cache already patched (so project counts move once).

/** Inserts `e` by `seq`; a `seq` already in the list (a replayed backlog after a reconnect) is ignored. */
export function applyRunEvent(list: RunEventDto[], e: RunEventDto): RunEventDto[] {
  const last = list.at(-1);
  if (last === undefined || last.seq < e.seq) return [...list, e];
  if (list.some((x) => x.seq === e.seq)) return list;
  const at = list.findIndex((x) => x.seq > e.seq);
  return [...list.slice(0, at), e, ...list.slice(at)];
}

/** The highest `seq` in a run's events list (0 for none). */
export const lastSeqOf = (list: RunEventDto[] | undefined): number =>
  (list ?? []).reduce((max, e) => Math.max(max, e.seq), 0);

/** A status change: from the run stream (with exit code and reason) or the project stream (without). */
export type StatusChange = RunStatusEvent | ProjectRunEvent;

const listsKey = (org: string, projectId: string) => [...runsKey(org, projectId), 'list'] as const;

/**
 * The run with the new status. Timestamps the event does not carry are approximated with the client clock (the
 * detail is refetched when the run ends); a pending note ("Cancelling…") rides along.
 */
function patched(run: CachedRun, e: StatusChange): CachedRun {
  const at = new Date().toISOString();
  const status = e.status;
  return {
    ...run,
    status,
    ...('exitCode' in e && {
      exitCode: e.exitCode,
      failureReason: e.failureReason,
    }),
    startedAt: run.startedAt ?? (status === 'queued' ? null : at),
    idleSince: status === 'idle' ? (run.idleSince ?? at) : null,
    finishedAt: isFinal(status) ? (run.finishedAt ?? at) : null,
  };
}

const matches = (filter: RunListFilter, status: RunStatus): boolean => {
  switch (filter) {
    case 'needs_you':
      return status === 'idle';
    case 'active':
      return status === 'starting' || status === 'running' || status === 'idle';
    case 'queued':
      return status === 'queued';
    case 'ended':
      return isFinal(status);
    case 'all':
      return true;
  }
};

type CountKey = keyof ProjectDto['counts'];
const COUNT_KEYS: readonly CountKey[] = ['needsYou', 'running', 'queued'];

/** Whether a run with `status` is in a project count, as the API counts: `running` is every live job, idle included. */
const countedIn = (key: CountKey, status: RunStatus): boolean => {
  switch (key) {
    case 'needsYou':
      return status === 'idle';
    case 'running':
      return status === 'starting' || status === 'running' || status === 'idle';
    case 'queued':
      return status === 'queued';
  }
};

/** The run as cached, from its detail or any runs list row. */
function cachedRun(qc: QueryClient, org: string, projectId: string, e: StatusChange): CachedRun | undefined {
  const detail = qc.getQueryData(runsQueries.detail(org, projectId, e.number).queryKey);
  if (detail) return detail;
  for (const [, list] of qc.getQueriesData<RunList>({
    queryKey: listsKey(org, projectId),
  })) {
    const row = list?.items.find((r) => r.id === e.runId);
    if (row) return row;
  }
  return undefined;
}

/** A list key's filter and ticket: ['org', org, 'projects', id, 'runs', 'list', filter, ticket?]. */
function listScope(key: QueryKey): { filter: RunListFilter; ticket: unknown } | undefined {
  const filter = RunListFilter.safeParse(key[6]);
  return filter.success ? { filter: filter.data, ticket: key[7] } : undefined;
}

/**
 * Applies a status change to the run's detail and its row in every cached runs list, and moves the project counts.
 * A row that no longer matches its list's filter leaves the list; a list the run now belongs to but does not hold
 * (or whose membership cannot be told) is invalidated, as is the project when the run's previous status is unknown.
 * A final status ends a pending cancel or finish (its note goes) after the patch.
 */
export function applyRunStatus(qc: QueryClient, org: string, projectId: string, e: StatusChange): void {
  const before = cachedRun(qc, org, projectId, e);
  // The two streams deliver the same changes at different times: a change at or before one already applied (a
  // lagging project stream), or one that would take a final run back to an active status, is stale.
  const applied = appliedSeqsOf(qc);
  const last = applied.get(e.runId);
  if ((last !== undefined && e.seq <= last) || (before !== undefined && isFinal(before.status) && !isFinal(e.status))) {
    return;
  }
  applied.set(e.runId, e.seq);
  // The other stream may have applied this change already: patching again is harmless, moving counts is not.
  const changed = before?.status !== e.status;

  qc.setQueryData(runsQueries.detail(org, projectId, e.number).queryKey, (r) => r && patched(r, e));
  for (const [key, list] of qc.getQueriesData<RunList>({
    queryKey: listsKey(org, projectId),
  })) {
    if (!list) continue;
    const scope = listScope(key);
    const has = list.items.some((r) => r.id === e.runId);
    if (has) {
      const keep = scope === undefined || matches(scope.filter, e.status);
      const items = keep
        ? list.items.map((r) => (r.id === e.runId ? patched(r, e) : r))
        : list.items.filter((r) => r.id !== e.runId);
      qc.setQueryData<RunList>(key, { ...list, items });
    } else if (!changed) {
      continue;
    } else if (
      scope === undefined ||
      (matches(scope.filter, e.status) &&
        (scope.ticket === undefined || before === undefined || scope.ticket === before.ticket.ref))
    ) {
      // The run belongs here now (an uncached run's ticket is unknown, so every ticket list may hold it): only the
      // server has the row and its position.
      void qc.invalidateQueries({ queryKey: key, exact: true });
    }
  }

  const project = projectsQueries.detail(org, projectId).queryKey;
  if (before === undefined) {
    void qc.invalidateQueries({ queryKey: project, exact: true });
  } else if (changed) {
    const moves = COUNT_KEYS.map(
      (k) => [k, Number(countedIn(k, e.status)) - Number(countedIn(k, before.status))] as const,
    );
    if (moves.some(([, d]) => d !== 0)) {
      qc.setQueryData(project, (p) => {
        if (!p) return p;
        const counts = { ...p.counts };
        for (const [k, d] of moves) counts[k] = Math.max(0, counts[k] + d);
        return { ...p, counts };
      });
    }
  }

  if (isFinal(e.status)) clearPendingAction(qc, e.runId);
}

// The seq of the last status change applied per run, per QueryClient (see applyRunStatus).
const appliedSeqs = new WeakMap<QueryClient, Map<string, number>>();
const appliedSeqsOf = (qc: QueryClient) => {
  const map = appliedSeqs.get(qc) ?? new Map<string, number>();
  appliedSeqs.set(qc, map);
  return map;
};

// Runs whose event stream is open (useRunEvents), per QueryClient: the project stream leaves their detail to it.
const streaming = new WeakMap<QueryClient, Map<string, number>>();
const streamsOf = (qc: QueryClient) => {
  const map = streaming.get(qc) ?? new Map<string, number>();
  streaming.set(qc, map);
  return map;
};

/** Marks the run as streamed until the returned function is called. */
export function markStreaming(qc: QueryClient, runId: string): () => void {
  const map = streamsOf(qc);
  map.set(runId, (map.get(runId) ?? 0) + 1);
  return () => {
    const n = (map.get(runId) ?? 1) - 1;
    if (n <= 0) map.delete(runId);
    else map.set(runId, n);
  };
}

export const isStreaming = (qc: QueryClient, runId: string): boolean => streamsOf(qc).has(runId);
