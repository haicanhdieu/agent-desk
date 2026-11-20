import { queryOptions } from '@tanstack/react-query';
import type { PageQuery } from '@agentdesk/contracts';
import { WHOLE_SET } from '@/app/pagination';
import { api } from '../api';

const projectKey = (org: string, projectId: string) => ['org', org, 'projects', projectId] as const;

/** Prefix of every cached page of the projects list (invalidate with it, not with one page's key). */
export const projectsListKey = (org: string) => ['org', org, 'projects', 'list'] as const;

// Keys per spec §4.2; every key starts with ['org', org].
export const projectsQueries = {
  list: (org: string, q: PageQuery) =>
    queryOptions({
      queryKey: [...projectsListKey(org), q.page, q.pageSize] as const,
      queryFn: () => api.projects.list({ query: q }),
    }),
  /** Page 1 at the maximum size: for the readers that need every project (the switcher, Needs you). */
  all: (org: string) => projectsQueries.list(org, WHOLE_SET),
  detail: (org: string, projectId: string) =>
    queryOptions({
      queryKey: projectKey(org, projectId),
      queryFn: () => api.projects.get({ params: { projectId } }),
      // The detail carries `counts` (needs you, running, queued): an aggregate of the runs, shown next to the runs
      // lists (chips, slots, the needs-you badge). It refetches on focus like the runs queries so the two agree.
      refetchOnWindowFocus: true,
    }),
  connection: (org: string, projectId: string) =>
    queryOptions({
      queryKey: [...projectKey(org, projectId), 'connection'] as const,
      queryFn: () => api.projects.connection({ params: { projectId } }),
      refetchOnWindowFocus: true,
    }),
};
