import type { QueryClient } from '@tanstack/react-query';
import { createRouter, type AnyRoute, type RouterHistory } from '@tanstack/react-router';
import { registerSignOutTarget } from '@/features/auth/signOut';
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
  const router = createRouter({ routeTree, ...routerDefaults(opts), scrollRestoration: true });
  // A 401 anywhere signs out through this router and clears this QueryClient.
  registerSignOutTarget({ router, queryClient: opts.queryClient });
  return router;
}

export type AppRouter = ReturnType<typeof createAppRouter>;

/** Test-only: the same router defaults over an ad-hoc route tree (see src/test/renderRoute.tsx). */
export function createRouterForTree(opts: CreateAppRouterOptions & { routeTree: AnyRoute }) {
  const router = createRouter({ routeTree: opts.routeTree, ...routerDefaults(opts) });
  registerSignOutTarget({ router, queryClient: opts.queryClient });
  return router;
}

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
