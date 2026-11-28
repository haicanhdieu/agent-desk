import { ApiError } from '@agentdesk/contracts/client';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { toastFromError } from '@/app/boundaries';
import { Button, Dialog, useToast } from '@/ds';
import { platformAdminQuery } from '@/features/access/queries';
import { orgsQuery, sessionQuery } from '@/features/auth/session';
import { signOutAndRedirect } from '@/features/auth/signOut';
import { toInvitationCard } from '@/features/invitations/map';
import { useAcceptInvitation, useDeclineInvitation } from '@/features/invitations/mutations';
import { myInvitationsQuery } from '@/features/invitations/queries';
import { MyInvitations, type MyInvitationsState } from '@/screens';

// The welcome page, outside `/o/$org`: the signed-in person's pending invitations, or how to get one (the landing of
// a person with no org). The session and memberships are read before render; the list and the access check show
// their own loading and error states.
export const Route = createFileRoute('/invitations/')({
  staticData: { chrome: { mode: 'standard', scope: 'personal', crumb: 'My invitations' } },
  loader: ({ context: { queryClient } }) =>
    Promise.all([queryClient.ensureQueryData(sessionQuery), queryClient.ensureQueryData(orgsQuery)]).then(() => null),
  component: WelcomePage,
});

const noop = () => undefined;

function WelcomePage() {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const { data: orgs } = useSuspenseQuery(orgsQuery);
  const invitations = useQuery(myInvitationsQuery);
  // Session-wide (never pinned to the active org), so a suspended active org does not refuse it.
  const access = useQuery(platformAdminQuery);
  const accept = useAcceptInvitation();
  const decline = useDeclineInvitation();
  const toast = useToast();
  const [declining, setDeclining] = useState<{ id: string; orgName: string } | null>(null);

  const email = session?.user.email ?? '';
  const platformAdmin = access.data?.platformAdmin ?? false;

  const pending = accept.isPending
    ? { id: accept.variables, action: 'accept' as const }
    : decline.isPending
      ? { id: decline.variables, action: 'decline' as const }
      : null;

  const errorState = (failure: unknown): MyInvitationsState => ({
    kind: 'error',
    ...(failure instanceof ApiError && failure.requestId !== undefined && { requestId: failure.requestId }),
    onRetry: () => {
      if (invitations.isError) void invitations.refetch();
      if (access.isError) void access.refetch();
    },
  });

  // The access check only decides whether the empty state offers Create organization, so a pending list never waits
  // on it; an empty list does, so the button is never hidden by mistake from a platform admin.
  let state: MyInvitationsState;
  if (invitations.isError) {
    state = errorState(invitations.error);
  } else if (invitations.data === undefined) {
    state = { kind: 'loading' };
  } else if (invitations.data.items.length > 0) {
    state = { kind: 'list', cards: invitations.data.items.map(toInvitationCard), pending };
  } else if (access.isError) {
    state = errorState(access.error);
  } else if (access.data === undefined) {
    state = { kind: 'loading' };
  } else {
    state = { kind: 'empty', member: orgs.length > 0, email, platformAdmin, createHref: '/platform/orgs/new' };
  }

  const declineBusy = decline.isPending;
  const closeDialog = () => setDeclining(null);
  const confirmDecline = () => {
    if (declining === null) return;
    decline.mutate(declining.id, {
      onSuccess: closeDialog,
      onError: (e) => {
        closeDialog();
        toast.show(toastFromError(e));
      },
    });
  };

  return (
    <>
      <MyInvitations
        state={state}
        onAccept={(id) => accept.mutate(id, { onError: (e) => toast.show(toastFromError(e)) })}
        onDecline={(id) => {
          const card = invitations.data?.items.find((i) => i.id === id);
          if (card) setDeclining({ id, orgName: card.org.name });
        }}
        onSignOut={() => void signOutAndRedirect(null)}
      />
      <Dialog
        open={declining !== null}
        title={`Decline invitation to ${declining?.orgName ?? ''}?`}
        width={440}
        onClose={declineBusy ? noop : closeDialog}
        footer={
          <>
            <Button variant="ghost" disabled={declineBusy} onClick={closeDialog}>
              Cancel
            </Button>
            <Button variant="solid-danger" disabled={declineBusy} aria-busy={declineBusy} onClick={confirmDecline}>
              {declineBusy ? 'Declining…' : 'Decline'}
            </Button>
          </>
        }
      >
        <p className="muted">You will need a new invitation to join later.</p>
      </Dialog>
    </>
  );
}
