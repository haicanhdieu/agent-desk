import { Controller, Get, Inject, Param } from '@nestjs/common';
import { routes, type RoleDto } from '@agentdesk/contracts';
import { routePath } from '../common/route-path';
import { ZodPipe } from '../common/zod-validation';
import { OrgsService } from '../orgs/orgs.service';

const ListParams = new ZodPipe(routes.roles.list.params);

/** `/api/orgs/:orgId/roles`: the guard lets any holder of an assignment in the active org through. */
@Controller()
export class RolesController {
  constructor(@Inject(OrgsService) private readonly orgs: OrgsService) {}

  @Get(routePath(routes.roles.list)) // routes.roles.list
  list(@Param(ListParams) p: { orgId: string }): Promise<RoleDto[]> {
    return this.orgs.listRoles(p.orgId);
  }
}
