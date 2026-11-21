import { Controller, Get, Inject, Req, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { routes, type AccessDto } from '@agentdesk/contracts';
import { isPlatformAdmin } from '../access/platform-admin';
import { CurrentAccess, type RequestAuthz } from '../access/current-access';
import { AUTH, type Auth } from '../auth/auth';
import { toHeaders } from '../auth/session.guard';
import { routePath } from '../common/route-path';
import { CONFIG, type Config } from '../config/config.module';
import { AssignmentsService } from './assignments.service';

/** `/api/me/access`: the one tenant route that answers a member with no assignment (the caller's own data only). */
@Controller()
export class MeController {
  constructor(
    @Inject(AssignmentsService) private readonly assignments: AssignmentsService,
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  @Get(routePath(routes.me.access)) // routes.me.access
  async access(@CurrentAccess() authz: RequestAuthz, @Req() req: FastifyRequest): Promise<AccessDto> {
    const session = await this.auth.api.getSession({ headers: toHeaders(req) });
    // the guard already refused a request without a session; fail closed if it is gone between the two reads
    if (!session) throw new UnauthorizedException('Authentication required');
    return this.assignments.accessOf(authz.access, isPlatformAdmin(this.config, session.user));
  }
}
