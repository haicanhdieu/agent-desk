import type { RouteDef } from '@agentdesk/contracts';

/** Nest route path for a contracts route: the contracts path without its leading slash (`api/projects/:projectId`). */
export function routePath(def: Pick<RouteDef, 'path'>): string {
  return def.path.replace(/^\//, '');
}
