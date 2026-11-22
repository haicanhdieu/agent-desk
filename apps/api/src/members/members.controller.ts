import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Put, Query } from '@nestjs/common';
import { routes, type MemberDto, type Page, type PageQuery, type UpdateMemberRoleRequest } from '@agentdesk/contracts';
import { CurrentAccess, type RequestAuthz } from '../access/current-access';
import { routePath } from '../common/route-path';
import { ZodPipe } from '../common/zod-validation';
import { MembersService } from './members.service';

const ListParams = new ZodPipe(routes.members.list.params);
const ListQuery = new ZodPipe(routes.members.list.query);
const UpdateRoleParams = new ZodPipe(routes.members.updateRole.params);
const RemoveParams = new ZodPipe(routes.members.remove.params);
const UpdateRoleBody = new ZodPipe(routes.members.updateRole.body);

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

  @Put(routePath(routes.members.updateRole))
  updateRole(
    @CurrentAccess() authz: RequestAuthz,
    @Param(UpdateRoleParams) p: { orgId: string; userId: string },
    @Body(UpdateRoleBody) body: UpdateMemberRoleRequest,
  ): Promise<MemberDto> {
    return this.members.updateRole(authz.access, p.orgId, p.userId, body.roleId);
  }

  @Delete(routePath(routes.members.remove))
  @HttpCode(204)
  async remove(
    @CurrentAccess() authz: RequestAuthz,
    @Param(RemoveParams) p: { orgId: string; userId: string },
  ): Promise<void> {
    await this.members.remove(authz.access, p.orgId, p.userId);
  }
}
