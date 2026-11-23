import {
  slicePage,
  type AuditEntryDto,
  type MemberDto,
  type Page,
  type PageQuery,
  type ProjectMemberDto,
  type RoleDto,
} from '@agentdesk/contracts';
import { z } from 'zod';
import { MAX_RETRIES } from '../../app/queryClient';
import { roleFixtures } from '../dto/access';
import { pagedProjectAuditFixtures } from '../dto/audit';
import { ids } from '../dto/ids';
import { pickerCandidateFixtures, projectMemberFixtures } from '../dto/projectMembers';
import { freshProjectSpace, freshTenantAdmin, type MockDb, type MockMembership, type MockUser } from './db';
import { Problem, conflict, notFound } from './http';
import { signedInAs } from './tenantAdminScenarios';

// The project-space mock scenarios and the store rules behind the project Members and Audit log routes (spec "Fakes and
// fixtures"). A spec picks a role and a scenario through sessionStorage (`PROJECT_SPACE_KEY`, written by
// e2e/mock/mock.ts `seedProjectSpace`); browser.ts reads it once when the worker starts. The permission guard has
// already run (handlers.ts, 403 before any lookup); the rules here follow it: the project exists (404), the caller's
// seat reaches it (404), then the store rules (422, 409, 404, 403 for yourself).

export const PROJECT_SPACE_KEY = 'agentdesk.mock.projectSpace';

export const PROJECT_SPACE_ROLES = ['owner', 'admin', 'projectAdmin', 'member', 'viewer'] as const;
export type ProjectSpaceRole = (typeof PROJECT_SPACE_ROLES)[number];

export const PROJECT_SPACE_SCENARIOS = [
  'membersEmpty',
  'membersError',
  'membersSlow',
  'membersPaged',
  'goneFromOrg',
  'roleRemovedMeanwhile',
  'roleAddedMeanwhile',
  'demotedMeanwhile',
  'pickerMany',
  'pickerError',
  'auditEmpty',
  'auditError',
  'auditSlow',
  'auditPaged',
] as const;
export type ProjectSpaceScenario = (typeof PROJECT_SPACE_SCENARIOS)[number];

const Stored = z.object({
  role: z.enum(PROJECT_SPACE_ROLES),
  scenario: z.enum(PROJECT_SPACE_SCENARIOS).optional(),
});

/** The stored `{ role, scenario? }`, or undefined for anything missing or unparsable. */
export function parseProjectSpace(
  raw: string | null,
): { role: ProjectSpaceRole; scenario?: ProjectSpaceScenario } | undefined {
  if (raw === null) return undefined;
  try {
    const parsed = Stored.safeParse(JSON.parse(raw));
    if (!parsed.success) return undefined;
    const { role, scenario } = parsed.data;
    return scenario === undefined ? { role } : { role, scenario };
  } catch {
    return undefined;
  }
}

const P = ids.project.invoicerApi;
const SLOW_MS = 1500;
/** An error scenario fails a list MAX_RETRIES + 1 times so the error state shows; the manual Retry then gets the list. */
const FAILURES_TO_SHOW_ERROR = MAX_RETRIES + 1;
const FIRST_CANDIDATES = 8;
const PAGED_MEMBERS = 25;
const CLEO = 'user-tenant-4';
const RAE = 'user-candidate-1';

const roleOfKey = (key: 'admin' | 'member' | 'viewer'): RoleDto => {
  const role = roleFixtures.find((r) => r.key === key);
  if (!role) throw new Error(`role fixture ${key} missing`);
  return role;
};
const roleRef = (role: RoleDto) => ({ id: role.id, key: role.key, name: role.name });

const forbidden = () => new Problem({ status: 403, title: 'Forbidden', type: 'forbidden' });
const unprocessable = (pointer: string, detail: string) =>
  new Problem({ status: 422, title: 'Validation failed', type: 'validation', errors: [{ pointer, detail }] });

