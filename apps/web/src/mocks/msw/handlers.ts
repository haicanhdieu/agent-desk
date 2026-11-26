import {
  ACTIVE_RUN_STATUSES,
  INVITATION_EXPIRY_SECONDS,
  ORG_HEADER,
  ORG_MISMATCH_PROBLEM_TYPE,
  ORG_SUSPENDED_PROBLEM_TYPE,
  PROVIDER_REAUTH_REQUIRED_PROBLEM_TYPE,
  PROVIDER_UNAVAILABLE_PROBLEM_TYPE,
  can,
  holdsAnywhere,
  routeAccess,
  type AccessDto,
  type CreateInvitationRequest,
  type InvitationDto,
  type InvitationListStatus,
  type MyInvitationDto,
  type PermissionLineDto,
  canResume,
  FINISHABLE_RUN_STATUSES,
  STOPPABLE_RUN_STATUSES,
  type RouteDef,
  type RuleDto,
  FINAL_RUN_STATUSES,
  ENV_CAP_DETAIL_PREFIX,
  ENV_MAX_TOTAL_BYTES,
  ENV_SIZE_DETAIL_PREFIX,
  type EnvEntryDto,
  type EnvKind,
  slicePage,
  type LinkedTicketDto,
  type ProjectConnectionDto,
  type ProjectDto,
  type RunDto,
  type RunListFilter,
  type RunStatus,
  type RunUsageDetail,
  type RunUsageSummary,
  type SetupScriptDto,
  type SetupTestDto,
  type SkillChangeResponse,
  type SkillDto,
} from '@agentdesk/contracts';
import { delay, http, type HttpHandler } from 'msw';
import { authHandlers } from './auth-handlers';
import { agentModelsAnswer } from './agentModels';
import {
  agentsOf,
  checkCredential,
  checklistOf,
  createAgent,
  refuseUnknownProvider,
  removeAgent,
  setDefaultAgent,
  testAgent,
  updateAgent,
} from './agentsApi';
import { PR_STATES_SLOW_MS, prStateItems } from './prStates';
import type { MockRun } from '../dto/runs';
import { assignmentFixtures, roleFixtures } from '../dto/access';
import { checklistFixtures } from '../dto/invitations';
import { promptPreviewFixture } from '../dto/rules';
import { slowActionRuns, transcriptBehaviours } from '../dto/sessionRuns';
import { noPlugins } from '../dto/setup';
import { NO_ROLE, defaultTriggerState, mockDb, type InvitationRow, type MockUser, type ProjectRow } from './db';
import {
  Problem,
  WithStatus,
  conflict,
  fieldErrors,
  flatRoutes,
  invalid,
  jsonResponse,
  notFound,
  problemResponse,
  routeDef,
  routeHandler,
  type ResponseOf,
  type RouteCtx,
  type RouteKey,
} from './http';
import { grantPlatformAdmin, listPlatformAdmins, revokePlatformAdmin } from './platformAdmins';
import { listPlatformAudit } from './platformAudit';
import {
  addPlatformOrg,
  createPlatformAssignment,
  getPlatformOrg,
  isPlatformOrg,
  listPlatformMembers,
  listPlatformOrgs,
  listPlatformProjects,
  listPlatformRoles,
  removePlatformAssignment,
  setPlatformOrgStatus,
  updatePlatformOrg,
} from './platformOrgs';
import { linkedTicketsFor, toDto } from './linkedTickets';
import {
  changeMemberRole,
  createAssignment,
  deleteAssignment,
  gate,
  listAudit,
  listMembers,
  removeMember,
  requireActiveOrg,
  updateOrg,
} from './tenantAdminScenarios';
import {
  addProjectMember,
  checkPickerFailure,
  listProjectAudit,
  applyAfterFirstPicker,
  listProjectMembers,
  pickerFilter,
  removeProjectMember,
  requireProjectScope,
  setProjectRole,
} from './projectSpaceScenarios';
import { appendRunEvent, endSetupTest, rememberSetupTestScript, scriptRun, setRunStatus } from './live';

// One handler per contracts route, implementing list/get/create/update/delete over the in-memory store. Every
// handler requires a session (401 otherwise), scopes reads to the active org (another org's record is a 404, as
// RLS hides it), validates params/query/body with the route's schemas (400 with JSON Pointers) and parses its
// response through the route's response schema.

const now = () => new Date().toISOString();
const isFinal = (s: RunStatus) => FINAL_RUN_STATUSES.some((f) => f === s);
const isActive = (s: RunStatus) => ACTIVE_RUN_STATUSES.some((a) => a === s);

/** The routes whose access kind pins them to the session's org (`user` and `platform` routes ignore the header). */
const isOrgPinned = (key: RouteKey): boolean => {
  const scope = routeAccess[key].scope;
  return scope !== 'user' && scope !== 'platform';
};

/** The signed-in user (401 otherwise); `user` and `platform` routes need no active org. */
function sessionUser(): MockUser {
  const user = mockDb.currentUser();
  if (!user) throw new Problem({ status: 401, title: 'Unauthorized', type: 'unauthorized' });
  return user;
}

const db = () => mockDb.state;

function session(): { user: MockUser; orgId: string } {
  const user = sessionUser();
  const orgId = mockDb.auth.activeOrganizationId;
  if (!orgId) throw new Problem({ status: 403, title: 'No active organization', type: 'forbidden' });
  const seat = db().memberships.find((m) => m.userId === user.id && m.orgId === orgId);
  if (seat?.roleKey === NO_ROLE) throw new Problem({ status: 403, title: 'Forbidden', type: 'forbidden' });
  return { user, orgId };
}

/** `me.access`: the user's seat in the active org as grants (one per project for a project seat), none without a seat. */
function accessOf(user: MockUser): AccessDto {
  const orgId = mockDb.auth.activeOrganizationId;
  const seat = db().memberships.find((m) => m.userId === user.id && m.orgId === orgId);
  const role = roleFixtures.find((r) => r.key === seat?.roleKey);
  const assignments =
    !seat || !role
      ? []
      : (seat.projectIds ?? [undefined]).map((projectId) => ({
          roleKey: role.key,
          scope: projectId === undefined ? ({ type: 'org' } as const) : ({ type: 'project', projectId } as const),
          permissions: role.permissions,
        }));
  return { userId: user.id, platformAdmin: user.platformAdmin, assignments };
}

/**
 * What the API guard decides before any id is looked up (apps/api access/authorize.ts): the route's permission must be
 * held somewhere (org scope for an org-level one), else 403. Targets are not resolved here, so own-run and out-of-scope
 * checks are left to the handlers. Keeps the mock as strict as the API for roles with fewer permissions.
 */
function requireRouteAccess(key: RouteKey, user: MockUser): void {
  const entry = routeAccess[key];
  const access = {
    userId: user.id,
    grants: accessOf(user).assignments.map((a) => ({
      roleId: a.roleKey,
      roleKey: a.roleKey,
      scope: a.scope,
      lines: a.permissions,
    })),
  };
  let allowed = true;
  switch (entry.scope) {
    case 'org':
      allowed = holdsAnywhere(access, entry.permission) && can(access, entry.permission);
      break;
    case 'project':
    case 'project-list':
      allowed = holdsAnywhere(access, entry.permission);
      break;
    case 'org-admin':
      allowed = entry.anyOf.some((p) => holdsAnywhere(access, p));
      break;
    default:
      break;
  }
  if (!allowed) throw new Problem({ status: 403, title: 'Forbidden', type: 'forbidden' });
}

type Answer<T> = T | WithStatus<T>;

// Invitations follow the API rules: lists by effective status, one pending row per (org, email), a 2 day lifetime, and
// an invitee who is not the invited email sees a 404.

const effectiveStatus = (row: InvitationRow): InvitationDto['status'] =>
  row.status === 'pending' && Date.parse(row.expiresAt) <= Date.now() ? 'expired' : row.status;

const toInvitationDto = (row: InvitationRow): InvitationDto => ({
  id: row.id,
  email: row.email,
  role: row.role,
  scope: row.scope,
  status: effectiveStatus(row),
  expiresAt: row.expiresAt,
  invitedBy: row.invitedBy,
  createdAt: row.createdAt,
  acceptedAt: row.acceptedAt,
});

const expiryFromNow = () => new Date(Date.now() + INVITATION_EXPIRY_SECONDS * 1000).toISOString();

