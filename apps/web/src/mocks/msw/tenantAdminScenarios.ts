import { slicePage, type AssignmentDto, type MemberDto, type Page, type PageQuery } from '@agentdesk/contracts';
import { roleFixtures, tenantMemberFixtures } from '../dto/access';
import { pagedAuditFixtures } from '../dto/audit';
import { ids } from '../dto/ids';
import { NO_ROLE, freshTenantAdmin, type MockDb, type MockState } from './db';
import { MAX_RETRIES } from '../../app/queryClient';
import { Problem, conflict, notFound } from './http';

// The tenant-admin mock scenarios and the store rules behind the members, org and audit routes (spec "Fakes and
// fixtures"). A spec picks a scenario through sessionStorage (`TENANT_ADMIN_SCENARIO_KEY`, written by e2e/mock/mock.ts
// `seedTenantAdmin`); browser.ts reads it once when the worker starts. Each scenario resets the store, then seeds it.
// The rules mirror the API: the permission guard has already run (handlers.ts), then the org is the active one (404),
// the member is in it (404), then who may touch owners (403) and the last-owner rule (409).

export const TENANT_ADMIN_SCENARIO_KEY = 'agentdesk.mock.tenantAdmin';

/**
 * How many times an error scenario fails a list. The app retries a 5xx MAX_RETRIES times on its own, so the first load
 * has to fail MAX_RETRIES + 1 times for the error state to show; the failures are then used up, so the manual Retry
 * (a new request) gets the list.
 */
const FAILURES_TO_SHOW_ERROR = MAX_RETRIES + 1;

export const TENANT_ADMIN_SCENARIOS = [
  'soleOwner',
  'twoOwners',
  'admin',
  'projectAdmin',
  'member',
  'viewer',
  'memberRemovedMeanwhile',
  'roleChangedMeanwhile',
  'membersError',
  'membersSlow',
  'membersPaged',
  'auditEmpty',
  'auditError',
  'auditSlow',
  'auditPaged',
  'invitationsManyAccepted',
] as const;

export type TenantAdminScenario = (typeof TENANT_ADMIN_SCENARIOS)[number];

export function parseTenantAdminScenario(raw: string | null): TenantAdminScenario | undefined {
  return TENANT_ADMIN_SCENARIOS.find((s) => s === raw);
}

const SLOW_MS = 1500;
const ACCEPTED_INVITATIONS = 25;
const SEEDED_AT = '2026-10-05T10:30:00.000Z';
const ORG_OWNER = 'owner';
const MEMBER_GONE = 'Member is no longer in the organization';
const LAST_OWNER = 'The organization needs at least one owner';

const roleOfKey = (key: string) => {
  const role = roleFixtures.find((r) => r.key === key);
  if (!role) throw new Error(`role fixture ${key} missing`);
  return role;
};

const orgRoleKey = (m: MemberDto): string | undefined => m.assignments.find((a) => a.scope.type === 'org')?.role.key;
const ownerCount = (members: MemberDto[]) => members.filter((m) => orgRoleKey(m) === ORG_OWNER).length;

// --- Scenario seeding ---

/** B of the "meanwhile" scenarios: Cleo Martin, a Member with project roles. */
const B = tenantMemberFixtures.twoOwners[3]?.userId ?? '';

type CallerRole = 'owner' | 'admin' | 'projectAdmin' | 'member' | 'viewer';

/** A new org-scope assignment; the seeded ones carry a fixed time so a scenario seeds the same data every load. */
function orgAssignment(
  db: MockDb,
  userId: string,
  key: string,
  grantedBy: string | null,
  grantedAt = SEEDED_AT,
): AssignmentDto {
  const role = roleOfKey(key);
  return {
    id: db.nextId(),
    userId,
    role: { id: role.id, key: role.key, name: role.name },
    scope: { type: 'org' },
    grantedBy,
    grantedAt,
  };
}

/** The roster with the signed-in user (alice) holding `role` instead of owner. */
function rosterFor(db: MockDb, base: MemberDto[], role: CallerRole): MemberDto[] {
  const roster = structuredClone(base);
  if (role === 'owner') return roster;
  return roster.map((m) => {
    if (m.userId !== ids.user.alice) return m;
    const projectRole: AssignmentDto = {
      ...orgAssignment(db, m.userId, 'admin', null),
      scope: { type: 'project', projectId: ids.project.invoicerApi },
    };
    return { ...m, assignments: [role === 'projectAdmin' ? projectRole : orgAssignment(db, m.userId, role, null)] };
  });
}

function signedInAs(db: MockDb, role: CallerRole): void {
  const state = db.state;
  state.memberships = [
    {
      userId: ids.user.alice,
      orgId: ids.org.alice,
      roleKey: role === 'projectAdmin' ? 'admin' : role,
      ...(role === 'projectAdmin' && { projectIds: [ids.project.invoicerApi] }),
    },
  ];
  state.auth = { signedIn: true, activeOrganizationId: ids.org.alice };
}

