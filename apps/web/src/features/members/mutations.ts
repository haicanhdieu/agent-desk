import type { MemberDto } from '@agentdesk/contracts';
import { ApiError } from '@agentdesk/contracts/client';
import { useMutation, useQueryClient, type QueryClient, type UseMutationResult } from '@tanstack/react-query';
import { accessKeys } from '../access/keys';
import { orgAccessQuery } from '../access/queries';
import { api } from '../api';
import { membersListKey } from './queries';

// No optimistic updates: the list changes when the server has answered, and a mutation stays pending until the
// refetches it asks for are done (so the dialog stays unclosable until the rows are fresh).
//
// - success: members, audit (a new entry) and, when the caller's own row changed, their access (the app bar, the
//   Settings tab and the page follow what they may still do);
// - 404 (member gone) and 409 (last owner): the list shows what is true now;
// - 403: nothing here. The caller's rights may have changed behind the open page; the route reads access again once
//   the refusal has been seen (a dialog Banner must not vanish under the no-access state it explains).

const auditKey = (org: string) => ['org', org, 'audit'] as const;

/** The signed-in user's id as the cached access answer knows it (undefined before it loaded). */
const callerId = (queryClient: QueryClient, org: string) =>
  queryClient.getQueryData(orgAccessQuery(org).queryKey)?.userId;

/** Reads the caller's access again (this org's and the session-wide one): the org menu, the Settings tabs and the page follow what they may still do. */
export const refreshAccess = (queryClient: QueryClient, org: string) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: accessKeys.org(org) }),
    queryClient.invalidateQueries({ queryKey: accessKeys.session() }),
  ]);
const refreshMembers = (queryClient: QueryClient, org: string) =>
  queryClient.invalidateQueries({ queryKey: membersListKey(org) });

async function afterSuccess(queryClient: QueryClient, org: string, userId: string): Promise<void> {
  await Promise.all([
    refreshMembers(queryClient, org),
    queryClient.invalidateQueries({ queryKey: auditKey(org) }),
    ...(userId === callerId(queryClient, org) ? [refreshAccess(queryClient, org)] : []),
  ]);
}

async function afterFailure(queryClient: QueryClient, org: string, e: unknown): Promise<void> {
  if (!(e instanceof ApiError)) return;
  if (e.status === 404 || e.status === 409) await refreshMembers(queryClient, org);
}

/** `PUT /orgs/:orgId/members/:userId/role` (needs `member:update`, org level). `roleId: null` is "No role". */
export function useChangeRole(
  org: string,
  orgId: string,
): UseMutationResult<MemberDto, ApiError, { userId: string; roleId: string | null }> {
  const queryClient = useQueryClient();
  return useMutation<MemberDto, ApiError, { userId: string; roleId: string | null }>({
    mutationFn: ({ userId, roleId }) => api.members.updateRole({ params: { orgId, userId }, body: { roleId } }),
    onSuccess: (_dto, { userId }) => afterSuccess(queryClient, org, userId),
    onError: (e) => afterFailure(queryClient, org, e),
  });
}

/** `DELETE /orgs/:orgId/members/:userId` (needs `member:delete`, org level). */
export function useRemoveMember(org: string, orgId: string): UseMutationResult<null, ApiError, { userId: string }> {
  const queryClient = useQueryClient();
  return useMutation<null, ApiError, { userId: string }>({
    mutationFn: ({ userId }) => api.members.remove({ params: { orgId, userId } }),
    onSuccess: (_none, { userId }) => afterSuccess(queryClient, org, userId),
    onError: (e) => afterFailure(queryClient, org, e),
  });
}
