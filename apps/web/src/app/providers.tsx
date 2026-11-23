import { QueryClientProvider, useQuery, type QueryClient } from '@tanstack/react-query';
import { RouterProvider, type AnyRouter } from '@tanstack/react-router';
import { useCallback, useState, type ReactNode } from 'react';
import { AccountInfoProvider, SignOutProvider } from '@/components';
import { LinkProvider, ToastProvider } from '@/ds';
import { sessionQuery } from '@/features/auth/session';
import { signOutAndRedirect } from '@/features/auth/signOut';
import { myInvitationsQuery } from '@/features/invitations/queries';
import { RouterLink } from './RouterLink';

/** An explicit logout lands on the plain sign-in page, with no `redirect` back to where the user was. */
const logout = () => void signOutAndRedirect(null);

/** Feeds the account menu the signed-in name and the count of invitations waiting for this person. */
function AccountInfo({ children }: { children: ReactNode }) {
  const session = useQuery(sessionQuery);
  // The list is the user's own and belongs to no org. It is fetched when the menu first opens, not on every page load.
  const [wanted, setWanted] = useState(false);
  const onOpen = useCallback(() => setWanted(true), []);
  const invitations = useQuery({ ...myInvitationsQuery, enabled: wanted && Boolean(session.data) });
  const pending = invitations.data?.items.filter((i) => i.status === 'pending').length ?? 0;
  return (
    <AccountInfoProvider name={session.data?.user.name} pendingInvitations={pending} onOpen={onOpen}>
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
