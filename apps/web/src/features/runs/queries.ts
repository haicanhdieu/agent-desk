import type { RunListFilter } from '@agentdesk/contracts';
import { queryOptions } from '@tanstack/react-query';
import { api } from '../api';

const projectKey = (org: string, projectId: string) => ['org', org, 'projects', projectId] as const;
const runsKey = (org: string, projectId: string) => [...projectKey(org, projectId), 'runs'] as const;

// Keys per spec §4.2. Runs queries refetch on window focus (the only area besides connections that does).
export const runsQueries = {
  list: (org: string, projectId: string, filter: RunListFilter) =>
    queryOptions({
      queryKey: [...runsKey(org, projectId), 'list', filter] as const,
      queryFn: () => api.runs.list({ params: { projectId }, query: { filter, limit: 50 } }),
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
