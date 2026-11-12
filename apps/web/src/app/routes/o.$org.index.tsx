import { createFileRoute, redirect } from '@tanstack/react-router';

// `/o/$org` has no page of its own: it opens the org's projects.
export const Route = createFileRoute('/o/$org/')({
  beforeLoad: ({ params }) => {
    // `href` until the projects route exists (Task 6); then `to: '/o/$org/projects'`.
    throw redirect({ href: `/o/${encodeURIComponent(params.org)}/projects` });
  },
});
