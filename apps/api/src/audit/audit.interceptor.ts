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

/** Derives `METHOD route-key` from the contracts route table; unmatched routes fall back to `METHOD path`. */
export function describeRequest(method: string, path: string): AuditTarget {
  const segments = path.split('/').filter(Boolean);
  const targetType = segments[0] === 'api' ? segments[1] ?? null : segments[0] ?? null;
  for (const route of compiled) {
    if (route.method !== method) continue;
    const m = route.pattern.exec(path);
    if (!m) continue;
    return { action: `${method} ${route.key}`, targetType, targetId: m[1] ?? null };
  }
  return { action: `${method} ${path}`, targetType, targetId: null };
}

/** Error name and pg code only: messages can echo row values. */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return 'unknown';
  const cause = err.cause;
  const code = typeof cause === 'object' && cause !== null && 'code' in cause ? String(cause.code) : undefined;
  return code ? `${err.name} (${code})` : err.name;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const path = req.url.split('?')[0] ?? '';
    const ctx = req.orgContext;
    if (!MUTATING.has(req.method) || !(path === '/api' || path.startsWith('/api/')) || !ctx) return next.handle();
    return next.handle().pipe(
      mergeMap(async (value: unknown) => {
        const target = describeRequest(req.method, path);
        try {
          await withOrg(this.db, ctx.orgId, (tx) =>
            tx.insert(auditLog).values({
              orgId: ctx.orgId,
              actorUserId: ctx.userId,
              action: target.action,
              targetType: target.targetType,
              targetId: target.targetId,
              payload: redactBody(req.body),
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