function listInvitations(orgId: string, query: { status: InvitationListStatus; page: number; pageSize: number }) {
  const rows = db()
    .invitations.filter((i) => i.orgId === orgId && (query.status === 'all' || effectiveStatus(i) === query.status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  return slicePage(rows.map(toInvitationDto), query);
}

const invitationOf = (orgId: string, id: string): InvitationRow => {
  const row = db().invitations.find((i) => i.orgId === orgId && i.id === id);
  if (!row) throw notFound('Invitation');
  return row;
};

const hasPendingFor = (orgId: string, email: string, except?: string): boolean =>
  db().invitations.some(
    (i) => i.orgId === orgId && i.email === email && i.id !== except && effectiveStatus(i) === 'pending',
  );

const alreadyInvited = () =>
  conflict('Email already invited', [{ pointer: '/email', detail: 'This email already has a pending invitation.' }]);

// As the API: a role or project the org cannot use is 422 with the JSON Pointer of the offending field.
const badRole = () =>
  new Problem({
    status: 422,
    title: 'Role not allowed here',
    type: 'validation',
    errors: [
      { pointer: '/roleId', detail: 'this role does not exist in the organization or cannot be given at this scope' },
    ],
  });
const unknownProject = (index: number) =>
  new Problem({
    status: 422,
    title: 'Project not found',
    type: 'validation',
    errors: [{ pointer: `/scope/projectIds/${index}`, detail: 'this project does not exist in the organization' }],
  });

function createInvitation(orgId: string, body: CreateInvitationRequest): InvitationDto {
  // The platform route has no active org (BR-34/35); the org is the one in the path.
  const user = sessionUser();
  if (db().failNextOrgInvitationCreate) {
    db().failNextOrgInvitationCreate = false;
    throw new Problem({ status: 500, title: 'Internal server error', type: 'internal' });
  }
  const role = roleFixtures.find((r) => r.id === body.roleId);
  if (!role || !role.assignableScopes.some((s) => s === body.scope.type)) throw badRole();
  const projects =
    body.scope.type === 'project'
      ? body.scope.projectIds.map((id, index) => {
          const project = db().projects.find((p) => p.id === id);
          if (!project) throw unknownProject(index);
          return { id, name: project.name };
        })
      : [];
  const isMember = db().memberships.some(
    (m) => m.orgId === orgId && db().users.some((u) => u.id === m.userId && u.email.toLowerCase() === body.email),
  );
  if (isMember) {
    throw conflict('Already a member', [{ pointer: '/email', detail: 'This email is already a member.' }]);
  }
  if (hasPendingFor(orgId, body.email)) throw alreadyInvited();
  const row: InvitationRow = {
    id: mockDb.nextId(),
    orgId,
    email: body.email,
    role: { id: role.id, key: role.key, name: role.name },
    scope: body.scope.type === 'org' ? { type: 'org' } : { type: 'project', projects },
    status: 'pending',
    expiresAt: expiryFromNow(),
    invitedBy: { name: user.name, handle: user.handle },
    createdAt: now(),
    acceptedAt: null,
  };
  db().invitations.push(row);
  return toInvitationDto(row);
}

// The API's revoke says "not pending"; resend keeps the spec's "no longer pending".
const notPending = () => conflict('Invitation is no longer pending');
// Accept and decline as the API: the 409 detail carries the effective status (accepted, declined, revoked, expired).
const notPendingStatus = (status: InvitationDto['status']) =>
  conflict('Conflict', undefined, `Invitation is ${status}`);

// The platform routes name the org in the path; as the API, an org that does not exist is a 404. An org the platform
// directory lists exists even when the mock store holds no seat for it.
const requireOrg = (orgId: string): string => {
  if (!db().orgs.some((o) => o.id === orgId) && !isPlatformOrg(orgId)) throw notFound('Organization');
  return orgId;
};
const actorOf = (u: MockUser) => ({ userId: u.id, name: u.name, handle: u.handle ?? null });
const revokeNotPending = () => conflict('Invitation is not pending', []);

function revokeInvitation(orgId: string, id: string): null {
  const row = invitationOf(orgId, id);
  if (effectiveStatus(row) !== 'pending') throw revokeNotPending();
  row.status = 'revoked';
  return null;
}

function resendInvitation(orgId: string, id: string): InvitationDto {
  const row = invitationOf(orgId, id);
  const status = effectiveStatus(row);
  if (status !== 'pending' && status !== 'expired') throw notPending();
  if (hasPendingFor(orgId, row.email, row.id)) throw alreadyInvited();
  row.status = 'pending';
  row.expiresAt = expiryFromNow();
  return toInvitationDto(row);
}

/** The signed-in user's invitations: only rows for their own email, whatever the org. */
function myInvitationRows(): InvitationRow[] {
  const user = sessionUser();
  // An unverified email owns no invitation: the list is empty and any id is a 404.
  if (!user.emailVerified) return [];
  return db().invitations.filter((i) => i.email === user.email.toLowerCase());
}

function myInvitationRow(id: string): InvitationRow {
  const row = myInvitationRows().find((i) => i.id === id);
  if (!row) throw notFound('Invitation');
  return row;
}

function pendingOfMine(id: string): InvitationRow {
  const row = myInvitationRow(id);
  const status = effectiveStatus(row);
  if (status !== 'pending') throw notPendingStatus(status);
  return row;
}

function toMyInvitation(row: InvitationRow): MyInvitationDto {
  const org = db().orgs.find((o) => o.id === row.orgId);
  if (!org) throw notFound('Invitation');
  return {
    id: row.id,
    org: { id: org.id, name: org.name, slug: org.slug },
    role: { key: row.role.key, name: row.role.name },
    scope: row.scope,
    invitedBy: row.invitedBy,
    expiresAt: row.expiresAt,
    status: effectiveStatus(row),
  };
}

const SLOW_MS = 3_000;
const slow = () => new Promise<void>((resolve) => setTimeout(resolve, SLOW_MS));
/** Transcript requests that already failed once in this page load (failOnce); a reset starts over. */
const failedOnce = new Set<number>();
mockDb.onReset(() => failedOnce.clear());

function projectRow(projectId: string): ProjectRow {
  const { orgId } = session();
  const row = db().projects.find((p) => p.id === projectId && p.orgId === orgId);
  if (!row) throw notFound('Project');
  return row;
}

/** The project exists in the active org and the caller's seat reaches it; anything else is a 404. */
function projectInScope(projectId: string): { user: MockUser; orgId: string } {
  const { user, orgId } = session();
  projectRow(projectId);
  requireProjectScope(mockDb, user.id, orgId, projectId);
  return { user, orgId };
}

const forbiddenProblem = () => new Problem({ status: 403, title: 'Forbidden', type: 'forbidden' });

/** Whether the user's seat holds `permission` on `projectId` (an org seat holds it everywhere). */
function canOnProject(user: MockUser, permission: PermissionLineDto['permission'], projectId: string): boolean {
  const grants = accessOf(user).assignments.map((a) => ({
    roleId: a.roleKey,
    roleKey: a.roleKey,
    scope: a.scope,
    lines: a.permissions,
  }));
  return can({ userId: user.id, grants }, permission, { projectId });
}

function toProjectDto(row: ProjectRow): ProjectDto {
  const runs = db().runs.filter((r) => r.projectId === row.id);
  const lastRunAt = runs.reduce<string | null>((max, r) => (max === null || r.queuedAt > max ? r.queuedAt : max), null);
  // `orgId` rides along; the response schema strips it.
  return {
    ...row,
    counts: {
      needsYou: runs.filter((r) => r.status === 'idle' || r.status === 'paused').length,
      // As the API counts them: live jobs, idle included; a paused run has no pod, so it is in needsYou only.
      running: runs.filter((r) => isActive(r.status)).length,
      queued: runs.filter((r) => r.status === 'queued').length,
    },
    lastRunAt,
  };
}

function connectionDto(row: ProjectRow): ProjectConnectionDto {
  const trig = db().triggers[row.id] ?? defaultTriggerState();
  return {
    mode: row.triggerMode,
    webhook: row.triggerMode === 'webhook' ? trig.webhook : null,
    polling: row.triggerMode === 'polling' ? { intervalSeconds: row.pollIntervalSeconds, ...trig.polling } : null,
  };
}

function agentOf(projectId: string) {
  const agent = db().agents.find((a) => a.projectId === projectId);
  if (!agent) throw notFound('Agent');
  return agent;
}

function skillsOf(projectId: string): SkillDto[] {
  const list = db().skills[projectId] ?? [];
  db().skills[projectId] = list;
  return list;
}

function skillOf(projectId: string, name: string): SkillDto {
  const skill = skillsOf(projectId).find((s) => s.name === name);
  if (!skill) throw notFound('Skill');
  return skill;
}

/** An agent of a project the caller can see; anything else is a 404. */
function agentInScope(agentId: string) {
  const agent = db().agents.find((a) => a.id === agentId);
  if (!agent) throw notFound('Agent');
  projectRow(agent.projectId);
  return agent;
}

function ruleOf(ruleId: string) {
  const rule = db().rules.find((r) => r.id === ruleId);
  if (!rule) throw notFound('Rule');
  projectRow(rule.projectId);
  return rule;
}

function assertUniqueCommand(projectId: string, command: string, exceptId?: string) {
  if (db().rules.some((r) => r.projectId === projectId && r.command === command && r.id !== exceptId)) {
    throw conflict('Rule already exists', [
      { pointer: '/command', detail: `A rule for /${command} already exists in this project.` },
    ]);
  }
}

/** As the API: a list item carries the usage totals only, without the per-model split, dates or source. */
const usageSummary = (detail: RunUsageDetail): RunUsageSummary => ({
  inputTokens: detail.inputTokens,
  cacheReadTokens: detail.cacheReadTokens,
  cacheWriteTokens: detail.cacheWriteTokens,
  outputTokens: detail.outputTokens,
  reasoningTokens: detail.reasoningTokens,
  totalInputTokens: detail.totalInputTokens,
  totalTokens: detail.totalTokens,
  modelCount: detail.modelCount,
  estimatedCostUsd: detail.estimatedCostUsd,
  partial: detail.partial,
});

/** As the API: a list item carries how many runs its ticket has had in the project, all statuses. */
const withTicketRunCount = (
  run: MockRun,
): Omit<RunDto, 'usage'> & {
  usage: RunUsageSummary | null;
  ticketRunCount: number;
  linkedTickets: LinkedTicketDto[];
} => {
  const projectRuns = db().runs.filter((r) => r.projectId === run.projectId);
  const dto = toDto(run);
  return {
    ...dto,
    usage: dto.usage ? usageSummary(dto.usage) : null,
    linkedTickets: linkedTicketsFor(run, projectRuns),
    ticketRunCount: projectRuns.filter((r) => r.ticket.ref === run.ticket.ref).length,
  };
};

function runOf(runId: string): MockRun {
  const run = db().runs.find((r) => r.id === runId);
  if (!run) throw notFound('Run');
  projectRow(run.projectId);
  return run;
}

/** As the API: a run carries its project's idle end and paused keep time, so a Limits edit shows on the run screens. */
const withAgentIdleEnd = (run: MockRun): MockRun => {
  const project = db().projects.find((p) => p.id === run.projectId);
  return project
    ? { ...run, idleEndSeconds: project.idleEndSeconds, pausedKeepSeconds: project.pausedKeepSeconds }
    : run;
};

/** How long the mock keeps a succeeded run's session after a close: the agent's default done keep time (1 day). */
const DONE_KEEP_MS = 86_400_000;
/** Runs resumed from a paused session: a Finish on them ends the run for good (the worker's rule, ADR 0030). */
const resumedFromPause = new WeakSet<RunDto>();
/** The API's answer to Cancel, Stop and Finish while a succeeded run's session is reopened. */
const REOPENED_ONLY_CLOSE = 'This session is reopened; the run has already succeeded. Close the session instead';

/** Ends the run now; open event streams see the note and the status (live.ts). */
function endRun(run: RunDto, status: 'succeeded' | 'cancelled', note: string) {
  run.finishedAt = now();
  run.exitCode = status === 'succeeded' ? 0 : null;
  appendRunEvent(run, 'lifecycle', { text: note });
  setRunStatus(run, status);
}

/** As the API's `q`: a number matches exactly (run number, ticket number or reference); text is a case-insensitive
 *  substring of the command, login, title, reference or a label, on the run's ticket or any ticket linked to it. */
function matchesSearch(run: MockRun, projectRuns: readonly MockRun[], q: string | undefined): boolean {
  const text = q?.trim();
  if (text === undefined || text === '') return true;
  const digits = /^#?(\d{1,9})$/.exec(text)?.[1];
  const tickets: { ref: string; number: number; title: string; labels: { name: string }[] }[] = [
    run.ticket,
    ...linkedTicketsFor(run, projectRuns),
  ];
  if (digits !== undefined) {
    return run.number === Number(digits) || tickets.some((t) => t.number === Number(digits) || t.ref === digits);
  }
  const has = (v: string | null | undefined, needle: string) => (v ?? '').toLowerCase().includes(needle.toLowerCase());
  const command = text.replace(/^\/+/, '');
  return (
    (command !== '' && has(run.command, command)) ||
    has(run.triggeredBy, text) ||
    tickets.some((t) => has(t.title, text) || has(t.ref, text) || t.labels.some((l) => has(l.name, text)))
  );
}

const matchesFilter = (filter: RunListFilter | undefined, s: RunStatus): boolean => {
  switch (filter) {
    case 'needs_you':
      // As the API: idle and paused runs, the same rule as the project's needsYou count (toProjectDto).
      return s === 'idle' || s === 'paused';
    case 'active':
      return isActive(s);
    case 'queued':
      return s === 'queued';
    case 'ended':
      return isFinal(s);
    default:
      return true;
  }
};

/** First `description:` line of a SKILL.md frontmatter. */
const descriptionOf = (body: string) => /^description:\s*(.+)$/m.exec(body)?.[1]?.trim() ?? '';

let commits = 0;
const nextSha = () => {
  commits += 1;
  return `c0ffee${String(commits).padStart(34, '0')}`;
};

/** What a skill change answers when the default branch needs review: a pending change request, nothing written. */
function changeRequestFor(
  project: ProjectRow,
  action: 'create' | 'update' | 'delete',
  name: string,
): SkillChangeResponse {
  commits += 1;
  return {
    kind: 'change_request',
    sourceBranch: `agent-desk/skill-${action}-${name}-${commits}`,
    targetBranch: project.defaultBranch ?? 'main',
    url: `https://example.com/${project.repoPath}/pull/${commits}`,
    id: String(commits),
  };
}

/** Saved setup script versions of a project, oldest first (part of the mock store, so a reset clears them). */
const setupVersionsOf = (projectId: string): SetupScriptDto[] => db().setupScripts[projectId] ?? [];
const findSetupTest = (id: string): SetupTestDto | undefined => db().setupTests.find((t) => t.id === id);

// Project environment helpers. The caps are the API's: 500 entries by default and 256 KiB of names and values. The
// mock keeps no secret value, so its size check counts the names of both kinds and the values of variables only.
const ENV_MAX_ENTRIES = 500;
const envEntriesOf = (projectId: string): EnvEntryDto[] => db().environment[projectId] ?? [];
/** Byte order of the name (names are ASCII), as the API's `COLLATE "C"`. */
const byName = (a: EnvEntryDto, b: EnvEntryDto): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const byteLength = (s: string): number => new TextEncoder().encode(s).length;
const envBytes = (e: EnvEntryDto): number => byteLength(e.name) + byteLength(e.value ?? '');

function assertEnvRoom(list: EnvEntryDto[], change: { addEntry: boolean; deltaBytes: number }): void {
  if (change.addEntry && list.length >= ENV_MAX_ENTRIES) {
    throw new Problem({
      status: 409,
      title: 'Conflict',
      type: 'conflict',
      detail: `${ENV_CAP_DETAIL_PREFIX}${ENV_MAX_ENTRIES} environment entries.`,
    });
  }
  const used = list.reduce((sum, e) => sum + envBytes(e), 0);
  if (change.deltaBytes > 0 && used + change.deltaBytes > ENV_MAX_TOTAL_BYTES) {
    throw new Problem({
      status: 409,
      title: 'Conflict',
      type: 'conflict',
      detail: `${ENV_SIZE_DETAIL_PREFIX}${ENV_MAX_TOTAL_BYTES} bytes (256 KiB) per project.`,
    });
  }
}

function createEnvEntry(projectParam: string, kind: EnvKind, name: string, value: string): EnvEntryDto {
  const projectId = projectRow(projectParam).id;
  const list = envEntriesOf(projectId);
  if (list.some((e) => e.name === name)) {
    const detail = `${name} already exists. A name can be used once, as a variable or a secret.`;
    throw conflict('Name already exists', [{ pointer: '/name', detail }], detail);
  }
  const entry: EnvEntryDto = {
    name,
    kind,
    value: kind === 'plain' ? value : null,
    updatedAt: now(),
    updatedBy: session().user.handle,
  };
  assertEnvRoom(list, { addEntry: true, deltaBytes: envBytes(entry) });
  db().environment[projectId] = [...list, entry];
  return entry;
}

function updateEnvEntry(projectParam: string, kind: EnvKind, name: string, value: string): EnvEntryDto {
  const projectId = projectRow(projectParam).id;
  const list = envEntriesOf(projectId);
  const current = list.find((e) => e.name === name && e.kind === kind);
  if (!current) throw notFound(kind === 'plain' ? 'Variable' : 'Secret');
  const next: EnvEntryDto = {
    ...current,
    value: kind === 'plain' ? value : null,
    updatedAt: now(),
    updatedBy: session().user.handle,
  };
  assertEnvRoom(list, { addEntry: false, deltaBytes: envBytes(next) - envBytes(current) });
  db().environment[projectId] = list.map((e) => (e === current ? next : e));
  return next;
}

function removeEnvEntry(projectParam: string, kind: EnvKind, name: string): null {
  const projectId = projectRow(projectParam).id;
  const list = envEntriesOf(projectId);
  if (!list.some((e) => e.name === name && e.kind === kind)) throw notFound(kind === 'plain' ? 'Variable' : 'Secret');
  db().environment[projectId] = list.filter((e) => !(e.name === name && e.kind === kind));
  return null;
}

/** Lowercase hex SHA-256 of the text's UTF-8 bytes (WebCrypto: the browser and the Vitest environment have it). */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The tested script is still the project's current one: its hash equals the current version's. */
async function matchesCurrent(projectId: string, scriptSha256: string): Promise<boolean> {
  const current = setupVersionsOf(projectId).at(-1);
  return current !== undefined && (await sha256Hex(current.body)) === scriptSha256;
}

/** Routes that are not JSON: the SSE streams and the terminal WebSockets (see streamGuard below). */
const STREAM_KEYS = [
  'runs.events',
  'projects.events',
  'runs.terminal',
  'setupTests.events',
  'setupTests.terminal',
] as const;
type StreamKey = (typeof STREAM_KEYS)[number];
type JsonKey = Exclude<RouteKey, StreamKey>;

type Impl = {
  [K in JsonKey]: (ctx: RouteCtx<K>) => Answer<ResponseOf<K>> | Promise<Answer<ResponseOf<K>>>;
};

const impl: Impl = {
  'connections.list': () => {
    const { orgId } = session();
    return db().connections.filter((c) => c.orgId === orgId);
  },
  // The mock provider has nothing installed beyond what the org already has linked.
  'connections.sync': () => {
    const { orgId } = session();
    const failing = db().githubSyncScenario;
    if (failing === 'reauth') {
      throw new Problem({
        status: 409,
        title: 'Conflict',
        type: PROVIDER_REAUTH_REQUIRED_PROBLEM_TYPE,
        detail: 'Your account at the provider must be connected again.',
      });
    }
    if (failing === 'unavailable') {
      throw new Problem({
        status: 503,
        title: 'Service Unavailable',
        type: PROVIDER_UNAVAILABLE_PROBLEM_TYPE,
        detail: 'The provider is not available right now. Try again later.',
      });
    }
    return db().connections.filter((c) => c.orgId === orgId);
  },
  'connections.install': ({ params }) => {
    session();
    // The real API returns the provider's install page; the fake provider has none, so it gets a placeholder https URL
    // (the app only follows absolute https install URLs).
    return {
      url:
        params.provider === 'github'
          ? 'https://github.com/apps/agent-desk/installations/new'
          : 'https://fake-provider.invalid/install',
    };
  },
  'connections.repos': ({ params }) => {
    const { orgId } = session();
    if (!db().connections.some((c) => c.id === params.connectionId && c.orgId === orgId)) throw notFound('Connection');
    return db().repos[params.connectionId] ?? [];
  },

  'projects.list': ({ query }) => {
    const { orgId } = session();
    // As the API: creation order, ties broken by id.
    const rows = db()
      .projects.filter((p) => p.orgId === orgId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
    const page = slicePage(rows, query);
    return { ...page, items: page.items.map(toProjectDto) };
  },
  'projects.create': ({ body }) => {
    const { orgId } = session();
    const conn = db().connections.find((c) => c.id === body.connectionId && c.orgId === orgId);
    if (!conn) throw invalid('/connectionId', 'Unknown connection.');
    if (!(db().repos[conn.id] ?? []).some((r) => r.repoPath === body.repoPath)) {
      throw invalid('/repoPath', 'The connection cannot see this repository.');
    }
    if (db().projects.some((p) => p.orgId === orgId && p.repoPath === body.repoPath)) {
      throw conflict('Project already exists', [{ pointer: '/repoPath', detail: 'A project already uses this repo.' }]);
    }
    const row: ProjectRow = {
      id: mockDb.nextId(),
      orgId,
      name: body.name ?? body.repoPath.split('/').at(-1) ?? body.repoPath,
      repoPath: body.repoPath,
      defaultBranch: (db().repos[conn.id] ?? []).find((r) => r.repoPath === body.repoPath)?.defaultBranch ?? null,
      codeConnectionId: conn.id,
      boardConnectionId: conn.id,
      triggerMode: body.triggerMode,
      pollIntervalSeconds: body.pollIntervalSeconds ?? 300,
      maxConcurrentRuns: 2,
      maxRunsPerTicket: 10,
      timeoutSeconds: 86400,
      pausedKeepSeconds: 604800,
      doneKeepSeconds: 86400,
      idleEndSeconds: 1800,
      autoResumeMax: 5,
      setupStep: 'agent',
      createdAt: now(),
    };
    db().projects.push(row);
    // The checklist follows the project just created ("Add an agent" is read from its default agent).
    db().checklists[orgId] = {
      complete: false,
      projectId: row.id,
      steps: [
        { key: 'connect_code_host', done: true },
        { key: 'create_project', done: true },
        { key: 'add_agent', done: false },
        { key: 'add_rule', done: false },
      ],
    };
    // The mock server hears at once: a webhook ping, or the first polling check.
    db().triggers[row.id] = {
      webhook: { lastEventAt: row.triggerMode === 'webhook' ? now() : null, lastEventAction: 'ping' },
      polling: {
        lastCheckedAt: row.triggerMode === 'polling' ? now() : null,
        lastError: null,
        pausedReason: null,
        nextPollAt: null,
      },
    };
    // The API creates the project's agent with the project; setup step 2 fills it in.
    db().agents.push({
      id: mockDb.nextId(),
      projectId: row.id,
      name: 'Claude',
      provider: 'claude',
      model: 'opus',
      baseUrl: null,
      maxTurns: null,
      timeoutSeconds: 1800,
      pausedKeepSeconds: 604800,
      doneKeepSeconds: 86400,
      idleEndSeconds: 1800,
      autoResumeMax: 5,
      credential: { set: false, type: null, updatedAt: null, setBy: null },
      accountLabel: null,
      isDefault: true,
      lastTest: null,
      usage: { rules: 0, blockingRuns: 0 },
    });
    return toProjectDto(row);
  },
  'projects.get': ({ params }) => toProjectDto(projectRow(params.projectId)),
  'projects.update': ({ params, body }) => {
    const row = projectRow(params.projectId);
    Object.assign(row, Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)));
    const trig = db().triggers[row.id] ?? defaultTriggerState();
    if (row.triggerMode === 'polling' && trig.polling.lastCheckedAt === null) {
      // Switching to polling runs a first check right away on the server.
      trig.polling.lastCheckedAt = now();
      trig.polling.nextPollAt = new Date(Date.now() + row.pollIntervalSeconds * 1000).toISOString();
    }
    db().triggers[row.id] = trig;
    return toProjectDto(row);
  },
  'projects.audit': ({ params, query }) => {
    const { user, orgId } = projectInScope(params.projectId);
    return listProjectAudit(mockDb, params.projectId, query, { userId: user.id, orgId });
  },
  'projectMembers.list': ({ params, query }) => {
    projectInScope(params.projectId);
    return listProjectMembers(mockDb, params.projectId, query);
  },
  'projectMembers.add': ({ params, body }) => {
    const { user, orgId } = projectInScope(params.projectId);
    return addProjectMember(mockDb, user, orgId, params.projectId, body);
  },
  'projectMembers.setRole': ({ params, body }) => {
    const { user } = projectInScope(params.projectId);
    return setProjectRole(mockDb, user, params.projectId, params.userId, body.roleId);
  },
  'projectMembers.remove': ({ params }) => {
    const { user } = session();
    // Removing yourself is refused before anything is looked up, the project included.
    if (params.userId === user.id) removeProjectMember(mockDb, user, params.projectId, params.userId);
    projectInScope(params.projectId);
    return removeProjectMember(mockDb, user, params.projectId, params.userId);
  },
  'projects.remove': ({ params }) => {
    const row = projectRow(params.projectId);
    const s = db();
    const runIds = new Set(s.runs.filter((r) => r.projectId === row.id).map((r) => r.id));
    s.projects = s.projects.filter((p) => p.id !== row.id);
    s.agents = s.agents.filter((a) => a.projectId !== row.id);
    s.rules = s.rules.filter((r) => r.projectId !== row.id);
    s.runs = s.runs.filter((r) => r.projectId !== row.id);
    for (const id of runIds) delete s.runEvents[id];
    delete s.skills[row.id];
    delete s.triggers[row.id];
    delete s.ignored[row.id];
    delete s.setupScripts[row.id];
    delete s.plugins[row.id];
    delete s.environment[row.id];
    for (const t of s.setupTests.filter((x) => x.projectId === row.id)) delete s.setupTestEvents[t.id];
    s.setupTests = s.setupTests.filter((t) => t.projectId !== row.id);
    return null;
  },
  'projects.connection': ({ params }) => connectionDto(projectRow(params.projectId)),
  'projects.pollNow': ({ params }) => {
    const row = projectRow(params.projectId);
    const trig = db().triggers[row.id] ?? defaultTriggerState();
    const reason = trig.polling.pausedReason;
    if (row.triggerMode !== 'polling')
      throw new Problem({ status: 409, title: 'Conflict', type: 'conflict', detail: 'This project uses webhooks.' });
    if (reason)
      throw new Problem({ status: 409, title: 'Conflict', type: 'conflict', detail: `Polling is paused: ${reason}` });
    trig.polling.lastCheckedAt = new Date().toISOString();
    db().triggers[row.id] = trig;
    return null;
  },
  'projects.ignored': ({ params, query }) => slicePage(db().ignored[projectRow(params.projectId).id] ?? [], query),

  'agents.list': ({ params, query }) => slicePage(agentsOf(projectRow(params.projectId).id), query),
  'agents.create': ({ params, body }) => createAgent(projectRow(params.projectId), body),
  'agents.update': ({ params, body }) => updateAgent(agentInScope(params.agentId), body),
  'agents.remove': ({ params }) => removeAgent(agentInScope(params.agentId)),
  'agents.setDefault': ({ params }) => setDefaultAgent(agentInScope(params.agentId)),
  'agents.test': ({ params }) => testAgent(agentInScope(params.agentId)),
  'agents.get': ({ params }) => agentOf(projectRow(params.projectId).id),
  'agents.put': ({ params, body }) => {
    const agent = agentOf(projectRow(params.projectId).id);
    agent.model = body.model;
    agent.maxTurns = body.maxTurns ?? null;
    agent.timeoutSeconds = body.timeoutSeconds;
    agent.pausedKeepSeconds = body.pausedKeepSeconds ?? agent.pausedKeepSeconds;
    agent.doneKeepSeconds = body.doneKeepSeconds ?? agent.doneKeepSeconds;
    agent.idleEndSeconds = body.idleEndSeconds ?? agent.idleEndSeconds;
    agent.autoResumeMax = body.autoResumeMax ?? agent.autoResumeMax;
    return agent;
  },
  'agents.putCredential': ({ params, body }) => {
    const { user } = session();
    const agent = agentInScope(params.agentId);
    checkCredential(agent, body);
    // Write-only: the value is dropped here, only the fact that one is set is kept.
    const updatedAt = now();
    agent.credential = { set: true, type: body.type, updatedAt, setBy: user.handle };
    // Absent keeps the saved address, a string sets it, null clears it.
    if (body.baseUrl !== undefined) agent.baseUrl = body.baseUrl;
    if (!db().agentCredentialSaved.includes(agent.id)) db().agentCredentialSaved.push(agent.id);
    return { updatedAt };
  },
  'agents.models': async ({ params }) => {
    const agent = agentInScope(params.agentId);
    const answer = agentModelsAnswer(
      agent,
      db().agentModelScenarios[agent.id],
      db().agentCredentialSaved.includes(agent.id),
    );
    if (answer === 'pending') return new Promise<never>(() => undefined);
    if (answer === 'error') throw new Problem({ status: 500, title: 'Internal server error', type: 'internal' });
    return answer;
  },

  'tickets.prStates': async ({ params, query }) => {
    const project = projectRow(params.projectId);
    const scenario = db().prStatesScenario;
    if (scenario === 'pending') return new Promise<never>(() => undefined);
    if (scenario === 'error') throw new Problem({ status: 500, title: 'Internal server error', type: 'internal' });
    if (scenario === 'slow') await delay(PR_STATES_SLOW_MS);
    return { items: prStateItems(db().prStates[project.id] ?? {}, query.ref, scenario === 'partial') };
  },

  // Full skills; the SkillSummaryDto response schema strips `body` and `sha`.
  'skills.list': ({ params, query }) =>
    slicePage(
      [...skillsOf(projectRow(params.projectId).id)].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
      query,
    ),
  'skills.get': ({ params }) => skillOf(projectRow(params.projectId).id, params.name),
  'skills.put': ({ params, body }) => {
    const list = skillsOf(projectRow(params.projectId).id);
    const existing = list.find((s) => s.name === params.name);
    if (existing && body.sha !== existing.sha) {
      throw conflict('Skill changed', undefined, 'The skill was changed since you opened it. Reload and try again.');
    }
    if (!existing && body.sha !== undefined) throw conflict('Skill not found at that sha');
    if (db().skillReviewRequired)
      return changeRequestFor(projectRow(params.projectId), existing ? 'update' : 'create', params.name);
    const sha = nextSha();
    const next: SkillDto = {
      name: params.name,
      description: descriptionOf(body.body),
      path: `.claude/skills/${params.name}/SKILL.md`,
      lastCommit: { sha, message: body.message, at: now() },
      body: body.body,
      sha,
    };
    if (existing) Object.assign(existing, next);
    else list.push(next);
    return { kind: 'commit', commitSha: sha, targetBranch: projectRow(params.projectId).defaultBranch ?? 'main' };
  },
  'skills.remove': ({ params }) => {
    const projectId = projectRow(params.projectId).id;
    skillOf(projectId, params.name);
    if (db().skillReviewRequired) return changeRequestFor(projectRow(projectId), 'delete', params.name);
    db().skills[projectId] = skillsOf(projectId).filter((s) => s.name !== params.name);
    return { kind: 'commit', commitSha: nextSha(), targetBranch: projectRow(projectId).defaultBranch ?? 'main' };
  },

  'setupScript.get': ({ params }) => setupVersionsOf(projectRow(params.projectId).id).at(-1) ?? null,
  'setupScript.put': async ({ params, body }) => {
    const projectId = projectRow(params.projectId).id;
    const list = setupVersionsOf(projectId);
    const current = list.at(-1)?.version ?? null;
    if (body.baseVersion !== current) {
      throw conflict('Setup script changed', undefined, 'The setup script was changed since you opened it.');
    }
    const next: SetupScriptDto = {
      version: (current ?? 0) + 1,
      body: body.body,
      note: body.note ?? null,
      createdBy: session().user.handle,
      createdAt: now(),
    };
    db().setupScripts[projectId] = [...list, next];
    // Tests of the previous script no longer match the current one.
    const sha = await sha256Hex(next.body);
    for (const t of db().setupTests) if (t.projectId === projectId) t.matchesCurrentScript = t.scriptSha256 === sha;
    return next;
  },
  'setupScript.versions': ({ params, query }) =>
    slicePage(
      [...setupVersionsOf(projectRow(params.projectId).id)]
        .reverse()
        .map((v) => ({ version: v.version, note: v.note, createdBy: v.createdBy, createdAt: v.createdAt })),
      query,
    ),
  'setupScript.version': ({ params }) => {
    const found = setupVersionsOf(projectRow(params.projectId).id).find((v) => v.version === params.version);
    if (!found) throw notFound('Setup script version');
    return found;
  },
  'setup.plugins': ({ params }) => db().plugins[projectRow(params.projectId).id] ?? noPlugins(),

  // Project environment. The mock mirrors apps/api project-env.service.ts: 404 for a missing or other-kind entry, 409
  // when a create's name exists in either kind or a limit is hit. A secret stores its name, who and when only: the
  // value is read by the schema and dropped, so no response and no store snapshot can carry it.
  'projectEnv.list': ({ params, query }) =>
    slicePage(
      envEntriesOf(projectRow(params.projectId).id)
        .filter((e) => e.kind === query.kind)
        .sort(byName),
      query,
    ),
  'projectEnv.createVar': ({ params, body }) => createEnvEntry(params.projectId, 'plain', body.name, body.value),
  'projectEnv.updateVar': ({ params, body }) => updateEnvEntry(params.projectId, 'plain', params.name, body.value),
  'projectEnv.removeVar': ({ params }) => removeEnvEntry(params.projectId, 'plain', params.name),
  'projectEnv.createSecret': ({ params, body }) => createEnvEntry(params.projectId, 'secret', body.name, body.value),
  'projectEnv.updateSecret': ({ params, body }) => updateEnvEntry(params.projectId, 'secret', params.name, body.value),
  'projectEnv.removeSecret': ({ params }) => removeEnvEntry(params.projectId, 'secret', params.name),
  'setupTests.create': async ({ params, body }) => {
    const projectId = projectRow(params.projectId).id;
    const sha = await sha256Hex(body.script);
    // A project has one test workspace at a time: the previous one ends.
    for (const t of db().setupTests) {
      if (t.projectId === projectId) endSetupTest(t);
    }
    const test: SetupTestDto = {
      id: mockDb.nextId(),
      projectId,
      status: 'queued',
      scriptSha256: sha,
      matchesCurrentScript: await matchesCurrent(projectId, sha),
      checkoutSha: null,
      plugins: { installed: [], skipped: [], failed: [] },
      exitCode: null,
      startedBy: session().user.handle,
      createdAt: now(),
      finishedAt: null,
      endedAt: null,
    };
    db().setupTests.push(test);
    rememberSetupTestScript(test.id, body.script);
    return test;
  },
  'setupTests.latest': ({ params }) =>
    db()
      .setupTests.filter((t) => t.projectId === projectRow(params.projectId).id)
      .at(-1) ?? null,
  'setupTests.end': ({ params }) => {
    const found = findSetupTest(params.setupTestId);
    if (!found) throw notFound('Setup test');
    projectRow(found.projectId);
    endSetupTest(found);
    return null;
  },
  // As the API: creation order (the store keeps rules in the order they were created).
  'rules.list': ({ params, query }) =>
    slicePage(
      db().rules.filter((r) => r.projectId === projectRow(params.projectId).id),
      query,
    ),
  'rules.create': ({ params, body }) => {
    const projectId = projectRow(params.projectId).id;
    assertUniqueCommand(projectId, body.command);
    const { kind, command, labelFilter, target, enabled } = body;
    // As the API: no agent means the rule follows the project's default agent (null).
    const agentId = body.agentId ?? null;
    const rule: RuleDto = {
      id: mockDb.nextId(),
      projectId,
      command,
      labelFilter,
      target,
      agentId,
      model: body.model ?? null,
      kind,
      skillName: body.kind === 'skill' ? body.skillName : null,
      prompt: body.kind === 'prompt' ? body.prompt : null,
      enabled,
      stats: { runs30d: 0, lastRunAt: null },
    };
    db().rules.push(rule);
    return rule;
  },
  'rules.update': ({ params, body }) => {
    const rule = ruleOf(params.ruleId);
    if (body.command !== undefined) assertUniqueCommand(rule.projectId, body.command, rule.id);
    const { command, labelFilter, target, enabled, kind, skillName, prompt } = body;
    if (command !== undefined) rule.command = command;
    if (labelFilter !== undefined) rule.labelFilter = labelFilter;
    if (target !== undefined) rule.target = target;
    if (enabled !== undefined) rule.enabled = enabled;
    if (body.agentId !== undefined) rule.agentId = body.agentId;
    if (body.model !== undefined) rule.model = body.model;
    // A kind switch sends kind plus the new field and clears the old one.
    if (kind !== undefined) rule.kind = kind;
    if (rule.kind === 'skill') {
      if (skillName !== undefined) rule.skillName = skillName;
      rule.prompt = null;
    } else {
      if (prompt !== undefined) rule.prompt = prompt;
      rule.skillName = null;
    }
    return rule;
  },
  'rules.promptPreview': ({ params }) => promptPreviewFixture(projectRow(params.projectId).repoPath),
  'rules.remove': ({ params }) => {
    const rule = ruleOf(params.ruleId);
    db().rules = db().rules.filter((r) => r.id !== rule.id);
    return null;
  },

  'runs.list': ({ params, query }) => {
    const projectId = projectRow(params.projectId).id;
    const matching = db()
      .runs.filter((r) => r.projectId === projectId)
      .filter((r) => matchesFilter(query.filter, r.status))
      .filter((r) => query.ticket === undefined || r.ticket.ref === query.ticket)
      .filter((r) =>
        matchesSearch(
          r,
          db().runs.filter((x) => x.projectId === projectId),
          query.q,
        ),
      )
      .sort((a, b) => b.number - a.number)
      .map((r) => withTicketRunCount(withAgentIdleEnd(r)));
    return slicePage(matching, query);
  },
  // Before byNumber, as in the API: `stats` is not a run number.
  'runs.stats': ({ params, query }) => {
    const projectId = projectRow(params.projectId).id;
    const runs = db().runs.filter((r) => r.projectId === projectId);
    const since = Date.parse(query.since);
    const today = runs.filter((r) => Date.parse(r.queuedAt) >= since);
    const idle = runs.filter((r) => r.status === 'idle').sort((a, b) => b.queuedAt.localeCompare(a.queuedAt))[0];
    const nextQueued = runs
      .filter((r) => r.status === 'queued')
      .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))[0];
    return {
      counts: {
        needs_you: runs.filter((r) => matchesFilter('needs_you', r.status)).length,
        active: runs.filter((r) => matchesFilter('active', r.status)).length,
        queued: runs.filter((r) => matchesFilter('queued', r.status)).length,
        ended: runs.filter((r) => matchesFilter('ended', r.status)).length,
        all: runs.length,
        ignored: (db().ignored[projectId] ?? []).length,
      },
      today: { total: today.length, failed: today.filter((r) => r.status === 'failed').length },
      idleRun: idle ? withTicketRunCount(withAgentIdleEnd(idle)) : null,
      nextQueuedNumber: nextQueued?.number ?? null,
    };
  },
  'runs.byNumber': ({ params }) => {
    const projectId = projectRow(params.projectId).id;
    const run = db().runs.find((r) => r.projectId === projectId && r.number === params.number);
    if (!run) throw notFound('Run');
    return toDto(withAgentIdleEnd(run));
  },
  'runs.get': ({ params }) => toDto(withAgentIdleEnd(runOf(params.runId))),
  'runs.log': ({ params }) => ({ items: db().runEvents[runOf(params.runId).id] ?? [] }),
  'runs.cancel': async ({ params }) => {
    const { user } = session();
    const run = runOf(params.runId);
    if (run.reopenedAt !== null) throw conflict(REOPENED_ONLY_CLOSE);
    if (isFinal(run.status)) throw conflict('Run already ended');
    if (slowActionRuns.has(run.number)) await slow();
    endRun(run, 'cancelled', `Cancel requested by ${user.handle}`);
    return null;
  },
  'runs.finish': async ({ params }) => {
    const { user } = session();
    const run = runOf(params.runId);
    if (run.reopenedAt !== null) throw conflict(REOPENED_ONLY_CLOSE);
    if (isFinal(run.status)) throw conflict('Run already ended');
    if (!FINISHABLE_RUN_STATUSES.some((s) => s === run.status)) throw conflict('Run is not waiting for you or done');
    if (slowActionRuns.has(run.number)) await slow();
    // As the worker (ADR 0032): Finish on a fresh Done run keeps its disk for the normal keep time.
    if (run.status === 'done' && !resumedFromPause.has(run)) {
      run.finishedAt = now();
      run.exitCode = 0;
      run.sessionExpiresAt = new Date(Date.now() + DONE_KEEP_MS).toISOString();
      appendRunEvent(run, 'lifecycle', { text: `Finish clicked by ${user.handle}` });
      setRunStatus(run, 'succeeded');
      return null;
    }
    endRun(run, 'succeeded', `Finish clicked by ${user.handle}`);
    return null;
  },
  'runs.closeSession': ({ params }) => {
    const { user } = session();
    const run = runOf(params.runId);
    if (run.reopenedAt === null) throw conflict('Only a reopened session can be closed');
    // As the worker (ADR 0032): the run returns to succeeded with its disk kept for a fresh keep time, and no comment.
    run.reopenedAt = null;
    run.finishedAt = now();
    run.exitCode = 0;
    run.sessionExpiresAt = new Date(Date.now() + DONE_KEEP_MS).toISOString();
    appendRunEvent(run, 'lifecycle', {
      kind: 'session_closed',
      how: 'person',
      text: `Session closed by ${user.handle}`,
    });
    setRunStatus(run, 'succeeded');
    return null;
  },
  'runs.transcript': async ({ params, query }) => {
    const run = runOf(params.runId);
    const behaviour = transcriptBehaviours[run.number];
    if (behaviour === 'slow') await slow();
    const failure = { status: 500, title: 'Internal Server Error', type: 'internal' };
    if (behaviour === 'fail') throw new Problem({ ...failure, requestId: 'req-123' });
    if (behaviour === 'failNoRequestId') throw new Problem({ ...failure, requestId: null });
    if (behaviour === 'failOnce' && !failedOnce.has(run.number)) {
      failedOnce.add(run.number);
      throw new Problem({ ...failure, requestId: 'req-123' });
    }
    // As the API: the newest window below `before`, oldest first; nextBefore is the window's first seq when older ones remain.
    const all = db().runTranscripts[run.id] ?? [];
    const { before } = query;
    const below = before === undefined ? all : all.filter((e) => e.seq < before);
    const items = below.slice(Math.max(0, below.length - query.limit));
    const first = items[0];
    return { items, nextBefore: items.length < below.length && first ? first.seq : null };
  },
  'runs.stop': ({ params }) => {
    const run = runOf(params.runId);
    if (run.reopenedAt !== null) throw conflict(REOPENED_ONLY_CLOSE);
    if (run.sessionEndingAt !== null) throw conflict('The session is already ending');
    if (!STOPPABLE_RUN_STATUSES.some((s) => s === run.status)) throw conflict('Only a live session can be stopped');
    return null;
  },
  'runs.resume': ({ params }) => {
    const { user } = session();
    const run = runOf(params.runId);
    // As the API: 409 with a plain message when the run cannot be resumed, is already being resumed, or has no
    // credential to resume with.
    if (run.status === 'queued' || run.status === 'starting') throw conflict('This run is already being resumed');
    if (!canResume(run, new Date())) {
      throw conflict('Only a paused run, or a finished run whose session is still kept, can be resumed');
    }
    if (!agentOf(run.projectId).credential.set) {
      throw conflict('This project has no agent credential, so the run cannot be resumed');
    }
    // A reopened succeeded run keeps its result (ADR 0032): the flag marks it until Close session.
    run.reopenedAt = run.status === 'succeeded' ? now() : null;
    if (run.status === 'paused') resumedFromPause.add(run);
    run.pausedAt = null;
    run.sessionExpiresAt = null;
    run.sessionEndingAt = null;
    run.pauseReason = null;
    run.finishedAt = null;
    run.exitCode = null;
    run.failureReason = null;
    appendRunEvent(run, 'lifecycle', { text: `Resume requested by ${user.handle}` });
    setRunStatus(run, 'queued');
    // Like a new run: a slot, the pod, then the agent is back (open event streams and the fake terminal follow).
    scriptRun(run.id, [
      { afterMs: 1_500, status: 'starting' },
      { afterMs: 1_500, lifecycle: 'Pod running' },
      { afterMs: 1_000, lifecycle: 'Session resumed', status: 'running' },
      // The agent's turn ends, so Finish run is offered.
      { afterMs: 4_000, lifecycle: 'Turn finished', status: 'done' },
    ]);
    return null;
  },

  'me.access': () => accessOf(sessionUser()),
  'me.platform': () => ({ platformAdmin: sessionUser().platformAdmin }),
  'roles.list': () => roleFixtures.filter((r) => r.builtIn),
  'members.list': async ({ params, query }) => {
    const { user, orgId } = session();
    requireActiveOrg(params.orgId, orgId);
    if (query.excludeProject !== undefined) {
      // Checked in the API's order: the project exists and the caller reaches it (404), then may read its assignments (403).
      projectInScope(query.excludeProject);
      if (!canOnProject(user, 'assignment:read', query.excludeProject)) throw forbiddenProblem();
      checkPickerFailure(mockDb);
    }
    await gate(mockDb, 'members');
    const page = await listMembers(mockDb, orgId, query, pickerFilter(mockDb, query));
    if (query.excludeProject !== undefined)
      applyAfterFirstPicker(mockDb, { userId: user.id, orgId }, query.excludeProject);
    return page;
  },
  'assignments.list': ({ query }) => slicePage(assignmentFixtures, query),
  'assignments.create': ({ params, body }) => {
    const { user, orgId } = session();
    requireActiveOrg(params.orgId, orgId);
    return createAssignment(mockDb, { userId: user.id, orgId }, body, (projectId) =>
      db().projects.some((p) => p.id === projectId && p.orgId === orgId),
    );
  },
  'assignments.remove': ({ params }) => {
    const { user, orgId } = session();
    requireActiveOrg(params.orgId, orgId);
    return deleteAssignment(mockDb, { userId: user.id, orgId }, params.assignmentId);
  },
  'invitations.list': ({ query }) => listInvitations(session().orgId, query),
  'invitations.create': ({ body }) => createInvitation(session().orgId, body),
  'invitations.remove': ({ params }) => revokeInvitation(session().orgId, params.invitationId),
  'invitations.resend': ({ params }) => resendInvitation(session().orgId, params.invitationId),
  'members.updateRole': ({ params, body }) => {
    const { user, orgId } = session();
    requireActiveOrg(params.orgId, orgId);
    return changeMemberRole(mockDb, { userId: user.id, orgId }, params.userId, body.roleId);
  },
  'members.remove': ({ params }) => {
    const { user, orgId } = session();
    // Self removal is refused before anything is looked up, the org included.
    if (params.userId === user.id) removeMember(mockDb, { userId: user.id, orgId }, params.userId);
    requireActiveOrg(params.orgId, orgId);
    return removeMember(mockDb, { userId: user.id, orgId }, params.userId);
  },
  'orgs.update': ({ params, body }) => {
    const { orgId } = session();
    requireActiveOrg(params.orgId, orgId);
    return updateOrg(mockDb, orgId, body);
  },
  'audit.list': async ({ params, query }) => {
    const { orgId } = session();
    requireActiveOrg(params.orgId, orgId);
    await gate(mockDb, 'audit');
    return listAudit(mockDb, orgId, query);
  },
  'orgs.checklist': () => {
    const { user, orgId } = session();
    const seat = db().memberships.find((m) => m.userId === user.id && m.orgId === orgId);
    // Owners and org-wide admins hold project:create at org scope; nobody else sees the checklist.
    const allowed = seat !== undefined && (seat.roleKey === 'owner' || (seat.roleKey === 'admin' && !seat.projectIds));
    if (!allowed) throw new Problem({ status: 403, title: 'Forbidden', type: 'forbidden' });
    return checklistOf(db().checklists[orgId] ?? checklistFixtures.none);
  },
  'me.listInvitations': ({ query }) => {
    const mine = myInvitationRows().filter((i) => effectiveStatus(i) === 'pending');
    return slicePage(mine.map(toMyInvitation), query);
  },
  'me.getInvitation': ({ params }) => toMyInvitation(myInvitationRow(params.invitationId)),
  'me.acceptInvitation': ({ params }) => {
    const user = sessionUser();
    const row = pendingOfMine(params.invitationId);
    const org = db().orgs.find((o) => o.id === row.orgId);
    if (!org) throw notFound('Invitation');
    const projectIds = row.scope.type === 'project' ? row.scope.projects.map((p) => p.id) : undefined;
    const seat = db().memberships.find((m) => m.userId === user.id && m.orgId === row.orgId);
    // Already a member: the mock keeps one seat (one role per org), so the existing seat stays as it is.
    if (!seat) {
      db().memberships.push({
        userId: user.id,
        orgId: row.orgId,
        roleKey: row.role.key,
        ...(projectIds && { projectIds }),
      });
    }
    row.status = 'accepted';
    row.acceptedAt = now();
    return { org: { id: org.id, name: org.name, slug: org.slug } };
  },
  'me.declineInvitation': ({ params }) => {
    pendingOfMine(params.invitationId).status = 'declined';
    return null;
  },

  'platform.createOrg': ({ body }) => {
    if (db().orgs.some((o) => o.slug === body.slug)) {
      throw conflict('Slug already taken', [{ pointer: '/slug', detail: 'This URL is taken.' }]);
    }
    const org = { id: mockDb.nextId(), name: body.name, slug: body.slug, logo: null, metadata: null, createdAt: now() };
    db().orgs.push(org);
    db().checklists[org.id] = checklistFixtures.none;
    addPlatformOrg({ id: org.id, name: org.name, slug: org.slug, createdAt: org.createdAt });
    return { id: org.id, name: org.name, slug: org.slug };
  },
  'platform.listOrgs': ({ query }) => listPlatformOrgs(query),
  'platform.getOrg': ({ params }) => getPlatformOrg(params.orgId),
  'platform.updateOrg': ({ params, body }) => updatePlatformOrg(params.orgId, body),
  'platform.suspendOrg': ({ params, body }) =>
    setPlatformOrgStatus(params.orgId, 'suspended', body.reason, actorOf(sessionUser())),
  'platform.reactivateOrg': ({ params, body }) =>
    setPlatformOrgStatus(params.orgId, 'active', body.reason, actorOf(sessionUser())),
  'platform.listProjects': ({ params, query }) => listPlatformProjects(params.orgId, query),
  'platform.listRoles': ({ params }) => listPlatformRoles(params.orgId),
  'platform.listMembers': ({ params, query }) => listPlatformMembers(params.orgId, query),
  'platform.listAssignments': ({ query }) => slicePage(assignmentFixtures, query),
  'platform.createAssignment': ({ params, body }) => createPlatformAssignment(params.orgId, body, sessionUser().id),
  'platform.removeAssignment': ({ params }) => removePlatformAssignment(params.orgId, params.assignmentId),
  'platform.listInvitations': ({ params, query }) => listInvitations(requireOrg(params.orgId), query),
  'platform.createInvitation': ({ params, body }) => createInvitation(requireOrg(params.orgId), body),
  'platform.removeInvitation': ({ params }) => revokeInvitation(requireOrg(params.orgId), params.invitationId),
  'platform.resendInvitation': ({ params }) => resendInvitation(requireOrg(params.orgId), params.invitationId),
  'platform.listAdmins': ({ query }) => listPlatformAdmins(query),
  'platform.listAudit': ({ query }) => listPlatformAudit(query),
  'platform.grantAdmin': ({ body }) => grantPlatformAdmin(body),
  'platform.revokeAdmin': ({ params }) => revokePlatformAdmin(params.adminId),
};

