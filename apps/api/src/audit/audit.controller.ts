import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { routes, type AuditEntryDto, type Page, type PageQuery } from '@agentdesk/contracts';
import { routePath } from '../common/route-path';
import { ZodPipe } from '../common/zod-validation';
import { AuditService } from './audit.service';

const ListParams = new ZodPipe(routes.audit.list.params);
const ListQuery = new ZodPipe(routes.audit.list.query);

/** `/api/orgs/:orgId/audit`: org-level `audit:read`, decided by the guard before any lookup; the tenant is the session's org. */
@Controller()
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get(routePath(routes.audit.list))
  list(@Param(ListParams) p: { orgId: string }, @Query(ListQuery) q: PageQuery): Promise<Page<AuditEntryDto>> {
    return this.audit.list(p.orgId, q);
  }
}
