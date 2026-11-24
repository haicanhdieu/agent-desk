import { ApiError } from '@agentdesk/contracts/client';
import { useMutation, useQueryClient, type QueryClient, type UseMutationResult } from '@tanstack/react-query';
import { accessKeys } from '../access/keys';
import { orgAccessQuery } from '../access/queries';
import { api } from '../api';
import type { AccessDiff } from './accessChange';
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

/** A failure of a project grant call: the org role (if it changed) was saved already, and so may be some grants. */
export class ProjectGrantsError extends Error {
  constructor(readonly failure: unknown) {
    super('A project grant could not be saved');
    this.name = 'ProjectGrantsError';
  }
}

export interface ChangeAccessInput {
  userId: string;
  /** The org role to set, or undefined when it did not change (the route is not called then). */
  roleId?: string | null;
  diff: Pick<AccessDiff, 'create' | 'remove'>;
}

/**
 * Saves the diff of Change access with the routes that exist: `PUT /orgs/:orgId/members/:userId/role` (needs
 * `member:update`, org level) first, since it is the call most likely to be refused and then nothing was written;
 * then `POST /orgs/:orgId/assignments` per added or replaced grant and `DELETE .../assignments/:id` per removed or
 * replaced one (`assignment:create` / `assignment:delete`, checked per project by the API). The calls run one after
 * the other and are not atomic: a refusal in the middle leaves the earlier ones saved, so the lists are read again on
 * every outcome and a failure of the grant calls is thrown as a `ProjectGrantsError`. Creates run before removes, so a
 * replaced grant is never missing for a moment.
 */
export function useChangeAccess(
  org: string,
  orgId: string,
): UseMutationResult<void, ApiError | ProjectGrantsError, ChangeAccessInput> {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError | ProjectGrantsError, ChangeAccessInput>({
    mutationFn: async ({ userId, roleId, diff }) => {
      if (roleId !== undefined) await api.members.updateRole({ params: { orgId, userId }, body: { roleId } });
      try {
        for (const c of diff.create) {
          await api.assignments.create({
            params: { orgId },
            body: { userId, roleId: c.roleId, scope: { type: 'project', projectId: c.projectId } },
          });
        }
        for (const assignmentId of diff.remove) {
          await api.assignments.remove({ params: { orgId, assignmentId } });
        }
      } catch (e) {
        throw new ProjectGrantsError(e);
      }
    },
    onSuccess: async (_none, input) => {
      await Promise.all([
        afterSuccess(queryClient, org, input.userId),
        // the project Members pages and Audit logs of the projects touched
        queryClient.invalidateQueries({ queryKey: ['org', org, 'projects'] }),
      ]);
    },
    onError: async (e) => {
      // Something may have been saved before the refusal: the list and the audit show what is true now.
      if (e instanceof ProjectGrantsError) {
        await Promise.all([
          refreshMembers(queryClient, org),
          queryClient.invalidateQueries({ queryKey: auditKey(org) }),
        ]);
      } else await afterFailure(queryClient, org, e);
    },
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