// As the API answers (Nest: 201 for a POST without @HttpCode).
const STATUS: Partial<Record<RouteKey, number>> = {
  'connections.install': 201,
  'connections.sync': 201,
  'projects.create': 201,
  'projectEnv.createVar': 201,
  'projectEnv.createSecret': 201,
  'agents.create': 201,
  'rules.create': 201,
  'projects.pollNow': 202,
  'runs.cancel': 202,
  'runs.stop': 202,
  'runs.finish': 202,
  'runs.closeSession': 202,
  'setupTests.end': 202,
  'assignments.create': 201,
  'projectMembers.add': 201,
  'projectMembers.remove': 204,
  'invitations.create': 201,
  'platform.createOrg': 201,
  'platform.createAssignment': 201,
  'platform.createInvitation': 201,
  'platform.grantAdmin': 201,
  'assignments.remove': 204,
  'invitations.remove': 204,
  'me.declineInvitation': 204,
  'platform.removeAssignment': 204,
  'platform.removeInvitation': 204,
  'platform.revokeAdmin': 204,
};

async function readBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new Problem({ status: 400, title: 'Invalid JSON body', type: 'validation' });
  }
}

function parsePart(schema: RouteDef['body'], value: unknown, where: string): unknown {
  if (!schema) return undefined;
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new Problem({
    status: 400,
    title: 'Validation failed',
    type: 'validation',
    detail: `Invalid ${where}`,
    errors: fieldErrors(result.error),
  });
}

