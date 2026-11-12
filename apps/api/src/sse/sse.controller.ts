import { Controller, Get, Headers, Inject, Param, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { routes } from '@agentdesk/contracts';
import { CurrentOrg, type OrgContext } from '../auth/org-context';
import { routePath } from '../common/route-path';
import { ZodPipe } from '../common/zod-validation';
import { SseService } from './sse.service';

const RunParam = new ZodPipe(routes.runs.events.params);
const ProjectParam = new ZodPipe(routes.projects.events.params);
const EventsQuery = new ZodPipe(routes.runs.events.query);

/** `Last-Event-ID` is only honoured as a plain non-negative integer; anything else means "from the start". */
function parseLastEventId(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^\d{1,15}$/.test(raw)) return undefined;
  return Number(raw);
}

/**
 * Both handlers take the raw reply (`@Res()`): validation and the 404 happen first, so errors are ordinary problem+json,
 * and only then does the service hijack the response and stream. AuditInterceptor ignores GET.
 */
@Controller()
export class SseController {
  constructor(@Inject(SseService) private readonly sse: SseService) {}

  @Get(routePath(routes.runs.events))
  async runEvents(
    @CurrentOrg() org: OrgContext,
    @Param(RunParam) p: { runId: string },
    @Query(EventsQuery) q: { after?: number },
    @Headers('last-event-id') lastEventId: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    // The query parameter wins; the header (sent by EventSource on reconnect) applies only when `after` is absent.
    const after = q.after ?? parseLastEventId(lastEventId) ?? 0;
    await this.sse.streamRun(org, p.runId, after, reply);
  }

  @Get(routePath(routes.projects.events))
  async projectEvents(
    @CurrentOrg() org: OrgContext,
    @Param(ProjectParam) p: { projectId: string },
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.sse.streamProject(org, p.projectId, reply);
  }
}
