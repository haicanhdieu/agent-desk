import { AppLink } from '@/ds';
import { RepoBlock, type RepoBlockProps } from '@/components/RepoBlock';
import type { ProjectSwitchMenu } from '@/components/ProjectSwitch';
import type { SubNavGroup, SubNavProps } from '@/components/SubNav';

const base = '/o/harbor-labs';

/** The org page each menu item opens; `projects` is the always-shown item. */
export type OrgMenuPage = 'projects' | 'members' | 'invitations' | 'audit' | 'general';

const projectsItem = { label: 'Projects', href: `${base}/projects`, icon: 'grid' as const };
const settingsItems = {
  members: { label: 'Members', href: `${base}/settings/members`, icon: 'users' as const },
  invitations: { label: 'Invitations', href: `${base}/settings/invitations`, icon: 'mail' as const },
  audit: { label: 'Audit log', href: `${base}/settings/audit`, icon: 'clock' as const },
  general: { label: 'General', href: `${base}/settings/general`, icon: 'sliders' as const },
};

const manageInPlatform = <AppLink href="/platform/orgs/org-harbor">Manage in Platform</AppLink>;

const menu = (settings: (keyof typeof settingsItems)[], footer?: SubNavProps['footer']): SubNavProps => ({
  'aria-label': 'Organization menu',
  groups: [
    { items: [projectsItem] },
    ...(settings.length > 0 ? [{ heading: 'Settings', items: settings.map((k) => settingsItems[k]) }] : []),
  ],
  ...(footer && { footer }),
});

const allSettings: (keyof typeof settingsItems)[] = ['members', 'invitations', 'audit', 'general'];

/**
 * The "Organization menu" model per viewer, as the org screens' stories feed it to the shell. A member has Projects
 * only; a project admin also has Invitations; an owner has the whole Settings group; a platform admin adds the last
 * "Manage in Platform" link. `loading` and `error` keep the always-shown Projects item (the spec's partial menu).
 */
export const orgMenuFixtures: Record<
  'owner' | 'member' | 'projectAdmin' | 'platformAdmin' | 'loading' | 'error',
  SubNavProps
> = {
  owner: menu(allSettings),
  member: menu([]),
  projectAdmin: menu(['invitations']),
  platformAdmin: menu(allSettings, manageInPlatform),
  loading: { ...menu([]), state: 'loading' },
  error: { ...menu([]), state: 'error', onRetry: () => undefined },
};

/** The same menu with the item for `page` marked as the current page. */
export function withOrgMenuActive(props: SubNavProps, page: OrgMenuPage): SubNavProps {
  const href = page === 'projects' ? projectsItem.href : settingsItems[page].href;
  const groups: SubNavGroup[] = props.groups.map((g) => ({
    ...g,
    items: g.items?.map((it) => (it.href === href ? { ...it, active: true } : it)),
  }));
  return { ...props, groups };
}

/** The platform page each top-level menu item opens. */
export type PlatformMenuPage = 'orgs' | 'admins' | 'audit';

const platformItems = {
  orgs: { label: 'Organizations', href: '/platform/orgs', icon: 'grid' as const },
  admins: { label: 'Platform admins', href: '/platform/admins', icon: 'users' as const },
  audit: { label: 'Audit log', href: '/platform/audit', icon: 'clock' as const },
};

/** The "Platform menu" at the top level: Organizations, Platform admins, Audit log. */
export const platformMenuFixture: SubNavProps = {
  'aria-label': 'Platform menu',
  groups: [{ items: [platformItems.orgs, platformItems.admins, platformItems.audit] }],
};

/** The top-level platform menu with the item for `page` marked as current. */
export function withPlatformMenuActive(props: SubNavProps, page: PlatformMenuPage): SubNavProps {
  const href = platformItems[page].href;
  return {
    ...props,
    groups: props.groups.map((g) => ({
      ...g,
      items: g.items?.map((it) => (it.href === href ? { ...it, active: true } : it)),
    })),
  };
}

/** The tab of one platform org that a menu item opens. */
export type PlatformOrgMenuPage = 'overview' | 'projects' | 'members' | 'invitations';

const orgBase = '/platform/orgs/org-harbor';
const platformOrgItems = {
  overview: { label: 'Overview', href: orgBase, icon: 'eye' as const },
  projects: { label: 'Projects', href: `${orgBase}/projects`, icon: 'grid' as const },
  members: { label: 'Members', href: `${orgBase}/members`, icon: 'users' as const },
  invitations: { label: 'Invitations', href: `${orgBase}/invitations`, icon: 'mail' as const },
};
const platformOrgGroups: SubNavGroup[] = [{ items: Object.values(platformOrgItems) }];
const orgsBack = { label: 'Organizations', href: '/platform/orgs' };
const orgHeader = (name: string, status?: 'Active' | 'Suspended') => (
  <div>
    <strong>{name}</strong>
    {status && <span className="muted"> {status}</span>}
  </div>
);

/**
 * The "Platform menu" inside one org (it replaces the top-level one): the "Organizations" back link, the org name with
 * its status, and the four tabs. `loading` holds placeholders for the name and the links; `error` reads "Organization"
 * with no status above the same links.
 */
