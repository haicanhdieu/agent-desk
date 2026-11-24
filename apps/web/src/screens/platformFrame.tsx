import type { ReactNode } from 'react';
import { PlatformLayout, TopBar, type OrgSwitchProps, type PageCrumb, type PlatformLayoutProps } from '@/components';
import type { Actor } from '@/mocks/types';

const opsAdmin: Actor = { login: 'ops-admin', initials: 'OA' };

const links = { orgs: '/platform/orgs', admins: '/platform/admins', audit: '/platform/audit' };

/** Stories only: the platform area has no organization, so the bar reads "No organization" and has no tabs. */
const noOrg: OrgSwitchProps = {
  current: null,
  orgs: [],
  platformAdmin: false,
  orgHref: (o) => `/o/${o.slug}/projects`,
  createHref: '/orgs/new',
};

const DEFAULT_CRUMBS: Record<PlatformLayoutProps['active'], PageCrumb[]> = {
  orgs: [{ label: 'Organizations' }],
  admins: [{ label: 'Platform admins' }],
  audit: [{ label: 'Audit log' }],
  overview: [{ label: 'Organizations', href: '/platform/orgs' }, { label: 'Organization' }],
  projects: [{ label: 'Organizations', href: '/platform/orgs' }, { label: 'Organization' }, { label: 'Projects' }],
  members: [{ label: 'Organizations', href: '/platform/orgs' }, { label: 'Organization' }, { label: 'Members' }],
  invitations: [
    { label: 'Organizations', href: '/platform/orgs' },
    { label: 'Organization' },
    { label: 'Invitations' },
  ],
};

/** Stories only: the app bar and the platform side menu around a platform screen, as the route renders them. */
export function PlatformFrame({
  active,
  org,
  sideMenu = true,
  children,
  crumbs: crumbsProp,
}: {
  active: PlatformLayoutProps['active'];
  org?: PlatformLayoutProps['org'];
  /** False keeps the bar and drops the side menu (the no-access page). */
  sideMenu?: boolean;
  children: ReactNode;
  /** The page crumbs the route would pass; defaults to the tab's own page. */
  crumbs?: PageCrumb[];
}) {
  const crumbs = crumbsProp ?? DEFAULT_CRUMBS[active];
  return (
    <>
      <TopBar variant="global" crumbs={crumbs} user={opsAdmin} org={noOrg} tabs="none" />
      {sideMenu ? (
        <PlatformLayout active={active} links={links} org={org}>
          {children}
        </PlatformLayout>
      ) : (
        children
      )}
    </>
  );
}
