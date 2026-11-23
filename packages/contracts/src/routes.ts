import { z } from 'zod';
import { Provider } from './enums';
import { AuditEntryDto } from './schemas/audit';
import {
  AccessDto,
  AssignmentDto,
  AssignmentListQuery,
  CreateAssignmentRequest,
  AcceptInvitationResponse,
  CreateInvitationRequest,
  InvitationDto,
  InvitationListQuery,
  MyInvitationDto,
  OrgChecklistDto,
  MemberDto,
  MemberUserId,
  MembersListQuery,
  ProjectMemberDto,
  AddProjectMemberRequest,
  SetProjectRoleRequest,
  RoleDto,
  UpdateMemberRoleRequest,
} from './schemas/access';
import {
  CreateOrgRequest,
  CreateOrgResponse,
  GrantPlatformAdminRequest,
  PlatformAdminDto,
  OrgDto,
  UpdateOrgRequest,
  PlatformAssignmentDto,
  PlatformInvitationDto,
  PlatformMemberDto,
  OrgStatusChangeRequest,
  PlatformOrgDetailDto,
  PlatformOrgDto,
  PlatformOrgListQuery,
  PlatformProjectDto,
  PlatformRoleDto,
  PlatformSessionDto,
} from './schemas/platform';
import {
  AgentDto,
  AgentModelsDto,
  PutAgentRequest,
  PutCredentialRequest,
  PutCredentialResponse,
} from './schemas/agents';
import { ConnectionDto, InstallResponse, RepoDto } from './schemas/connections';
import {
  CreateProjectRequest,
  IgnoredEventDto,
  ProjectConnectionDto,
  ProjectDto,
  UpdateProjectRequest,
} from './schemas/projects';
import { CreateRuleRequest, PromptPreviewDto, RuleDto, UpdateRuleRequest } from './schemas/rules';
import { PrStatesQuery, PrStatesResponse } from './schemas/tickets';
import { PageQuery, pageOf } from './schemas/page';
import { RunStatusEvent, ProjectRunEvent } from './schemas/events';
import { RunTranscriptQuery, RunTranscriptResponse } from './schemas/transcript';
import { RunDto, RunListQuery, RunListResponse, RunLogResponse, RunStatsDto, RunStatsQuery } from './schemas/runs';
import {
  CreateSetupTestRequest,
  PluginsDto,
  PutSetupScriptRequest,
  SetupScriptDto,
  SetupScriptVersionDto,
  SetupTestDto,
} from './schemas/setup';
import {
  DeleteSkillQuery,
  PutSkillRequest,
  PutSkillResponse,
  SkillDto,
  SkillName,
  SkillSummaryDto,
} from './schemas/skills';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RouteDef {
  method: HttpMethod;
  path: string;
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
  response: z.ZodType;
}

const projectParams = z.object({ projectId: z.uuid() });
const projectMemberParams = z.object({ projectId: z.uuid(), userId: MemberUserId });
const runParams = z.object({ runId: z.uuid() });
const ruleParams = z.object({ ruleId: z.uuid() });
const skillParams = z.object({ projectId: z.uuid(), name: SkillName });
const setupTestParams = z.object({ setupTestId: z.uuid() });
const setupVersionParams = z.object({ projectId: z.uuid(), version: z.coerce.number().int().min(1).max(2147483647) });
const orgParams = z.object({ orgId: z.uuid() });
const orgMemberParams = z.object({ orgId: z.uuid(), userId: MemberUserId });
const orgAssignmentParams = z.object({ orgId: z.uuid(), assignmentId: z.uuid() });
const orgInvitationParams = z.object({ orgId: z.uuid(), invitationId: z.uuid() });
const invitationParams = z.object({ invitationId: z.uuid() });
const orgQuery = { orgId: z.uuid().optional() };
const empty = z.null();

