import type { ReactNode } from 'react';
import {
  PlatformLayout,
  TopBar,
  type OrgSwitchProps,
  type PageCrumb,
  type PlatformLayoutProps,
  type PlatformOrgGroup,
} from '@/components';
import { orgSwitchFixtures } from '@/mocks';
import type { Actor } from '@/mocks/types';

const opsAdmin: Actor = { login: 'ops-admin', initials: 'OA' };

const links = { orgs: '/platform/orgs', admins: '/platform/admins', audit: '/platform/audit' };

type FrameActive = 'orgs' | 'admins' | 'audit' | NonNullable<PlatformLayoutProps['active']>;

/** Stories only: the platform scope of the bar, as the route renders it (the Platform group first, no org checked). */
const platformScope = (
  base: typeof orgSwitchFixtures.platformAdmin = orgSwitchFixtures.platformAdmin,
): OrgSwitchProps => ({
  ...base,
  scope: 'platform',
  platformHref: '/platform/orgs',
  orgHref: (o) => `/o/${o.slug}/projects`,
  createHref: '/platform/orgs/new',
});

const DEFAULT_CRUMBS: Record<FrameActive, PageCrumb[]> = {
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

/** Stories only: the platform bar, and inside one org the side menu with the org group, as the route renders them. */
export function PlatformFrame({
  active,
  org,
  sideMenu = true,
  children,
  crumbs: crumbsProp,
  scopeOrg,
}: {
  active: FrameActive;
  org?: PlatformOrgGroup;
  /** False keeps the bar and drops the layout (the no-access page). */
  sideMenu?: boolean;
  children: ReactNode;
  /** The page crumbs the route would pass; defaults to the tab's own page. */
  crumbs?: PageCrumb[];
  /** The scope switch data; defaults to a platform admin with two memberships. */
  scopeOrg?: OrgSwitchProps;
}) {
  const crumbs = crumbsProp ?? DEFAULT_CRUMBS[active];
  const tab = active === 'admins' || active === 'audit' ? active : 'orgs';
  const section = active === 'orgs' || active === 'admins' || active === 'audit' ? undefined : active;
  return (
    <>
      <TopBar
        variant="platform"
        crumbs={crumbs}
        user={opsAdmin}
        org={scopeOrg ?? platformScope()}
        platformTabs={{ active: tab, links }}
      />
      {sideMenu ? (
        <PlatformLayout active={section} org={org}>
          {children}
        </PlatformLayout>
      ) : (
        children
      )}
    </>
  );
}

export { platformScope };
