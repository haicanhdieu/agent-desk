import type { CreateInvitationRequest, InvitationDto } from '@agentdesk/contracts';
import type { ApiError } from '@agentdesk/contracts/client';
import { useMutation, useQueryClient, type QueryClient, type UseMutationResult } from '@tanstack/react-query';
import { api } from '../api';
import { orgsQuery } from '../auth/session';
import { orgInvitationsListKey } from './queries';

function orgIdOf(queryClient: QueryClient, org: string): string {
  const found = queryClient.getQueryData(orgsQuery.queryKey)?.find((o) => o.slug === org);
  if (!found) throw new Error(`Unknown organization ${org}`);
  return found.id;
}

// No optimistic updates. Success and failure both refetch: a 409 means the row changed elsewhere, so the list shows
// its new status (BR-19). The mutation stays pending until the refetch is done.
export function useResendInvitation(org: string): UseMutationResult<InvitationDto, ApiError, string> {
  const queryClient = useQueryClient();
  return useMutation<InvitationDto, ApiError, string>({
    mutationFn: (id) => api.invitations.resend({ params: { orgId: orgIdOf(queryClient, org), invitationId: id } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: orgInvitationsListKey(org) }),
  });
}

export function useRevokeInvitation(org: string): UseMutationResult<null, ApiError, string> {
  const queryClient = useQueryClient();
  return useMutation<null, ApiError, string>({
    mutationFn: (id) => api.invitations.remove({ params: { orgId: orgIdOf(queryClient, org), invitationId: id } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: orgInvitationsListKey(org) }),
  });
}

/** Creates an invitation in the route's org. The list is refetched once it exists; a failure changes nothing. */
export function useCreateInvitation(org: string): UseMutationResult<InvitationDto, ApiError, CreateInvitationRequest> {
  const queryClient = useQueryClient();
  return useMutation<InvitationDto, ApiError, CreateInvitationRequest>({
    mutationFn: (body) => api.invitations.create({ params: { orgId: orgIdOf(queryClient, org) }, body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orgInvitationsListKey(org) }),
  });
}
