import type { OrgDto, UpdateOrgRequest } from '@agentdesk/contracts';
import type { ApiError } from '@agentdesk/contracts/client';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { api } from '../api';
import { orgsQuery } from '../auth/session';

/**
 * Updates the org (name and/or slug). The tenant is the route's `orgId` (from the session's org list), never the body.
 * On success the org list holds the saved row at once (so the new slug resolves), and is refetched (ADR-0015).
 *
 * `_org` (the slug in the URL) is part of the planned signature (Task 29) but intentionally unused: the request is
 * addressed by `orgId` alone, and the cache is keyed by org id, not by slug.
 */
export function useUpdateOrg(_org: string, orgId: string): UseMutationResult<OrgDto, ApiError, UpdateOrgRequest> {
  const queryClient = useQueryClient();
  return useMutation<OrgDto, ApiError, UpdateOrgRequest>({
    mutationFn: (body) => api.orgs.update({ params: { orgId }, body }),
    onSuccess: (saved) => {
      queryClient.setQueryData(orgsQuery.queryKey, (prev) =>
        prev?.map((o) => (o.id === saved.id ? { ...o, name: saved.name, slug: saved.slug } : o)),
      );
    },
  });
}
