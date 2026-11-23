import { infiniteQueryOptions, keepPreviousData } from '@tanstack/react-query';
import type { MembersListQuery } from '@agentdesk/contracts';
import { api } from '../api';
import { membersListKey } from '../members/queries';

export const PICKER_PAGE_SIZE = 20;
export const PICKER_DEBOUNCE_MS = 250;

/** One page of the Add picker: org members without a role on `excludeProject`; `q` is trimmed and left out when empty. */
export function memberSearchQuery(q: string, excludeProject: string, page: number): MembersListQuery {
  const text = q.trim();
  return {
    ...(text !== '' && { q: text }),
    excludeProject,
    page,
    pageSize: PICKER_PAGE_SIZE,
  };
}

/** The infinite picker list for one search text (pass it trimmed); a new text is a new list, so a slow earlier answer never shows under it. */
export function pickerQuery(org: string, orgId: string, projectId: string, q: string) {
  return infiniteQueryOptions({
    queryKey: [...membersListKey(org), 'infinite', { excludeProject: projectId, q }] as const,
    queryFn: ({ pageParam }) =>
      api.members.list({ params: { orgId }, query: memberSearchQuery(q, projectId, pageParam) }),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (all.length * last.pageSize < last.total ? all.length + 1 : undefined),
    // The previous search stays on screen (state "searching") while the next one loads.
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}
