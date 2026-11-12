import { createFileRoute, notFound, Outlet } from '@tanstack/react-router';
import { orgsQuery, sessionQuery, setActiveOrganization } from '@/features/auth/session';

// Org layout: resolves the `$org` slug among the user's organizations. Unknown (or not a member) → not found, and
// nothing is sent to the server. A known org other than the active one becomes active, and the org-scoped cache
// of the previous org is dropped.
export const Route = createFileRoute('/o/$org')({
  beforeLoad: async ({ context: { queryClient }, params, preload }) => {
    const [session, orgs] = await Promise.all([
      queryClient.ensureQueryData(sessionQuery),
      queryClient.ensureQueryData(orgsQuery),
    ]);
    const org = orgs.find((o) => o.slug === params.org);
    if (!org) throw notFound();
    if (session?.activeOrganizationId !== org.id) {
      // A hover preload must not switch the server-side active org; abort it (the router discards failed preloads)
      // so no data of this org is cached under the old active org.
      if (preload) throw new Error(`Not preloading org ${org.slug}: it is not the active org`);
      await setActiveOrganization(queryClient, org);
    }
    return { org };
  },
  component: Outlet,
});
