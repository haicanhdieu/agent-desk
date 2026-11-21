import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { routes, type PrStatesQuery, type PrStatesResponse } from '@agentdesk/contracts';
import { CurrentOrg, type OrgContext } from '../auth/org-context';
import { routePath } from '../common/route-path';
import { ZodPipe } from '../common/zod-validation';
import { TicketsService } from './tickets.service';

const ProjectParam = new ZodPipe(routes.tickets.prStates.params);
const RefQuery = new ZodPipe(routes.tickets.prStates.query);

@Controller()
export class TicketsController {
  constructor(@Inject(TicketsService) private readonly service: TicketsService) {}

  @Get(routePath(routes.tickets.prStates))
  prStates(
    @CurrentOrg() org: OrgContext,
    @Param(ProjectParam) p: { projectId: string },
    @Query(RefQuery) q: PrStatesQuery,
  ): Promise<PrStatesResponse> {
    return this.service.prStates(org, p.projectId, q.ref);
  }
}
