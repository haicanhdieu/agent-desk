import type { ReactNode } from 'react';
import { NO_PAGE_CRUMBS, ORG_SETTINGS_CRUMB, type OrgSwitchProps, type PageCrumb } from '@/components';
import { orgMenuFixtures, user, withOrgMenuActive, type OrgMenuPage } from '@/mocks';
import type { Actor, OrgOption, OrgSettingsTabKey } from '@/mocks/types';
import { ShellFrame } from './shellFrame';

const harbor: OrgOption = { id: 'org-harbor', slug: 'harbor-labs', name: 'Harbor Labs' };
const northwind: OrgOption = { id: 'org-northwind', slug: 'northwind', name: 'Northwind Analytics' };

/** The switcher of the stories: a person of two orgs, so the scope crumb is a menu button. */
export const harborOrg: OrgSwitchProps = {
  current: harbor,
  orgs: [harbor, northwind],
  platformAdmin: false,
  orgHref: (o) => `/o/${o.slug}/projects`,
  createHref: '/platform/orgs/new',
};

export interface OrgShellFrameProps {
  /** Whose "Organization menu" the shell draws. */
  viewer?: keyof typeof orgMenuFixtures;
  /** The menu item marked as the current page; none for a no-access page. */
  page: OrgMenuPage | null;
  org?: OrgSwitchProps;
  user?: Actor;
  crumbs?: readonly PageCrumb[];
  /** Menu collapsed to its 48px strip. */
  collapsed?: boolean;
  height?: number;
  children: ReactNode;
}

/**
 * Stories and screen tests only: the shell with the org menu around an org screen, as the route renders it. The screen
 * inside draws only its own page.
 */
export function OrgShellFrame({
  viewer = 'owner',
  page,
  org = harborOrg,
  user: actor = user,
  crumbs = NO_PAGE_CRUMBS,
  collapsed = false,
  height = 900,
  children,
}: OrgShellFrameProps) {
  const fixture = orgMenuFixtures[viewer];
  const model = page === null ? fixture : withOrgMenuActive(fixture, page);
  return (
    <ShellFrame height={height} menuModel={model} collapsed={collapsed} topBar={{ user: actor, crumbs, org }}>
      {children}
    </ShellFrame>
  );
}

export type OrgSettingsRole = 'owner' | 'admin' | 'projectAdmin' | 'member';
/** The settings page each story shows, in the one shell: the org menu of the role, the page current. `sideMenu: false` is the no-access page. */
export function OrgSettingsFrame({
  role,
  active,
  sideMenu = true,
  orgName,
  children,
}: {
  role: OrgSettingsRole;
  active: OrgSettingsTabKey;
  sideMenu?: boolean;
  /** The org's current name in the bar, when a story shows it after a rename. */
  orgName?: string;
  children: ReactNode;
}) {
  const current =
    harborOrg.current === null ? null : { ...harborOrg.current, ...(orgName !== undefined && { name: orgName }) };
  const org: OrgSwitchProps = { ...harborOrg, current };
  return (
    <OrgShellFrame
      viewer={role === 'admin' ? 'owner' : role}
      page={sideMenu ? active : null}
      org={org}
      crumbs={[{ label: ORG_SETTINGS_CRUMB[active] }]}
    >
      {children}
    </OrgShellFrame>
  );
}
