import { createFileRoute, redirect } from '@tanstack/react-router';
import { orgAccessQuery, toAccess } from '@/features/access/queries';
import { firstSettingsTab } from '@/features/chrome/appBar';

// `/o/$org/settings` opens the first tab the caller may open. Without any tab there is no redirect: the layout shows
// the no-access state. The grants are ensured by `/o/$org`; the API stays the authority (UI only).
export const Route = createFileRoute('/o/$org/settings/')({
  beforeLoad: async ({ context: { queryClient }, params }) => {
    const tab = firstSettingsTab(toAccess(await queryClient.ensureQueryData(orgAccessQuery(params.org))));
    if (tab === null) return;
    throw redirect({ href: `/o/${encodeURIComponent(params.org)}/settings/${tab}`, replace: true });
  },
});
