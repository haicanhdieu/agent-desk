import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import { routes, type CreateRuleRequest, type RuleDto, type UpdateRuleRequest } from '@agentdesk/contracts';
import { CurrentOrg, type OrgContext } from '../auth/org-context';
import { routePath } from '../common/route-path';
import { ZodPipe } from '../common/zod-validation';
import { RulesService } from './rules.service';

const ProjectParam = new ZodPipe(routes.rules.list.params);
const RuleParam = new ZodPipe(routes.rules.update.params);
const CreateBody = new ZodPipe(routes.rules.create.body);
const UpdateBody = new ZodPipe(routes.rules.update.body);

@Controller()
export class RulesController {
  constructor(@Inject(RulesService) private readonly service: RulesService) {}

  @Get(routePath(routes.rules.list))
  list(@CurrentOrg() org: OrgContext, @Param(ProjectParam) p: { projectId: string }): Promise<RuleDto[]> {
    return this.service.list(org, p.projectId);
  }

  @Post(routePath(routes.rules.create))
  create(
    @CurrentOrg() org: OrgContext,
    @Param(ProjectParam) p: { projectId: string },
    @Body(CreateBody) body: CreateRuleRequest,
  ): Promise<RuleDto> {
    return this.service.create(org, p.projectId, body);
  }

  @Patch(routePath(routes.rules.update))
  update(
    @CurrentOrg() org: OrgContext,
    @Param(RuleParam) p: { ruleId: string },
    @Body(UpdateBody) body: UpdateRuleRequest,
  ): Promise<RuleDto> {
    return this.service.update(org, p.ruleId, body);
  }

  @Delete(routePath(routes.rules.remove))
  @HttpCode(204)
  remove(@CurrentOrg() org: OrgContext, @Param(RuleParam) p: { ruleId: string }): Promise<void> {
    return this.service.remove(org, p.ruleId);
  }
}
