import { ApiError } from '@agentdesk/contracts/client';
import { createFileRoute, Outlet, useRouterState, type ErrorComponentProps } from '@tanstack/react-router';
import { PlatformForbidden, RouteError } from '@/app/boundaries';
import { PlatformLayout, TopBar, type OrgSwitchProps, type PlatformLayoutProps } from '@/components';
import { platformAdminQuery } from '@/features/access/queries';
import { orgsQuery, sessionQuery } from '@/features/auth/session';
import { useAppBar } from '@/features/chrome/appBar';

// The platform area, outside any org: its own bar ("No organization", no tabs) and the side menu. Whether the caller
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
  component: PlatformShell,
  errorComponent: PlatformError,
});

function PlatformError(props: ErrorComponentProps) {
  if (props.error instanceof ApiError && props.error.status === 403) return <PlatformForbidden />;
  return <RouteError {...props} />;
}

const LINKS = { orgs: '/platform/orgs', admins: '/platform/admins', audit: '/platform/audit' };

/** The platform area has no organization: the bar reads "No organization" and offers no org menu. */
const NO_ORG: OrgSwitchProps = {
  current: null,
  orgs: [],
  platformAdmin: false,
  orgHref: (o) => `/o/${encodeURIComponent(o.slug)}/projects`,
  createHref: '/orgs/new',
};

function useActive(): PlatformLayoutProps['active'] {
  const segment = useRouterState({ select: (s) => /^\/platform\/([^/]+)/.exec(s.location.pathname)?.[1] });
  return segment === 'orgs' || segment === 'audit' ? segment : 'admins';
}

function PlatformShell() {
  const bar = useAppBar(null);
  const active = useActive();
  return (
    <>
      <TopBar variant="global" user={bar.user} org={NO_ORG} tabs="none" />
      <PlatformLayout active={active} links={LINKS}>
        <Outlet />
      </PlatformLayout>
    </>
  );
}
