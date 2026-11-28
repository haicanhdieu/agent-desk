import { Outlet } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { NotFound, RouteError } from './boundaries';
import { SkipLink } from '@/components';
import { ShellHost } from './shell/ShellHost';

/** Context every route sees (loaders call `context.queryClient.ensureQueryData`). */
export interface RouterContext {
  queryClient: QueryClient;
}

/**
 * Wraps the whole match tree (the router's `InnerWrap`): the skip link and the shell host. They sit above the root
 * match, so they stay mounted while the first load is pending and the shell around the loading page is the same one
 * that surrounds the loaded page (an open org switcher survives the org list arriving).
 */
export function AppWrap({ children }: { children?: ReactNode }) {
  return (
    <>
      <SkipLink />
      <ShellHost>{children}</ShellHost>
    </>
  );
}

/**
 * Options of the root route, shared by routes/__root.tsx and the test helper's ad-hoc trees so both render the
 * same root. Task-specific root behaviour (the session guard) lives in __root.tsx.
 */
export const rootRouteOptions = {
  component: Outlet,
  notFoundComponent: NotFound,
  errorComponent: RouteError,
};