// --- Scenario seeding ---

function pagedMembers(db: MockDb): ProjectMemberDto[] {
  const base = projectMemberFixtures[P] ?? [];
  const role = roleOfKey('member');
  const extra = Array.from({ length: PAGED_MEMBERS - base.length }, (_, i): ProjectMemberDto => ({
    userId: `user-paged-${i + 1}`,
    name: `Member ${String(i + 1).padStart(2, '0')}`,
    handle: `member${i + 1}`,
    projectRoles: [{ assignmentId: db.nextId(), role: roleRef(role) }],
  }));
  return [...structuredClone(base), ...extra];
}

/** The org roster: everyone with a role on P, then the people the Add picker offers. */
function rosterOf(db: MockDb, candidates: number): MemberDto[] {
  const seen = new Set<string>();
  const roster: MemberDto[] = [];
  for (const person of db.state.projectSpace.members[P] ?? []) {
    if (seen.has(person.userId)) continue;
    seen.add(person.userId);
    roster.push({ userId: person.userId, handle: person.handle, name: person.name, assignments: [] });
  }
  roster.push(...structuredClone(pickerCandidateFixtures.slice(0, candidates)));
  return roster;
}

/** Resets the store and seeds it for `role` (and `scenario`): who is signed in, P's people and audit, the org roster. */
export function applyProjectSpace(db: MockDb, opts: { role: ProjectSpaceRole; scenario?: ProjectSpaceScenario }): void {
  db.reset();
  const s = db.state;
  s.tenantAdmin = freshTenantAdmin();
  s.projectSpace = freshProjectSpace();
  const space = s.projectSpace;
  signedInAs(db, opts.role);
  let candidates = FIRST_CANDIDATES;
  switch (opts.scenario) {
    case 'membersEmpty':
      space.members[P] = [];
      break;
    case 'membersError':
      space.failuresLeft.members = FAILURES_TO_SHOW_ERROR;
      break;
    case 'membersSlow':
      space.delayMs.members = SLOW_MS;
      break;
    case 'membersPaged':
      space.members[P] = pagedMembers(db);
      break;
    case 'goneFromOrg':
      space.goneUserIds = [RAE];
      break;
    case 'roleRemovedMeanwhile':
      space.meanwhile = 'roleRemoved';
      break;
    case 'roleAddedMeanwhile':
      space.meanwhile = 'roleAdded';
      break;
    case 'demotedMeanwhile':
      space.meanwhile = 'demoted';
      break;
    case 'pickerMany':
      candidates = pickerCandidateFixtures.length;
      break;
    case 'pickerError':
      space.failuresLeft.picker = FAILURES_TO_SHOW_ERROR;
      break;
    case 'auditEmpty':
      space.audit[P] = [];
      break;
    case 'auditError':
      space.failuresLeft.audit = FAILURES_TO_SHOW_ERROR;
      break;
    case 'auditSlow':
      space.delayMs.audit = SLOW_MS;
      break;
    case 'auditPaged':
      space.audit[P] = structuredClone(pagedProjectAuditFixtures);
      break;
    case undefined:
      break;
  }
  s.members[ids.org.alice] = rosterOf(db, candidates);
}

// --- Store rules behind the routes ---

/** A project the caller's seat does not reach is a 404, as if it did not exist. */
export function requireProjectScope(db: MockDb, userId: string, orgId: string, projectId: string): void {
  const seat = db.state.memberships.find((m) => m.userId === userId && m.orgId === orgId);
  if (seat?.projectIds && !seat.projectIds.includes(projectId)) throw notFound('Project');
}

async function gate(db: MockDb, list: 'members' | 'audit'): Promise<void> {
  const { delayMs, failuresLeft } = db.state.projectSpace;
  if (delayMs[list] > 0) await new Promise<void>((resolve) => setTimeout(resolve, delayMs[list]));
  if (failuresLeft[list] > 0) {
    failuresLeft[list] -= 1;
    throw new Problem({ status: 500, title: 'Internal server error', type: 'internal' });
  }
}

