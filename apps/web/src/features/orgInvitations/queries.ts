import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import type { InvitationDto, InvitationListStatus, Page, ProjectDto } from '@agentdesk/contracts';
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

/** The roles the invite dialog offers from (the dialog narrows them to what the inviter may give). */
export const inviteRolesQuery = (org: string, orgId: string) =>
  queryOptions({
    queryKey: ['org', org, 'invitations', 'roles'] as const,
    queryFn: () => api.roles.list({ params: { orgId } }),
  });

/** Every project of the org (the API pages at 100). */
export const inviteProjectsQuery = (org: string) =>
  queryOptions({
    queryKey: ['org', org, 'invitations', 'projects'] as const,
    queryFn: async (): Promise<ProjectDto[]> => {
      const items: ProjectDto[] = [];
      for (let page = 1; ; page += 1) {
        const res = await api.projects.list({ query: { page, pageSize: 100 } });
        items.push(...res.items);
        if (res.items.length === 0 || items.length >= res.total) return items;
      }
    },
  });
