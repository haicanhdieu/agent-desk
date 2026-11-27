import { ApiError } from '@agentdesk/contracts/client';
import { createFileRoute, Outlet, type ErrorComponentProps } from '@tanstack/react-router';
import { PlatformForbidden, RouteError } from '@/app/boundaries';
import { platformAdminQuery } from '@/features/access/queries';
import { orgsQuery, sessionQuery } from '@/features/auth/session';

// The platform area, outside any org: the shell host draws its bar and side menu (the Platform menu, or the one-org menu inside an org); each page route declares its chrome. Whether the caller
// is a platform admin is read before any child loads (`GET /api/me/platform`); anyone else gets the forbidden state and no
// platform request is sent. A 403 from a child platform query shows the same state. UI only: the API is the authority.
export const Route = createFileRoute('/platform')({
  // `beforeLoad` runs before every child loader: for a non-admin the 403 stops them, so no platform request is sent.
  beforeLoad: async ({ context: { queryClient } }) => {
    const [, , platform] = await Promise.all([
      queryClient.ensureQueryData(sessionQuery),
      queryClient.ensureQueryData(orgsQuery),
      queryClient.fetchQuery(platformAdminQuery), // fresh within staleTime, else refetched: a new grant shows without a reload
    ]);
    if (!platform.platformAdmin) {
      throw new ApiError({ status: 403, type: 'forbidden', title: 'Forbidden', detail: 'Platform admins only' });
    }
  },
  staticData: { chrome: { mode: 'standard', scope: 'platform' } },
  component: PlatformShell,
  errorComponent: PlatformError,
});

function PlatformError(props: ErrorComponentProps) {
  if (props.error instanceof ApiError && props.error.status === 403) return <PlatformForbidden />;
  return <RouteError {...props} />;
}

function PlatformShell() {
  return <Outlet />;
}
