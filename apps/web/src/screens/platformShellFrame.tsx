import { useState, type ReactNode } from 'react';
import { NO_PAGE_CRUMBS, SubNav, type OrgSwitchProps, type PageCrumb, type PageState } from '@/components';
import {
  platformMenuFixture,
  platformOrgMenuFixtures,
  withPlatformMenuActive,
  withPlatformOrgMenuActive,
  type PlatformMenuPage,
  type PlatformOrgMenuPage,
} from '@/mocks';
import type { Actor } from '@/mocks/types';
import { ShellFrame } from './shellFrame';
import { platformScope } from './platformFrame';

const opsAdmin: Actor = { login: 'ops-admin', initials: 'OA' };

export type PlatformShellMenu =
  /** The top-level platform menu with `page` current. */
  | { page: PlatformMenuPage }
  /** The one-org menu with `tab` current; `state` picks the placeholder or the failed name. */
  | { org: 'active' | 'suspended' | 'loading' | 'error'; tab: PlatformOrgMenuPage };

export interface PlatformShellFrameProps {
  menu: PlatformShellMenu;
  /** The scope switch data; defaults to a platform admin with two memberships. */
  scopeOrg?: OrgSwitchProps;
  crumbs?: readonly PageCrumb[];
  state?: PageState;
  /** Menu collapsed to its 48px strip. */
  collapsed?: boolean;
  /** False: the no-access page, which has no menu. */
  sideMenu?: boolean;
  height?: number;
  children: ReactNode;
}

/**
 * Stories and screen tests only: the shell with the "Platform menu" around a platform screen, as the route renders it.
 * The screen inside draws only its own page.
 */
export function PlatformShellFrame({
  menu,
  scopeOrg = platformScope(),
  crumbs = NO_PAGE_CRUMBS,
  state,
  collapsed: startCollapsed = false,
  sideMenu = true,
  height = 900,
  children,
}: PlatformShellFrameProps) {
  const [collapsed, setCollapsed] = useState(startCollapsed);
  const model =
    'page' in menu
      ? withPlatformMenuActive(platformMenuFixture, menu.page)
      : withPlatformOrgMenuActive(platformOrgMenuFixtures[menu.org], menu.tab);
  return (
    <ShellFrame
      height={height}
      menuMode={sideMenu ? (collapsed ? 'collapsed' : 'full') : 'none'}
      menu={
        sideMenu ? (
          <SubNav {...model} collapsed={collapsed} onToggleCollapsed={() => setCollapsed((c) => !c)} />
        ) : undefined
      }
      topBar={{ variant: 'platform', user: opsAdmin, crumbs, org: scopeOrg, ...(state && { state }) }}
    >
      {children}
    </ShellFrame>
  );
}
