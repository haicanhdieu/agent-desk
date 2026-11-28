import { useState } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { can, type Access } from '@agentdesk/contracts';
import { ApiError } from '@agentdesk/contracts/client';
import type { OrgSwitchProps, PageCrumb, ProjectSwitchMenu, RepoBlockProps, ShellPageState } from '@/components';
import type { Actor } from '@/mocks/types';
import { useNow } from '@/app/useNow';
import { orgAccessQuery, platformAdminQuery, sessionAccessQuery, toAccess } from '../access/queries';
import { orgsQuery, sessionQuery, type Organization } from '../auth/session';
import { urlOrgId } from '../auth/orgResync';
import { projectPaths } from '../desk/frame';
import { toOrgSwitch, toOrgSwitchList } from '../orgs/orgSwitch';
import { platformCrumbs, type PlatformOrgCrumb } from '../platform/crumbs';
import { platformOrgQuery } from '../platform/queries';
import { toConnectionStatus, toProjectMenuItems } from '../projects/map';
import { projectsQueries } from '../projects/queries';
import { switchTargetHref } from '../projects/switchTarget';
import { repoUrlOf } from '../runs/map';
import {
  errorMenuScope,
  goToProjectsHref,
  orgMenu,
  platformMenu,
  platformOrgMenu,
  projectMenuModel,
  type ErrorScope,
  type GrantState,
  type MenuModel,
} from './nav';
import type { MenuItemKey, RouteChrome } from './routeChrome';

export interface ShellInput {
  chrome: RouteChrome | undefined;
  pathname: string;
  params: { org?: string; project?: string; orgId?: string; run?: string };
  pageState?: ShellPageState;
}

export interface ShellData {
  user: Actor;
  /** Scope-only: never projectsHref, settingsHref or manageHref. */
  orgSwitch: OrgSwitchProps;
  /** Lazy list, with allProjectsHref and, with project:create, newProjectHref. */
  projectSwitch?: ProjectSwitchMenu;
  /** "Loading project": no name, no switcher. */
  projectPlaceholder?: boolean;
  menu: MenuModel | null;
  onRetryMenu(): void;
  crumbs: PageCrumb[];
  titleScope?: string;
  goToProjectsHref: string;
  /** The logo's target when it is not the default `/projects`: Platform > Organizations for a platform admin with no org. */
  logoHref?: string;
}

const isStatus = (e: unknown, ...codes: number[]) => e instanceof ApiError && codes.includes(e.status);

type QueryState = 'loading' | 'error' | 'ready';
const stateOf = (q: Pick<UseQueryResult, 'data' | 'isError'>): QueryState =>
  q.data !== undefined ? 'ready' : q.isError ? 'error' : 'loading';

/** The menu to build: where the page is, or (on a not-found or forbidden page) the deepest scope its address names that may open. */
type Target =
  | { scope: 'org'; slug: string }
  | { scope: 'project'; slug: string; projectId: string }
  | { scope: 'personal' }
  | { scope: 'platform' }
  | { scope: 'platformOrg'; orgId: string }
  | { scope: 'none' };

/** The scope an address names, for an error page that declares no chrome. */
function targetFromPath(pathname: string): Target {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] === 'platform') return { scope: 'platform' };
  if (parts[0] !== 'o' || parts[1] === undefined) return { scope: 'none' };
  try {
    const slug = decodeURIComponent(parts[1]);
    const projectId = parts[2] === 'p' && parts[3] !== undefined ? decodeURIComponent(parts[3]) : undefined;
    return projectId === undefined ? { scope: 'org', slug } : { scope: 'project', slug, projectId };
  } catch {
    return { scope: 'none' };
  }
}

/** Pages whose shell comes from their own address, whatever their route declares. */
function isAddressState(state: ShellPageState | undefined): boolean {
  return state === 'notFound' || state === 'forbidden' || state === 'suspended';
}

function targetOf(input: ShellInput): Target {
  const { chrome, params } = input;
  if (chrome === undefined || chrome.mode === 'none' || chrome.scope === undefined) {
    return isAddressState(input.pageState) ? targetFromPath(input.pathname) : { scope: 'none' };
  }
  switch (chrome.scope) {
    case 'org':
      return params.org === undefined ? { scope: 'none' } : { scope: 'org', slug: params.org };
    case 'project':
      return params.org === undefined || params.project === undefined
        ? { scope: 'none' }
        : { scope: 'project', slug: params.org, projectId: params.project };
    case 'personal':
      return { scope: 'personal' };
    case 'platform':
      return { scope: 'platform' };
    case 'platformOrg':
      return params.orgId === undefined ? { scope: 'platform' } : { scope: 'platformOrg', orgId: params.orgId };
    default:
      return { scope: 'none' };
  }
}

