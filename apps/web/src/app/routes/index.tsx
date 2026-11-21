import { createFileRoute, redirect } from '@tanstack/react-router';
import { landingOrg } from '@/features/auth/session';

// `/` opens the active org's projects (the root guard has already sent signed-out visitors to sign-in). With no org
// it opens the welcome page, which lists invitations or says how to get one.
export const Route = createFileRoute('/')({
  beforeLoad: async ({ context: { queryClient } }) => {
    const org = await landingOrg(queryClient);
    if (org) throw redirect({ to: '/o/$org/projects', params: { org: org.slug } });
    throw redirect({ to: '/invitations' });
  },
});
