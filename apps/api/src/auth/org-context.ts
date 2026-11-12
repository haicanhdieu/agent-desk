import { createParamDecorator, Inject, Injectable, Scope, type ExecutionContext } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { withOrg, type Db, type Tx } from '@agentdesk/db';
import { DB } from '../db/db.module';

export interface OrgContext {
  userId: string;
  orgId: string;
  role: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by SessionGuard on authenticated /api requests. */
    orgContext?: OrgContext;
  }
}

/** The caller's `{ userId, orgId, role }`, resolved and membership-checked by SessionGuard. */
export const CurrentOrg = createParamDecorator((_data: unknown, ctx: ExecutionContext): OrgContext => {
  const ctxValue = ctx.switchToHttp().getRequest<FastifyRequest>().orgContext;
  if (!ctxValue) throw new Error('CurrentOrg used on a route without SessionGuard');
  return ctxValue;
});

/** Runs queries inside `withOrg` for the request's organization, so RLS scopes every statement. */
@Injectable({ scope: Scope.REQUEST })
export class OrgDb {
  constructor(
    @Inject(REQUEST) private readonly req: FastifyRequest,
    @Inject(DB) private readonly db: Db,
  ) {}

  get context(): OrgContext {
    const ctx = this.req.orgContext;
    if (!ctx) throw new Error('OrgDb used on a route without SessionGuard');
    return ctx;
  }

  run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withOrg(this.db, this.context.orgId, fn);
  }
}
