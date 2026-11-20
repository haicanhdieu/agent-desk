import type {
  Page,
  RunDto,
  RunEventDto,
  RunListFilter,
  RunListItem,
  RunStatsDto,
  RunTranscriptResponse,
} from '@agentdesk/contracts';
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { api } from '../api';
import { withPendingNote } from './pending';

/** The transcript's page size (the route's default). */
export const TRANSCRIPT_PAGE_SIZE = 200;

/**
 * A run as cached: the list item plus `statusNote`, a client-only note while a cancel or finish is pending
 * ("Cancelling…"). Server data never carries it; the queryFns re-apply it to fresh data until the run is final
 * (pending.ts).
 */
export type CachedRun = RunListItem & { statusNote?: string };
/** A run without the list-only `ticketRunCount`: what the list rows and the detail have in common. */
export type RunCore = Omit<RunListItem, 'ticketRunCount'>;
/** A run as cached by the detail query: the full DTO (with the prompt texts) plus `statusNote`. */
export type CachedRunDetail = RunDto & { statusNote?: string };

/** One page of a runs list, as cached. */
export type RunList = Page<CachedRun>;

/** Which page of a runs list: the filter, the ticket ref (the provider-local ticket number like `12`) and the page. */
export interface RunListParams {
  filter: RunListFilter;
  ticket?: string;
  page: number;
  pageSize: number;
}

const projectKey = (org: string, projectId: string) => ['org', org, 'projects', projectId] as const;
export const runsKey = (org: string, projectId: string) => [...projectKey(org, projectId), 'runs'] as const;
/** Prefix of every cached `runs.stats` query (one per `since`). */
export const runStatsKey = (org: string, projectId: string) => [...runsKey(org, projectId), 'stats'] as const;

// Keys per spec §4.2. Runs queries refetch on window focus (as do the connection queries and, for its counts,
// `projectsQueries.detail`).
export const runsQueries = {
  /**
   * One page of the runs matching `filter` (and `ticket`), newest first, with the total the server counted. The page
   * is the last part of the key, so every page of every list is covered by the `...'list'` prefix.
   */
  list: (org: string, projectId: string, p: RunListParams) =>
    queryOptions({
      queryKey: [...runsKey(org, projectId), 'list', p.filter, p.ticket ?? null, p.page, p.pageSize] as const,
      queryFn: async ({ client }): Promise<RunList> => {
        const res = await api.runs.list({
          params: { projectId },
          query: {
            filter: p.filter,
            page: p.page,
            pageSize: p.pageSize,
            ...(p.ticket !== undefined && { ticket: p.ticket }),
          },
        });
        return { ...res, items: res.items.map((r) => withPendingNote(client, r)) };
      },
      refetchOnWindowFocus: true,
    }),
  /**
   * The Run list's numbers: chip counts, today's runs since `since` (the start of the local day), the newest idle run
   * and the oldest queued run's number. Applying a status change invalidates it (applyEvents).
   */
  stats: (org: string, projectId: string, since: string) =>
    queryOptions({
      queryKey: [...runStatsKey(org, projectId), since] as const,
      queryFn: async ({ client }): Promise<RunStatsDto> => {
        const stats = await api.runs.stats({ params: { projectId }, query: { since } });
        return { ...stats, idleRun: stats.idleRun && withPendingNote(client, stats.idleRun) };
      },
      refetchOnWindowFocus: true,
    }),
  detail: (org: string, projectId: string, number: number) =>
    queryOptions({
      queryKey: [...runsKey(org, projectId), number] as const,
      queryFn: async ({ client }): Promise<CachedRunDetail> =>
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
  /**
   * The saved transcript, newest page first (pages[0]); each page's `nextBefore` leads to the older one. It goes
   * through the (cached) detail for the run id. Saved text does not change while the run has no pod, so it is never
   * stale and not refetched on focus; useTranscriptReload refetches it when the pod goes away.
   */
  transcript: (org: string, projectId: string, number: number) =>
    infiniteQueryOptions({
      queryKey: [...runsKey(org, projectId), number, 'transcript'] as const,
      queryFn: async ({ client, pageParam }): Promise<RunTranscriptResponse> => {
        const run = await client.ensureQueryData(runsQueries.detail(org, projectId, number));
        return api.runs.transcript({
          params: { runId: run.id },
          query: { limit: TRANSCRIPT_PAGE_SIZE, ...(pageParam !== undefined && { before: pageParam }) },
        });
      },
      initialPageParam: undefined as number | undefined,
      getNextPageParam: (p) => p.nextBefore ?? undefined,
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      // The run may have been resumed and stopped again while this screen was away; useTranscriptReload only sees the
      // area turn while mounted, so a remount refetches instead of showing the cached pages. It runs only while
      // enabled (no pod), so it never fetches for a live run.
      refetchOnMount: 'always',
      // Agent call: no automatic retry. A failed load shows "Couldn't load the transcript" with a Retry button at once,
      // instead of a skeleton for the retry delays; the person's Retry is the retry.
      retry: false,
    }),
  ignored: (org: string, projectId: string) =>
    queryOptions({
      queryKey: [...projectKey(org, projectId), 'ignored'] as const,
      queryFn: () => api.projects.ignored({ params: { projectId } }),
    }),
};
