import { ApiError } from '@agentdesk/contracts/client';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Outlet, useMatch, useRouterState, type ErrorComponentProps } from '@tanstack/react-router';
import { PlatformForbidden, RouteError } from '@/app/boundaries';
import { PlatformLayout, TopBar, type PlatformLayoutProps, type PlatformOrgGroup } from '@/components';
import { platformAdminQuery } from '@/features/access/queries';
import { orgsQuery, sessionQuery } from '@/features/auth/session';
import { useAppBar } from '@/features/chrome/appBar';
import { platformCrumbs, type PlatformOrgCrumb } from '@/features/platform/crumbs';
import { platformOrgQuery } from '@/features/platform/queries';

// The platform area, outside any org: its own bar (scope "Platform", page crumbs, Platform sections tabs) and, inside one org, a side menu with the org group. Whether the caller
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

function useActive(): PlatformLayoutProps['active'] {
  const orgPage = useRouterState({ select: (s) => /^\/platform\/orgs\/[^/]+(?:\/([^/]+))?/.exec(s.location.pathname) });
  if (!orgPage) return undefined;
  const section = orgPage[1];
  return section === 'projects' || section === 'members' || section === 'invitations' ? section : 'overview';
}

/**
 * Inside one org the side menu holds the org group and the bar names the org. The org is the page's own query, so it
 * is read once for both. The links come from the URL id, so a failed read still links.
 */
function useOrgGroup(): { org: PlatformOrgGroup | undefined; crumb: PlatformOrgCrumb } {
  const match = useMatch({ from: '/platform/orgs/$orgId', shouldThrow: false });
  const orgId = match?.params.orgId ?? '';
  const { data, isPending, error } = useQuery({ ...platformOrgQuery(orgId), enabled: match !== undefined });
  if (match === undefined) return { org: undefined, crumb: { state: 'none' } };
  const linksFor = (id: string) => {
    const base = `/platform/orgs/${encodeURIComponent(id)}`;
    return {
      overview: base,
      projects: `${base}/projects`,
      members: `${base}/members`,
      invitations: `${base}/invitations`,
    };
  };
  if (data === undefined) {
    if (error instanceof ApiError && error.status === 404) return { org: undefined, crumb: { state: 'notFound' } };
    if (error) {
      return {
        org: { state: 'error', name: 'Organization', links: linksFor(orgId) },
        crumb: { state: 'error', id: orgId },
      };
    }
    return isPending
      ? { org: { state: 'loading' }, crumb: { state: 'loading' } }
      : { org: undefined, crumb: { state: 'none' } };
  }
  return {
    org: { state: 'ready', name: data.name, links: linksFor(data.id) },
    crumb: { state: 'ready', id: data.id, name: data.name },
  };
}

function PlatformShell() {
  const bar = useAppBar(null);
  const active = useActive();
  const { org, crumb } = useOrgGroup();
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const { crumbs, state, tab } = platformCrumbs(pathname, crumb);
  return (
    <>
      <TopBar
        variant="platform"
        crumbs={crumbs}
        state={state}
        user={bar.user}
        org={{ ...bar.org, scope: 'platform' }}
        platformTabs={{ active: tab, links: LINKS }}
      />
      <PlatformLayout active={active} org={org}>
        <Outlet />
      </PlatformLayout>
    </>
  );
}
