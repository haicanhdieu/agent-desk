import { can, type Access } from '@agentdesk/contracts';
import type { OrgSettingsTabKey } from '@/mocks/types';
import { canInvite } from '../access/queries';

/** The order of the settings pages: the side menu lists them so, and `/settings` opens the first the caller may open. */
export const ORG_SETTINGS_ORDER = [
  'members',
  'invitations',
  'audit',
  'general',
] as const satisfies readonly OrgSettingsTabKey[];

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
  for (const key of ORG_SETTINGS_ORDER) if (ok[key]) tabs[key] = `${base}/${key}`;
  return tabs;
}

export function canOpenSettings(access: Access): boolean {
  return firstSettingsTab(access) !== null;
}

/** The first of members, invitations, audit, general that the access may open. */
export function firstSettingsTab(access: Access): OrgSettingsTabKey | null {
  const ok = allowed(access);
  return ORG_SETTINGS_ORDER.find((key) => ok[key]) ?? null;
}

/** The projects page of the membership with this org id, or undefined for an org the person does not belong to. Ids are matched, never slugs. */
export function openOrgHref(
  memberships: ReadonlyArray<{ id: string; slug: string }>,
  orgId: string,
): string | undefined {
  const m = memberships.find((o) => o.id === orgId);
  return m === undefined ? undefined : `/o/${encodeURIComponent(m.slug)}/projects`;
}
