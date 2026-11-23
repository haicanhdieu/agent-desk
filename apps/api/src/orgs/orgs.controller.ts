import { Body, Controller, Inject, Param, Patch } from '@nestjs/common';
import { routes, type OrgDto, type UpdateOrgRequest } from '@agentdesk/contracts';
import { CurrentAccess, type RequestAuthz } from '../access/current-access';
import { routePath } from '../common/route-path';
import { ZodPipe } from '../common/zod-validation';
import { OrgsService } from './orgs.service';

const UpdateParams = new ZodPipe(routes.orgs.update.params);
const UpdateBody = new ZodPipe(routes.orgs.update.body);

/** `/api/orgs/:orgId`: org-level `org:update`, decided by the guard before any lookup; the tenant is the session's org. */
@Controller()
export class OrgsController {
  constructor(@Inject(OrgsService) private readonly orgs: OrgsService) {}

  @Patch(routePath(routes.orgs.update))
  update(
    @CurrentAccess() authz: RequestAuthz,
    @Param(UpdateParams) p: { orgId: string },
    @Body(UpdateBody) body: UpdateOrgRequest,
  ): Promise<OrgDto> {
    return this.orgs.update(authz.access.userId, p.orgId, body);
  }
}
