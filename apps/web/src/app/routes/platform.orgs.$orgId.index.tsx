import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useNow } from '@/app/useNow';
import { toPlatformOrgOverview } from '@/features/platform/map';
import { platformOrgQuery } from '@/features/platform/queries';
import { PlatformOrgOverview } from '@/screens';

// The Overview of one organization: its facts. The header, Banner and dialogs are the `$orgId` layout's.
export const Route = createFileRoute('/platform/orgs/$orgId/')({
  staticData: { chrome: { mode: 'standard', scope: 'platformOrg', item: 'orgOverview' } },
  component: PlatformOrgOverviewPage,
});

function PlatformOrgOverviewPage() {
  const { orgId } = Route.useParams();
  const now = useNow();
  const { data } = useQuery(platformOrgQuery(orgId));
  if (data === undefined) return null;
  return <PlatformOrgOverview overview={toPlatformOrgOverview(data, now)} />;
}
