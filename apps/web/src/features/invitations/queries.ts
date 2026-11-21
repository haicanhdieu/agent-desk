import { queryOptions } from '@tanstack/react-query';
import type { MyInvitationDto, Page } from '@agentdesk/contracts';
import { api } from '../api';
import { invitationKeys } from './keys';

/** The signed-in user's invitations; outside `['org', slug]` because they belong to no org yet. */
export const myInvitationsQuery = queryOptions({
  queryKey: invitationKeys.list(),
  queryFn: (): Promise<Page<MyInvitationDto>> => api.me.listInvitations({ query: { page: 1, pageSize: 100 } }),
});

export const myInvitationQuery = (id: string) =>
  queryOptions({
    queryKey: invitationKeys.detail(id),
    queryFn: (): Promise<MyInvitationDto> => api.me.getInvitation({ params: { invitationId: id } }),
  });
