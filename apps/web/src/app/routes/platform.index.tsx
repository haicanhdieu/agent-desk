import { createFileRoute, redirect } from '@tanstack/react-router';

// `/platform` opens the Organizations directory.
export const Route = createFileRoute('/platform/')({
  beforeLoad: () => {
    throw redirect({ href: '/platform/orgs', replace: true });
  },
});
