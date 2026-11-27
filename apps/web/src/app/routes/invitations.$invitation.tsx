import { ApiError } from '@agentdesk/contracts/client';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { toastFromError } from '@/app/boundaries';
import { useToast } from '@/ds';
import { orgsQuery, sessionQuery } from '@/features/auth/session';
import { signOutAndRedirect } from '@/features/auth/signOut';
import { toAcceptState } from '@/features/invitations/map';
import { useAcceptInvitation, useDeclineInvitation } from '@/features/invitations/mutations';
import { myInvitationQuery } from '@/features/invitations/queries';
import { InvitationAccept, type InvitationAcceptState } from '@/screens';

// The invitation link: the signed-in person's own invitation with Accept and Decline, or why it cannot be answered.
// The id is a path param, so anything that is not a uuid is "not available" without a request.
const InvitationId = z.string().uuid();

export const Route = createFileRoute('/invitations/$invitation')({
  staticData: { chrome: { mode: 'standard', scope: 'personal', crumb: 'My invitations' } },
  loader: ({ context: { queryClient } }) =>
    Promise.all([queryClient.ensureQueryData(sessionQuery), queryClient.ensureQueryData(orgsQuery)]).then(() => null),
  component: InvitationLinkPage,
});

const isConflict = (e: unknown) => e instanceof ApiError && e.status === 409;
const isNotFound = (e: unknown) => e instanceof ApiError && e.status === 404;

function InvitationLinkPage() {
  const { invitation: param } = Route.useParams();
  const { data: session } = useSuspenseQuery(sessionQuery);
  const valid = InvitationId.safeParse(param).success;
  const invitation = useQuery({ ...myInvitationQuery(param), enabled: valid });
  const accept = useAcceptInvitation();
  const decline = useDeclineInvitation();
  const toast = useToast();
  const [confirmDecline, setConfirmDecline] = useState(false);
  // A 409 makes the mutation hooks refetch the invitation; if it still reads pending afterwards, the page cannot
  // explain the refusal and falls to the error state instead of offering the same answer again.
  const [conflicted, setConflicted] = useState(false);

  const email = session?.user.email ?? '';
  // Unused while the shell owns the page (the bar is the shell's); the screen's own fallback bar still takes it.
  const handle = session?.user.handle ?? '';

  const retry = () => {
    setConflicted(false);
    void invitation.refetch();
  };
  const errorState = (failure: unknown): InvitationAcceptState => ({
    kind: 'error',
    ...(failure instanceof ApiError && failure.requestId !== undefined && { requestId: failure.requestId }),
    onRetry: retry,
  });

  let state: InvitationAcceptState;
  if (!valid || isNotFound(invitation.error)) {
    state = { kind: 'notAvailable', email };
  } else if (invitation.isError) {
    state = errorState(invitation.error);
  } else if (invitation.data === undefined) {
    state = { kind: 'loading' };
  } else {
    const mapped = toAcceptState(invitation.data);
    if (mapped.kind !== 'pending') {
      state = mapped;
    } else if (conflicted && !invitation.isFetching) {
      state = errorState(undefined);
    } else {
      state = {
        ...mapped,
        confirmDecline,
        busy: accept.isPending ? 'accept' : decline.isPending ? 'decline' : null,
      };
    }
  }

  const onAccept = () => {
    setConflicted(false);
    accept.mutate(param, {
      onError: (e) => {
        if (isConflict(e)) setConflicted(true);
        else toast.show(toastFromError(e));
      },
    });
  };
  const onConfirmDecline = () => {
    setConflicted(false);
    decline.mutate(param, {
      onSuccess: () => setConfirmDecline(false),
      onError: (e) => {
        setConfirmDecline(false);
        if (isConflict(e)) setConflicted(true);
        else toast.show(toastFromError(e));
      },
    });
  };

  return (
    <InvitationAccept
      user={{ login: handle, initials: handle.slice(0, 2).toUpperCase() }}
      state={state}
      onAccept={onAccept}
      onDecline={() => setConfirmDecline(true)}
      onConfirmDecline={onConfirmDecline}
      onCancelDecline={() => setConfirmDecline(false)}
      onSignOut={() => void signOutAndRedirect()}
    />
  );
}
