import {
  slicePage,
  type OrgStatus,
  type Page,
  type PlatformOrgDetailDto,
  type PlatformOrgDto,
  type PlatformOrgListQuery,
  type PlatformOrgSuspensionDto,
  type UpdateOrgRequest,
} from '@agentdesk/contracts';
import { platformOrgDtoFixtures } from '../dto/platform';
import { mockDb } from './db';
import { conflict, notFound } from './http';

// The platform organizations directory: stateful so later suspend and reactivate calls change what the list shows.

let orgs: PlatformOrgDto[] = structuredClone(platformOrgDtoFixtures);
let suspensions = new Map<string, PlatformOrgSuspensionDto>();
mockDb.onReset(() => {
  orgs = structuredClone(platformOrgDtoFixtures);
  suspensions = new Map();
});

/** Replaces the directory (scenario seeding); a store reset puts the fixtures back. */
export function seedPlatformOrgs(entries: PlatformOrgDto[]): void {
  orgs = structuredClone(entries);
  suspensions = new Map();
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
  return { ...structuredClone(org), suspension: structuredClone(suspensions.get(orgId) ?? null) };
}

/** As the API: a repeat (already in that status) is a no-op that keeps the first reason; a real change sets or clears the suspension. */
export function setPlatformOrgStatus(
  orgId: string,
  to: OrgStatus,
  reason: string,
  by: PlatformOrgSuspensionDto['by'] = null,
): PlatformOrgDetailDto {
  const org = orgs.find((o) => o.id === orgId);
  if (!org) throw notFound('Organization');
  if (org.status === to) return getPlatformOrg(orgId);
  org.status = to;
  const seat = mockDb.state.orgs.find((o) => o.id === orgId);
  if (seat) seat.status = to;
  if (to === 'suspended') {
    const at = new Date().toISOString();
    org.suspendedAt = at;
    suspensions.set(orgId, { at, reason, by });
  } else {
    org.suspendedAt = null;
    suspensions.delete(orgId);
  }
  return getPlatformOrg(orgId);
}

/** As the API: a slug another org holds is a 409 at `/slug`; values equal to the current ones change nothing. Status and suspension stay. */
export function updatePlatformOrg(orgId: string, body: UpdateOrgRequest): PlatformOrgDetailDto {
  const org = orgs.find((o) => o.id === orgId);
  if (!org) throw notFound('Organization');
  if (body.slug !== undefined && body.slug !== org.slug && orgs.some((o) => o.id !== orgId && o.slug === body.slug)) {
    throw conflict('Slug already in use', [{ pointer: '/slug', detail: 'this slug is already taken' }]);
  }
  org.name = body.name ?? org.name;
  org.slug = body.slug ?? org.slug;
  const seat = mockDb.state.orgs.find((o) => o.id === orgId);
  if (seat) {
    seat.name = org.name;
    seat.slug = org.slug;
  }
  return getPlatformOrg(orgId);
}
