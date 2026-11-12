import { createFileRoute, notFound, Outlet } from '@tanstack/react-router';
import { z } from 'zod';
import { projectsQueries } from '@/features/projects/queries';

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
  component: Outlet,
});