const seatOf = (db: MockDb, userId: string, orgId: string): MockMembership | undefined =>
  db.state.memberships.find((m) => m.userId === userId && m.orgId === orgId);

function personOf(db: MockDb, who: Pick<MemberDto, 'userId' | 'name' | 'handle'>, role: RoleDto): ProjectMemberDto {
  return {
    userId: who.userId,
    name: who.name,
    handle: who.handle,
    projectRoles: [{ assignmentId: db.nextId(), role: roleRef(role) }],
  };
}

/** After the first project list is read, a person's role is removed under the open page. */
function applyAfterFirstList(db: MockDb, projectId: string): void {
  const space = db.state.projectSpace;
  if (space.listReads === 0 && space.meanwhile === 'roleRemoved') {
    space.members[projectId] = (space.members[projectId] ?? []).filter((m) => m.userId !== CLEO);
  }
  space.listReads += 1;
}

/**
 * After the first Add-dialog picker read (the person is already on screen), someone else gives that person a role on P
 * (`roleAdded`) or the caller is demoted to a member seat (`demoted`).
 */
export function applyAfterFirstPicker(db: MockDb, caller: { userId: string; orgId: string }, projectId: string): void {
  const space = db.state.projectSpace;
  const hook = space.meanwhile;
  if (space.pickerReads === 0) {
    if (hook === 'roleAdded') {
      const rae = db.state.members[caller.orgId]?.find((m) => m.userId === RAE);
      if (rae) space.members[projectId] = [...(space.members[projectId] ?? []), personOf(db, rae, roleOfKey('member'))];
    } else if (hook === 'demoted') {
      const seat = seatOf(db, caller.userId, caller.orgId);
      if (seat) {
        seat.roleKey = 'member';
        delete seat.projectIds;
      }
    }
  }
  space.pickerReads += 1;
}

/** `projectMembers.list`: P's people in the order they were added. */
export async function listProjectMembers(
  db: MockDb,
  projectId: string,
  query: PageQuery,
): Promise<Page<ProjectMemberDto>> {
  await gate(db, 'members');
  const page = slicePage(structuredClone(db.state.projectSpace.members[projectId] ?? []), query);
  applyAfterFirstList(db, projectId);
  return page;
}

/** The picker (`members.list` with `excludeProject`) fails while a scenario asks for it. */
export function checkPickerFailure(db: MockDb): void {
  const left = db.state.projectSpace.failuresLeft;
  if (left.picker > 0) {
    left.picker -= 1;
    throw new Problem({ status: 500, title: 'Internal server error', type: 'internal' });
  }
}

/** Who stays in the picker: not on `excludeProject`, and the name or handle holds `q` (a literal match, any case). */
export function pickerFilter(
  db: MockDb,
  filter: { q?: string | undefined; excludeProject?: string | undefined },
): (m: MemberDto) => boolean {
  const needle = filter.q?.toLowerCase();
  const onProject = new Set(
    filter.excludeProject === undefined
      ? []
      : (db.state.projectSpace.members[filter.excludeProject] ?? []).map((m) => m.userId),
  );
  return (m) =>
    !onProject.has(m.userId) &&
    (needle === undefined ||
      m.name.toLowerCase().includes(needle) ||
      (m.handle?.toLowerCase().includes(needle) ?? false));
}

function record(
  db: MockDb,
  actor: MockUser,
  projectId: string,
  entry: Pick<AuditEntryDto, 'action' | 'changes'> & { target: { userId: string; name: string } },
): void {
  const log = (db.state.projectSpace.audit[projectId] ??= []);
  log.unshift({
    id: db.nextId(),
    at: new Date().toISOString(),
    actor: { userId: actor.id, name: actor.name, handle: actor.handle },
    actorKind: 'member',
    action: entry.action,
    target: { type: 'user', id: entry.target.userId, label: entry.target.name },
    changes: entry.changes,
    projects: [],
  });
}

