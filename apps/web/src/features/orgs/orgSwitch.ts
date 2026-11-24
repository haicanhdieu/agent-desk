import type { OrgOption, OrgSwitchData } from '@/mocks';
import type { Organization } from '../auth/session';

const toOption = (o: Organization): OrgOption => ({
  id: o.id,
  slug: o.slug,
  name: o.name,
  ...(o.status === 'suspended' && { suspended: true }),
});

/** The org switcher's data: the memberships, the one the URL names, and whether the user is a platform admin. */
export function toOrgSwitch(orgs: Organization[], currentSlug: string | null, platformAdmin: boolean): OrgSwitchData {
  const options = orgs.map(toOption);
  const current = currentSlug === null ? undefined : options.find((o) => o.slug === currentSlug);
  return { current: current ?? null, orgs: options, platformAdmin };
}
