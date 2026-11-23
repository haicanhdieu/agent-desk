import { can, type Access } from '@agentdesk/contracts';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import type { OrgSwitchProps } from '@/components';
import type { Actor, OrgSettingsTabKey } from '@/mocks/types';
import { canInvite, orgAccessQuery, sessionAccessQuery, toAccess } from '../access/queries';
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

  const slug = orgSlug ?? orgs.find((o) => o.id === session?.activeOrganizationId)?.slug ?? null;
  const switchData = toOrgSwitch(orgs, slug, accessDto?.platformAdmin ?? false);
  const base = slug === null ? undefined : `/o/${encodeURIComponent(slug)}`;
  const showSettings = base !== undefined && accessDto !== undefined && canOpenSettings(toAccess(accessDto));
  const handle = session?.user.handle ?? '';

  return {
    user: { login: handle, initials: handle.slice(0, 2).toUpperCase() },
    org: {
      ...switchData,
      orgHref: (o) => `/o/${encodeURIComponent(o.slug)}/projects`,
      createHref: '/orgs/new',
      ...(base !== undefined && { projectsHref: `${base}/projects` }),
      ...(showSettings && { settingsHref: `${base}/settings` }),
    },
  };
}
