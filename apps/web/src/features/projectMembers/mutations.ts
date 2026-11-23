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