export const platformOrgMenuFixtures: Record<'active' | 'suspended' | 'loading' | 'error', SubNavProps> = {
  active: {
    'aria-label': 'Platform menu',
    back: orgsBack,
    header: orgHeader('Harbor Labs', 'Active'),
    groups: platformOrgGroups,
  },
  suspended: {
    'aria-label': 'Platform menu',
    back: orgsBack,
    header: orgHeader('Harbor Labs', 'Suspended'),
    groups: platformOrgGroups,
  },
  loading: {
    'aria-label': 'Platform menu',
    back: orgsBack,
    header: <span role="status" aria-label="Loading organization" />,
    groups: [],
    state: 'loading',
  },
  error: {
    'aria-label': 'Platform menu',
    back: orgsBack,
    header: orgHeader('Organization'),
    groups: platformOrgGroups,
  },
};

/** The org menu with the item for `page` marked as current. */
export function withPlatformOrgMenuActive(props: SubNavProps, page: PlatformOrgMenuPage): SubNavProps {
  const href = platformOrgItems[page].href;
  return {
    ...props,
    groups: props.groups.map((g) => ({
      ...g,
      items: g.items?.map((it) => (it.href === href ? { ...it, active: true } : it)),
    })),
  };
}

/** The project page each menu item opens. */
export type ProjectMenuPage = 'runs' | 'rules' | 'skills' | 'setup' | 'agents' | 'members' | 'audit';

const projectBase = `${base}/p/invoicer-api`;
const projectItems = {
  runs: { label: 'Runs', href: `${projectBase}/runs`, icon: 'runs' as const, badge: 1 },
  rules: { label: 'Routing rules', href: `${projectBase}/rules`, icon: 'rule' as const },
  skills: { label: 'Skills', href: `${projectBase}/skills`, icon: 'skill-file' as const },
  setup: { label: 'Workspace setup', href: `${projectBase}/setup`, icon: 'terminal' as const },
  agents: { label: 'Agent & settings', href: `${projectBase}/desk`, icon: 'bot' as const },
  members: { label: 'Members', href: `${projectBase}/members`, icon: 'users' as const },
  audit: { label: 'Audit log', href: `${projectBase}/audit`, icon: 'clock' as const },
};
const allProjects = { label: 'All projects', href: `${base}/projects` };
const repoUrl = 'https://github.com/harbor-labs/invoicer-api';
const repo = (over: Partial<RepoBlockProps> = {}) => (
  <RepoBlock
    owner="harbor-labs"
    name="invoicer-api"
    branch="main"
    status={{ tone: 'ok', text: 'Connected' }}
    repoUrl={repoUrl}
    {...over}
  />
);
const projectMenu = (
  groups: SubNavGroup[],
  footer: SubNavProps['footer'] = repo(),
  state?: SubNavProps['state'],
): SubNavProps => ({
  'aria-label': 'Project menu',
  back: allProjects,
  groups,
  footer,
  ...(state && { state }),
});
const runsOnly: SubNavGroup = { items: [projectItems.runs] };
const fullGroups: SubNavGroup[] = [
  runsOnly,
  {
    heading: 'Configure',
    items: [projectItems.rules, projectItems.skills, projectItems.setup, projectItems.agents],
  },
  { heading: 'Access', items: [projectItems.members, projectItems.audit] },
];

/**
 * The "Project menu" model per viewer and state. `full` has every group; `member` has Runs and the repository block
 * only. `loading` keeps the back link and the repository block; `error` keeps Runs, then "Could not load the menu."
 * The repository block reads OK, a silent-webhook warning, a polling error, or has no branch line.
 */
export const projectMenuFixtures: Record<
  'full' | 'member' | 'loading' | 'error' | 'repoWarning' | 'repoError' | 'repoNoBranch',
  SubNavProps
> = {
  full: projectMenu(fullGroups),
  member: projectMenu([runsOnly]),
  loading: projectMenu([], repo(), 'loading'),
  error: { ...projectMenu([runsOnly], repo(), 'error'), onRetry: () => undefined },
  repoWarning: projectMenu(fullGroups, repo({ status: { tone: 'warn', text: 'No webhooks for 2 days' } })),
  repoError: projectMenu(
    fullGroups,
    repo({ status: { tone: 'err', text: 'Polling failed: rate limited, retry in 5 min' } }),
  ),
  repoNoBranch: projectMenu(fullGroups, repo({ branch: null })),
};

/** The project menu with the item for `page` marked as the current page. */
export function withProjectMenuActive(props: SubNavProps, page: ProjectMenuPage): SubNavProps {
  const href = projectItems[page].href;
  return {
    ...props,
    groups: props.groups.map((g) => ({
      ...g,
      items: g.items?.map((it) => (it.href === href ? { ...it, active: true } : { ...it, active: undefined })),
    })),
  };
}

const switchItems = [
  { name: 'invoicer-api', needsYou: 1, current: true, href: projectBase },
  { name: 'invoicer-web', needsYou: 0, href: `${base}/p/invoicer-web` },
  {
    name: 'ledger-sync',
    needsYou: 2,
    warning: 'webhooks',
    warningTone: 'idle' as const,
    href: `${base}/p/ledger-sync`,
  },
];
const switchLinks = { allProjectsHref: `${base}/projects`, newProjectHref: `${base}/projects/new` };

/** What the project switcher's popover holds, for the stories that open it. */
export const projectSwitchFixtures: Record<'ready' | 'empty' | 'loading' | 'error' | 'noCreate', ProjectSwitchMenu> = {
  ready: { status: 'ready', items: switchItems, ...switchLinks },
  empty: { status: 'ready', items: [], ...switchLinks },
  loading: { status: 'loading', ...switchLinks },
  error: { status: 'error', onRetry: () => undefined, ...switchLinks },
  noCreate: { status: 'ready', items: switchItems, allProjectsHref: switchLinks.allProjectsHref },
};
