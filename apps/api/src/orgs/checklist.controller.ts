import { Controller, Get, Inject, Param } from '@nestjs/common';
import { routes, type OrgChecklistDto } from '@agentdesk/contracts';
import { orgChecklist } from '@agentdesk/core';
import { projects, withOrg, type Db } from '@agentdesk/db';
import { CurrentAccess, type RequestAuthz } from '../access/current-access';
import { routePath } from '../common/route-path';
import { ZodPipe } from '../common/zod-validation';
import { DB } from '../db/db.module';

const Params = new ZodPipe(routes.orgs.checklist.params);

/**
 * `/api/orgs/:orgId/checklist`: the guard admits only holders of `project:create` at org scope (owner, org admin)
 * and 404s another org's id. Those holders see every project, so the checklist covers every project id of the org.
 */
@Controller()
export class ChecklistController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get(routePath(routes.orgs.checklist))
  checklist(@CurrentAccess() _authz: RequestAuthz, @Param(Params) p: { orgId: string }): Promise<OrgChecklistDto> {
    return withOrg(this.db, p.orgId, async (tx) => {
      const rows = await tx.select({ id: projects.id }).from(projects);
      return orgChecklist(
        tx,
        rows.map((r) => r.id),
      );
    });
  }
}