export const routes = {
  connections: {
    list: { method: 'GET', path: '/api/connections', response: z.array(ConnectionDto) },
    install: {
      method: 'POST',
      path: '/api/connections/:provider/install',
      params: z.object({ provider: Provider }),
      response: InstallResponse,
    },
    /**
     * 201: links the installations the caller's own provider account can already see (the app was installed before
     * this org had a connection, so the provider never redirects back). Returns the org's connections; idempotent.
     */
    sync: {
      method: 'POST',
      path: '/api/connections/:provider/sync',
      params: z.object({ provider: Provider }),
      response: z.array(ConnectionDto),
    },
    repos: {
      method: 'GET',
      path: '/api/connections/:connectionId/repos',
      params: z.object({ connectionId: z.uuid() }),
      response: z.array(RepoDto),
    },
  },
  projects: {
    list: { method: 'GET', path: '/api/projects', query: PageQuery, response: pageOf(ProjectDto) },
    create: { method: 'POST', path: '/api/projects', body: CreateProjectRequest, response: ProjectDto },
    get: { method: 'GET', path: '/api/projects/:projectId', params: projectParams, response: ProjectDto },
    update: {
      method: 'PATCH',
      path: '/api/projects/:projectId',
      params: projectParams,
      body: UpdateProjectRequest,
      response: ProjectDto,
    },
    remove: { method: 'DELETE', path: '/api/projects/:projectId', params: projectParams, response: empty },
    audit: {
      method: 'GET',
      path: '/api/projects/:projectId/audit',
      params: projectParams,
      query: PageQuery,
      response: pageOf(AuditEntryDto),
    },
    connection: {
      method: 'GET',
      path: '/api/projects/:projectId/connection',
      params: projectParams,
      response: ProjectConnectionDto,
    },
    /**
     * 202: asks for a poll now instead of waiting for the next scheduled one; the result shows up in `connection`.
     * 409 (problem `detail` says why) when the project is not polling, polling is paused, or it is backing off.
     */
    pollNow: {
      method: 'POST',
      path: '/api/projects/:projectId/connection/poll',
      params: projectParams,
      response: empty,
    },
    ignored: {
      method: 'GET',
      path: '/api/projects/:projectId/ignored',
      params: projectParams,
      query: PageQuery,
      response: pageOf(IgnoredEventDto),
    },
    /** SSE (text/event-stream): `event: run` frames, each a ProjectRunEvent. */
    events: {
      method: 'GET',
      path: '/api/projects/:projectId/events',
      params: projectParams,
      query: z.object(orgQuery),
      response: ProjectRunEvent,
    },
  },
  agents: {
    get: { method: 'GET', path: '/api/projects/:projectId/agent', params: projectParams, response: AgentDto },
    put: {
      method: 'PUT',
      path: '/api/projects/:projectId/agent',
      params: projectParams,
      body: PutAgentRequest,
      response: AgentDto,
    },
    putCredential: {
      method: 'PUT',
      path: '/api/agents/:agentId/credential',
      params: z.object({ agentId: z.uuid() }),
      body: PutCredentialRequest,
      response: PutCredentialResponse,
    },
    models: {
      method: 'GET',
      path: '/api/agents/:agentId/models',
      params: z.object({ agentId: z.uuid() }),
      response: AgentModelsDto,
    },
  },
  tickets: {
    prStates: {
      method: 'GET',
      path: '/api/projects/:projectId/tickets/pr-states',
      params: projectParams,
      query: PrStatesQuery,
      response: PrStatesResponse,
    },
  },
  skills: {
    list: {
      method: 'GET',
      path: '/api/projects/:projectId/skills',
      params: projectParams,
      query: PageQuery,
      response: pageOf(SkillSummaryDto),
    },
    get: { method: 'GET', path: '/api/projects/:projectId/skills/:name', params: skillParams, response: SkillDto },
    put: {
      method: 'PUT',
      path: '/api/projects/:projectId/skills/:name',
      params: skillParams,
      body: PutSkillRequest,
      response: PutSkillResponse,
    },
    remove: {
      method: 'DELETE',
      path: '/api/projects/:projectId/skills/:name',
      params: skillParams,
      query: DeleteSkillQuery,
      response: empty,
    },
  },
  rules: {
    list: {
      method: 'GET',
      path: '/api/projects/:projectId/rules',
      params: projectParams,
      query: PageQuery,
      response: pageOf(RuleDto),
    },
    create: {
      method: 'POST',
      path: '/api/projects/:projectId/rules',
      params: projectParams,
      body: CreateRuleRequest,
      response: RuleDto,
    },
    update: {
      method: 'PATCH',
      path: '/api/rules/:ruleId',
      params: ruleParams,
      body: UpdateRuleRequest,
      response: RuleDto,
    },
    promptPreview: {
      method: 'GET',
      path: '/api/projects/:projectId/rules/prompt-preview',
      params: projectParams,
      response: PromptPreviewDto,
    },
    remove: { method: 'DELETE', path: '/api/rules/:ruleId', params: ruleParams, response: empty },
  },
  setupScript: {
    get: {
      method: 'GET',
      path: '/api/projects/:projectId/setup-script',
      params: projectParams,
      response: SetupScriptDto.nullable(),
    },
    put: {
      method: 'PUT',
      path: '/api/projects/:projectId/setup-script',
      params: projectParams,
      body: PutSetupScriptRequest,
      response: SetupScriptDto,
    },
    versions: {
      method: 'GET',
      path: '/api/projects/:projectId/setup-script/versions',
      params: projectParams,
      query: PageQuery,
      response: pageOf(SetupScriptVersionDto),
    },
    version: {
      method: 'GET',
      path: '/api/projects/:projectId/setup-script/versions/:version',
      params: setupVersionParams,
      response: SetupScriptDto,
    },
  },
  setup: {
    /** The plugins panel: what the runner will install from the repo's settings, read at the default branch. */
    plugins: {
      method: 'GET',
      path: '/api/projects/:projectId/plugins',
      params: projectParams,
      response: PluginsDto,
    },
  },
  setupTests: {
    create: {
      method: 'POST',
      path: '/api/projects/:projectId/setup-tests',
      params: projectParams,
      body: CreateSetupTestRequest,
      response: SetupTestDto,
    },
    latest: {
      method: 'GET',
      path: '/api/projects/:projectId/setup-tests/latest',
      params: projectParams,
      response: SetupTestDto.nullable(),
    },
    end: { method: 'POST', path: '/api/setup-tests/:setupTestId/end', params: setupTestParams, response: empty },
    /** SSE (text/event-stream): `event: status` (SetupTestDto) then `event: event` (RunEventDto) frames. */
    events: {
      method: 'GET',
      path: '/api/setup-tests/:setupTestId/events',
      params: setupTestParams,
      query: z.object({ after: z.coerce.number().int().min(0).max(2147483647).optional(), ...orgQuery }),
      response: SetupTestDto,
    },
    /** WebSocket upgrade, framed like runs.terminal; the gateway lands separately from the HTTP controllers. */
    terminal: {
      method: 'GET',
      path: '/api/setup-tests/:setupTestId/terminal',
      params: setupTestParams,
      query: z.object(orgQuery),
      response: empty,
    },
  },
  runs: {
    list: {
      method: 'GET',
      path: '/api/projects/:projectId/runs',
      params: projectParams,
      query: RunListQuery,
      response: RunListResponse,
    },
    stats: {
      method: 'GET',
      path: '/api/projects/:projectId/runs/stats',
      params: projectParams,
      query: RunStatsQuery,
      response: RunStatsDto,
    },
    byNumber: {
      method: 'GET',
      path: '/api/projects/:projectId/runs/:number',
      params: z.object({ projectId: z.uuid(), number: z.coerce.number().int().min(1) }),
      response: RunDto,
    },
    get: { method: 'GET', path: '/api/runs/:runId', params: runParams, response: RunDto },
    log: { method: 'GET', path: '/api/runs/:runId/log', params: runParams, response: RunLogResponse },
    cancel: { method: 'POST', path: '/api/runs/:runId/cancel', params: runParams, response: empty },
    finish: { method: 'POST', path: '/api/runs/:runId/finish', params: runParams, response: empty },
    resume: { method: 'POST', path: '/api/runs/:runId/resume', params: runParams, response: empty },
    stop: { method: 'POST', path: '/api/runs/:runId/stop', params: runParams, response: empty },
    /** Ends a reopened session: the run returns to succeeded with its disk kept for a fresh keep time. */
    closeSession: { method: 'POST', path: '/api/runs/:runId/close-session', params: runParams, response: empty },
    transcript: {
      method: 'GET',
      path: '/api/runs/:runId/transcript',
      params: runParams,
      query: RunTranscriptQuery,
      response: RunTranscriptResponse,
    },
    /** SSE (text/event-stream): `event: status` (RunStatusEvent) then `event: event` (RunEventMessage) frames. */
    events: {
      method: 'GET',
      path: '/api/runs/:runId/events',
      params: runParams,
      query: z.object({ after: z.coerce.number().int().min(0).max(2147483647).optional(), ...orgQuery }),
      response: RunStatusEvent,
    },
    /** WebSocket upgrade: binary terminal bytes both ways; text `{"type":"resize","cols","rows"}`; close 4401/4403/4409/4410/4412. */
    terminal: {
      method: 'GET',
      path: '/api/runs/:runId/terminal',
      params: runParams,
      query: z.object(orgQuery),
      response: empty,
    },
  },
  me: {
    access: { method: 'GET', path: '/api/me/access', response: AccessDto },
    platform: { method: 'GET', path: '/api/me/platform', response: PlatformSessionDto },
    listInvitations: {
      method: 'GET',
      path: '/api/me/invitations',
      query: PageQuery,
      response: pageOf(MyInvitationDto),
    },
    getInvitation: {
      method: 'GET',
      path: '/api/me/invitations/:invitationId',
      params: invitationParams,
      response: MyInvitationDto,
    },
    acceptInvitation: {
      method: 'POST',
      path: '/api/me/invitations/:invitationId/accept',
      params: invitationParams,
      response: AcceptInvitationResponse,
    },
    declineInvitation: {
      method: 'POST',
      path: '/api/me/invitations/:invitationId/decline',
      params: invitationParams,
      response: empty,
    },
  },
  orgs: {
    update: { method: 'PATCH', path: '/api/orgs/:orgId', params: orgParams, body: UpdateOrgRequest, response: OrgDto },
    checklist: { method: 'GET', path: '/api/orgs/:orgId/checklist', params: orgParams, response: OrgChecklistDto },
  },
  roles: {
    list: { method: 'GET', path: '/api/orgs/:orgId/roles', params: orgParams, response: z.array(RoleDto) },
  },
  members: {
    list: {
      method: 'GET',
      path: '/api/orgs/:orgId/members',
      params: orgParams,
      query: MembersListQuery,
      response: pageOf(MemberDto),
    },
    updateRole: {
      method: 'PUT',
      path: '/api/orgs/:orgId/members/:userId/role',
      params: orgMemberParams,
      body: UpdateMemberRoleRequest,
      response: MemberDto,
    },
    remove: {
      method: 'DELETE',
      path: '/api/orgs/:orgId/members/:userId',
      params: orgMemberParams,
      response: empty,
    },
  },
  projectMembers: {
    list: {
      method: 'GET',
      path: '/api/projects/:projectId/members',
      params: projectParams,
      query: PageQuery,
      response: pageOf(ProjectMemberDto),
    },
    add: {
      method: 'POST',
      path: '/api/projects/:projectId/members',
      params: projectParams,
      body: AddProjectMemberRequest,
      response: ProjectMemberDto,
    },
    setRole: {
      method: 'PUT',
      path: '/api/projects/:projectId/members/:userId/role',
      params: projectMemberParams,
      body: SetProjectRoleRequest,
      response: ProjectMemberDto,
    },
    remove: {
      method: 'DELETE',
      path: '/api/projects/:projectId/members/:userId',
      params: projectMemberParams,
      response: empty,
    },
  },
  audit: {
    list: {
      method: 'GET',
      path: '/api/orgs/:orgId/audit',
      params: orgParams,
      query: PageQuery,
      response: pageOf(AuditEntryDto),
    },
  },
  assignments: {
    list: {
      method: 'GET',
      path: '/api/orgs/:orgId/assignments',
      params: orgParams,
      query: AssignmentListQuery,
      response: pageOf(AssignmentDto),
    },
    create: {
      method: 'POST',
      path: '/api/orgs/:orgId/assignments',
      params: orgParams,
      body: CreateAssignmentRequest,
      response: AssignmentDto,
    },
    remove: {
      method: 'DELETE',
      path: '/api/orgs/:orgId/assignments/:assignmentId',
      params: orgAssignmentParams,
      response: empty,
    },
  },
  invitations: {
    list: {
      method: 'GET',
      path: '/api/orgs/:orgId/invitations',
      params: orgParams,
      query: InvitationListQuery,
      response: pageOf(InvitationDto),
    },
    create: {
      method: 'POST',
      path: '/api/orgs/:orgId/invitations',
      params: orgParams,
      body: CreateInvitationRequest,
      response: InvitationDto,
    },
    remove: {
      method: 'DELETE',
      path: '/api/orgs/:orgId/invitations/:invitationId',
      params: orgInvitationParams,
      response: empty,
    },
    resend: {
      method: 'POST',
      path: '/api/orgs/:orgId/invitations/:invitationId/resend',
      params: orgInvitationParams,
      response: InvitationDto,
    },
  },
  platform: {
    createOrg: { method: 'POST', path: '/api/platform/orgs', body: CreateOrgRequest, response: CreateOrgResponse },
    listOrgs: {
      method: 'GET',
      path: '/api/platform/orgs',
      query: PlatformOrgListQuery,
      response: pageOf(PlatformOrgDto),
    },
    getOrg: { method: 'GET', path: '/api/platform/orgs/:orgId', params: orgParams, response: PlatformOrgDetailDto },
    suspendOrg: {
      method: 'POST',
      path: '/api/platform/orgs/:orgId/suspend',
      params: orgParams,
      body: OrgStatusChangeRequest,
      response: PlatformOrgDetailDto,
    },
    reactivateOrg: {
      method: 'POST',
      path: '/api/platform/orgs/:orgId/reactivate',
      params: orgParams,
      body: OrgStatusChangeRequest,
      response: PlatformOrgDetailDto,
    },
    listProjects: {
      method: 'GET',
      path: '/api/platform/orgs/:orgId/projects',
      params: orgParams,
      query: PageQuery,
      response: pageOf(PlatformProjectDto),
    },
    listRoles: {
      method: 'GET',
      path: '/api/platform/orgs/:orgId/roles',
      params: orgParams,
      response: z.array(PlatformRoleDto),
    },
    listMembers: {
      method: 'GET',
      path: '/api/platform/orgs/:orgId/members',
      params: orgParams,
      query: PageQuery,
      response: pageOf(PlatformMemberDto),
    },
    listAssignments: {
      method: 'GET',
      path: '/api/platform/orgs/:orgId/assignments',
      params: orgParams,
      query: AssignmentListQuery,
      response: pageOf(PlatformAssignmentDto),
    },
    createAssignment: {
      method: 'POST',
      path: '/api/platform/orgs/:orgId/assignments',
      params: orgParams,
      body: CreateAssignmentRequest,
      response: PlatformAssignmentDto,
    },
    removeAssignment: {
      method: 'DELETE',
      path: '/api/platform/orgs/:orgId/assignments/:assignmentId',
      params: orgAssignmentParams,
      response: empty,
    },
    listInvitations: {
      method: 'GET',
      path: '/api/platform/orgs/:orgId/invitations',
      params: orgParams,
      query: InvitationListQuery,
      response: pageOf(PlatformInvitationDto),
    },
    createInvitation: {
      method: 'POST',
      path: '/api/platform/orgs/:orgId/invitations',
      params: orgParams,
      body: CreateInvitationRequest,
      response: PlatformInvitationDto,
    },
    removeInvitation: {
      method: 'DELETE',
      path: '/api/platform/orgs/:orgId/invitations/:invitationId',
      params: orgInvitationParams,
      response: empty,
    },
    resendInvitation: {
      method: 'POST',
      path: '/api/platform/orgs/:orgId/invitations/:invitationId/resend',
      params: orgInvitationParams,
      response: PlatformInvitationDto,
    },
    listAdmins: { method: 'GET', path: '/api/platform/admins', query: PageQuery, response: pageOf(PlatformAdminDto) },
    grantAdmin: {
      method: 'POST',
      path: '/api/platform/admins',
      body: GrantPlatformAdminRequest,
      response: PlatformAdminDto,
    },
    revokeAdmin: {
      method: 'DELETE',
      path: '/api/platform/admins/:adminId',
      params: z.object({ adminId: z.uuid() }),
      response: empty,
    },
  },
} as const satisfies Record<string, Record<string, RouteDef>>;

export type Routes = typeof routes;

/** Flattens the grouped table to `{ 'runs.list': RouteDef, ... }`. */
export function flattenRoutes(table: Record<string, Record<string, RouteDef>>): Record<string, RouteDef> {
  const out: Record<string, RouteDef> = {};
  for (const [group, entries] of Object.entries(table)) {
    for (const [name, def] of Object.entries(entries)) out[`${group}.${name}`] = def;
  }
  return out;
}
