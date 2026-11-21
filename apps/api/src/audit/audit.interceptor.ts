import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { mergeMap, type Observable } from 'rxjs';
import { flattenRoutes, routes } from '@agentdesk/contracts';
import { auditLog, withOrg, type Db } from '@agentdesk/db';
import { describeError } from '../common/pg-errors';
import { DB } from '../db/db.module';
import { redactBody } from './redact-body';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface CompiledRoute {
  key: string;
  method: string;
  pattern: RegExp;
  params: string[];
}

const compiled: CompiledRoute[] = Object.entries(flattenRoutes(routes)).map(([key, def]) => {
  const params: string[] = [];
  const source = def.path
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        params.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { key, method: def.method, pattern: new RegExp(`^${source}/?$`), params };
});

export interface AuditTarget {
  action: string;
  targetType: string | null;
  targetId: string | null;
}

/**
 * Derives `METHOD route-key` from the contracts route table; unmatched routes fall back to `METHOD path`. The interceptor
 * passes the matched route pattern as `path` and the router's `params`, so no text of the request url reaches the row:
 * without `params` the target id is the first path segment that is a param, as written in `path`.
 */
export function describeRequest(method: string, path: string, params?: Record<string, unknown>): AuditTarget {
  const segments = path.split('/').filter(Boolean);
  const targetType = segments[0] === 'api' ? (segments[1] ?? null) : (segments[0] ?? null);
  for (const route of compiled) {
    if (route.method !== method) continue;
    const m = route.pattern.exec(path);
    if (!m) continue;
    const name = route.params[0];
    const fromParams = name === undefined ? undefined : params?.[name];
    const targetId = params === undefined ? (m[1] ?? null) : typeof fromParams === 'string' ? fromParams : null;
    return { action: `${method} ${route.key}`, targetType, targetId };
  }
  return { action: `${method} ${path}`, targetType, targetId: null };
}

/** The router's path params as a record (it parses them to strings); anything else is no params. */
function paramsOf(params: unknown): Record<string, unknown> {
  return typeof params === 'object' && params !== null ? Object.fromEntries(Object.entries(params)) : {};
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    // Gate and describe by the matched route and its params, as the session guard does: the router percent-decodes
    // the path and drops a fragment, so the raw url is neither a reliable test nor safe text for the audit row.
    const route = req.routeOptions.url ?? '';
    const ctx = req.orgContext;
    if (!MUTATING.has(req.method) || !(route === '/api' || route.startsWith('/api/')) || !ctx) return next.handle();
    return next.handle().pipe(
      mergeMap(async (value: unknown) => {
        const target = describeRequest(req.method, route, paramsOf(req.params));
        try {
          await withOrg(this.db, ctx.orgId, (tx) =>
            tx.insert(auditLog).values({
              orgId: ctx.orgId,
              actorUserId: ctx.userId,
              action: target.action,
              targetType: target.targetType,
              targetId: target.targetId,
              payload: redactBody(req.body, target.action),
            }),
          );
        } catch (err) {
          // The mutation already happened; never fail the response, but make the gap visible.
          this.logger.error(`audit insert failed for ${target.action}: ${describeError(err)}`);
        }
        return value;
      }),
    );
  }
}
