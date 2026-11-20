import { z } from 'zod';
import { Provider } from './enums';
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
const runParams = z.object({ runId: z.uuid() });
const ruleParams = z.object({ ruleId: z.uuid() });
const skillParams = z.object({ projectId: z.uuid(), name: SkillName });
const setupTestParams = z.object({ setupTestId: z.uuid() });
const setupVersionParams = z.object({ projectId: z.uuid(), version: z.coerce.number().int().min(1).max(2147483647) });
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
      query: z.object({ after: z.coerce.number().int().min(0).max(2147483647).optional() }),
      response: SetupTestDto,
    },
    /** WebSocket upgrade, framed like runs.terminal; the gateway lands separately from the HTTP controllers. */
    terminal: {
      method: 'GET',
      path: '/api/setup-tests/:setupTestId/terminal',
      params: setupTestParams,
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
      query: z.object({ after: z.coerce.number().int().min(0).max(2147483647).optional() }),
      response: RunStatusEvent,
    },
    /** WebSocket upgrade: binary terminal bytes both ways; text `{"type":"resize","cols","rows"}`; close 4401/4403/4409/4410. */
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