function repoOf(
  dto: { repoPath: string; defaultBranch: string | null },
  status: RepoBlockProps['status'],
): RepoBlockProps {
  const [owner = '', ...rest] = dto.repoPath.split('/');
  return {
    owner,
    name: rest.join('/'),
    branch: dto.defaultBranch ?? null,
    repoUrl: repoUrlOf(dto.repoPath),
    ...(status !== undefined && { status }),
  };
}

/**
 * Everything the shell around a page needs: the top bar's switchers and crumbs, the side menu and the document title
 * scope. It uses `useQuery` only (never suspends, never throws) and sends a tenant query only when it is safe: the
 * org is a loaded, active-for-the-session, non-suspended membership and the latest URL names it (spec "Shell data rules").
 */
export function useShellData(input: ShellInput): ShellData {
  const { chrome, pathname, params, pageState } = input;
  const now = useNow();
  const sessionQ = useQuery(sessionQuery);
  const orgsQ = useQuery(orgsQuery);
  const platformQ = useQuery(platformAdminQuery);
  const platformAdmin = platformQ.data?.platformAdmin ?? false;
  const session = sessionQ.data;
  const memberships: Organization[] | undefined = orgsQ.data;
  const listState = stateOf(orgsQ);

  const target = targetOf(input);
  const onPlatform = target.scope === 'platform' || target.scope === 'platformOrg';
  const activeOrg = memberships?.find((o) => o.id === session?.activeOrganizationId);
  // The org the tenant queries would name: the URL's for org and project pages, the session's for personal ones.
  const slug =
    target.scope === 'org' || target.scope === 'project'
      ? target.slug
      : target.scope === 'personal'
        ? activeOrg?.slug
        : undefined;
  const member = slug === undefined ? undefined : memberships?.find((o) => o.slug === slug);
  const urlId = urlOrgId();
  // A page that reports `suspended` (the refusal can arrive before the membership list shows it) is never an active org.
  const orgSuspended = member?.status === 'suspended' || pageState === 'suspended';
  const tenantOk =
    member !== undefined &&
    !orgSuspended &&
    session !== undefined &&
    session !== null &&
    member.id === session.activeOrganizationId &&
    (target.scope === 'personal' ? urlId === undefined || urlId === member.id : urlId === member.id);
  const tenantSlug = tenantOk ? slug : undefined;

  const hasMenuOrg = target.scope === 'org' || target.scope === 'project' || target.scope === 'personal';
  const orgAccessA = useQuery({
    ...orgAccessQuery(tenantSlug ?? ''),
    enabled: tenantOk && (target.scope === 'org' || target.scope === 'project'),
  });
  const sessionAccessA = useQuery({ ...sessionAccessQuery, enabled: tenantOk && target.scope === 'personal' });
  const accessQ = target.scope === 'personal' ? sessionAccessA : orgAccessA;
  const accessData = tenantOk && hasMenuOrg ? accessQ.data : undefined;
  const access: Access | undefined = accessData === undefined ? undefined : toAccess(accessData);
  const accessState: QueryState = !tenantOk ? 'loading' : stateOf({ data: accessData, isError: accessQ.isError });

  const projectId = target.scope === 'project' ? target.projectId : undefined;
  const projectOn = tenantOk && projectId !== undefined;
  const detailQ = useQuery({
    ...projectsQueries.detail(tenantSlug ?? '', projectId ?? ''),
    enabled: projectOn,
    throwOnError: false,
  });
  const connectionQ = useQuery({
    ...projectsQueries.connection(tenantSlug ?? '', projectId ?? ''),
    enabled: projectOn,
  });
  const inaccessible = projectOn && detailQ.isError && isStatus(detailQ.error, 403, 404);
  const detail = projectOn && !inaccessible ? detailQ.data : undefined;
  const projectKnown: 'accessible' | 'inaccessible' | 'unknown' =
    detail !== undefined ? 'accessible' : inaccessible ? 'inaccessible' : 'unknown';

  // A project that can never load (non-member or suspended org) shows no loading placeholder; while the org list or the session is still unknown it may.
  const sessionPending = sessionQ.data === undefined && !sessionQ.isError;
  const projectCanLoad = listState !== 'ready' || tenantOk || sessionPending;

  const platformOrgId = target.scope === 'platformOrg' ? target.orgId : undefined;
  const platformOrgQ = useQuery({
    ...platformOrgQuery(platformOrgId ?? ''),
    enabled: platformAdmin && platformOrgId !== undefined,
    retry: false,
  });
  const platformOrgMissing = platformOrgQ.isError && isStatus(platformOrgQ.error, 404);

  // The project switcher's list: fetched once the switcher is first opened for this org.
  const [openedFor, setOpenedFor] = useState<string>();
  const listQ = useQuery({
    ...projectsQueries.all(tenantSlug ?? ''),
    enabled: tenantSlug !== undefined && detail !== undefined && openedFor === tenantSlug,
  });

  const handle = session?.user.handle ?? '';
  const user: Actor = { login: handle, initials: handle.slice(0, 2).toUpperCase() };

  // --- the menu -----------------------------------------------------------------------------------------------
  const errorPage = isAddressState(pageState);
  const item: MenuItemKey | undefined = errorPage ? undefined : chrome?.item;
  const parent = chrome?.parent === true && !errorPage;

  let shown: Target = target;
  if (platformOrgMissing && target.scope === 'platformOrg') {
    shown = { scope: 'platform' };
  } else if (errorPage || (target.scope === 'project' && projectKnown === 'inaccessible')) {
    const scope: ErrorScope = errorMenuScope({
      pathname,
      ...(memberships !== undefined && { memberships }),
      project: projectKnown,
      platformAdmin,
    });
    shown =
      scope.scope === 'none'
        ? { scope: 'none' }
        : scope.scope === 'platform'
          ? { scope: 'platform' }
          : scope.scope === 'org'
            ? { scope: 'org', slug: scope.slug }
            : { scope: 'project', slug: scope.slug, projectId: scope.projectId };
  }
  const markedItem: MenuItemKey | undefined =
    platformOrgMissing && target.scope === 'platformOrg'
      ? 'platformOrgs'
      : target.scope === 'project' && projectKnown === 'inaccessible'
        ? undefined
        : item;

  const grant = (): GrantState | null => {
    if (listState === 'loading') return 'orgListLoading';
    if (listState === 'error') return 'orgListError';
    if (member === undefined || orgSuspended) return null;
    if (!tenantOk) return 'loading';
    return accessState === 'ready' ? 'ready' : accessState;
  };

  let menu: MenuModel | null = null;
  if (shown.scope === 'platform') {
    menu = platformAdmin ? platformMenu({ ...(markedItem !== undefined && { item: markedItem }) }) : null;
  } else if (shown.scope === 'platformOrg') {
    if (platformAdmin) {
      const org: Parameters<typeof platformOrgMenu>[0]['org'] = platformOrgQ.data
        ? { status: 'ready', name: platformOrgQ.data.name, orgStatus: platformOrgQ.data.status }
        : platformOrgQ.isError
          ? { status: 'error' }
          : { status: 'loading' };
      menu = platformOrgMenu({ orgId: shown.orgId, org, ...(markedItem !== undefined && { item: markedItem }) });
    }
  } else if (shown.scope === 'org' || shown.scope === 'personal') {
    const state = slug === undefined ? null : grant();
    if (slug !== undefined && state !== null) {
      menu = orgMenu({
        slug,
        state,
        ...(access !== undefined && { access }),
        ...(platformAdmin &&
          state === 'ready' &&
          member !== undefined && { manageHref: `/platform/orgs/${member.id}` }),
        ...(markedItem !== undefined && { item: markedItem }),
      });
    }
  } else if (shown.scope === 'project') {
    const state = grant();
    if (state !== null) {
      const detailState: QueryState =
        detail !== undefined ? 'ready' : detailQ.isError && projectOn ? 'error' : 'loading';
      const projectState: GrantState =
        state === 'orgListLoading' || state === 'orgListError'
          ? state
          : state === 'error' || detailState === 'error'
            ? 'error'
            : state === 'loading' || detailState === 'loading'
              ? 'loading'
              : 'ready';
      const status =
        connectionQ.data !== undefined && detail !== undefined
          ? toConnectionStatus(connectionQ.data, detail, now)
          : undefined;
      menu = projectMenuModel({
        slug: shown.slug,
        projectId: shown.projectId,
        state: projectState,
        ...(access !== undefined && { access }),
        ...(detail !== undefined && { needsYou: detail.counts.needsYou }),
        ...(detail !== undefined && {
          repo: repoOf(detail, status === undefined ? undefined : { tone: status.tone, text: status.text }),
        }),
        ...(markedItem !== undefined && { item: markedItem }),
        ...(parent && { parent: true }),
      });
    }
  }

  // --- retry --------------------------------------------------------------------------------------------------
  const onRetryMenu = () => {
    if (listState === 'error') void orgsQ.refetch();
    if (tenantOk && accessQ.isError) void accessQ.refetch();
    if (projectOn && detailQ.isError && detail === undefined && !inaccessible) void detailQ.refetch();
    if (projectOn && connectionQ.isError) void connectionQ.refetch();
    if (platformOrgQ.isError && !platformOrgMissing) void platformOrgQ.refetch();
  };

  // --- the top bar --------------------------------------------------------------------------------------------
  const { orgs, list } = toOrgSwitchList(orgsQ);
  const switchData = toOrgSwitch(orgs, member?.slug ?? slug ?? null, platformAdmin);
  const orgSwitch: OrgSwitchProps = {
    ...switchData,
    ...(list !== undefined && { list }),
    orgHref: (o) => `/o/${encodeURIComponent(o.slug)}/projects`,
    createHref: '/platform/orgs/new',
    ...(platformAdmin && { platformHref: '/platform' }),
    ...(onPlatform && { scope: 'platform' as const }),
  };

  const projectShown = shown.scope === 'project' && target.scope === 'project';
  const projectSwitch: ProjectSwitchMenu | undefined =
    projectShown && detail !== undefined && tenantSlug !== undefined && projectId !== undefined
      ? {
          ...(listQ.data !== undefined
            ? {
                status: 'ready' as const,
                items: toProjectMenuItems(listQ.data.items, projectId, (id) =>
                  switchTargetHref(tenantSlug, id, item, parent, access),
                ),
              }
            : listQ.isError
              ? { status: 'error' as const, onRetry: () => void listQ.refetch() }
              : { status: 'loading' as const }),
          onOpen: () => setOpenedFor(tenantSlug),
          allProjectsHref: projectPaths(tenantSlug, projectId).projects,
          ...(access !== undefined &&
            can(access, 'project:create') && {
              newProjectHref: `${projectPaths(tenantSlug, projectId).projects}/new/repo`,
            }),
        }
      : undefined;

  // --- crumbs and title ---------------------------------------------------------------------------------------
  let crumbs: PageCrumb[] = [];
  let titleScope: string | undefined;
  if (onPlatform) {
    const orgCrumb: PlatformOrgCrumb =
      platformOrgId === undefined
        ? { state: 'none' }
        : platformOrgQ.data
          ? { state: 'ready', id: platformOrgId, name: platformOrgQ.data.name }
          : platformOrgMissing
            ? { state: 'notFound' }
            : platformOrgQ.isError
              ? { state: 'error', id: platformOrgId }
              : { state: 'loading' };
    crumbs = platformCrumbs(pathname, orgCrumb).crumbs;
    titleScope = 'Platform';
  } else {
    const suspended = orgSuspended;
    const label =
      chrome?.crumb ??
      (chrome?.mode === 'wizard' ? 'New project' : target.scope === 'personal' ? 'My invitations' : undefined);
    if (pageState !== 'notFound' && !suspended) {
      const runs = projectId !== undefined && slug !== undefined ? projectPaths(slug, projectId).runs : undefined;
      // A run page has no crumb of its own: its trail is the Runs link and "Run n".
      if (params.run !== undefined && runs !== undefined)
        crumbs = [{ label: 'Runs', href: runs }, { label: `Run ${params.run}` }];
      else if (label !== undefined) crumbs = [{ label }];
    }
    if (target.scope === 'org' && member !== undefined && !suspended) titleScope = member.name;
    if (target.scope === 'project' && detail !== undefined) titleScope = detail.name;
  }

  const shownScope: ErrorScope =
    menu === null
      ? { scope: 'none' }
      : shown.scope === 'org' || shown.scope === 'project'
        ? shown.scope === 'org'
          ? { scope: 'org', slug: shown.slug }
          : { scope: 'project', slug: shown.slug, projectId: shown.projectId }
        : shown.scope === 'personal' && slug !== undefined
          ? { scope: 'org', slug }
          : shown.scope === 'platform' || shown.scope === 'platformOrg'
            ? { scope: 'platform' }
            : { scope: 'none' };

  return {
    user,
    orgSwitch,
    ...(projectSwitch !== undefined && { projectSwitch }),
    ...(target.scope === 'project' && { projectPlaceholder: detail === undefined && !inaccessible && projectCanLoad }),
    menu,
    onRetryMenu,
    crumbs,
    ...(titleScope !== undefined && { titleScope }),
    goToProjectsHref: goToProjectsHref(shownScope),
    ...(platformAdmin && memberships?.length === 0 && { logoHref: '/platform/orgs' }),
  };
}
