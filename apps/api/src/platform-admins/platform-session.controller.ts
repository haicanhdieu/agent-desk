import { Controller, Get, Inject } from '@nestjs/common';
import { routes, type PlatformSessionDto } from '@agentdesk/contracts';
import type { Db } from '@agentdesk/db';
import { CurrentSessionUser, type SessionUser } from '../access/session-user';
import { isPlatformAdmin } from '../access/platform-admin';
import { routePath } from '../common/route-path';
import { DB } from '../db/db.module';

/** `/api/me/platform`: whether the signed-in user is a platform admin (the caller's own flag only; no org, no body). */
@Controller()
export class PlatformSessionController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get(routePath(routes.me.platform))
  async get(@CurrentSessionUser() user: SessionUser): Promise<PlatformSessionDto> {
    return { platformAdmin: await isPlatformAdmin(this.db, user) };
  }
}
