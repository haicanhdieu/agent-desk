import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import type { MemberDto, Page } from '@agentdesk/contracts';
import { api } from '../api';

/** Prefix of every cached page of the org's members list (invalidate with it, not with one page's key). */
export const membersListKey = (org: string) => ['org', org, 'members', 'list'] as const;

export const membersQuery = (org: string, orgId: string, q: { page: number; pageSize: number }) =>
  queryOptions({
    queryKey: [...membersListKey(org), q.page, q.pageSize] as const,
    queryFn: (): Promise<Page<MemberDto>> => api.members.list({ params: { orgId }, query: q }),
    // Another page of the same org keeps the old rows on screen while it loads; another org's rows never do.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === org ? keepPreviousData(previous) : undefined,
  });