function projectRoleOf(roleId: string): RoleDto {
  const role = roleFixtures.find((r) => r.id === roleId);
  if (!role?.assignableScopes.includes('project')) {
    throw unprocessable('/roleId', 'this role cannot be given at project level');
  }
  return role;
}

/** The role names a person holds on a project, each once, as the API's audit "from" text. */
const roleNames = (m: ProjectMemberDto): string => [...new Set(m.projectRoles.map((r) => r.role.name))].join(', ');
const rowsOf = (db: MockDb, projectId: string): ProjectMemberDto[] => db.state.projectSpace.members[projectId] ?? [];
const rowOf = (db: MockDb, projectId: string, userId: string): ProjectMemberDto | undefined =>
  rowsOf(db, projectId).find((m) => m.userId === userId);

/** `projectMembers.add`: an org member with no role on P gets one (409 for any role, 422 for a stranger or a bad role). */
export function addProjectMember(
  db: MockDb,
  actor: MockUser,
  orgId: string,
  projectId: string,
  body: { userId: string; roleId: string },
): ProjectMemberDto {
  const role = projectRoleOf(body.roleId);
  const space = db.state.projectSpace;
  const roster = db.state.members[orgId] ?? [];
  const who = roster.find((m) => m.userId === body.userId);
  if (space.goneUserIds.includes(body.userId)) {
    db.state.members[orgId] = roster.filter((m) => m.userId !== body.userId);
    throw unprocessable('/userId', 'this person is no longer in the organization');
  }
  if (!who) throw unprocessable('/userId', 'this person is not in the organization');
  if (rowOf(db, projectId, body.userId)) throw conflict('This person already has a role on this project', []);
  const added = personOf(db, who, role);
  space.members[projectId] = [...rowsOf(db, projectId), added];
  record(db, actor, projectId, {
    action: 'assignment.granted',
    target: who,
    changes: [{ field: 'role', from: null, to: role.name }],
  });
  return structuredClone(added);
}

/** `projectMembers.setRole`: one row of the new role replaces the person's rows on P; the same role writes nothing. */
export function setProjectRole(
  db: MockDb,
  actor: MockUser,
  projectId: string,
  userId: string,
  roleId: string,
): ProjectMemberDto {
  const current = rowOf(db, projectId, userId);
  if (!current) throw notFound('Project member');
  const role = projectRoleOf(roleId);
  const same = current.projectRoles.length === 1 && current.projectRoles[0]?.role.id === role.id;
  if (same) return structuredClone(current);
  const from = roleNames(current);
  current.projectRoles = [{ assignmentId: db.nextId(), role: roleRef(role) }];
  record(db, actor, projectId, {
    action: 'project_member.role_changed',
    target: current,
    changes: [{ field: 'role', from, to: role.name }],
  });
  return structuredClone(current);
}

/** `projectMembers.remove`: nobody removes themselves (403, before any lookup); a person with no row is 404. */
export function removeProjectMember(db: MockDb, actor: MockUser, projectId: string, userId: string): null {
  if (userId === actor.id) throw forbidden();
  const current = rowOf(db, projectId, userId);
  if (!current) throw notFound('Project member');
  db.state.projectSpace.members[projectId] = rowsOf(db, projectId).filter((m) => m.userId !== userId);
  record(db, actor, projectId, {
    action: 'project_member.removed',
    target: current,
    changes: [{ field: 'role', from: roleNames(current), to: null }],
  });
  return null;
}

/** `projects.audit`: the entries tagged P, newest first (time, then id). */
export async function listProjectAudit(db: MockDb, projectId: string, query: PageQuery): Promise<Page<AuditEntryDto>> {
  await gate(db, 'audit');
  const entries = [...(db.state.projectSpace.audit[projectId] ?? [])].sort(
    (a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id),
  );
  return slicePage(entries, query);
}
