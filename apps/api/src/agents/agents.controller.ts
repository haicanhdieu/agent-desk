import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  routes,
  type AgentConnectionDto,
  type AgentDto,
  type AgentModelsDto,
  type CreateAgentRequest,
  type Page,
  type PageQuery,
  type PutAgentRequest,
  type PutCredentialRequest,
  type PutCredentialResponse,
  type UpdateAgentRequest,
} from '@agentdesk/contracts';
import { CurrentOrg, type OrgContext } from '../auth/org-context';
import { routePath } from '../common/route-path';
import { ZodPipe } from '../common/zod-validation';
import { AgentsService } from './agents.service';
import { ProviderPipe } from './provider-pipe';

const ProjectParam = new ZodPipe(routes.agents.get.params);
const AgentParam = new ZodPipe(routes.agents.putCredential.params);
const ModelsParam = new ZodPipe(routes.agents.models.params);
const ListQuery = new ZodPipe(routes.agents.list.query);
const PutBody = new ProviderPipe(new ZodPipe(routes.agents.put.body));
const CreateBody = new ProviderPipe(new ZodPipe(routes.agents.create.body));
const UpdateBody = new ProviderPipe(new ZodPipe(routes.agents.update.body));
const CredentialBody = new ZodPipe(routes.agents.putCredential.body);

/** The guard has already decided 403 (permission) and 404 (project or agent scope) for every route here. */
@Controller()
export class AgentsController {
  constructor(@Inject(AgentsService) private readonly service: AgentsService) {}

  @Get(routePath(routes.agents.list))
  list(
    @CurrentOrg() org: OrgContext,
    @Param(ProjectParam) p: { projectId: string },
    @Query(ListQuery) q: PageQuery,
  ): Promise<Page<AgentDto>> {
    return this.service.list(org, p.projectId, q);
  }

  @Post(routePath(routes.agents.create))
  @HttpCode(201)
  create(
    @CurrentOrg() org: OrgContext,
    @Param(ProjectParam) p: { projectId: string },
    @Body(CreateBody) body: CreateAgentRequest,
  ): Promise<AgentDto> {
    return this.service.create(org, p.projectId, body);
  }

  @Patch(routePath(routes.agents.update))
  update(
    @CurrentOrg() org: OrgContext,
    @Param(AgentParam) p: { agentId: string },
    @Body(UpdateBody) body: UpdateAgentRequest,
  ): Promise<AgentDto> {
    return this.service.update(org, p.agentId, body);
  }

  @Post(routePath(routes.agents.setDefault))
  @HttpCode(200)
  setDefault(@CurrentOrg() org: OrgContext, @Param(AgentParam) p: { agentId: string }): Promise<AgentDto> {
    return this.service.setDefault(org, p.agentId);
  }

  @Delete(routePath(routes.agents.remove))
  @HttpCode(204)
  remove(@CurrentOrg() org: OrgContext, @Param(AgentParam) p: { agentId: string }): Promise<void> {
    return this.service.remove(org, p.agentId);
  }

  @Post(routePath(routes.agents.test))
  @HttpCode(200)
  test(@CurrentOrg() org: OrgContext, @Param(AgentParam) p: { agentId: string }): Promise<AgentConnectionDto> {
    return this.service.test(org, p.agentId);
  }

  @Get(routePath(routes.agents.get))
  get(@CurrentOrg() org: OrgContext, @Param(ProjectParam) p: { projectId: string }): Promise<AgentDto> {
    return this.service.get(org, p.projectId);
  }

  @Put(routePath(routes.agents.put))
  put(
    @CurrentOrg() org: OrgContext,
    @Param(ProjectParam) p: { projectId: string },
    @Body(PutBody) body: PutAgentRequest,
  ): Promise<AgentDto> {
    return this.service.put(org, p.projectId, body);
  }

  @Put(routePath(routes.agents.putCredential))
  putCredential(
    @CurrentOrg() org: OrgContext,
    @Param(AgentParam) p: { agentId: string },
    @Body(CredentialBody) body: PutCredentialRequest,
  ): Promise<PutCredentialResponse> {
    return this.service.putCredential(org, p.agentId, body);
  }

  @Get(routePath(routes.agents.models))
  models(@CurrentOrg() org: OrgContext, @Param(ModelsParam) p: { agentId: string }): Promise<AgentModelsDto> {
    return this.service.models(org, p.agentId);
  }
}
