import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { routes, type Page, type PageQuery, type PlatformMemberDto } from '@agentdesk/contracts';
import { CurrentPlatformAdmin, type PlatformAdminContext } from '../access/current-access';
import { routePath } from '../common/route-path';
import { ZodPipe } from '../common/zod-validation';
import { MembersService } from './members.service';

const ListParams = new ZodPipe(routes.platform.listMembers.params);
const ListQuery = new ZodPipe(routes.platform.listMembers.query);

/** `/api/platform/orgs/:orgId/members`: reachable only by a config-listed platform admin (SessionGuard, `scope: 'platform'`). */
@Controller()
export class PlatformMembersController {
  constructor(@Inject(MembersService) private readonly members: MembersService) {}

  @Get(routePath(routes.platform.listMembers)) // routes.platform.listMembers
  list(
    // the decorator makes the guard's platform decision mandatory for this handler
    @CurrentPlatformAdmin() _admin: PlatformAdminContext,
    @Param(ListParams) p: { orgId: string },
    @Query(ListQuery) q: PageQuery,
  ): Promise<Page<PlatformMemberDto>> {
    return this.members.listForPlatform(p.orgId, q);
  }
}
