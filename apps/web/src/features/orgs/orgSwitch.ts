import type { OrgSwitchData } from '@/mocks';
import type { Organization } from '../auth/session';

/** The org switcher's data: the memberships, the one the URL names, and whether the user is a platform admin. */
export function toOrgSwitch(orgs: Organization[], currentSlug: string | null, platformAdmin: boolean): OrgSwitchData {
  const current = currentSlug === null ? undefined : orgs.find((o) => o.slug === currentSlug);
  return { current: current ?? null, orgs, platformAdmin };
}
