import type { QueryClient } from '@tanstack/react-query';
import { createRouter, type AnyRoute, type RouterHistory } from '@tanstack/react-router';
import { NotFound, RouteError, RoutePending } from './boundaries';
import { routeTree } from './routeTree.gen';

export interface CreateAppRouterOptions {
  queryClient: QueryClient;
  /** Memory history in tests; browser history by default. */
  history?: RouterHistory;
}

function routerDefaults({ queryClient, history }: CreateAppRouterOptions) {
  return {
    context: { queryClient },
    ...(history && { history }),
    defaultPreload: 'intent' as const,
    // Loaders read through Query, which owns freshness; the router never serves its own stale preload.
    defaultPreloadStaleTime: 0,
    defaultPendingMs: 300,
    defaultPendingMinMs: 300,
    defaultPendingComponent: RoutePending,
    defaultErrorComponent: RouteError,
    defaultNotFoundComponent: NotFound,
  };
}

/** The app router: file routes, intent preloading, 300 ms pending delay and minimum, shared boundaries. */
export function createAppRouter(opts: CreateAppRouterOptions) {
  return createRouter({ routeTree, ...routerDefaults(opts), scrollRestoration: true });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

/** Test-only: the same router defaults over an ad-hoc route tree (see src/test/renderRoute.tsx). */
export function createRouterForTree(opts: CreateAppRouterOptions & { routeTree: AnyRoute }) {
  return createRouter({ routeTree: opts.routeTree, ...routerDefaults(opts) });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
