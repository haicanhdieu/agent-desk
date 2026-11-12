import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { member, type Db } from '@agentdesk/db';
import { requestContext } from '../common/request-context';
import { DB } from '../db/db.module';
import { AUTH, type Auth } from './auth';

/**
 * Everything under /api needs a session except the OpenAPI spec and UI; so do the dev-only /dev routes (they act on the
 * caller's org). Health and webhooks live outside /api and are public.
 */
export function isPublicPath(url: string): boolean {
  const path = url.split('?')[0] ?? '';
  if (path === '/api/docs' || path.startsWith('/api/docs/')) return true;
  return !(path === '/api' || path.startsWith('/api/') || path === '/dev' || path.startsWith('/dev/'));
}

export function toHeaders(req: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else if (v !== undefined) headers.set(k, v);
  }
  return headers;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(DB) private readonly db: Db,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    if (isPublicPath(req.url)) return true;
    const session = await this.auth.api.getSession({ headers: toHeaders(req) });
    if (!session) throw new UnauthorizedException('Authentication required');
    const orgId = session.session.activeOrganizationId;
    if (!orgId) throw new ForbiddenException('No active organization');
    const rows = await this.db.orm
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, orgId), eq(member.userId, session.user.id)))
      .limit(1);
    const role = rows[0]?.role;
    if (role === undefined) throw new ForbiddenException('Not a member of the active organization');
    req.orgContext = { userId: session.user.id, orgId, role };
    requestContext.set({ orgId });
    return true;
  }
}
