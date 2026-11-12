import { Body, Controller, Get, Inject, Param, Put } from '@nestjs/common';
import {
  routes,
  type AgentDto,
  type PutAgentRequest,
  type PutCredentialRequest,
  type PutCredentialResponse,
} from '@agentdesk/contracts';
import { CurrentOrg, type OrgContext } from '../auth/org-context';
import { routePath } from '../common/route-path';
import { ZodPipe } from '../common/zod-validation';
import { AgentsService } from './agents.service';

const ProjectParam = new ZodPipe(routes.agents.get.params);
const AgentParam = new ZodPipe(routes.agents.putCredential.params);
const PutBody = new ZodPipe(routes.agents.put.body);
const CredentialBody = new ZodPipe(routes.agents.putCredential.body);

@Controller()
export class AgentsController {
  constructor(@Inject(AgentsService) private readonly service: AgentsService) {}

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
}
