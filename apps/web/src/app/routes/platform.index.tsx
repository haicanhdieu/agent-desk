import { createFileRoute, redirect } from '@tanstack/react-router';

// `/platform` opens the Platform admins page (the Organizations directory takes over when it is built).
export const Route = createFileRoute('/platform/')({
  beforeLoad: () => {
    throw redirect({ href: '/platform/admins', replace: true });
  },
});
