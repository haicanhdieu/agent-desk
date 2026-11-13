import type { RunDto, RunEventDto, RunListFilter } from '@agentdesk/contracts';
import { queryOptions } from '@tanstack/react-query';
import { api } from '../api';
import { withPendingNote } from './pending';

/** The contract's maximum page size. */
export const RUN_LIST_PAGE_SIZE = 100;
/** Cap on pages fetched per list (1000 runs). */
export const RUN_LIST_MAX_PAGES = 10;

/**
 * A run as cached: the DTO plus `statusNote`, a client-only note while a cancel or finish is pending ("Cancelling…").
 * Server data never carries it; the queryFns re-apply it to fresh data until the run is final (pending.ts).
 */
export type CachedRun = RunDto & { statusNote?: string };

export interface RunList {
  items: CachedRun[];
  /** More runs exist beyond the page cap. */
  truncated: boolean;
}

const projectKey = (org: string, projectId: string) => ['org', org, 'projects', projectId] as const;
export const runsKey = (org: string, projectId: string) => [...projectKey(org, projectId), 'runs'] as const;

// Keys per spec §4.2. Runs queries refetch on window focus (as do the connection queries and, for its counts,
// `projectsQueries.detail`).
export const runsQueries = {
  /**
   * Every run matching `filter` (and `ticket`, the ticket ref, the provider-local ticket number like `12`), newest first. The API pages by
   * cursor; this follows `nextCursor` for up to `RUN_LIST_MAX_PAGES` pages of `RUN_LIST_PAGE_SIZE`. `truncated` is
   * true when runs beyond that cap exist (logged in CONTRACT-GAPS.md; there is no aggregate count route).
   * A failed page fails the whole query, and Query's retry starts again from page 1: keeping fetched pages across
   * retries would need state outside the query function (or useInfiniteQuery, whose pages the screens don't need),
   * and a fresh walk also avoids stitching pages from different moments. At most 10 pages, so the cost is bounded.
   */
  list: (org: string, projectId: string, filter: RunListFilter, ticket?: string) =>
    queryOptions({
      queryKey: [...runsKey(org, projectId), 'list', filter, ...(ticket === undefined ? [] : [ticket])] as const,
      queryFn: async ({ client }): Promise<RunList> => {
        const items: CachedRun[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < RUN_LIST_MAX_PAGES; page += 1) {
          const res = await api.runs.list({
            params: { projectId },
            query: {
              filter,
              limit: RUN_LIST_PAGE_SIZE,
              ...(ticket !== undefined && { ticket }),
              ...(cursor !== undefined && { cursor }),
            },
          });
          items.push(...res.items.map((r) => withPendingNote(client, r)));
          if (res.nextCursor === null) return { items, truncated: false };
          cursor = res.nextCursor;
        }
        return { items, truncated: true };
      },
      refetchOnWindowFocus: true,
    }),
  detail: (org: string, projectId: string, number: number) =>
    queryOptions({
      queryKey: [...runsKey(org, projectId), number] as const,
      queryFn: async ({ client }): Promise<CachedRun> =>
        withPendingNote(client, await api.runs.byNumber({ params: { projectId, number } })),
      refetchOnWindowFocus: true,
    }),
  /**
   * The stored event log; `runs.log` takes the run id, so this goes through the (cached) detail first. A final run's
   * log no longer changes, so with `final` it loads once: never stale, no refetch on focus. Events the run stream
   * added after the fetched ones (higher seq) are kept, so a refetch while streaming never drops them.
   */
  events: (org: string, projectId: string, number: number, final = false) =>
    queryOptions({
      queryKey: [...runsKey(org, projectId), number, 'events'] as const,
      queryFn: async ({ client, queryKey }): Promise<RunEventDto[]> => {
        const run = await client.ensureQueryData(runsQueries.detail(org, projectId, number));
        const log = await api.runs.log({ params: { runId: run.id } });
        const fetchedTo = log.items.reduce((max, e) => Math.max(max, e.seq), 0);
        const live = (client.getQueryData<RunEventDto[]>(queryKey) ?? []).filter((e) => e.seq > fetchedTo);
        return [...log.items, ...live];
      },
      ...(final ? { staleTime: Infinity, refetchOnWindowFocus: false } : { refetchOnWindowFocus: true }),
    }),
  ignored: (org: string, projectId: string) =>
    queryOptions({
      queryKey: [...projectKey(org, projectId), 'ignored'] as const,
      queryFn: () => api.projects.ignored({ params: { projectId } }),
    }),
};
