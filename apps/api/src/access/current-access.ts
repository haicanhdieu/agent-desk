import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Access, RouteKey } from '@agentdesk/contracts';

export interface RequestAuthz {
  access: Access;
  routeKey: RouteKey;
  projectId?: string;
  ownerUserId?: string | null;
}

export interface PlatformAdminContext {
  userId: string;
  email: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by SessionGuard on tenant routes: the caller's loaded access and the matched route. */
    authz?: RequestAuthz;
    /** Set by SessionGuard on `/api/platform/*` routes for a platform admin (a `platform_admins` entry matching the verified session email). */
    platformAdmin?: PlatformAdminContext;
  }
}

/** The caller's loaded access for this request; throws when the guard did not set it (a route outside the guard). */
export const CurrentAccess = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestAuthz => {
  const authz = ctx.switchToHttp().getRequest<FastifyRequest>().authz;
  if (!authz) throw new Error('CurrentAccess used on a route without the access guard');
  return authz;
});

/** The platform admin behind this request; throws when the guard did not set it. */
export const CurrentPlatformAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PlatformAdminContext => {
    const admin = ctx.switchToHttp().getRequest<FastifyRequest>().platformAdmin;
    if (!admin) throw new Error('CurrentPlatformAdmin used on a route without the platform guard');
    return admin;
  },
);
