import { createFileRoute, redirect } from '@tanstack/react-router';

// The bare /desk URL (BR-82) has no page: it replaces itself with Runs, so Back does not bounce forward again. Only
// the index route redirects; the six /desk/<page> routes keep their own pages and search (`?tab=` stays).
export const Route = createFileRoute('/o/$org/p/$project/desk/')({
  beforeLoad: ({ params: { org, project } }) => {
    throw redirect({ to: '/o/$org/p/$project/runs', params: { org, project }, replace: true });
  },
});
