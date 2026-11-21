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
import type { RouteAccess, RouteKey } from '@agentdesk/contracts';
import type { Db } from '@agentdesk/db';
import { FORBIDDEN_DETAIL } from '../access/authorize';
import { checkTenantAccess, isOrgMember } from '../access/check-access';
import { isPlatformAdmin } from '../access/platform-admin';
import { routeEntryFor } from '../access/route-entry';
import { LOGGER } from '../common/logger';
import { OrgMismatchException, requestedOrgId } from '../common/org-mismatch';
import { requestContext } from '../common/request-context';
import { CONFIG, type Config } from '../config/config.module';
import { DB } from '../db/db.module';
import { AUTH, type Auth } from './auth';

/**
 * Everything under /api needs a session except the OpenAPI spec and UI; so do the dev-only /dev routes (they act on the
 * caller's org). Health and webhooks live outside /api and are public. It takes the matched route pattern, never the
 * raw request url: the router percent-decodes the path, so `/%61pi/...` reaches an /api handler but looks public as text.
 */
export function isPublicPath(routePattern: string): boolean {
  const path = routePattern.split('?')[0] ?? '';
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

/**
 * The path params as strings. A value that is not a string (never the case for Fastify, which parses paths to strings)
 * becomes `''`, which matches no org or uuid, so it is refused or not found rather than skipped.
 */
function stringParams(params: unknown): Record<string, string | undefined> {
  if (typeof params !== 'object' || params === null) return {};
  return Object.fromEntries(Object.entries(params).map(([k, v]) => [k, typeof v === 'string' ? v : '']));
}

function permissionLabel(entry: RouteAccess): string | null {
  if (entry.scope === 'self' || entry.scope === 'user') return null;
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
    who: {
      orgId?: string;
      userId: string;
      routeKey: RouteKey | null;
      permission: string | null;
      projectId?: string;
    },
  ): ForbiddenException {
    this.logger.info(
      {
        requestId: req.id,
        ...(who.orgId === undefined ? {} : { orgId: who.orgId }),
        userId: who.userId,
        ...(who.projectId === undefined ? {} : { projectId: who.projectId }),
        routeKey: who.routeKey,
        permission: who.permission,
      },
      'access denied',
    );
    return new ForbiddenException(FORBIDDEN_DETAIL);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    // Decide from the matched pattern; only when there is none (never for a routed request) fall back to the raw url,
    // so a missing pattern on an /api url is not public and ends in the unknown-route deny.
    const pattern = req.routeOptions.url;
    if (isPublicPath(pattern === undefined || pattern === '' ? req.url : pattern)) return true;
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

    if (match.kind === 'route' && match.entry.scope === 'user') {
      // A signed-in user acting on their own data: no org, no membership, and an org header is ignored.
      req.sessionUser = { userId, email: session.user.email, emailVerified: session.user.emailVerified };
      return true;
    }

    const orgId = session.session.activeOrganizationId;
    if (match.kind === 'route') {
      // Every request is pinned to the org it names: a header or query org that is not the session's active org
      // (or any named org when there is no active one) is refused before anything else is looked at.
      const named = requestedOrgId(req);
      if (named !== undefined && named !== orgId) {
        this.logger.info(
          { requestId: req.id, userId, sessionOrgId: orgId ?? null, headerOrgId: named },
          'org mismatch',
        );
        throw new OrgMismatchException();
      }
      if (!orgId && match.entry.scope === 'self') {
        req.authz = { access: { userId, grants: [] }, routeKey: match.key };
        return true;
      }
    }
    if (!orgId) throw new ForbiddenException('No active organization');

    if (match.kind === 'dev') {
      if (!(await isOrgMember(this.db, { userId, orgId }))) {
        throw new ForbiddenException('Not a member of the active organization');
      }
      req.orgContext = { userId, orgId };
      requestContext.set({ orgId });
      return true;
    }

    // Membership, the path :orgId, the permission (before any id is looked up) and the project scope are decided here,
    // so a refusal never depends on what the target is. Any outcome but ok fails closed.
    const { entry } = match;
    const check = await checkTenantAccess(this.db, { userId, orgId }, entry, stringParams(req.params), this.logger);
    if (!check.ok) {
      if (check.status === 404) throw new NotFoundException('Not found');
      throw this.deny(req, {
        orgId,
        userId,
        routeKey: match.key,
        permission: permissionLabel(entry),
        ...(check.projectId === undefined ? {} : { projectId: check.projectId }),
      });
    }
    req.orgContext = { userId, orgId };
    req.authz = {
      access: check.access,
      routeKey: match.key,
      ...(check.target === undefined ? {} : { projectId: check.target.projectId }),
      ...(check.target?.ownerUserId === undefined ? {} : { ownerUserId: check.target.ownerUserId }),
    };
    requestContext.set({ orgId });
    return true;
  }
}
