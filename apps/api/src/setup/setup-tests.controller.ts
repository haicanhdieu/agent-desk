import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { routes, type CreateSetupTestRequest, type SetupTestDto } from '@agentdesk/contracts';
import { CurrentOrg, type OrgContext } from '../auth/org-context';
import { routePath } from '../common/route-path';
import { ZodPipe } from '../common/zod-validation';
import { SetupTestStream } from './setup-test-stream';
import { SetupTestsService } from './setup-tests.service';

const ProjectParam = new ZodPipe(routes.setupTests.create.params);
const TestParam = new ZodPipe(routes.setupTests.end.params);
const CreateBody = new ZodPipe(routes.setupTests.create.body);
const EventsQuery = new ZodPipe(routes.setupTests.events.query);

const MAX_SEQ = 2147483647;

/** `Last-Event-ID` is only honoured as a plain non-negative integer; anything else means "from the start". */
function parseLastEventId(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^\d{1,15}$/.test(raw)) return undefined;
  const n = Number(raw);
  return n <= MAX_SEQ ? n : undefined;
}

@Controller()
export class SetupTestsController {
  constructor(
    @Inject(SetupTestsService) private readonly service: SetupTestsService,
    @Inject(SetupTestStream) private readonly stream: SetupTestStream,
  ) {}

  @Post(routePath(routes.setupTests.create))
  @HttpCode(200)
  create(
    @CurrentOrg() org: OrgContext,
    @Param(ProjectParam) p: { projectId: string },
    @Body(CreateBody) body: CreateSetupTestRequest,
  ): Promise<SetupTestDto> {
    return this.service.create(org, p.projectId, body);
  }

  @Get(routePath(routes.setupTests.latest))
  latest(@CurrentOrg() org: OrgContext, @Param(ProjectParam) p: { projectId: string }): Promise<SetupTestDto | null> {
    return this.service.latest(org, p.projectId);
  }

  @Post(routePath(routes.setupTests.end))
  @HttpCode(202)
  async end(@CurrentOrg() org: OrgContext, @Param(TestParam) p: { setupTestId: string }): Promise<null> {
    await this.service.end(org, p.setupTestId);
    return null;
  }

  /** Takes the raw reply like the run stream: errors before the stream starts are ordinary problem+json. */
  @Get(routePath(routes.setupTests.events))
  async events(
    @CurrentOrg() org: OrgContext,
    @Param(TestParam) p: { setupTestId: string },
    @Query(EventsQuery) q: { after?: number },
    @Headers('last-event-id') lastEventId: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const after = q.after ?? parseLastEventId(lastEventId) ?? 0;
    await this.stream.stream(org, p.setupTestId, after, reply);
  }
}
