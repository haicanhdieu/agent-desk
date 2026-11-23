import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import {
  routes,
  type AddProjectMemberRequest,
  type Page,
  type PageQuery,
  type ProjectMemberDto,
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
}
