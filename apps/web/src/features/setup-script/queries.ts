import { queryOptions } from '@tanstack/react-query';
import type { EnvKind, PageQuery } from '@agentdesk/contracts';
import { api } from '../api';

const setupKey = (org: string, projectId: string) => ['org', org, 'projects', projectId, 'setup'] as const;

/** Prefix of every cached page of one kind of the project's environment entries. */
export const envKey = (org: string, projectId: string, kind: EnvKind) =>
  [...setupKey(org, projectId), 'env', kind] as const;

/** Prefix of every cached page of the version history. */
export const versionsKey = (org: string, projectId: string) => [...setupKey(org, projectId), 'versions'] as const;

// Workspace setup reads (spec §5.5): the saved script and its history, the plugins panel and the latest setup test.
export const setupQueries = {
  script: (org: string, projectId: string) =>
    queryOptions({
      queryKey: [...setupKey(org, projectId), 'script'] as const,
      queryFn: () => api.setupScript.get({ params: { projectId } }),
    }),
  versions: (org: string, projectId: string, q: PageQuery) =>
    queryOptions({
      queryKey: [...versionsKey(org, projectId), q.page, q.pageSize] as const,
      queryFn: () => api.setupScript.versions({ params: { projectId }, query: q }),
    }),
  version: (org: string, projectId: string, version: number) =>
    queryOptions({
      queryKey: [...setupKey(org, projectId), 'version', version] as const,
      queryFn: () => api.setupScript.version({ params: { projectId, version } }),
      // A saved version never changes.
      staleTime: Infinity,
    }),
  env: (org: string, projectId: string, q: { kind: EnvKind; page: number; pageSize: number }) =>
    queryOptions({
      queryKey: [...envKey(org, projectId, q.kind), { page: q.page, pageSize: q.pageSize }] as const,
      queryFn: () =>
        api.projectEnv.list({ params: { projectId }, query: { kind: q.kind, page: q.page, pageSize: q.pageSize } }),
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
