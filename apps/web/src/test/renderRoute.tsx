import type { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory, createRootRouteWithContext, type AnyRoute, type AnyRouter } from '@tanstack/react-router';
import { act, render } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { AppProviders } from '@/app/providers';
import { createAppQueryClient } from '@/app/queryClient';
import { rootRouteOptions, type RouterContext } from '@/app/root';
import { createAppRouter, createRouterForTree } from '@/app/router';

export interface RenderRouteOptions {
  /** Applied before the first render, e.g. `scenarios.signedOut`. */
  scenario?: () => void;
  /** An ad-hoc tree from `createTestRootRoute()` instead of the app's file routes. */
  routeTree?: AnyRoute;
}

export interface RenderedRoute {
  router: AnyRouter;
  queryClient: QueryClient;
  user: UserEvent;
}

/** A root route with the app's root options, for tests that need routes the app does not have. */
export function createTestRootRoute() {
  return createRootRouteWithContext<RouterContext>()({ ...rootRouteOptions });
}

/**
 * Renders the app at `path` with memory history, a fresh QueryClient (retries without delay) and the MSW node
 * server from src/test/setup.ts; resolves once the first navigation has settled.
 */
export async function renderRoute(path: string, opts: RenderRouteOptions = {}): Promise<RenderedRoute> {
  opts.scenario?.();
  const queryClient = createAppQueryClient({ retryDelay: 0 });
  const history = createMemoryHistory({ initialEntries: [path] });
  const router: AnyRouter = opts.routeTree
    ? createRouterForTree({ queryClient, history, routeTree: opts.routeTree })
    : createAppRouter({ queryClient, history });
  const user = userEvent.setup();
  await act(async () => {
    render(<AppProviders router={router} queryClient={queryClient} />);
    await router.load();
  });
  return { router, queryClient, user };
}
