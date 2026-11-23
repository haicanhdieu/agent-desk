import type { AddProjectMemberRequest, ProjectMemberDto } from '@agentdesk/contracts';
import { ApiError } from '@agentdesk/contracts/client';
import { useMutation, useQueryClient, type QueryClient, type UseMutationResult } from '@tanstack/react-query';
import { projectAuditListKey } from '../projectAudit/queries';
import { api } from '../api';
import { membersListKey } from '../members/queries';
import { projectMembersListKey } from './queries';

/** Refetch what a members change touches: the project members list, the org members (and the picker) and the project audit. */
export function invalidateProjectSpace(qc: QueryClient, org: string, projectId: string): Promise<void> {
  return Promise.all([
    qc.invalidateQueries({ queryKey: projectMembersListKey(org, projectId) }),
    qc.invalidateQueries({ queryKey: membersListKey(org).slice(0, 3) }),
    qc.invalidateQueries({ queryKey: projectAuditListKey(org, projectId) }),
  ]).then(() => undefined);
}

// No optimistic updates: the list changes when the server has answered. A 409 or 422 means the person changed
// meanwhile, so the lists refetch too.
export function useAddProjectMember(
  org: string,
  projectId: string,
): UseMutationResult<ProjectMemberDto, ApiError, AddProjectMemberRequest> {
  const qc = useQueryClient();
  return useMutation<ProjectMemberDto, ApiError, AddProjectMemberRequest>({
    mutationFn: (body) => api.projectMembers.add({ params: { projectId }, body }),
    onSuccess: () => invalidateProjectSpace(qc, org, projectId),
    onError: (e) => {
      if (e.status === 409 || e.status === 422) return invalidateProjectSpace(qc, org, projectId);
      return undefined;
    },
  });
}

// A 404 means the person is no longer on the project: the list shows what is true now. An org switched in another tab
// (also a 409) changes nothing here. The call stays pending until the refetches are done, so a dialog is never closed on
// stale rows.
export function useSetProjectRole(
  org: string,
  projectId: string,
): UseMutationResult<ProjectMemberDto, ApiError, { userId: string; roleId: string }> {
  const qc = useQueryClient();
  return useMutation<ProjectMemberDto, ApiError, { userId: string; roleId: string }>({
    mutationFn: ({ userId, roleId }) => api.projectMembers.setRole({ params: { projectId, userId }, body: { roleId } }),
    onSuccess: () => invalidateProjectSpace(qc, org, projectId),
    onError: (e) => (e.status === 404 ? invalidateProjectSpace(qc, org, projectId) : undefined),
  });
}

export function useRemoveProjectMember(org: string, projectId: string): UseMutationResult<null, ApiError, string> {
  const qc = useQueryClient();
  return useMutation<null, ApiError, string>({
    mutationFn: (userId) => api.projectMembers.remove({ params: { projectId, userId } }),
    onSuccess: () => invalidateProjectSpace(qc, org, projectId),
    onError: (e) => (e.status === 404 ? invalidateProjectSpace(qc, org, projectId) : undefined),
  });
}
