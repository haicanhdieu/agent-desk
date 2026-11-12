import { Controller, Get, Inject } from '@nestjs/common';
import type { ProjectDto } from '@agentdesk/contracts';
import { OrgDb } from '../auth/org-context';

/** Stub until the projects task lands: authenticated and org-scoped, returns nothing yet. */
@Controller('api/projects')
export class ProjectsController {
  constructor(@Inject(OrgDb) private readonly orgDb: OrgDb) {}

  @Get()
  async list(): Promise<ProjectDto[]> {
    return this.orgDb.run(async () => []);
  }
}
