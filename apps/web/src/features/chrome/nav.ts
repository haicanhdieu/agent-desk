import { type Access } from '@agentdesk/contracts';
import type { RepoBlockProps, SubNavGroup, SubNavItem } from '@/components';
import { projectPaths, deskRightsOf } from '../desk/frame';
import { ORG_SETTINGS_ORDER, orgSettingsTabs } from './appBar';
import type { MenuItemKey } from './routeChrome';

export type GrantState = 'loading' | 'error' | 'ready' | 'orgListLoading' | 'orgListError';

export interface MenuModel {
  label: 'Organization menu' | 'Project menu' | 'Platform menu';
  state: 'ready' | 'loading' | 'error';
  groups: SubNavGroup[];
  back?: { label: string; href: string };
  header?: { name: string; status?: 'active' | 'suspended' } | 'loading';
  footer?: { kind: 'managePlatform'; href: string } | { kind: 'repo'; repo: RepoBlockProps };
}

const SETTINGS_ITEM: Record<(typeof ORG_SETTINGS_ORDER)[number], Pick<SubNavItem, 'label' | 'icon'>> = {
  members: { label: 'Members', icon: 'users' },
  invitations: { label: 'Invitations', icon: 'mail' },
  audit: { label: 'Audit log', icon: 'clock' },
  general: { label: 'General', icon: 'sliders' },
};

/** The menu state for a grant state: the org list loading is a ready menu, the org list failing is an error. */
function menuState(state: GrantState): MenuModel['state'] {
  if (state === 'ready' || state === 'orgListLoading') return 'ready';
  return state === 'loading' ? 'loading' : 'error';
}

function item(
  key: MenuItemKey,
  current: MenuItemKey | undefined,
  label: string,
  href: string,
  icon: SubNavItem['icon'],
  extra: Partial<SubNavItem> = {},
): SubNavItem {
  return { label, href, icon, ...extra, ...(current === key && { active: true as const }) };
}

export function orgMenu(i: {
  slug: string;
  state: GrantState;
  access?: Access;
  manageHref?: string;
  item?: MenuItemKey;
}): MenuModel {
  const base = `/o/${encodeURIComponent(i.slug)}`;
  const groups: SubNavGroup[] = [{ items: [item('projects', i.item, 'Projects', `${base}/projects`, 'grid')] }];
  const ready = i.state === 'ready';
  if (ready && i.access !== undefined) {
    const tabs = orgSettingsTabs(i.slug, i.access);
    const settings = ORG_SETTINGS_ORDER.flatMap((key) => {
      const href = tabs[key];
      return href === undefined ? [] : [item(key, i.item, SETTINGS_ITEM[key].label, href, SETTINGS_ITEM[key].icon)];
    });
    if (settings.length > 0) groups.push({ heading: 'Settings', items: settings });
  }
  return {
    label: 'Organization menu',
    state: menuState(i.state),
    groups,
    ...(ready && i.manageHref !== undefined && { footer: { kind: 'managePlatform' as const, href: i.manageHref } }),
  };
}

export function projectMenuModel(i: {
  slug: string;
  projectId: string;
  state: GrantState;
  access?: Access;
  needsYou?: number;
  repo?: RepoBlockProps;
  item?: MenuItemKey;
  parent?: boolean;
}): MenuModel {
  const paths = projectPaths(i.slug, i.projectId);
  const back = { label: 'All projects', href: paths.projects };
  const loading = i.state === 'loading';
  const ready = i.state === 'ready';
  const runs: SubNavItem = {
    ...item(
      'runs',
      i.item,
      'Runs',
      paths.runs,
      'runs',
      i.needsYou !== undefined && i.needsYou > 0 ? { badge: i.needsYou } : {},
    ),
    ...(i.item === 'runs' && i.parent && { active: 'parent' as const }),
  };
  const groups: SubNavGroup[] = loading ? [] : [{ items: [runs] }];
  if (ready) {
    const rights = deskRightsOf(i.access, i.projectId);
    const configure = [
      rights.rules && item('rules', i.item, 'Routing rules', paths.rules, 'rule'),
      rights.skills && item('skills', i.item, 'Skills', paths.skills, 'skill-file'),
      rights.setup && item('setup', i.item, 'Workspace setup', paths.setup, 'terminal'),
      rights.agent && item('agent', i.item, 'Agent & settings', paths.agent, 'bot'),
    ].filter((x): x is SubNavItem => x !== false);
    const access = [
      rights.members && item('projectMembers', i.item, 'Members', paths.members, 'users'),
      rights.audit && item('projectAudit', i.item, 'Audit log', paths.audit, 'clock'),
    ].filter((x): x is SubNavItem => x !== false);
    if (configure.length > 0) groups.push({ heading: 'Configure', items: configure });
    if (access.length > 0) groups.push({ heading: 'Access', items: access });
  }
  return {
    label: 'Project menu',
    state: menuState(i.state),
    groups,
    back,
    ...(i.state !== 'orgListLoading' &&
      i.state !== 'orgListError' &&
      i.repo !== undefined && {
        footer: { kind: 'repo' as const, repo: i.repo },
      }),
  };
}

