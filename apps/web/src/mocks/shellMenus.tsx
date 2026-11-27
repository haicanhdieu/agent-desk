import { AppLink } from '@/ds';
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
