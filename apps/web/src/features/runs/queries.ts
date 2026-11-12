import type { RunDto, RunListFilter } from '@agentdesk/contracts';
import { queryOptions } from '@tanstack/react-query';
import { api } from '../api';

/** The contract's maximum page size. */
export const RUN_LIST_PAGE_SIZE = 100;
/** Cap on pages fetched per list (1000 runs). */
export const RUN_LIST_MAX_PAGES = 10;

export interface RunList {
  items: RunDto[];
  /** More runs exist beyond the page cap. */
  truncated: boolean;
}

const projectKey = (org: string, projectId: string) => ['org', org, 'projects', projectId] as const;
const runsKey = (org: string, projectId: string) => [...projectKey(org, projectId), 'runs'] as const;

// Keys per spec §4.2. Runs queries refetch on window focus (the only area besides connections that does).
export const runsQueries = {
  /**
   * Every run matching `filter` (and `ticket`, a full ticket ref `owner/repo#12`), newest first. The API pages by
   * cursor; this follows `nextCursor` for up to `RUN_LIST_MAX_PAGES` pages of `RUN_LIST_PAGE_SIZE`. `truncated` is
   * true when runs beyond that cap exist (logged in CONTRACT-GAPS.md; there is no aggregate count route).
   */
  list: (org: string, projectId: string, filter: RunListFilter, ticket?: string) =>
    queryOptions({
      queryKey: [...runsKey(org, projectId), 'list', filter, ...(ticket === undefined ? [] : [ticket])] as const,
      queryFn: async (): Promise<RunList> => {
        const items: RunDto[] = [];
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
          items.push(...res.items);
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
      queryFn: () => api.runs.byNumber({ params: { projectId, number } }),
      refetchOnWindowFocus: true,
    }),
  /** The stored event log; `runs.log` takes the run id, so this goes through the (cached) detail first. */
  events: (org: string, projectId: string, number: number) =>
    queryOptions({
      queryKey: [...runsKey(org, projectId), number, 'events'] as const,
      queryFn: async ({ client }) => {
        const run = await client.ensureQueryData(runsQueries.detail(org, projectId, number));
        const log = await api.runs.log({ params: { runId: run.id } });
        return log.items;
      },
      refetchOnWindowFocus: true,
    }),
  ignored: (org: string, projectId: string) =>
    queryOptions({
      queryKey: [...projectKey(org, projectId), 'ignored'] as const,
      queryFn: () => api.projects.ignored({ params: { projectId } }),
    }),
};
