import { createFileRoute, redirect } from '@tanstack/react-router';

// The bare project URL (BR-29) has no page: it replaces itself with Runs. No permission guard and no loader: Runs and
// the project layout do the scope check, so an unknown or out-of-scope project ends in Not found there.
export const Route = createFileRoute('/o/$org/p/$project/')({
  beforeLoad: ({ params: { org, project } }) => {
    throw redirect({ to: '/o/$org/p/$project/runs', params: { org, project }, replace: true });
  },
});
