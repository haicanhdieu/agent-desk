import { Outlet } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { NotFound, RouteError } from './boundaries';

/** Context every route sees (loaders call `context.queryClient.ensureQueryData`). */
export interface RouterContext {
  queryClient: QueryClient;
}

function RootLayout() {
  return <Outlet />;
}

/**
 * Options of the root route, shared by routes/__root.tsx and the test helper's ad-hoc trees so both render the
 * same root. Task-specific root behaviour (the session guard) lives in __root.tsx.
 */
export const rootRouteOptions = {
  component: RootLayout,
  notFoundComponent: NotFound,
  errorComponent: RouteError,
};
