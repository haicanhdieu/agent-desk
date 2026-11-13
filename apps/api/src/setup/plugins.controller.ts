import { Controller, Get, Inject, Param } from '@nestjs/common';
import { routes, type PluginsDto } from '@agentdesk/contracts';
import { CurrentOrg, type OrgContext } from '../auth/org-context';
import { routePath } from '../common/route-path';
import { ZodPipe } from '../common/zod-validation';
import { PluginsService } from './plugins.service';

const ProjectParam = new ZodPipe(routes.setup.plugins.params);

@Controller()
export class PluginsController {
  constructor(@Inject(PluginsService) private readonly service: PluginsService) {}

  @Get(routePath(routes.setup.plugins))
  get(@CurrentOrg() org: OrgContext, @Param(ProjectParam) p: { projectId: string }): Promise<PluginsDto> {
    return this.service.get(org, p.projectId);
  }
}
