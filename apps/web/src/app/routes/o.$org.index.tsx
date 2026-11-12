import { createFileRoute, redirect } from '@tanstack/react-router';

// `/o/$org` has no page of its own: it opens the org's projects.
export const Route = createFileRoute('/o/$org/')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/o/$org/projects', params: { org: params.org } });
  },
});
