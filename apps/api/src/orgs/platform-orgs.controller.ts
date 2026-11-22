import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import {
  routes,
  type CreateOrgRequest,
  type CreateOrgResponse,
  type Page,
  type PageQuery,
  type PlatformOrgDto,
  type PlatformProjectDto,
  type PlatformRoleDto,
} from '@agentdesk/contracts';
import { CurrentPlatformAdmin, type PlatformAdminContext } from '../access/current-access';
import { routePath } from '../common/route-path';
import { ZodPipe } from '../common/zod-validation';
import { OrgsService } from './orgs.service';

const CreateBody = new ZodPipe(routes.platform.createOrg.body);
const ListOrgsQuery = new ZodPipe(routes.platform.listOrgs.query);
const ProjectsParams = new ZodPipe(routes.platform.listProjects.params);
const ProjectsQuery = new ZodPipe(routes.platform.listProjects.query);
const RolesParams = new ZodPipe(routes.platform.listRoles.params);

/** `/api/platform/*`: reachable only by a platform admin (a `platform_admins` entry matching the verified session email) (SessionGuard, `scope: 'platform'`). */
@Controller()
export class PlatformOrgsController {
  constructor(@Inject(OrgsService) private readonly orgs: OrgsService) {}

  @Post(routePath(routes.platform.createOrg))
  create(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Body(CreateBody) body: CreateOrgRequest,
  ): Promise<CreateOrgResponse> {
    return this.orgs.createOrg(admin.userId, body);
  }

  @Get(routePath(routes.platform.listOrgs))
  list(
    @CurrentPlatformAdmin() _admin: PlatformAdminContext,
    @Query(ListOrgsQuery) q: PageQuery,
  ): Promise<Page<PlatformOrgDto>> {
    return this.orgs.listOrgs(q);
  }

  @Get(routePath(routes.platform.listProjects))
  projects(
    @CurrentPlatformAdmin() _admin: PlatformAdminContext,
    @Param(ProjectsParams) p: { orgId: string },
    @Query(ProjectsQuery) q: PageQuery,
  ): Promise<Page<PlatformProjectDto>> {
    return this.orgs.listProjects(p.orgId, q);
  }

  @Get(routePath(routes.platform.listRoles))
  roles(
    @CurrentPlatformAdmin() _admin: PlatformAdminContext,
    @Param(RolesParams) p: { orgId: string },
  ): Promise<PlatformRoleDto[]> {
    return this.orgs.listRoles(p.orgId);
  }
}
