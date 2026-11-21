import { Controller, Get, Inject, Param } from '@nestjs/common';
import { routes, type OrgChecklistDto } from '@agentdesk/contracts';
import { CurrentAccess, type RequestAuthz } from '../access/current-access';
import { routePath } from '../common/route-path';
import { ZodPipe } from '../common/zod-validation';
import { ChecklistService } from './checklist.service';

const Params = new ZodPipe(routes.orgs.checklist.params);

/** `/api/orgs/:orgId/checklist`: the guard admits only holders of `project:create` at org scope and 404s another org's id. */
@Controller()
export class ChecklistController {
  constructor(@Inject(ChecklistService) private readonly service: ChecklistService) {}

  @Get(routePath(routes.orgs.checklist))
  checklist(@CurrentAccess() _authz: RequestAuthz, @Param(Params) p: { orgId: string }): Promise<OrgChecklistDto> {
    return this.service.checklist(p.orgId);
  }
}
