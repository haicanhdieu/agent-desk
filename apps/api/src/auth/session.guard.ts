import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Logger } from 'pino';
import { and, eq } from 'drizzle-orm';
import type { RouteAccess, RouteKey } from '@agentdesk/contracts';
import { loadAccess } from '@agentdesk/core';
import { member, withOrg, type Db } from '@agentdesk/db';
import { FORBIDDEN_DETAIL, preTargetDecision } from '../access/authorize';
import { isPlatformAdmin } from '../access/platform-admin';
import { routeEntryFor } from '../access/route-entry';
import { LOGGER } from '../common/logger';
import { requestContext } from '../common/request-context';
import { CONFIG, type Config } from '../config/config.module';
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

/** The `:orgId` path param when the route has one; `undefined` when it has none (any other value is returned as-is). */
function orgIdParam(req: FastifyRequest): unknown {
  const params: unknown = req.params;
  if (typeof params !== 'object' || params === null || !('orgId' in params)) return undefined;
  return params.orgId;
}

function permissionLabel(entry: Exclude<RouteAccess, { scope: 'self' }>): string {
  return entry.scope === 'org-admin' ? entry.anyOf.join(' | ') : entry.permission;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /** Logs the deny and returns the 403 to throw; the response never says which permission is missing. */
  private deny(
    req: FastifyRequest,
    who: { orgId?: string; userId: string; routeKey: RouteKey | null; permission: string | null },
  ): ForbiddenException {
    this.logger.info(
      {
        requestId: req.id,
        ...(who.orgId === undefined ? {} : { orgId: who.orgId }),
        userId: who.userId,
        routeKey: who.routeKey,
        permission: who.permission,
      },
      'access denied',
    );
    return new ForbiddenException(FORBIDDEN_DETAIL);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    if (isPublicPath(req.url)) return true;
    const session = await this.auth.api.getSession({ headers: toHeaders(req) });
    if (!session) throw new UnauthorizedException('Authentication required');
    const userId = session.user.id;
    const match = routeEntryFor(req.method, req.routeOptions.url ?? '');

    if (match.kind === 'route' && match.entry.scope === 'platform') {
      if (!isPlatformAdmin(this.config, session.user)) {
        throw this.deny(req, { userId, routeKey: match.key, permission: match.entry.permission });
      }
      req.platformAdmin = { userId, email: session.user.email };
      return true;
    }
    if (match.kind === 'unknown') throw this.deny(req, { userId, routeKey: null, permission: null });

    const orgId = session.session.activeOrganizationId;
    if (!orgId) throw new ForbiddenException('No active organization');
    const rows = await this.db.orm
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
      .limit(1);
    const role = rows[0]?.role;
    if (role === undefined) throw new ForbiddenException('Not a member of the active organization');

    if (match.kind === 'dev') {
      req.orgContext = { userId, orgId, role };
      requestContext.set({ orgId });
      return true;
    }

    const pathOrg = orgIdParam(req);
    if (pathOrg !== undefined && pathOrg !== orgId) throw new NotFoundException('Not found');

    const access = await withOrg(this.db, orgId, (tx) => loadAccess(tx, userId, this.logger));
    req.orgContext = { userId, orgId, role };
    req.authz = { access, routeKey: match.key };
    requestContext.set({ orgId });

    // Only `self` and `org-admin` are enforced here. `org`, `project` and `project-list` keep membership-only behaviour
    // until the guard learns to enforce them (a later task of the RBAC plan).
    const { entry } = match;
    if (entry.scope === 'self') return true;
    if (entry.scope === 'org-admin' && preTargetDecision(entry, access) !== 'allow') {
      throw this.deny(req, { orgId, userId, routeKey: match.key, permission: permissionLabel(entry) });
    }
    return true;
  }
}
