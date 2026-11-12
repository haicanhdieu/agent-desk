import { createRootRouteWithContext, redirect } from '@tanstack/react-router';
import { sessionQuery } from '@/features/auth/session';
import { rootRouteOptions, type RouterContext } from '../root';

export const Route = createRootRouteWithContext<RouterContext>()({
  ...rootRouteOptions,
  // Session guard: without a session every page but sign-in goes to `/sign-in?redirect=<current>`.
  beforeLoad: async ({ context: { queryClient }, location }) => {
    if (location.pathname === '/sign-in') return;
    const session = await queryClient.ensureQueryData(sessionQuery);
    if (!session) throw redirect({ to: '/sign-in', search: { redirect: location.href } });
  },
});
