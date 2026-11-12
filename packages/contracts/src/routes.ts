import { z } from 'zod';
import { Provider } from './enums';
import { AgentDto, PutAgentRequest, PutCredentialRequest, PutCredentialResponse } from './schemas/agents';
import { ConnectionDto, InstallResponse, RepoDto } from './schemas/connections';
import {
  CreateProjectRequest,
  IgnoredEventDto,
  ProjectConnectionDto,
  ProjectDto,
  UpdateProjectRequest,
} from './schemas/projects';
import { CreateRuleRequest, RuleDto, UpdateRuleRequest } from './schemas/rules';
import { RunStatusEvent, ProjectRunEvent } from './schemas/events';
import { RunDto, RunListQuery, RunListResponse, RunLogResponse } from './schemas/runs';
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
const runParams = z.object({ runId: z.uuid() });
const ruleParams = z.object({ ruleId: z.uuid() });
const skillParams = z.object({ projectId: z.uuid(), name: SkillName });
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
    repos: {
      method: 'GET',
      path: '/api/connections/:connectionId/repos',
      params: z.object({ connectionId: z.uuid() }),
      response: z.array(RepoDto),
    },
  },
  projects: {
    list: { method: 'GET', path: '/api/projects', response: z.array(ProjectDto) },
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
    connection: {
      method: 'GET',
      path: '/api/projects/:projectId/connection',
      params: projectParams,
      response: ProjectConnectionDto,
    },
    ignored: {
      method: 'GET',
      path: '/api/projects/:projectId/ignored',
      params: projectParams,
      response: z.array(IgnoredEventDto),
    },
    /** SSE (text/event-stream): `event: run` frames, each a ProjectRunEvent. */
    events: {
      method: 'GET',
      path: '/api/projects/:projectId/events',
      params: projectParams,
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
  },
  skills: {
    list: {
      method: 'GET',
      path: '/api/projects/:projectId/skills',
      params: projectParams,
      response: z.array(SkillSummaryDto),
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
    list: { method: 'GET', path: '/api/projects/:projectId/rules', params: projectParams, response: z.array(RuleDto) },
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
    remove: { method: 'DELETE', path: '/api/rules/:ruleId', params: ruleParams, response: empty },
  },
  runs: {
    list: {
      method: 'GET',
      path: '/api/projects/:projectId/runs',
      params: projectParams,
      query: RunListQuery,
      response: RunListResponse,
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
    /** SSE (text/event-stream): `event: status` (RunStatusEvent) then `event: event` (RunEventMessage) frames. */
    events: {
      method: 'GET',
      path: '/api/runs/:runId/events',
      params: runParams,
      query: z.object({ after: z.coerce.number().int().min(0).max(2147483647).optional() }),
      response: RunStatusEvent,
    },
    /** WebSocket upgrade: binary terminal bytes both ways; text `{"type":"resize","cols","rows"}`; close 4401/4403/4409. */
    terminal: { method: 'GET', path: '/api/runs/:runId/terminal', params: runParams, response: empty },
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
