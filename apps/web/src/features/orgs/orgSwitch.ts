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

/**
 * The org switcher's list state from the orgs query: loading or error (with retry) only while there is no list at
 * all. A failed background refetch keeps the last good list, the person's own memberships.
 */
export function toOrgSwitchList(q: { data?: Organization[]; isError: boolean; refetch(): unknown }): {
  orgs: Organization[];
  list?: OrgSwitchData['list'];
} {
  if (q.data !== undefined) return { orgs: q.data };
  if (q.isError) return { orgs: [], list: { status: 'error', onRetry: () => void q.refetch() } };
  return { orgs: [], list: { status: 'loading' } };
}
