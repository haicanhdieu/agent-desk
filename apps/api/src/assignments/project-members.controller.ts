import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import {
  routes,
  type AddProjectMemberRequest,
  type Page,
  type PageQuery,
  type ProjectMemberDto,
  type SetProjectRoleRequest,
} from '@agentdesk/contracts';
import { CurrentAccess, type RequestAuthz } from '../access/current-access';
import { CurrentOrg, type OrgContext } from '../auth/org-context';
import { routePath } from '../common/route-path';
import { ZodPipe } from '../common/zod-validation';
import { ProjectMembersService } from './project-members.service';

const ListParams = new ZodPipe(routes.projectMembers.list.params);
const ListQuery = new ZodPipe(routes.projectMembers.list.query);
const AddParams = new ZodPipe(routes.projectMembers.add.params);
const AddBody = new ZodPipe(routes.projectMembers.add.body);
const SetRoleParams = new ZodPipe(routes.projectMembers.setRole.params);
const SetRoleBody = new ZodPipe(routes.projectMembers.setRole.body);
const RemoveParams = new ZodPipe(routes.projectMembers.remove.params);

/** `/api/projects/:projectId/members`: the guard has already decided 403 (permission) and 404 (project scope). */
@Controller()
export class ProjectMembersController {
  constructor(@Inject(ProjectMembersService) private readonly members: ProjectMembersService) {}

  @Get(routePath(routes.projectMembers.list)) // routes.projectMembers.list
  list(
    @CurrentOrg() org: OrgContext,
    @Param(ListParams) p: { projectId: string },
    @Query(ListQuery) q: PageQuery,
  ): Promise<Page<ProjectMemberDto>> {
    return this.members.list(org.orgId, p.projectId, q);
  }

  @Post(routePath(routes.projectMembers.add)) // routes.projectMembers.add
  @HttpCode(201)
  add(
    @CurrentOrg() org: OrgContext,
    @CurrentAccess() authz: RequestAuthz,
    @Param(AddParams) p: { projectId: string },
    @Body(AddBody) body: AddProjectMemberRequest,
  ): Promise<ProjectMemberDto> {
    return this.members.add(authz.access, org.orgId, p.projectId, body);
  }

  @Put(routePath(routes.projectMembers.setRole)) // routes.projectMembers.setRole
  setRole(
    @CurrentOrg() org: OrgContext,
    @CurrentAccess() authz: RequestAuthz,
    @Param(SetRoleParams) p: { projectId: string; userId: string },
    @Body(SetRoleBody) body: SetProjectRoleRequest,
  ): Promise<ProjectMemberDto> {
    return this.members.setRole(authz.access, org.orgId, p.projectId, p.userId, body.roleId);
  }

  @Delete(routePath(routes.projectMembers.remove)) // routes.projectMembers.remove
  @HttpCode(204)
  remove(
    @CurrentOrg() org: OrgContext,
    @CurrentAccess() authz: RequestAuthz,
    @Param(RemoveParams) p: { projectId: string; userId: string },
  ): Promise<void> {
    return this.members.remove(authz.access, org.orgId, p.projectId, p.userId);
  }
}
