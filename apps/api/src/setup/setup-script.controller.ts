import { Body, Controller, Get, Inject, Param, Put, Query } from '@nestjs/common';
import {
  routes,
  type Page,
  type PageQuery,
  type PutSetupScriptRequest,
  type SetupScriptDto,
  type SetupScriptVersionDto,
} from '@agentdesk/contracts';
import { CurrentOrg, type OrgContext } from '../auth/org-context';
import { routePath } from '../common/route-path';
import { ZodPipe } from '../common/zod-validation';
import { SetupScriptService } from './setup-script.service';

const ProjectParam = new ZodPipe(routes.setupScript.get.params);
const VersionParams = new ZodPipe(routes.setupScript.version.params);
const VersionsQuery = new ZodPipe(routes.setupScript.versions.query);
const PutBody = new ZodPipe(routes.setupScript.put.body);

@Controller()
export class SetupScriptController {
  constructor(@Inject(SetupScriptService) private readonly service: SetupScriptService) {}

  @Get(routePath(routes.setupScript.get))
  get(@CurrentOrg() org: OrgContext, @Param(ProjectParam) p: { projectId: string }): Promise<SetupScriptDto | null> {
    return this.service.get(org, p.projectId);
  }

  @Put(routePath(routes.setupScript.put))
  put(
    @CurrentOrg() org: OrgContext,
    @Param(ProjectParam) p: { projectId: string },
    @Body(PutBody) body: PutSetupScriptRequest,
  ): Promise<SetupScriptDto> {
    return this.service.put(org, p.projectId, body);
  }

  @Get(routePath(routes.setupScript.versions))
  versions(
    @CurrentOrg() org: OrgContext,
    @Param(ProjectParam) p: { projectId: string },
    @Query(VersionsQuery) q: PageQuery,
  ): Promise<Page<SetupScriptVersionDto>> {
    return this.service.versions(org, p.projectId, q);
  }

  @Get(routePath(routes.setupScript.version))
  version(
    @CurrentOrg() org: OrgContext,
    @Param(VersionParams) p: { projectId: string; version: number },
  ): Promise<SetupScriptDto> {
    return this.service.version(org, p.projectId, p.version);
  }
}
