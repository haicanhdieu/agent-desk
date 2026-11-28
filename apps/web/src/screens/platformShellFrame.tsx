import type { ReactNode } from 'react';
import { NO_PAGE_CRUMBS, type OrgSwitchProps, type PageCrumb } from '@/components';
import {
  orgSwitchFixtures,
  platformMenuFixture,
  platformOrgMenuFixtures,
  withPlatformMenuActive,
  withPlatformOrgMenuActive,
  type PlatformMenuPage,
  type PlatformOrgMenuPage,
} from '@/mocks';
import type { Actor } from '@/mocks/types';
import { ShellFrame } from './shellFrame';

const opsAdmin: Actor = { login: 'ops-admin', initials: 'OA' };

/** Stories only: the platform scope of the bar, as the route renders it (the Platform group first, no org checked). */
export const platformScope = (
  base: typeof orgSwitchFixtures.platformAdmin = orgSwitchFixtures.platformAdmin,
): OrgSwitchProps => ({
  ...base,
  scope: 'platform',
  platformHref: '/platform/orgs',
  orgHref: (o) => `/o/${o.slug}/projects`,
  createHref: '/platform/orgs/new',
});

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
  collapsed = false,
  sideMenu = true,
  height = 900,
  children,
}: PlatformShellFrameProps) {
  const model =
    'page' in menu
      ? withPlatformMenuActive(platformMenuFixture, menu.page)
      : withPlatformOrgMenuActive(platformOrgMenuFixtures[menu.org], menu.tab);
  return (
    <ShellFrame
      height={height}
      {...(sideMenu && { menuModel: model, collapsed })}
      menuMode={sideMenu ? undefined : 'none'}
      topBar={{ user: opsAdmin, crumbs, org: scopeOrg }}
    >
      {children}
    </ShellFrame>
  );
}

export type PlatformOrgState = { state: 'loading' } | { state: 'ready' | 'error' };
type FrameActive = 'orgs' | 'admins' | 'audit' | PlatformOrgMenuPage;

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

/**
 * Stories only: a platform page in the shell, named by the page that is current (`active`); inside one org, `org`
 * says whether the org menu has its name, is still loading or failed.
 */
export function PlatformFrame({
  active,
  org,
  sideMenu = true,
  crumbs,
  scopeOrg,
  children,
}: {
  active: FrameActive;
  org?: PlatformOrgState;
  /** False keeps the bar and drops the menu (the no-access page). */
  sideMenu?: boolean;
  crumbs?: readonly PageCrumb[];
  scopeOrg?: OrgSwitchProps;
  children: ReactNode;
}) {
  const menu: PlatformShellMenu =
    active === 'orgs' || active === 'admins' || active === 'audit'
      ? { page: active }
      : { org: org?.state === 'loading' || org?.state === 'error' ? org.state : 'active', tab: active };
  return (
    <PlatformShellFrame
      menu={menu}
      sideMenu={sideMenu}
      crumbs={crumbs ?? DEFAULT_CRUMBS[active]}
      {...(scopeOrg && { scopeOrg })}
    >
      {children}
    </PlatformShellFrame>
  );
}
