import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import type { InvitationDto, InvitationListStatus, Page } from '@agentdesk/contracts';
import { api } from '../api';

/** Prefix of every cached page of the org's invitations list (invalidate with it, not with one page's key). */
export const orgInvitationsListKey = (org: string) => ['org', org, 'invitations', 'list'] as const;

export const orgInvitationsQuery = (
  org: string,
  orgId: string,
  q: { status: InvitationListStatus; page: number; pageSize: number },
) =>
  queryOptions({
    queryKey: [...orgInvitationsListKey(org), q.status, q.page, q.pageSize] as const,
    queryFn: (): Promise<Page<InvitationDto>> => api.invitations.list({ params: { orgId }, query: q }),
    // Another page of the same filter keeps the old rows on screen while it loads; another filter does not.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[4] === q.status ? keepPreviousData(previous) : undefined,
  });
