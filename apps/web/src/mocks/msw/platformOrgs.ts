import {
  slicePage,
  type CreateAssignmentRequest,
  type OrgStatus,
  type Page,
  type PageQuery,
  type PlatformAssignmentDto,
  type PlatformMemberDto,
  type PlatformOrgDetailDto,
  type PlatformOrgDto,
  type PlatformOrgListQuery,
  type PlatformOrgSuspensionDto,
  type PlatformProjectDto,
  type PlatformRoleDto,
  type UpdateOrgRequest,
} from '@agentdesk/contracts';
import { roleFixtures } from '../dto/access';
import { platformMemberFixtures, platformOrgDtoFixtures, platformProjectFixtures } from '../dto/platform';
import { mockDb } from './db';
import { conflict, notFound, Problem } from './http';

// The platform organizations directory: stateful so later suspend and reactivate calls change what the list shows.

let orgs: PlatformOrgDto[] = structuredClone(platformOrgDtoFixtures);
let suspensions = new Map<string, PlatformOrgSuspensionDto>();

// The org detail tabs: each org has its own projects and members (with their assignments), made from the fixtures on the
// first read, or from the scenario's seed, or empty for an org made in the mock.
interface OrgTabs {
  projects: PlatformProjectDto[];
  members: PlatformMemberDto[];
}
let tabSeed: OrgTabs = { projects: platformProjectFixtures, members: platformMemberFixtures };
let tabs = new Map<string, OrgTabs>();
mockDb.onReset(() => {
  orgs = structuredClone(platformOrgDtoFixtures);
  suspensions = new Map();
  tabSeed = { projects: platformProjectFixtures, members: platformMemberFixtures };
  tabs = new Map();
});

/** Replaces the directory (scenario seeding); a store reset puts the fixtures back. */
export function seedPlatformOrgs(entries: PlatformOrgDto[]): void {
  orgs = structuredClone(entries);
  suspensions = new Map();
  tabs = new Map();
}

/** Replaces what every org's Projects and Members tabs start with (scenario seeding); a store reset puts the fixtures back. */
export function seedPlatformOrgTabs(seed: OrgTabs): void {
  tabSeed = structuredClone(seed);
  tabs = new Map();
}

/** A new organization has no owner, members or projects yet. */
export function addPlatformOrg(org: { id: string; name: string; slug: string; createdAt: string }): void {
  tabs.set(org.id, { projects: [], members: [] });
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

/** As the API's `requireOrg`: an org that is neither in the directory nor in the mock store is a 404. */
function tabsOf(orgId: string): OrgTabs {
  const known = orgs.some((o) => o.id === orgId) || mockDb.state.orgs.some((o) => o.id === orgId);
  if (!known) throw notFound('Organization');
  let found = tabs.get(orgId);
  if (!found) {
    found = structuredClone(tabSeed);
    tabs.set(orgId, found);
  }
  return found;
}

export function listPlatformProjects(orgId: string, q: PageQuery): Page<PlatformProjectDto> {
  return slicePage(structuredClone(tabsOf(orgId).projects), q);
}

export function listPlatformMembers(orgId: string, q: PageQuery): Page<PlatformMemberDto> {
  return slicePage(structuredClone(tabsOf(orgId).members), q);
}

export function listPlatformRoles(orgId: string): PlatformRoleDto[] {
  tabsOf(orgId);
  return structuredClone(roleFixtures.filter((r) => r.builtIn));
}

const invalidAt = (title: string, pointer: string, detail: string) =>
  new Problem({ status: 422, title, type: 'validation', errors: [{ pointer, detail }] });

/** The directory owner is the earliest org-scope Owner assignment of the members, or none (the last owner may go here). */
function refreshOwner(orgId: string, tab: OrgTabs): void {
  const org = orgs.find((o) => o.id === orgId);
  if (!org) return;
  const owners = tab.members
    .flatMap((m) =>
      m.assignments.filter((a) => a.role.key === 'owner' && a.scope.type === 'org').map((a) => ({ m, a })),
    )
    .sort((x, y) => x.a.grantedAt.localeCompare(y.a.grantedAt));
  const first = owners[0];
  org.owner = first
    ? { userId: first.m.userId, name: first.m.name, handle: first.m.handle, email: first.m.email }
    : null;
}

/** As the API: the checks run in its order (role at that scope, project, member), each a 422 at the field's pointer; a repeat returns the same assignment. */
export function createPlatformAssignment(
  orgId: string,
  body: CreateAssignmentRequest,
  grantedBy: string | null,
): PlatformAssignmentDto {
  const tab = tabsOf(orgId);
  const role = roleFixtures.find((r) => r.id === body.roleId);
  if (!role || !role.assignableScopes.includes(body.scope.type)) {
    throw invalidAt(
      'Role not allowed here',
      '/roleId',
      'this role does not exist in the organization or cannot be given at this scope',
    );
  }
  const { scope } = body;
  if (scope.type === 'project' && !tab.projects.some((p) => p.id === scope.projectId)) {
    throw invalidAt('Project not found', '/scope/projectId', 'this project does not exist in the organization');
  }
  const person = tab.members.find((m) => m.userId === body.userId);
  if (!person) throw invalidAt('User not found', '/userId', 'this person is not a member of the organization');
  const same = person.assignments.find(
    (a) =>
      a.role.id === role.id &&
      a.scope.type === scope.type &&
      (scope.type === 'org' || (a.scope.type === 'project' && a.scope.projectId === scope.projectId)),
  );
  if (same) return structuredClone(same);
  const made: PlatformAssignmentDto = {
    id: crypto.randomUUID(),
    userId: person.userId,
    role: { id: role.id, key: role.key, name: role.name },
    scope,
    grantedBy,
    grantedAt: new Date().toISOString(),
  };
  person.assignments.push(made);
  if (role.key === 'owner') refreshOwner(orgId, tab);
  return structuredClone(made);
}

/** As the API on platform routes: any assignment can go, the last owner's too (the directory then has no owner). */
export function removePlatformAssignment(orgId: string, assignmentId: string): null {
  const tab = tabsOf(orgId);
  for (const m of tab.members) {
    const at = m.assignments.findIndex((a) => a.id === assignmentId);
    const [gone] = at < 0 ? [] : m.assignments.splice(at, 1);
    if (gone) {
      if (gone.role.key === 'owner') refreshOwner(orgId, tab);
      return null;
    }
  }
  throw notFound('Assignment');
}

/** Whether the platform directory lists the org (an org the mock store does not hold can still be one). */
export function isPlatformOrg(orgId: string): boolean {
  return orgs.some((o) => o.id === orgId);
}
