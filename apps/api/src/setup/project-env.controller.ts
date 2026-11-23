import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import {
  routes,
  type CreateEnvSecretRequest,
  type CreateEnvVarRequest,
  type EnvEntryDto,
  type EnvListQuery,
  type Page,
  type UpdateEnvSecretRequest,
  type UpdateEnvVarRequest,
} from '@agentdesk/contracts';
import { CurrentOrg, type OrgContext } from '../auth/org-context';
import { routePath } from '../common/route-path';
import { ZodPipe } from '../common/zod-validation';
import { ProjectEnvService } from './project-env.service';

const ProjectParam = new ZodPipe(routes.projectEnv.list.params);
const EntryParams = new ZodPipe(routes.projectEnv.updateVar.params);
const ListQuery = new ZodPipe(routes.projectEnv.list.query);
const CreateVarBody = new ZodPipe(routes.projectEnv.createVar.body);
const UpdateVarBody = new ZodPipe(routes.projectEnv.updateVar.body);
const CreateSecretBody = new ZodPipe(routes.projectEnv.createSecret.body);
const UpdateSecretBody = new ZodPipe(routes.projectEnv.updateSecret.body);

interface EntryParamsValue {
  projectId: string;
  name: string;
}

@Controller()
export class ProjectEnvController {
  constructor(@Inject(ProjectEnvService) private readonly service: ProjectEnvService) {}

  @Get(routePath(routes.projectEnv.list))
  list(
    @CurrentOrg() org: OrgContext,
    @Param(ProjectParam) p: { projectId: string },
    @Query(ListQuery) q: EnvListQuery,
  ): Promise<Page<EnvEntryDto>> {
    return this.service.list(org, p.projectId, q);
  }

  @Post(routePath(routes.projectEnv.createVar))
  createVar(
    @CurrentOrg() org: OrgContext,
    @Param(ProjectParam) p: { projectId: string },
    @Body(CreateVarBody) body: CreateEnvVarRequest,
  ): Promise<EnvEntryDto> {
    return this.service.createVar(org, p.projectId, org.userId, body);
  }

  @Put(routePath(routes.projectEnv.updateVar))
  updateVar(
    @CurrentOrg() org: OrgContext,
    @Param(EntryParams) p: EntryParamsValue,
    @Body(UpdateVarBody) body: UpdateEnvVarRequest,
  ): Promise<EnvEntryDto> {
    return this.service.updateVar(org, p.projectId, org.userId, p.name, body);
  }

  @Delete(routePath(routes.projectEnv.removeVar))
  @HttpCode(204)
  removeVar(@CurrentOrg() org: OrgContext, @Param(EntryParams) p: EntryParamsValue): Promise<void> {
    return this.service.removeVar(org, p.projectId, p.name);
  }

  @Post(routePath(routes.projectEnv.createSecret))
  createSecret(
    @CurrentOrg() org: OrgContext,
    @Param(ProjectParam) p: { projectId: string },
    @Body(CreateSecretBody) body: CreateEnvSecretRequest,
  ): Promise<EnvEntryDto> {
    return this.service.createSecret(org, p.projectId, org.userId, body);
  }

  @Put(routePath(routes.projectEnv.updateSecret))
  updateSecret(
    @CurrentOrg() org: OrgContext,
    @Param(EntryParams) p: EntryParamsValue,
    @Body(UpdateSecretBody) body: UpdateEnvSecretRequest,
  ): Promise<EnvEntryDto> {
    return this.service.updateSecret(org, p.projectId, org.userId, p.name, body);
  }

  @Delete(routePath(routes.projectEnv.removeSecret))
  @HttpCode(204)
  removeSecret(@CurrentOrg() org: OrgContext, @Param(EntryParams) p: EntryParamsValue): Promise<void> {
    return this.service.removeSecret(org, p.projectId, p.name);
  }
}
