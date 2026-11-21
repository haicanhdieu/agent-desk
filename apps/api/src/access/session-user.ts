import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

/** The signed-in user behind a `user` route: no org, no membership. */
export interface SessionUser {
  userId: string;
  email: string;
  emailVerified: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by SessionGuard on `user` routes (a signed-in user acting on their own data, whatever their org). */
    sessionUser?: SessionUser;
  }
}

/** The signed-in user of this request; throws when the guard did not set it (a route that is not kind `user`). */
export const CurrentSessionUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): SessionUser => {
  const user = ctx.switchToHttp().getRequest<FastifyRequest>().sessionUser;
  if (!user) throw new Error('CurrentSessionUser used on a route without the user guard');
  return user;
});
