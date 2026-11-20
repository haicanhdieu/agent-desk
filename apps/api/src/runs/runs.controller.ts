import { Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import {
  routes,
  type IgnoredEventDto,
  type RunDto,
  type RunListQuery,
  type RunListResponse,
  type RunLogResponse,
  type RunTranscriptQuery,
  type RunTranscriptResponse,
} from '@agentdesk/contracts';
import { CurrentOrg, type OrgContext } from '../auth/org-context';
import { routePath } from '../common/route-path';
import { ZodPipe } from '../common/zod-validation';
import { RunsService } from './runs.service';

const ProjectParam = new ZodPipe(routes.runs.list.params);
const NumberParam = new ZodPipe(routes.runs.byNumber.params);
const RunParam = new ZodPipe(routes.runs.get.params);
const ListQuery = new ZodPipe(routes.runs.list.query);
const TranscriptQuery = new ZodPipe(routes.runs.transcript.query);

@Controller()
export class RunsController {
  constructor(@Inject(RunsService) private readonly service: RunsService) {}

  @Get(routePath(routes.runs.list))
  list(
    @CurrentOrg() org: OrgContext,
    @Param(ProjectParam) p: { projectId: string },
    @Query(ListQuery) q: RunListQuery,
  ): Promise<RunListResponse> {
    return this.service.list(org, p.projectId, q);
  }

  @Get(routePath(routes.runs.byNumber))
  byNumber(
    @CurrentOrg() org: OrgContext,
    @Param(NumberParam) p: { projectId: string; number: number },
  ): Promise<RunDto> {
    return this.service.byNumber(org, p.projectId, p.number);
  }

  @Get(routePath(routes.projects.ignored))
  ignored(@CurrentOrg() org: OrgContext, @Param(ProjectParam) p: { projectId: string }): Promise<IgnoredEventDto[]> {
    return this.service.ignored(org, p.projectId);
  }

  @Get(routePath(routes.runs.get))
  get(@CurrentOrg() org: OrgContext, @Param(RunParam) p: { runId: string }): Promise<RunDto> {
    return this.service.get(org, p.runId);
  }

  @Get(routePath(routes.runs.log))
  log(@CurrentOrg() org: OrgContext, @Param(RunParam) p: { runId: string }): Promise<RunLogResponse> {
    return this.service.log(org, p.runId);
  }

  @Get(routePath(routes.runs.transcript))
  transcript(
    @CurrentOrg() org: OrgContext,
    @Param(RunParam) p: { runId: string },
    @Query(TranscriptQuery) q: RunTranscriptQuery,
  ): Promise<RunTranscriptResponse> {
    return this.service.transcript(org, p.runId, q);
  }

  @Post(routePath(routes.runs.stop))
  @HttpCode(202)
  async stop(@CurrentOrg() org: OrgContext, @Param(RunParam) p: { runId: string }): Promise<null> {
    await this.service.stop(org, p.runId);
    return null;
  }

  @Post(routePath(routes.runs.cancel))
  @HttpCode(202)
  async cancel(@CurrentOrg() org: OrgContext, @Param(RunParam) p: { runId: string }): Promise<null> {
    await this.service.cancel(org, p.runId);
    return null;
  }

  @Post(routePath(routes.runs.finish))
  @HttpCode(202)
  async finish(@CurrentOrg() org: OrgContext, @Param(RunParam) p: { runId: string }): Promise<null> {
    await this.service.finish(org, p.runId);
    return null;
  }

  @Post(routePath(routes.runs.resume))
  @HttpCode(204)
  async resume(@CurrentOrg() org: OrgContext, @Param(RunParam) p: { runId: string }): Promise<null> {
    await this.service.resume(org, p.runId);
    return null;
  }
}
