import type {
  CreateAssignmentRequest,
  GrantPlatformAdminRequest,
  OrgStatus,
  PlatformAdminDto,
  PlatformAssignmentDto,
  PlatformOrgDetailDto,
  UpdateOrgRequest,
} from '@agentdesk/contracts';
import { ApiError } from '@agentdesk/contracts/client';
import { useMutation, useQueryClient, type QueryClient, type UseMutationResult } from '@tanstack/react-query';
import { accessKeys } from '../access/keys';
import { api } from '../api';
import { orgsQuery } from '../auth/session';
import { platformKeys } from './keys';

// No optimistic updates: the list changes when the server has answered, and a mutation stays pending until the
// refetch it asks for is done (so a dialog stays unclosable until the rows are fresh).

/** `POST /api/platform/admins`: a repeat grant answers 200 with the entry, so it ends like a new one. */
export function useGrantPlatformAdmin(): UseMutationResult<PlatformAdminDto, ApiError, GrantPlatformAdminRequest> {
  const queryClient = useQueryClient();
  return useMutation<PlatformAdminDto, ApiError, GrantPlatformAdminRequest>({
    mutationFn: (body) => api.platform.grantAdmin({ body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: platformKeys.adminsAll() }),
  });
}

/**
 * `DELETE /api/platform/admins/:adminId`. `own` is the caller's own entry: they are no longer an admin, so the cached
 * access answers go (the next read asks the API) and the list is not fetched again (they leave the area). A 404 or 409
 * means the list changed behind the page: it is fetched again.
 */
export function useRevokePlatformAdmin(): UseMutationResult<void, ApiError, { adminId: string; own: boolean }> {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, { adminId: string; own: boolean }>({
    mutationFn: async ({ adminId }) => {
      await api.platform.revokeAdmin({ params: { adminId } });
    },
    onSuccess: async (_none, { own }) => {
      if (own) {
        await queryClient.cancelQueries({ queryKey: accessKeys.platform(), exact: true });
        queryClient.removeQueries({ queryKey: accessKeys.session(), exact: true });
        queryClient.removeQueries({ queryKey: accessKeys.platform(), exact: true });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: platformKeys.adminsAll() });
    },
    onError: async (e) => {
      if (e instanceof ApiError && (e.status === 404 || e.status === 409)) {
        await queryClient.invalidateQueries({ queryKey: platformKeys.adminsAll() });
      }
    },
  });
}

/**
 * `POST /api/platform/orgs/:orgId/suspend` or `…/reactivate`. The answer is the new detail: it is the cached org at
 * once, and the directory pages (and the org lists under them) are fetched again. A repeat answers 200 like a change.
 */
export function useSetOrgStatus(
  orgId: string,
): UseMutationResult<PlatformOrgDetailDto, ApiError, { to: OrgStatus; reason: string }> {
  const queryClient = useQueryClient();
  return useMutation<PlatformOrgDetailDto, ApiError, { to: OrgStatus; reason: string }>({
    mutationFn: ({ to, reason }) =>
      to === 'suspended'
        ? api.platform.suspendOrg({ params: { orgId }, body: { reason } })
        : api.platform.reactivateOrg({ params: { orgId }, body: { reason } }),
    onSuccess: async (detail) => {
      queryClient.setQueryData(platformKeys.org(orgId), detail);
      // The detail was just set from the answer: only the lists (and other orgs' details) are fetched again.
      const own = platformKeys.org(orgId);
      await queryClient.invalidateQueries({
        queryKey: platformKeys.orgsAll(),
        predicate: (q) => !(q.queryKey.length === own.length && q.queryKey.every((part, i) => part === own[i])),
      });
    },
  });
}

/**
 * `PATCH /api/platform/orgs/:orgId`: the answer is the new detail and becomes the cached org at once; the directory
 * pages (and other orgs' details) and the caller's own org list are fetched again. No navigation: the page stays.
 */
export function useUpdatePlatformOrg(
  orgId: string,
): UseMutationResult<PlatformOrgDetailDto, ApiError, UpdateOrgRequest> {
  const queryClient = useQueryClient();
  return useMutation<PlatformOrgDetailDto, ApiError, UpdateOrgRequest>({
    mutationFn: (body) => api.platform.updateOrg({ params: { orgId }, body }),
    onSuccess: async (detail) => {
      queryClient.setQueryData(platformKeys.org(orgId), detail);
      const own = platformKeys.org(orgId);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: platformKeys.orgsAll(),
          predicate: (q) => !(q.queryKey.length === own.length && q.queryKey.every((part, i) => part === own[i])),
        }),
        queryClient.invalidateQueries({ queryKey: orgsQuery.queryKey }),
      ]);
    },
  });
}

/**
 * Both assignment changes end the same way: everything under `['platform', 'orgs']` is fetched again (this org's
 * members first among them, and the directory's owner column when an Owner came or went). The mutation stays pending
 * until that is done, so a dialog stays unclosable until the rows are fresh.
 */
const refreshAfterAssignment = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ queryKey: platformKeys.orgsAll() });

/** `POST /api/platform/orgs/:orgId/assignments`: a repeat returns the same assignment, so it ends like a new one. */
export function useAddPlatformAssignment(
  orgId: string,
): UseMutationResult<PlatformAssignmentDto, ApiError, CreateAssignmentRequest> {
  const queryClient = useQueryClient();
  return useMutation<PlatformAssignmentDto, ApiError, CreateAssignmentRequest>({
    mutationFn: (body) => api.platform.createAssignment({ params: { orgId }, body }),
    onSuccess: () => refreshAfterAssignment(queryClient),
  });
}

/**
 * `DELETE /api/platform/orgs/:orgId/assignments/:assignmentId`. Removing the org's last Owner is allowed here. A 404
 * means the assignment is already gone: the members are fetched again.
 */
export function useRemovePlatformAssignment(
  orgId: string,
): UseMutationResult<void, ApiError, { assignmentId: string }> {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, { assignmentId: string }>({
    mutationFn: async ({ assignmentId }) => {
      await api.platform.removeAssignment({ params: { orgId, assignmentId } });
    },
    onSuccess: () => refreshAfterAssignment(queryClient),
    onError: async (e) => {
      if (e instanceof ApiError && e.status === 404) await refreshAfterAssignment(queryClient);
    },
  });
}