const PLATFORM_BACK = { label: 'Organizations', href: '/platform/orgs' };

export function platformMenu(i: { item?: MenuItemKey }): MenuModel {
  return {
    label: 'Platform menu',
    state: 'ready',
    groups: [
      {
        items: [
          item('platformOrgs', i.item, 'Organizations', '/platform/orgs', 'grid'),
          item('platformAdmins', i.item, 'Platform admins', '/platform/admins', 'users'),
          item('platformAudit', i.item, 'Audit log', '/platform/audit', 'clock'),
        ],
      },
    ],
  };
}

export function platformOrgMenu(i: {
  orgId: string;
  org:
    { status: 'loading' } | { status: 'error' } | { status: 'ready'; name: string; orgStatus: 'active' | 'suspended' };
  item?: MenuItemKey;
}): MenuModel {
  const base = `/platform/orgs/${encodeURIComponent(i.orgId)}`;
  const groups: SubNavGroup[] =
    i.org.status === 'loading'
      ? []
      : [
          {
            items: [
              item('orgOverview', i.item, 'Overview', base, 'eye'),
              item('orgProjects', i.item, 'Projects', `${base}/projects`, 'grid'),
              item('orgMembers', i.item, 'Members', `${base}/members`, 'users'),
              item('orgInvitations', i.item, 'Invitations', `${base}/invitations`, 'mail'),
            ],
          },
        ];
  const header: MenuModel['header'] =
    i.org.status === 'loading'
      ? 'loading'
      : i.org.status === 'error'
        ? { name: 'Organization' }
        : { name: i.org.name, status: i.org.orgStatus };
  return {
    label: 'Platform menu',
    state: i.org.status === 'loading' ? 'loading' : 'ready',
    groups,
    back: PLATFORM_BACK,
    header,
  };
}

export type ErrorScope =
  | { scope: 'project'; slug: string; projectId: string }
  | { scope: 'org'; slug: string }
  | { scope: 'platform' }
  | { scope: 'none' };

const NONE: ErrorScope = { scope: 'none' };

function decode(part: string): string | undefined {
  try {
    return decodeURIComponent(part);
  } catch {
    return undefined;
  }
}

/**
 * The menu an error page keeps: the deepest scope its own address names that the person may open, else none.
 * Never an org the path does not name, and never a suspended or non-member org.
 */
export function errorMenuScope(i: {
  pathname: string;
  memberships?: { slug: string; status: string }[];
  project: 'accessible' | 'inaccessible' | 'unknown';
  platformAdmin: boolean;
}): ErrorScope {
  const parts = i.pathname.split('/').filter(Boolean);
  if (parts[0] === 'platform') return i.platformAdmin ? { scope: 'platform' } : NONE;
  if (parts[0] !== 'o' || parts[1] === undefined) return NONE;
  const slug = decode(parts[1]);
  const member = slug === undefined ? undefined : i.memberships?.find((m) => m.slug === slug);
  if (slug === undefined || member === undefined || member.status === 'suspended') return NONE;
  const projectId = parts[2] === 'p' && parts[3] !== undefined ? decode(parts[3]) : undefined;
  if (projectId !== undefined && i.project !== 'inaccessible') return { scope: 'project', slug, projectId };
  return { scope: 'org', slug };
}

/** "Go to projects": the shown menu's org's projects page, else the landing page. */
export function goToProjectsHref(scope: ErrorScope): string {
  if (scope.scope === 'org' || scope.scope === 'project') return `/o/${encodeURIComponent(scope.slug)}/projects`;
  return '/';
}
