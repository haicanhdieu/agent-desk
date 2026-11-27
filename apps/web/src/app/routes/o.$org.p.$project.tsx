import { useQuery } from '@tanstack/react-query';
import { createFileRoute, notFound, Outlet } from '@tanstack/react-router';
import { z } from 'zod';
import { projectsQueries } from '@/features/projects/queries';
import { useProjectEvents } from '@/features/runs/useProjectEvents';

const ProjectParam = z.uuid();

// Project layout: loads the project and its connection for every project page (top bar, Desk frame). An unknown
// project, or another org's (the API answers 404), is not found; a 403 shows "You don't have access" (RouteError).
export const Route = createFileRoute('/o/$org/p/$project')({
  beforeLoad: ({ params }) => {
    if (!ProjectParam.safeParse(params.project).success) throw notFound();
  },
  loader: async ({ context: { queryClient }, params: { org, project } }) => {
    await Promise.all([
      queryClient.ensureQueryData(projectsQueries.detail(org, project)),
      queryClient.ensureQueryData(projectsQueries.connection(org, project)),
    ]);
  },
  component: ProjectLayout,
});

function ProjectLayout() {
  const { org, project } = Route.useParams();
  // Run status changes in the project, for every project page (spec §5.2).
  useProjectEvents(org, project);
  // Watches the project read for the whole layout: when it stops being readable (403, 404) the query's `throwOnError`
  // sends the answer to the route's boundary, so a project that was open from the cache is not left on screen.
  useQuery(projectsQueries.detail(org, project));
  // Keyed by the project id only, never by the search: switching project remounts the page, so nothing typed or
  // opened for the old project (a draft, a dialog, a pane with a typed credential) survives; a search change keeps it.
  return <Outlet key={project} />;
}
