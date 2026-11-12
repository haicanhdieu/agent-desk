import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { authCall, authClient } from './client';
import { resetSignOutGuard } from './signOut';

// Session and organizations from better-auth, cached in Query so route `beforeLoad`s read them synchronously after
// the first fetch. These keys sit outside `['org', slug]` on purpose: they hold what picks the org.

// `handle` (GitHub login) is an additional user field the API declares on the better-auth user.
const GetSessionResponse = z
  .object({
    session: z.object({ activeOrganizationId: z.string().nullish() }),
    user: z.object({ id: z.string(), name: z.string(), handle: z.string(), image: z.string().nullish() }),
  })
  .nullable();

const OrganizationList = z.array(z.object({ id: z.string(), slug: z.string(), name: z.string() }));

export interface Session {
  user: { id: string; name: string; handle: string; image: string | null };
  activeOrganizationId: string | null;
}

export type Organization = z.output<typeof OrganizationList>[number];

async function fetchSession(): Promise<Session | null> {
  const data = GetSessionResponse.parse(await authCall(() => authClient.getSession()));
  if (!data) return null;
  resetSignOutGuard();
  const { user, session } = data;
  return {
    user: { id: user.id, name: user.name, handle: user.handle, image: user.image ?? null },
    activeOrganizationId: session.activeOrganizationId ?? null,
  };
}

/** The signed-in user and active org id, or `null` when signed out. */
export const sessionQuery = queryOptions({ queryKey: ['session'], queryFn: fetchSession });

/** The organizations the user is a member of. */
export const orgsQuery = queryOptions({
  queryKey: ['session', 'orgs'],
  queryFn: async (): Promise<Organization[]> =>
    OrganizationList.parse(await authCall(() => authClient.organization.list())),
});

/**
 * Makes `org` the session's active organization (the API scopes every request by it), then drops the org-scoped
 * cache. Callers pass only an org from `orgsQuery`, so a non-member org is never sent.
 */
export async function setActiveOrganization(queryClient: QueryClient, org: Organization): Promise<void> {
  await authCall(() => authClient.organization.setActive({ organizationId: org.id }));
  queryClient.setQueryData(sessionQuery.queryKey, (prev) => prev && { ...prev, activeOrganizationId: org.id });
  // In-flight fetches of the old org must not land in the cache after it is cleared.
  await queryClient.cancelQueries({ queryKey: ['org'] });
  queryClient.removeQueries({ queryKey: ['org'] });
}
