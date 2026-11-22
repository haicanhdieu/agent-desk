import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { RouterProvider, type AnyRouter } from '@tanstack/react-router';
import { SignOutProvider } from '@/components';
import { LinkProvider, ToastProvider } from '@/ds';
import { signOutAndRedirect } from '@/features/auth/signOut';
import { RouterLink } from './RouterLink';

/** An explicit logout lands on the plain sign-in page, with no `redirect` back to where the user was. */
const logout = () => void signOutAndRedirect(null);

/** Everything the app needs around the router: Query, toasts, router-backed links and the account menu's sign-out. */
export function AppProviders({ router, queryClient }: { router: AnyRouter; queryClient: QueryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <LinkProvider component={RouterLink}>
          <SignOutProvider onSignOut={logout}>
            <RouterProvider router={router} />
          </SignOutProvider>
        </LinkProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
