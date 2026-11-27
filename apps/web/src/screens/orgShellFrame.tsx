import { useState, type ReactNode } from 'react';
import { NO_PAGE_CRUMBS, SubNav, type OrgSwitchProps, type PageCrumb, type PageState } from '@/components';
import { orgMenuFixtures, user, withOrgMenuActive, type OrgMenuPage } from '@/mocks';
import type { Actor, OrgOption } from '@/mocks/types';
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
  state?: PageState;
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
  state,
  collapsed: startCollapsed = false,
  height = 900,
  children,
}: OrgShellFrameProps) {
  const [collapsed, setCollapsed] = useState(startCollapsed);
  const fixture = orgMenuFixtures[viewer];
  const model = page === null ? fixture : withOrgMenuActive(fixture, page);
  return (
    <ShellFrame
      height={height}
      menuMode={collapsed ? 'collapsed' : 'full'}
      menu={<SubNav {...model} collapsed={collapsed} onToggleCollapsed={() => setCollapsed((c) => !c)} />}
      topBar={{ variant: 'global', user: actor, crumbs, org, tabs: 'none', ...(state && { state }) }}
    >
      {children}
    </ShellFrame>
  );
}
