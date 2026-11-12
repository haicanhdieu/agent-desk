import { ProblemSchema, flattenRoutes, routes, type RouteDef, type Routes } from '@agentdesk/contracts';
import { HttpResponse, http, type HttpHandler } from 'msw';
import type { z } from 'zod';
import { mockDb } from './db';

// Shared plumbing for the MSW handlers: route keys typed from the contracts table, problem+json responses with
// `x-request-id`, and handler construction for a route key (used by handlers.ts and scenarios.ts).

export type RouteKey = {
  [G in keyof Routes]: `${G & string}.${keyof Routes[G] & string}`;
}[keyof Routes];

export type RouteOf<K extends RouteKey> = K extends `${infer G extends keyof Routes}.${infer N}`
  ? N extends keyof Routes[G]
    ? Routes[G][N]
    : never
  : never;

type Part<R, F extends 'params' | 'query' | 'body'> = R extends { [P in F]: infer S extends z.ZodType }
  ? z.output<S>
  : undefined;

export type ResponseOf<K extends RouteKey> = z.output<RouteOf<K>['response']>;

export const flatRoutes: Record<string, RouteDef> = flattenRoutes(routes);

export function routeDef(key: RouteKey): RouteDef {
  const def = flatRoutes[key];
  if (!def) throw new Error(`Unknown route ${key}`);
  return def;
}

export interface ProblemInit {
  status: number;
  title: string;
  type?: string;
  detail?: string;
  errors?: { pointer: string; detail: string }[];
}

/** Thrown by a route implementation; turned into a problem+json response. */
export class Problem extends Error {
  readonly init: ProblemInit;
  constructor(init: ProblemInit) {
    super(init.title);
    this.init = init;
  }
}

export const notFound = (what: string) => new Problem({ status: 404, title: `${what} not found`, type: 'not-found' });
export const conflict = (title: string, errors?: ProblemInit['errors'], detail?: string) =>
  new Problem({ status: 409, title, type: 'conflict', ...(errors && { errors }), ...(detail && { detail }) });
export const invalid = (pointer: string, detail: string) =>
  new Problem({ status: 400, title: 'Validation failed', type: 'validation', errors: [{ pointer, detail }] });

export function problemResponse(init: ProblemInit): Response {
  const requestId = mockDb.nextRequestId();
  const body = ProblemSchema.parse({
    type: init.type ? `urn:agentdesk:problem:${init.type}` : 'about:blank',
    title: init.title,
    status: init.status,
    ...(init.detail !== undefined && { detail: init.detail }),
    ...(init.errors !== undefined && { errors: init.errors }),
    requestId,
  });
  return HttpResponse.json(body, {
    status: init.status,
    headers: { 'content-type': 'application/problem+json', 'x-request-id': requestId },
  });
}

/** A 2xx JSON response (or an empty one when the route's response is `null`). */
export function jsonResponse(data: unknown, status = 200): Response {
  const headers = { 'x-request-id': mockDb.nextRequestId() };
  if (data === null) return new HttpResponse(null, { status: status === 200 ? 204 : status, headers });
  return HttpResponse.json(data, { status, headers });
}

/** Issues of a failed Zod parse as JSON Pointer field errors. */
export function fieldErrors(error: z.ZodError): { pointer: string; detail: string }[] {
  return error.issues.map((i) => ({ pointer: `/${i.path.map(String).join('/')}`, detail: i.message }));
}

export interface RouteCtx<K extends RouteKey> {
  params: Part<RouteOf<K>, 'params'>;
  query: Part<RouteOf<K>, 'query'>;
  body: Part<RouteOf<K>, 'body'>;
  request: Request;
}

const verbs = { GET: http.get, POST: http.post, PUT: http.put, PATCH: http.patch, DELETE: http.delete } as const;

/** Registers `resolve` at the route's method and path, logging the request first. */
export function routeHandler(key: RouteKey, resolve: (request: Request, params: unknown) => Promise<Response>) {
  const def = routeDef(key);
  const handler: HttpHandler = verbs[def.method](def.path, async ({ request, params }) => {
    mockDb.logRequest(def.method, new URL(request.url).pathname);
    return resolve(request, params);
  });
  return handler;
}
