import type { AcceptInvitationResponse } from '@agentdesk/contracts';
import type { ApiError } from '@agentdesk/contracts/client';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { api } from '../api';
import { invitationKeys } from './keys';

// No optimistic updates: the list changes when the server has answered. A failure (409 after a revoke, expiry or an
// answer in another tab) also refetches the list, so the card leaves it (BR-23).

export function useAcceptInvitation(): UseMutationResult<AcceptInvitationResponse, ApiError, string> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation<AcceptInvitationResponse, ApiError, string>({
    mutationFn: (id) => api.me.acceptInvitation({ params: { invitationId: id } }),
    onSuccess: async ({ org }) => {
      // The org layout reads the membership list, so it must be fresh before the navigation.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['session', 'orgs'] }),
        queryClient.invalidateQueries({ queryKey: invitationKeys.list() }),
      ]);
      await navigate({ to: '/o/$org/projects', params: { org: org.slug } });
    },
    onError: () => void queryClient.invalidateQueries({ queryKey: invitationKeys.list() }),
  });
}

export function useDeclineInvitation(): UseMutationResult<null, ApiError, string> {
  const queryClient = useQueryClient();
  return useMutation<null, ApiError, string>({
    mutationFn: (id) => api.me.declineInvitation({ params: { invitationId: id } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: invitationKeys.list() }),
  });
}
