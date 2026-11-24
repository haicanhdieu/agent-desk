import { createFileRoute, redirect } from '@tanstack/react-router';

// The create-org form moved into the platform shell; this path stays for old links and bookmarks.
export const Route = createFileRoute('/orgs/new')({
  beforeLoad: () => {
    throw redirect({ to: '/platform/orgs/new' });
  },
});
