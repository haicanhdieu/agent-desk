import type { ReactNode } from 'react';
import { OrgSettingsLayout, TopBar, type OrgSwitchProps } from '@/components';
import { orgSettingsFixtures } from '@/mocks';
import type { Actor, OrgSettingsTabKey } from '@/mocks/types';

const kim: Actor = { login: 'kim-hale', initials: 'KH' };
const account = { name: 'Kim Hale', handle: 'kim-hale', invitationsHref: '#invitations' };
const harbor = { id: 'org-harbor', ...orgSettingsFixtures.org };
const base = `/o/${harbor.slug}`;

type Role = 'owner' | 'admin' | 'projectAdmin' | 'member';

/** The tabs each role may open; a member has no Settings at all. */
const tabsFor = (role: Role): OrgSettingsTabKey[] => (role === 'member' ? [] : orgSettingsFixtures.tabs[role]);

/**
 * Stories only: the app bar and the Settings layout around a settings screen, as the route renders them.
 * `sideMenu={false}` keeps the bar and drops the layout (the member's no-access page).
 */
export function OrgSettingsFrame({
  role,
  active,
  sideMenu = true,
  children,
}: {
  role: Role;
  active: OrgSettingsTabKey | null;
  sideMenu?: boolean;
  children: ReactNode;
}) {
  const keys = tabsFor(role);
  const org: OrgSwitchProps = {
    current: harbor,
    orgs: [harbor],
    platformAdmin: false,
    orgHref: (o) => `/o/${o.slug}/projects`,
    createHref: '/orgs/new',
    projectsHref: `${base}/projects`,
    ...(keys.length > 0 && { settingsHref: `${base}/settings/${keys[0]}` }),
  };
  const tabs = Object.fromEntries(keys.map((k) => [k, `${base}/settings/${k}`]));
  return (
    <>
      <TopBar
        variant="global"
        user={kim}
        account={account}
        org={org}
        tabs="org"
        active={keys.length > 0 && sideMenu ? 'settings' : undefined}
        links={{ projects: `${base}/projects` }}
      />
      {sideMenu ? (
        <OrgSettingsLayout tabs={tabs} active={active}>
          {children}
        </OrgSettingsLayout>
      ) : (
        children
      )}
    </>
  );
}
