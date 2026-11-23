import {
  slicePage,
  type Page,
  type PlatformOrgDetailDto,
  type PlatformOrgDto,
  type PlatformOrgListQuery,
} from '@agentdesk/contracts';
import { platformOrgDtoFixtures } from '../dto/platform';
import { mockDb } from './db';
import { notFound } from './http';

// The platform organizations directory: stateful so later suspend and reactivate calls change what the list shows.

let orgs: PlatformOrgDto[] = structuredClone(platformOrgDtoFixtures);
mockDb.onReset(() => {
  orgs = structuredClone(platformOrgDtoFixtures);
});

/** Replaces the directory (scenario seeding); a store reset puts the fixtures back. */
export function seedPlatformOrgs(entries: PlatformOrgDto[]): void {
  orgs = structuredClone(entries);
}

/** A new organization has no owner, members or projects yet. */
export function addPlatformOrg(org: { id: string; name: string; slug: string; createdAt: string }): void {
  orgs = [
    {
      ...org,
      memberCount: 0,
      status: 'active',
      suspendedAt: null,
      projectCount: 0,
      lastActivityAt: null,
      owner: null,
    },
    ...orgs,
  ];
}

/** Newest first (id breaks ties). Search is a plain substring of the name or slug, so `%` and `_` are literal. */
export function listPlatformOrgs(q: PlatformOrgListQuery): Page<PlatformOrgDto> {
  const needle = q.q?.toLowerCase() ?? '';
  const rows = orgs.filter(
    (o) =>
      (needle === '' || o.name.toLowerCase().includes(needle) || o.slug.toLowerCase().includes(needle)) &&
      (q.status === undefined || o.status === q.status),
  );
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  return slicePage(rows, q);
}

export function getPlatformOrg(orgId: string): PlatformOrgDetailDto {
  const org = orgs.find((o) => o.id === orgId);
  if (!org) throw notFound('Organization');
  return { ...structuredClone(org), suspension: null };
}
