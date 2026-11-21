import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import {
  routes,
  type CreateProjectRequest,
  type Page,
  type PageQuery,
  type ProjectConnectionDto,
  type ProjectDto,
  type UpdateProjectRequest,
} from '@agentdesk/contracts';
import { CurrentAccess, type RequestAuthz } from '../access/current-access';
import { CurrentOrg, type OrgContext } from '../auth/org-context';
import { routePath } from '../common/route-path';
import { ZodPipe } from '../common/zod-validation';
import { ProjectsService } from './projects.service';

const ListQuery = new ZodPipe(routes.projects.list.query);
const IdParam = new ZodPipe(routes.projects.get.params);
const CreateBody = new ZodPipe(routes.projects.create.body);
const UpdateBody = new ZodPipe(routes.projects.update.body);

@Controller()
export class ProjectsController {
  constructor(@Inject(ProjectsService) private readonly service: ProjectsService) {}

  @Get(routePath(routes.projects.list))
  list(
    @CurrentOrg() org: OrgContext,
    @CurrentAccess() authz: RequestAuthz,
    @Query(ListQuery) q: PageQuery,
  ): Promise<Page<ProjectDto>> {
    return this.service.list(org, authz, q);
  }

  @Post(routePath(routes.projects.create))
  create(@CurrentOrg() org: OrgContext, @Body(CreateBody) body: CreateProjectRequest): Promise<ProjectDto> {
    return this.service.create(org, body);
  }

  @Get(routePath(routes.projects.get))
  get(@CurrentOrg() org: OrgContext, @Param(IdParam) p: { projectId: string }): Promise<ProjectDto> {
    return this.service.get(org, p.projectId);
  }

  @Patch(routePath(routes.projects.update))
  update(
    @CurrentOrg() org: OrgContext,
    @Param(IdParam) p: { projectId: string },
    @Body(UpdateBody) body: UpdateProjectRequest,
  ): Promise<ProjectDto> {
    return this.service.update(org, p.projectId, body);
  }

  @Delete(routePath(routes.projects.remove))
  @HttpCode(204)
  remove(@CurrentOrg() org: OrgContext, @Param(IdParam) p: { projectId: string }): Promise<void> {
    return this.service.remove(org, p.projectId);
  }

  @Get(routePath(routes.projects.connection))
  connection(@CurrentOrg() org: OrgContext, @Param(IdParam) p: { projectId: string }): Promise<ProjectConnectionDto> {
    return this.service.connection(org, p.projectId);
  }

  @Post(routePath(routes.projects.pollNow))
  @HttpCode(202)
  async pollNow(@CurrentOrg() org: OrgContext, @Param(IdParam) p: { projectId: string }): Promise<null> {
    await this.service.pollNow(org, p.projectId);
    return null;
  }
}
