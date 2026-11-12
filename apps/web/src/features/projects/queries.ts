import { queryOptions } from '@tanstack/react-query';
import { api } from '../api';

const projectKey = (org: string, projectId: string) => ['org', org, 'projects', projectId] as const;

// Keys per spec §4.2; every key starts with ['org', org].
export const projectsQueries = {
  list: (org: string) =>
    queryOptions({
      queryKey: ['org', org, 'projects'] as const,
      queryFn: () => api.projects.list(),
    }),
  detail: (org: string, projectId: string) =>
    queryOptions({
      queryKey: projectKey(org, projectId),
      queryFn: () => api.projects.get({ params: { projectId } }),
    }),
  connection: (org: string, projectId: string) =>
    queryOptions({
      queryKey: [...projectKey(org, projectId), 'connection'] as const,
      queryFn: () => api.projects.connection({ params: { projectId } }),
      refetchOnWindowFocus: true,
    }),
};