function seed(db: MockDb, role: CallerRole, base: MemberDto[]): void {
  signedInAs(db, role);
  db.state.members[ids.org.alice] = rosterFor(db, base, role);
}

const { soleOwner, twoOwners, paged25 } = tenantMemberFixtures;

const seeders: Record<TenantAdminScenario, (db: MockDb) => void> = {
  soleOwner: (db) => seed(db, 'owner', soleOwner),
  twoOwners: (db) => seed(db, 'owner', twoOwners),
  admin: (db) => seed(db, 'admin', twoOwners),
  projectAdmin: (db) => seed(db, 'projectAdmin', twoOwners),
  member: (db) => seed(db, 'member', twoOwners),
  viewer: (db) => seed(db, 'viewer', twoOwners),
  // After the first members list is read, B is gone (or a viewer): the page still shows the old row.
  memberRemovedMeanwhile(db) {
    seed(db, 'owner', twoOwners);
    db.state.tenantAdmin.afterFirstMembersList = { userId: B, change: 'remove' };
  },
  roleChangedMeanwhile(db) {
    seed(db, 'owner', twoOwners);
    db.state.tenantAdmin.afterFirstMembersList = { userId: B, change: 'viewer' };
  },
  membersError(db) {
    seed(db, 'owner', twoOwners);
    db.state.tenantAdmin.failuresLeft.members = FAILURES_TO_SHOW_ERROR;
  },
  membersSlow(db) {
    seed(db, 'owner', twoOwners);
    db.state.tenantAdmin.delayMs.members = SLOW_MS;
  },
  membersPaged: (db) => seed(db, 'owner', paged25),
  auditEmpty(db) {
    seed(db, 'owner', twoOwners);
    db.state.audit[ids.org.alice] = [];
  },
  auditError(db) {
    seed(db, 'owner', twoOwners);
    db.state.tenantAdmin.failuresLeft.audit = FAILURES_TO_SHOW_ERROR;
  },
  auditSlow(db) {
    seed(db, 'owner', twoOwners);
    db.state.tenantAdmin.delayMs.audit = SLOW_MS;
  },
  auditPaged(db) {
    seed(db, 'owner', twoOwners);
    db.state.audit[ids.org.alice] = pagedAuditFixtures(25);
  },
  // The owner's org has 25 accepted invitations (page size 20), so page 2 of the Accepted filter exists.
  invitationsManyAccepted(db) {
    seed(db, 'owner', twoOwners);
    const base = db.state.invitations.find((i) => i.orgId === ids.org.alice);
    if (!base) throw new Error('invitation fixture missing');
    for (let n = 1; n <= ACCEPTED_INVITATIONS; n += 1) {
      db.state.invitations.push({
        ...base,
        id: `b3300000-0000-4000-8000-${String(n).padStart(12, '0')}`,
        email: `accepted${n}@x.dev`,
        status: 'accepted',
        acceptedAt: SEEDED_AT,
        createdAt: new Date(Date.parse(SEEDED_AT) - n * 60_000).toISOString(),
      });
    }
  },
};

/** Resets the store and seeds it for `scenario`: who is signed in (always in the first org), the roster, the audit log. */
export function applyTenantAdminScenario(db: MockDb, scenario: TenantAdminScenario): void {
  db.reset();
  db.state.tenantAdmin = freshTenantAdmin();
  seeders[scenario](db);
}

// --- Store rules behind the routes ---

const state = (db: MockDb): MockState => db.state;

/** `:orgId` must be the active org; any other is a 404 (nothing of another org shows). */
export function requireActiveOrg(orgId: string, activeOrgId: string): void {
  if (orgId !== activeOrgId) throw notFound('Organization');
}

/** Holds the answer back and fails it with a 500 (and a request id) while a scenario asks for it. */
export async function gate(db: MockDb, list: 'members' | 'audit'): Promise<void> {
  const { delayMs, failuresLeft } = state(db).tenantAdmin;
  if (delayMs[list] > 0) await new Promise<void>((resolve) => setTimeout(resolve, delayMs[list]));
  if (failuresLeft[list] > 0) {
    failuresLeft[list] -= 1;
    throw new Problem({ status: 500, title: 'Internal server error', type: 'internal' });
  }
}

/** The page of members; the "meanwhile" scenarios change the data right after the first read. */
export function listMembers(db: MockDb, orgId: string, query: PageQuery): Page<MemberDto> {
  const s = state(db);
  const page = slicePage(structuredClone(s.members[orgId] ?? []), query);
  const hook = s.tenantAdmin.afterFirstMembersList;
  if (s.tenantAdmin.membersListReads === 0 && hook) {
    const roster = s.members[orgId] ?? [];
    if (hook.change === 'remove') {
      s.members[orgId] = roster.filter((m) => m.userId !== hook.userId);
    } else {
      const role = roleOfKey('viewer');
      s.members[orgId] = roster.map((m) =>
        m.userId === hook.userId
          ? {
              ...m,
              assignments: [
                ...m.assignments.filter((a) => a.scope.type !== 'org'),
                orgAssignment(db, m.userId, role.key, null, new Date().toISOString()),
              ],
            }
          : m,
      );
    }
  }
  s.tenantAdmin.membersListReads += 1;
  return page;
}

