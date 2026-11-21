import { flattenRoutes, routeAccess, routes, type RouteAccess, type RouteKey } from '@agentdesk/contracts';

export type RouteMatch = { kind: 'route'; key: RouteKey; entry: RouteAccess } | { kind: 'dev' } | { kind: 'unknown' };

/** Registered next to the route table (the provider redirects the browser here after an install); same access as the install. */
const INSTALL_CALLBACK: { method: string; url: string; key: RouteKey } = {
  method: 'GET',
  url: '/api/connections/:provider/callback',
  key: 'connections.install',
};

const byMethodAndUrl = new Map<string, RouteKey>();
for (const [key, def] of Object.entries(flattenRoutes(routes))) {
  // Keys of the flattened table are exactly the RouteKey union (routeAccess is typed from the same table).
  byMethodAndUrl.set(`${def.method} ${def.path}`, key as RouteKey);
}
byMethodAndUrl.set(`${INSTALL_CALLBACK.method} ${INSTALL_CALLBACK.url}`, INSTALL_CALLBACK.key);

/**
 * Looks a route up by HTTP method and the Fastify route url (`req.routeOptions.url`, with `:param` placeholders), never
 * by the concrete request path. HEAD answers from the GET entry (Fastify serves HEAD from the GET handler).
 * Anything under `/dev` is `dev`; anything else with no entry is `unknown` and the guard refuses it.
 */
export function routeEntryFor(method: string, routeUrl: string): RouteMatch {
  if (routeUrl === '/dev' || routeUrl.startsWith('/dev/')) return { kind: 'dev' };
  const upper = method.toUpperCase();
  const key = byMethodAndUrl.get(`${upper === 'HEAD' ? 'GET' : upper} ${routeUrl}`);
  if (key === undefined) return { kind: 'unknown' };
  return { kind: 'route', key, entry: routeAccess[key] };
}
