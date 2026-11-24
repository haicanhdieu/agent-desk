import type { ReactNode } from 'react';
import { NO_PAGE_CRUMBS, ORG_SETTINGS_CRUMB, OrgSettingsLayout, TopBar, type OrgSwitchProps } from '@/components';
import { orgSettingsFixtures } from '@/mocks';
import type { Actor, OrgSettingsTabKey } from '@/mocks/types';

const kim: Actor = { login: 'kim-hale', initials: 'KH' };
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
  orgName,
  children,
}: {
  role: Role;
  active: OrgSettingsTabKey | null;
  sideMenu?: boolean;
  /** The org's current name in the bar, when a story shows it after a rename. */
  orgName?: string;
  children: ReactNode;
}) {
  const keys = tabsFor(role);
  const current = orgName === undefined ? harbor : { ...harbor, name: orgName };
  const org: OrgSwitchProps = {
    current,
    orgs: [current],
    platformAdmin: false,
    orgHref: (o) => `/o/${o.slug}/projects`,
    createHref: '/platform/orgs/new',
    projectsHref: `${base}/projects`,
    ...(keys.length > 0 && { settingsHref: `${base}/settings/${keys[0]}` }),
  };
  const tabs = Object.fromEntries(keys.map((k) => [k, `${base}/settings/${k}`]));
  return (
    <>
      <TopBar
        variant="global"
        crumbs={
          keys.length > 0 && active
            ? [{ label: 'Org settings', href: `${base}/settings` }, { label: ORG_SETTINGS_CRUMB[active] }]
            : NO_PAGE_CRUMBS
        }
        {...(keys.length === 0 && { state: 'forbidden' as const })}
        user={kim}
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