function callerIsOwner(db: MockDb, orgId: string, callerId: string): boolean {
  return state(db).memberships.some((m) => m.userId === callerId && m.orgId === orgId && m.roleKey === ORG_OWNER);
}

function targetOf(db: MockDb, orgId: string, userId: string): MemberDto {
  const target = (state(db).members[orgId] ?? []).find((m) => m.userId === userId);
  if (!target) throw new Problem({ status: 404, title: MEMBER_GONE, type: 'not-found' });
  return target;
}

const forbidden = () => new Problem({ status: 403, title: 'Forbidden', type: 'forbidden' });

/** Keeps the signed-in user's seat in step with their member row, so `me.access` follows a change. */
function syncSeat(db: MockDb, orgId: string, userId: string, roleKey: string | null): void {
  const seat = state(db).memberships.find((m) => m.userId === userId && m.orgId === orgId);
  if (seat) seat.roleKey = roleKey ?? NO_ROLE;
}

/**
 * `members.updateRole`: nobody changes their own role (403). Replaces the member's org-scope assignments with one of `roleId` (or none). Only an owner gives
 * or takes `owner`. The same role again is a 200 that changes nothing, after that owner check. The change may not leave the org with no owner.
 */
export function changeMemberRole(
  db: MockDb,
  caller: { userId: string; orgId: string },
  userId: string,
  roleId: string | null,
): MemberDto {
  // nobody changes their own role (403, before any lookup)
  if (userId === caller.userId) throw forbidden();
  const { orgId } = caller;
  const target = targetOf(db, orgId, userId);
  const role = roleId === null ? null : roleFixtures.find((r) => r.id === roleId);
  if (role === undefined || (role !== null && !role.assignableScopes.includes('org'))) {
    throw new Problem({
      status: 422,
      title: 'Role not allowed here',
      type: 'validation',
      errors: [{ pointer: '/roleId', detail: 'this role cannot be given at organization level' }],
    });
  }
  const current = orgRoleKey(target);
  const next = role?.key;
  const touchesOwner = current === ORG_OWNER || next === ORG_OWNER;
  if (touchesOwner && !callerIsOwner(db, orgId, caller.userId)) throw forbidden();
  // the same role is a no-op, but only after the owner check: an admin giving owner to an owner is 403
  if (current === next) return structuredClone(target);
  const roster = state(db).members[orgId] ?? [];
  if (current === ORG_OWNER && ownerCount(roster) <= 1) throw conflict(LAST_OWNER, []);
  target.assignments = [
    ...target.assignments.filter((a) => a.scope.type !== 'org'),
    ...(next === undefined ? [] : [orgAssignment(db, userId, next, caller.userId, new Date().toISOString())]),
  ];
  syncSeat(db, orgId, userId, next ?? null);
  return structuredClone(target);
}

/** `members.remove`: nobody removes themselves (403, before any lookup); only an owner removes an owner; never the last one. */
export function removeMember(db: MockDb, caller: { userId: string; orgId: string }, userId: string): null {
  if (userId === caller.userId) throw forbidden();
  const { orgId } = caller;
  const target = targetOf(db, orgId, userId);
  const isOwner = orgRoleKey(target) === ORG_OWNER;
  if (isOwner && !callerIsOwner(db, orgId, caller.userId)) throw forbidden();
  const roster = state(db).members[orgId] ?? [];
  if (isOwner && ownerCount(roster) <= 1) throw conflict(LAST_OWNER, []);
  state(db).members[orgId] = roster.filter((m) => m.userId !== userId);
  state(db).memberships = state(db).memberships.filter((m) => !(m.userId === userId && m.orgId === orgId));
  return null;
}

/** `orgs.update`: slugs stay unique (409 on `/slug`); the org list `/auth/organization/list` reads the same rows. */
export function updateOrg(
  db: MockDb,
  orgId: string,
  body: { name?: string | undefined; slug?: string | undefined },
): { id: string; name: string; slug: string } {
  const orgs = state(db).orgs;
  const org = orgs.find((o) => o.id === orgId);
  if (!org) throw notFound('Organization');
  if (body.slug !== undefined && body.slug !== org.slug && orgs.some((o) => o.slug === body.slug)) {
    throw conflict('Slug already in use', [{ pointer: '/slug', detail: 'this slug is already taken' }]);
  }
  org.name = body.name ?? org.name;
  org.slug = body.slug ?? org.slug;
  return { id: org.id, name: org.name, slug: org.slug };
}

/** `audit.list`: the org's entries, newest first (time, then id). */
export function listAudit(db: MockDb, orgId: string, query: PageQuery) {
  const entries = [...(state(db).audit[orgId] ?? [])].sort(
    (a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id),
  );
  return slicePage(entries, query);
}
