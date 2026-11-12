import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { RouterProvider, type AnyRouter } from '@tanstack/react-router';
import { LinkProvider, ToastProvider } from '@/ds';
import { RouterLink } from './RouterLink';

/** Everything the app needs around the router: Query, toasts, and router-backed links for `ds` and screens. */
export function AppProviders({ router, queryClient }: { router: AnyRouter; queryClient: QueryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <LinkProvider component={RouterLink}>
          <RouterProvider router={router} />
        </LinkProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
