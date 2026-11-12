import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Put, Query } from '@nestjs/common';
import {
  routes,
  type DeleteSkillQuery,
  type PutSkillRequest,
  type PutSkillResponse,
  type SkillDto,
  type SkillSummaryDto,
} from '@agentdesk/contracts';
import { CurrentOrg, type OrgContext } from '../auth/org-context';
import { routePath } from '../common/route-path';
import { ZodPipe } from '../common/zod-validation';
import { SkillsService } from './skills.service';

const ProjectParam = new ZodPipe(routes.skills.list.params);
const SkillParams = new ZodPipe(routes.skills.get.params);
const PutBody = new ZodPipe(routes.skills.put.body);
const DeleteQuery = new ZodPipe(routes.skills.remove.query);

interface SkillParams {
  projectId: string;
  name: string;
}

@Controller()
export class SkillsController {
  constructor(@Inject(SkillsService) private readonly service: SkillsService) {}

  @Get(routePath(routes.skills.list))
  list(@CurrentOrg() org: OrgContext, @Param(ProjectParam) p: { projectId: string }): Promise<SkillSummaryDto[]> {
    return this.service.list(org, p.projectId);
  }

  @Get(routePath(routes.skills.get))
  get(@CurrentOrg() org: OrgContext, @Param(SkillParams) p: SkillParams): Promise<SkillDto> {
    return this.service.get(org, p.projectId, p.name);
  }

  @Put(routePath(routes.skills.put))
  put(
    @CurrentOrg() org: OrgContext,
    @Param(SkillParams) p: SkillParams,
    @Body(PutBody) body: PutSkillRequest,
  ): Promise<PutSkillResponse> {
    return this.service.put(org, p.projectId, p.name, body);
  }

  @Delete(routePath(routes.skills.remove))
  @HttpCode(204)
  remove(
    @CurrentOrg() org: OrgContext,
    @Param(SkillParams) p: SkillParams,
    @Query(DeleteQuery) q: DeleteSkillQuery,
  ): Promise<void> {
    return this.service.remove(org, p.projectId, p.name, q.message);
  }
}