/** The query as an object: a key sent once is a string, a repeated key an array (as the API's query parser does). */
function queryOf(sp: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(sp.keys())) {
    const all = sp.getAll(key);
    out[key] = all.length === 1 ? (all[0] ?? '') : all;
  }
  return out;
}

/**
 * The API guard's second step (after membership, before the permission): a member of a suspended active org is refused
 * 403 `org-suspended` whatever their role, `me.access` included. The body is fixed text: no reason, no date. A non-member
 * keeps the plain 403.
 */
function refuseSuspendedOrg(user: MockUser): void {
  const orgId = mockDb.auth.activeOrganizationId;
  if (!orgId) return;
  if (db().orgs.find((o) => o.id === orgId)?.status !== 'suspended') return;
  if (!db().memberships.some((m) => m.userId === user.id && m.orgId === orgId)) {
    throw new Problem({ status: 403, title: 'Forbidden', type: 'forbidden' });
  }
  throw new Problem({
    status: 403,
    title: 'Forbidden',
    type: ORG_SUSPENDED_PROBLEM_TYPE,
    detail: 'This organization is suspended.',
  });
}

function contractHandler<K extends JsonKey>(key: K, run: Impl[K]): HttpHandler {
  const def = routeDef(key);
  return routeHandler(key, async (request, rawParams) => {
    try {
      const caller = sessionUser();
      // A platform route is for a platform admin with a verified email, as the API's guard checks; no org is made otherwise.
      if (routeAccess[key].scope === 'platform' && !(caller.platformAdmin && caller.emailVerified)) {
        throw new Problem({ status: 403, title: 'Forbidden', type: 'forbidden' });
      }
      // A request pinned to an org the session no longer has active is refused before anything else.
      const pinned = request.headers.get(ORG_HEADER);
      if (pinned !== null && isOrgPinned(key) && pinned !== mockDb.auth.activeOrganizationId) {
        throw new Problem({
          status: 409,
          title: 'This organization was switched in another tab',
          type: ORG_MISMATCH_PROBLEM_TYPE,
        });
      }
      if (isOrgPinned(key)) refuseSuspendedOrg(caller);
      if (isOrgPinned(key) && key !== 'me.access') requireRouteAccess(key, session().user);
      const url = new URL(request.url);
      const params = parsePart(def.params, rawParams, 'path parameters');
      const rawBody = def.body ? await readBody(request) : undefined;
      if (key === 'agents.create' && typeof params === 'object' && params !== null && 'projectId' in params) {
        // The project is checked first (404); then a Coming-soon or unknown provider is 422 on /provider, not a shape error.
        projectRow(String(params.projectId));
        refuseUnknownProvider(rawBody);
      }
      const parts = {
        params,
        query: parsePart(def.query, queryOf(url.searchParams), 'query'),
        body: parsePart(def.body, rawBody, 'body'),
        request,
      };
      // Each part was parsed by this route's own schema above, so it has the shape RouteCtx<K> names.
      const ctx = parts as RouteCtx<K>;
      const answer = await run(ctx);
      const [body, status] = answer instanceof WithStatus ? [answer.body, answer.status] : [answer, STATUS[key]];
      return jsonResponse(def.response.parse(body), status);
    } catch (e) {
      if (e instanceof Problem) return problemResponse(e.init);
      throw e;
    }
  });
}

