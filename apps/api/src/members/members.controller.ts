import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { routes, type MemberDto, type Page, type PageQuery } from '@agentdesk/contracts';
import { CurrentAccess, type RequestAuthz } from '../access/current-access';
import { routePath } from '../common/route-path';
import { ZodPipe } from '../common/zod-validation';
import { MembersService } from './members.service';

const ListParams = new ZodPipe(routes.members.list.params);
const ListQuery = new ZodPipe(routes.members.list.query);

/** `/api/orgs/:orgId/members`: org-admin route; the service decides which assignments the caller sees. Never an email. */
@Controller()
export class MembersController {
  constructor(@Inject(MembersService) private readonly members: MembersService) {}

  @Get(routePath(routes.members.list)) // routes.members.list
  list(
    @CurrentAccess() authz: RequestAuthz,
    @Param(ListParams) p: { orgId: string },
    @Query(ListQuery) q: PageQuery,
  ): Promise<Page<MemberDto>> {
    return this.members.list(authz.access, p.orgId, q);
  }
}
