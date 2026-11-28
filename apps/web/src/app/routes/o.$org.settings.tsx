import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Outlet } from '@tanstack/react-router';
import { Forbidden, NotFound } from '@/app/boundaries';
import { orgAccessQuery, toAccess } from '@/features/access/queries';
import { firstSettingsTab } from '@/features/chrome/appBar';

// Settings area: the shell draws the bar and the org menu; each page declares its own item (`staticData.item`). Without
// any page the caller may open, this layout shows the no-access state (the shell keeps the org menu). Access only
// shows or hides UI here; the API refuses each action (ADR-0036).
export const Route = createFileRoute('/o/$org/settings')({
  staticData: { chrome: { mode: 'standard', scope: 'org' } },
  component: SettingsLayout,
  // An unknown tab keeps the bar and the side menu.
  notFoundComponent: NotFound,
});

function SettingsLayout() {
  const { org } = Route.useParams();
  const { data: accessDto } = useSuspenseQuery(orgAccessQuery(org));
  return firstSettingsTab(toAccess(accessDto)) === null ? <Forbidden /> : <Outlet />;
}
