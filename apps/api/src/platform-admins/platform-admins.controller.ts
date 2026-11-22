import { Body, Controller, Get, Inject, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  routes,
  type GrantPlatformAdminRequest,
  type Page,
  type PageQuery,
  type PlatformAdminDto,
} from '@agentdesk/contracts';
import { CurrentPlatformAdmin, type PlatformAdminContext } from '../access/current-access';
import { routePath } from '../common/route-path';
import { ZodPipe } from '../common/zod-validation';
import { PlatformAdminsService } from './platform-admins.service';

const ListQuery = new ZodPipe(routes.platform.listAdmins.query);
const GrantBody = new ZodPipe(routes.platform.grantAdmin.body);

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

  /** 201 when created, 200 for a repeat of an existing entry. */
  @Post(routePath(routes.platform.grantAdmin))
  async grant(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Body(GrantBody) body: GrantPlatformAdminRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PlatformAdminDto> {
    const { entry, created } = await this.admins.grant(admin.userId, body);
    void reply.status(created ? 201 : 200);
    return entry;
  }
}
