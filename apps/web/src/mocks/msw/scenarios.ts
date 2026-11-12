import type { RequestHandler } from 'msw';
import { mockDb } from './db';
import { problemResponse, routeHandler, type ProblemInit, type RouteKey } from './http';

// Per-test (or per-page) overrides. Handler overrides go through the active MSW server or worker's `use`, so the
// test setup's `resetHandlers()` drops them after each test; store changes are undone by `mockDb.reset()`.

interface MockTarget {
  use(...handlers: RequestHandler[]): void;
}

let target: MockTarget | undefined;

/** node.ts and browser.ts register their server or worker here. */
export function setScenarioTarget(t: MockTarget): void {
  target = t;
}

function override(handler: RequestHandler) {
  if (!target) throw new Error('No MSW server or worker registered (import mocks/msw/node or browser first).');
  target.use(handler);
}

export const scenarios = {
  /** No session: get-session returns null, org routes and every API route return 401. */
  signedOut(): void {
    mockDb.signOut();
  },
  /** The route answers 500 problem+json until the handlers reset; `delayMs` holds the answer back (in-flight UI). */
  serverError(routeKey: RouteKey, { delayMs = 0 }: { delayMs?: number } = {}): void {
    override(
      routeHandler(routeKey, async () => {
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
        return problemResponse({ status: 500, title: 'Internal server error', type: 'internal' });
      }),
    );
  },
  /** The route answers the given problem until the handlers reset. */
  problem(routeKey: RouteKey, problem: ProblemInit): void {
    override(routeHandler(routeKey, async () => problemResponse(problem)));
  },
};
