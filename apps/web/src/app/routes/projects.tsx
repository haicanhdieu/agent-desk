import { createFileRoute, redirect } from '@tanstack/react-router';
import { landingOrg } from '@/features/auth/session';

// The global top bar (projects list, setup) links the logo to `/projects`; it opens the active org's projects, or `/`
// (which explains having no organization) when there is none.
export const Route = createFileRoute('/projects')({
  beforeLoad: async ({ context: { queryClient } }) => {
    const org = await landingOrg(queryClient);
    if (org) throw redirect({ to: '/o/$org/projects', params: { org: org.slug } });
    throw redirect({ to: '/' });
  },
});