const isJsonKey = (k: string): k is JsonKey => k in flatRoutes && !STREAM_KEYS.some((s) => s === k);
const build = <K extends JsonKey>(key: K) => contractHandler(key, impl[key]);

/** The project a stream route's path parameters point at, when the signed-in user's active org can see it (RLS). */
function streamProblem(key: StreamKey, params: Record<string, unknown>): Response | undefined {
  const user = mockDb.currentUser();
  if (!user) return problemResponse({ status: 401, title: 'Unauthorized', type: 'unauthorized' });
  // The API refuses an SSE connect and a terminal attach of a suspended org like any other route (spec BR-38).
  try {
    refuseSuspendedOrg(user);
  } catch (e) {
    if (e instanceof Problem) return problemResponse(e.init);
    throw e;
  }
  const orgId = mockDb.auth.activeOrganizationId;
  const projectId =
    key === 'projects.events'
      ? params['projectId']
      : key === 'setupTests.events' || key === 'setupTests.terminal'
        ? findSetupTest(String(params['setupTestId']))?.projectId
        : db().runs.find((r) => r.id === params['runId'])?.projectId;
  const ok = db().projects.some((p) => p.id === projectId && p.orgId === orgId);
  return ok ? undefined : problemResponse({ status: 404, title: 'Not found', type: 'not-found' });
}

