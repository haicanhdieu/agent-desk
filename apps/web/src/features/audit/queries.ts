import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import type { AuditEntryDto, Page } from '@agentdesk/contracts';
import { api } from '../api';

/** Prefix of every cached page of the org's audit log. */
export const auditListKey = (org: string) => ['org', org, 'audit', 'list'] as const;

export const auditQuery = (org: string, orgId: string, q: { page: number; pageSize: number }) =>
  queryOptions({
    queryKey: [...auditListKey(org), q.page, q.pageSize] as const,
    queryFn: (): Promise<Page<AuditEntryDto>> => api.audit.list({ params: { orgId }, query: q }),
    staleTime: 30_000,
    // Another page of the same org keeps the old rows on screen while it loads; another org's rows never do.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === org ? keepPreviousData(previous) : undefined,
  });
