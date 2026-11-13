import { queryOptions } from '@tanstack/react-query';
import { api } from '../api';

const setupKey = (org: string, projectId: string) => ['org', org, 'projects', projectId, 'setup'] as const;

// Workspace setup reads (spec §5.5): the saved script and its history, the plugins panel and the latest setup test.
export const setupQueries = {
  script: (org: string, projectId: string) =>
    queryOptions({
      queryKey: [...setupKey(org, projectId), 'script'] as const,
      queryFn: () => api.setupScript.get({ params: { projectId } }),
    }),
  versions: (org: string, projectId: string) =>
    queryOptions({
      queryKey: [...setupKey(org, projectId), 'versions'] as const,
      queryFn: () => api.setupScript.versions({ params: { projectId } }),
    }),
  version: (org: string, projectId: string, version: number) =>
    queryOptions({
      queryKey: [...setupKey(org, projectId), 'version', version] as const,
      queryFn: () => api.setupScript.version({ params: { projectId, version } }),
      // A saved version never changes.
      staleTime: Infinity,
    }),
  plugins: (org: string, projectId: string) =>
    queryOptions({
      queryKey: [...setupKey(org, projectId), 'plugins'] as const,
      queryFn: () => api.setup.plugins({ params: { projectId } }),
    }),
  latest: (org: string, projectId: string) =>
    queryOptions({
      queryKey: [...setupKey(org, projectId), 'latest-test'] as const,
      queryFn: () => api.setupTests.latest({ params: { projectId } }),
    }),
};
