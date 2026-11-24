import { Controller, Get, Inject, Query } from '@nestjs/common';
import { routes, type Page, type PlatformAuditEntryDto, type PlatformAuditListQuery } from '@agentdesk/contracts';
import { CurrentPlatformAdmin, type PlatformAdminContext } from '../access/current-access';
import { routePath } from '../common/route-path';
import { ZodPipe } from '../common/zod-validation';
import { PlatformAuditService } from './platform-audit.service';

const ListQuery = new ZodPipe(routes.platform.listAudit.query);

/** `/api/platform/audit`: `platform-audit:read` at platform level, decided by the guard before the query is parsed or any id looked up. */
@Controller()
export class PlatformAuditController {
  constructor(@Inject(PlatformAuditService) private readonly audit: PlatformAuditService) {}

  @Get(routePath(routes.platform.listAudit))
  list(
    @CurrentPlatformAdmin() _admin: PlatformAdminContext,
    @Query(ListQuery) q: PlatformAuditListQuery,
  ): Promise<Page<PlatformAuditEntryDto>> {
    return this.audit.list(q);
  }
}
