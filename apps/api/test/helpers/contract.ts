import { expect } from 'vitest';
import { flattenRoutes, routes } from '@agentdesk/contracts';

interface InjectedResponse {
  statusCode: number;
  body: string;
  json: () => unknown;
}

const table = flattenRoutes(routes);

/** Asserts the response body parses with the response schema of the named route (e.g. 'projects.list'). */
export function expectContract(routeKey: string, res: InjectedResponse): unknown {
  const def = table[routeKey];
  if (!def) throw new Error(`unknown route key ${routeKey}`);
  expect(res.statusCode, `status of ${routeKey}: ${res.body}`).toBeLessThan(300);
  const payload = res.statusCode === 204 || res.body === '' ? null : res.json();
  const parsed = def.response.safeParse(payload);
  expect(parsed.success, `${routeKey} response violates its contract: ${JSON.stringify(parsed.error?.issues)}`).toBe(
    true,
  );
  return parsed.data;
}