/**
 * A stream route's auth and scope check (401, 403 for a suspended org, or 404 for a record the active org cannot see). When the request may go
 * on it answers nothing, so the next handler takes it: in the browser the SSE handlers (stream-handlers.ts, listed
 * after these guards) stream; the terminal route only exists as a WebSocket, played by fakeTerminal.ts. Vitest uses
 * FakeEventSource and FakeWebSocket instead, so no request gets past a guard there.
 */
function streamGuard(key: StreamKey): HttpHandler {
  const def = routeDef(key);
  return http.get(def.path, ({ request, params }) => {
    mockDb.logRequest(def.method, new URL(request.url).pathname);
    return streamProblem(key, params);
  });
}

export const streamGuards: Record<StreamKey, HttpHandler> = {
  'runs.events': streamGuard('runs.events'),
  'projects.events': streamGuard('projects.events'),
  'runs.terminal': streamGuard('runs.terminal'),
  'setupTests.events': streamGuard('setupTests.events'),
  'setupTests.terminal': streamGuard('setupTests.terminal'),
};

/** The handler for each contracts route key (the stream routes get their guard). */
export const routeHandlers: Record<RouteKey, HttpHandler> = {
  ...(Object.fromEntries(
    Object.keys(impl)
      .filter(isJsonKey)
      .map((key) => [key, build(key)]),
  ) as Record<JsonKey, HttpHandler>), // `impl` is typed `Impl`, so its keys are exactly JsonKey.
  ...streamGuards,
};

export { problemResponse };

export const handlers: HttpHandler[] = [...authHandlers, ...Object.values(routeHandlers)];
