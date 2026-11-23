import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import type { AuditEntryDto, Page } from '@agentdesk/contracts';
import { api } from '../api';

/** Prefix of every cached page of one project's audit log. */
export const projectAuditListKey = (org: string, projectId: string) =>
  ['org', org, 'projects', projectId, 'audit', 'list'] as const;

export const projectAuditQuery = (org: string, projectId: string, q: { page: number; pageSize: number }) =>
  queryOptions({
    queryKey: [...projectAuditListKey(org, projectId), q.page, q.pageSize] as const,
    queryFn: (): Promise<Page<AuditEntryDto>> => api.projects.audit({ params: { projectId }, query: q }),
    staleTime: 30_000,
    // Another page of the same project keeps the old rows on screen while it loads; another project's rows never do.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === org && previousQuery.queryKey[3] === projectId
        ? keepPreviousData(previous)
        : undefined,
  });
