import { QueryClientProvider, useQuery, type QueryClient } from '@tanstack/react-query';
import { RouterProvider, type AnyRouter } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { AccountInfoProvider, SignOutProvider } from '@/components';
import { LinkProvider, ToastProvider } from '@/ds';
import { sessionQuery } from '@/features/auth/session';
import { signOutAndRedirect } from '@/features/auth/signOut';
import { RouterLink } from './RouterLink';

/** An explicit logout lands on the plain sign-in page, with no `redirect` back to where the user was. */
const logout = () => void signOutAndRedirect(null);

/** Feeds the account menu the signed-in name and email. */
function AccountInfo({ children }: { children: ReactNode }) {
  const session = useQuery(sessionQuery);
  return (
    <AccountInfoProvider name={session.data?.user.name} email={session.data?.user.email}>
      {children}
    </AccountInfoProvider>
  );
}

/** Everything the app needs around the router: Query, toasts, router-backed links and the account menu's sign-out. */
export function AppProviders({ router, queryClient }: { router: AnyRouter; queryClient: QueryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <LinkProvider component={RouterLink}>
          <SignOutProvider onSignOut={logout}>
            <AccountInfo>
              <RouterProvider router={router} />
            </AccountInfo>
          </SignOutProvider>
        </LinkProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
