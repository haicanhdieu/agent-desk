import { Controller, Get, Inject, Query } from '@nestjs/common';
import { routes, type Page, type PageQuery, type PlatformAdminDto } from '@agentdesk/contracts';
import { CurrentPlatformAdmin, type PlatformAdminContext } from '../access/current-access';
import { routePath } from '../common/route-path';
import { ZodPipe } from '../common/zod-validation';
import { PlatformAdminsService } from './platform-admins.service';

const ListQuery = new ZodPipe(routes.platform.listAdmins.query);

/** `/api/platform/admins`: reachable only by a platform admin (a `platform_admins` entry matching the verified session email) (SessionGuard). */
@Controller()
export class PlatformAdminsController {
  constructor(@Inject(PlatformAdminsService) private readonly admins: PlatformAdminsService) {}

  @Get(routePath(routes.platform.listAdmins))
  list(
    @CurrentPlatformAdmin() _admin: PlatformAdminContext,
    @Query(ListQuery) q: PageQuery,
  ): Promise<Page<PlatformAdminDto>> {
    return this.admins.list(q);
  }
}
