import { can, type Access } from '@agentdesk/contracts';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import type { OrgSwitchProps } from '@/components';
import type { Actor, OrgSettingsTabKey } from '@/mocks/types';
import { canInvite, orgAccessQuery, platformAdminQuery, sessionAccessQuery, toAccess } from '../access/queries';
import { orgsQuery, sessionQuery } from '../auth/session';
import { toOrgSwitch } from '../orgs/orgSwitch';

const TAB_ORDER: OrgSettingsTabKey[] = ['general', 'members', 'invitations', 'audit'];

/** Whether the access may open each tab; the three org-level permissions only count from an org-scope grant (`can`). */
function allowed(access: Access): Record<OrgSettingsTabKey, boolean> {
  return {
    general: can(access, 'org:update'),
    members: can(access, 'member:read'),
    invitations: canInvite(access),
    audit: can(access, 'audit:read'),
  };
}

/** href per tab the access may open: general (org:update), members (member:read), invitations (canInvite), audit (audit:read); org-scope checks via can(). */
export function orgSettingsTabs(slug: string, access: Access): Partial<Record<OrgSettingsTabKey, string>> {
  const ok = allowed(access);
  const base = `/o/${encodeURIComponent(slug)}/settings`;
  const tabs: Partial<Record<OrgSettingsTabKey, string>> = {};
  for (const key of TAB_ORDER) if (ok[key]) tabs[key] = `${base}/${key}`;
  return tabs;
}

export function canOpenSettings(access: Access): boolean {
  return firstSettingsTab(access) !== null;
}

/** The first of general, members, invitations, audit that the access may open. */
export function firstSettingsTab(access: Access): OrgSettingsTabKey | null {
  const ok = allowed(access);
  return TAB_ORDER.find((key) => ok[key]) ?? null;
}

/** The projects page of the membership with this org id, or undefined for an org the person does not belong to. Ids are matched, never slugs. */
export function openOrgHref(
  memberships: ReadonlyArray<{ id: string; slug: string }>,
  orgId: string,
): string | undefined {
  const m = memberships.find((o) => o.id === orgId);
  return m === undefined ? undefined : `/o/${encodeURIComponent(m.slug)}/projects`;
}

export interface AppBarData {
  user: Actor;
  org: OrgSwitchProps;
}

/** Org pages pass the URL slug (access `['org', slug, 'access']`); personal pages pass null (the session's active org, `['session','access']`). */
export function useAppBar(orgSlug: string | null): AppBarData {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const { data: orgs } = useSuspenseQuery(orgsQuery);
  // Only one of the two access queries runs; a pending or failed one leaves the Settings item out.
  const orgAccess = useQuery({ ...orgAccessQuery(orgSlug ?? ''), enabled: orgSlug !== null });
  const sessionAccess = useQuery({ ...sessionAccessQuery, enabled: orgSlug === null });
  const accessDto = (orgSlug === null ? sessionAccess : orgAccess).data;
  // The platform-admin flag has its own query: the access one is refused for a suspended org. A failure hides the item.
  const platformAdmin = useQuery(platformAdminQuery).data?.platformAdmin ?? false;

  const slug = orgSlug ?? orgs.find((o) => o.id === session?.activeOrganizationId)?.slug ?? null;
  const switchData = toOrgSwitch(orgs, slug, platformAdmin);
  const base = slug === null ? undefined : `/o/${encodeURIComponent(slug)}`;
  const showSettings = base !== undefined && accessDto !== undefined && canOpenSettings(toAccess(accessDto));
  const handle = session?.user.handle ?? '';

  return {
    user: { login: handle, initials: handle.slice(0, 2).toUpperCase() },
    org: {
      ...switchData,
      orgHref: (o) => `/o/${encodeURIComponent(o.slug)}/projects`,
      createHref: '/orgs/new',
      ...(platformAdmin && { platformHref: '/platform' }),
      ...(platformAdmin &&
        switchData.current !== null && { manageHref: `/platform/orgs/${encodeURIComponent(switchData.current.id)}` }),
      ...(base !== undefined && { projectsHref: `${base}/projects` }),
      // A platform admin who belongs to no org has no org page to land on: the logo opens Platform > Organizations.
      ...(base === undefined && platformAdmin && orgs.length === 0 && { projectsHref: '/platform/orgs' }),
      ...(showSettings && { settingsHref: `${base}/settings` }),
    },
  };
}
