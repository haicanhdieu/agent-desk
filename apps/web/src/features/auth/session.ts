import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { OrgStatus } from '@agentdesk/contracts';
import { z } from 'zod';
import { accessKeys } from '../access/keys';
import { authCall, authClient } from './client';
import { resetSignOutGuard } from './signOut';

// Session and organizations from better-auth, cached in Query so route `beforeLoad`s read them synchronously after
// the first fetch. These keys sit outside `['org', slug]` on purpose: they hold what picks the org.

// `handle` (GitHub login) is an additional user field the API declares on the better-auth user.
const GetSessionResponse = z
  .object({
    session: z.object({ activeOrganizationId: z.string().nullish() }),
    user: z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      handle: z.string(),
      image: z.string().nullish(),
    }),
  })
  .nullable();

// `status` lets the switcher mark a suspended org; an older answer without it reads as active.
const OrganizationList = z.array(
  z.object({ id: z.string(), slug: z.string(), name: z.string(), status: OrgStatus.default('active') }),
);

export interface Session {
  user: { id: string; name: string; email: string; handle: string; image: string | null };
  activeOrganizationId: string | null;
}

export type Organization = z.output<typeof OrganizationList>[number];

async function fetchSession(): Promise<Session | null> {
  const data = GetSessionResponse.parse(await authCall(() => authClient.getSession()));
  if (!data) return null;
  resetSignOutGuard();
  const { user, session } = data;
  return {
    user: { id: user.id, name: user.name, email: user.email, handle: user.handle, image: user.image ?? null },
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
 * cache and the session-wide access (`['session','access']` holds the grants in the active org). Callers pass only an
 * org from `orgsQuery`, so a non-member org is never sent.
 */
export async function setActiveOrganization(queryClient: QueryClient, org: Organization): Promise<void> {
  await authCall(() => authClient.organization.setActive({ organizationId: org.id }));
  queryClient.setQueryData(sessionQuery.queryKey, (prev) => prev && { ...prev, activeOrganizationId: org.id });
  // In-flight fetches of the old org must not land in the cache after it is cleared.
  await queryClient.cancelQueries({ queryKey: ['org'] });
  queryClient.removeQueries({ queryKey: ['org'] });
  // The grants of the previous active org must not outlive the switch (personal pages read them for the top bar).
  await queryClient.cancelQueries({ queryKey: accessKeys.session(), exact: true });
  queryClient.removeQueries({ queryKey: accessKeys.session(), exact: true });
}

/** The org `/` and `/projects` open: the session's active org, else the first membership, else none. */
export async function landingOrg(queryClient: QueryClient): Promise<Organization | undefined> {
  const [session, orgs] = await Promise.all([
    queryClient.ensureQueryData(sessionQuery),
    queryClient.ensureQueryData(orgsQuery),
  ]);
  return orgs.find((o) => o.id === session?.activeOrganizationId) ?? orgs[0];
}
