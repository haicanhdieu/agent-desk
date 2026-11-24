import type { ReactNode } from 'react';
import { PlatformLayout, TopBar, type OrgSwitchProps, type PlatformLayoutProps } from '@/components';
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

/** Stories only: the app bar and the platform side menu around a platform screen, as the route renders them. */
export function PlatformFrame({
  active,
  org,
  sideMenu = true,
  children,
}: {
  active: PlatformLayoutProps['active'];
  org?: PlatformLayoutProps['org'];
  /** False keeps the bar and drops the side menu (the no-access page). */
  sideMenu?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <TopBar variant="global" user={opsAdmin} org={noOrg} tabs="none" />
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
