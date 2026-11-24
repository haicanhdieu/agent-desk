import { ApiError } from '@agentdesk/contracts/client';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Outlet, useMatch, useRouterState, type ErrorComponentProps } from '@tanstack/react-router';
import { PlatformForbidden, RouteError } from '@/app/boundaries';
import { PlatformLayout, TopBar, type OrgSwitchProps, type PlatformLayoutProps } from '@/components';
import { platformAdminQuery } from '@/features/access/queries';
import { orgsQuery, sessionQuery } from '@/features/auth/session';
import { useAppBar } from '@/features/chrome/appBar';
import { platformCrumbs, type PlatformOrgCrumb } from '@/features/platform/crumbs';
import { platformOrgQuery } from '@/features/platform/queries';

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
  const orgPage = useRouterState({ select: (s) => /^\/platform\/orgs\/[^/]+(?:\/([^/]+))?/.exec(s.location.pathname) });
  if (orgPage) {
    const section = orgPage[1];
    return section === 'projects' || section === 'members' || section === 'invitations' ? section : 'overview';
  }
  return segment === 'orgs' || segment === 'audit' ? segment : 'admins';
}

/**
 * Inside one org the side menu adds the group "<org name>" and the bar names the org. The org is the page's own
 * query, so it is read once for both.
 */
function useOrgGroup(): { org: PlatformLayoutProps['org']; crumb: PlatformOrgCrumb } {
  const match = useMatch({ from: '/platform/orgs/$orgId', shouldThrow: false });
  const orgId = match?.params.orgId ?? '';
  const { data, isPending, error } = useQuery({ ...platformOrgQuery(orgId), enabled: match !== undefined });
  if (match === undefined) return { org: undefined, crumb: { state: 'none' } };
  if (data === undefined) {
    if (error instanceof ApiError && error.status === 404) return { org: undefined, crumb: { state: 'notFound' } };
    if (error) return { org: undefined, crumb: { state: 'error', id: orgId } };
    return { org: undefined, crumb: isPending ? { state: 'loading' } : { state: 'none' } };
  }
  const base = `/platform/orgs/${encodeURIComponent(data.id)}`;
  return {
    org: {
      name: data.name,
      links: {
        overview: base,
        projects: `${base}/projects`,
        members: `${base}/members`,
        invitations: `${base}/invitations`,
      },
    },
    crumb: { state: 'ready', id: data.id, name: data.name },
  };
}

function PlatformShell() {
  const bar = useAppBar(null);
  const active = useActive();
  const { org, crumb } = useOrgGroup();
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const { crumbs, state } = platformCrumbs(pathname, crumb);
  return (
    <>
      <TopBar variant="global" crumbs={crumbs} state={state} user={bar.user} org={NO_ORG} tabs="none" />
      <PlatformLayout active={active} links={LINKS} org={org}>
        <Outlet />
      </PlatformLayout>
    </>
  );
}
