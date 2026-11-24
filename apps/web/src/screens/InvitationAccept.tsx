import type { ReactNode } from 'react';
import { Button, Dialog, Skeleton } from '@/ds';
import { KeyValue, RouteLoadError, SurfaceCard, TopBar, type OrgSwitchProps } from '@/components';
import type { Actor, InvitationDetailsView } from '@/mocks/types';
import styles from './Screens.module.css';

export type InvitationAcceptState =
  | { kind: 'loading' }
  | { kind: 'pending'; details: InvitationDetailsView; busy: 'accept' | 'decline' | null; confirmDecline: boolean }
  | { kind: 'accepted'; orgName: string; orgHref: string }
  | { kind: 'declined'; invitationsHref: string }
  | { kind: 'expired'; orgName: string; inviter: string | null }
  | { kind: 'revoked' }
  | { kind: 'notAvailable'; email: string }
  | { kind: 'error'; requestId?: string; onRetry: () => void };

export interface InvitationAcceptProps {
  user: Actor;
  org?: OrgSwitchProps;
  state: InvitationAcceptState;
  onAccept: () => void;
  onDecline: () => void;
  onConfirmDecline: () => void;
  onCancelDecline: () => void;
  onSignOut: () => void;
}

/** The invitation link page: the invitee's own invitation with Accept and Decline, or why it cannot be answered. */
export function InvitationAccept({ user, org, state, ...handlers }: InvitationAcceptProps) {
  return (
    <>
      <TopBar
        variant="global"
        crumbs={[{ label: 'Invitation' }]}
        user={user}
        org={org}
        tabs={org?.current ? 'org' : 'none'}
      />
      <main className={styles.emptyMain}>{body(state, handlers)}</main>
    </>
  );
}

const noop = () => {};

type Handlers = Omit<InvitationAcceptProps, 'user' | 'org' | 'state'>;

function notice(title: string, text?: string, actions?: ReactNode) {
  return (
    <div className={styles.emptyNoticeCol}>
      <h1>{title}</h1>
      {text && <p className="muted">{text}</p>}
      {actions && <div className={styles.welcomeActions}>{actions}</div>}
    </div>
  );
}

function body(state: InvitationAcceptState, h: Handlers) {
  switch (state.kind) {
    case 'loading':
      return (
        <div className={styles.welcomeCol}>
          <div className={styles.welcomeLoading} aria-busy="true" role="status" aria-label="Loading">
            <Skeleton variant="block" height={32} width={260} />
            <Skeleton variant="block" height={150} width="100%" />
            <span className={styles.acceptActions} aria-hidden="true">
              <Skeleton variant="block" height={40} width={96} />
              <Skeleton variant="block" height={40} width={96} />
            </span>
          </div>
        </div>
      );
    case 'error':
      return (
        <div className={styles.welcomeCol}>
          <RouteLoadError title="Internal server error" requestId={state.requestId} onRetry={state.onRetry} />
        </div>
      );
    case 'pending':
      return pendingBody(state, h);
    case 'accepted':
      return notice(
        `You already joined ${state.orgName}`,
        undefined,
        <Button variant="primary" size="lg" href={state.orgHref}>
          {`Go to ${state.orgName}`}
        </Button>,
      );
    case 'declined':
      return notice(
        'You declined this invitation',
        undefined,
        <Button size="lg" href={state.invitationsHref}>
          Go to invitations
        </Button>,
      );
    case 'revoked':
      return notice('This invitation was revoked');
    case 'expired':
      return notice(
        'This invitation has expired',
        state.inviter
          ? `Ask ${state.inviter} to resend it.`
          : `Ask an owner or admin of ${state.orgName} to resend it.`,
      );
    case 'notAvailable':
      return notice(
        'This invitation is not available',
        'Check that you signed in with the email it was sent to, or ask the person who invited you for a new link.',
        <>
          <span className={styles.signedIn}>{`Signed in as ${state.email}`}</span>
          <Button onClick={h.onSignOut}>Sign out</Button>
        </>,
      );
  }
}

function pendingBody(state: Extract<InvitationAcceptState, { kind: 'pending' }>, h: Handlers) {
  const { details, busy } = state;
  const items = [
    { term: 'Role', value: details.roleName },
    { term: 'Access', value: details.access },
    ...(details.inviter ? [{ term: 'Invited by', value: details.inviter }] : []),
    {
      term: 'Expires',
      value: (
        <time dateTime={details.expires.dateTime} title={details.expires.title}>
          {details.expires.text}
        </time>
      ),
    },
  ];
  return (
    <div className={styles.welcomeCol}>
      <h1>{`Join ${details.orgName}`}</h1>
      <SurfaceCard>
        <KeyValue items={items} termWidth={120} />
      </SurfaceCard>
      <div className={styles.acceptActions}>
        <Button variant="primary" size="lg" disabled={busy !== null} aria-busy={busy === 'accept'} onClick={h.onAccept}>
          {busy === 'accept' ? 'Accepting…' : 'Accept'}
        </Button>
        <Button size="lg" disabled={busy !== null} onClick={h.onDecline}>
          Decline
        </Button>
      </div>
      <Dialog
        open={state.confirmDecline}
        title={`Decline invitation to ${details.orgName}?`}
        width={440}
        onClose={busy === 'decline' ? noop : h.onCancelDecline}
        footer={
          <>
            <Button variant="ghost" disabled={busy === 'decline'} onClick={h.onCancelDecline}>
              Cancel
            </Button>
            <Button
              variant="solid-danger"
              disabled={busy === 'decline'}
              aria-busy={busy === 'decline'}
              onClick={h.onConfirmDecline}
            >
              {busy === 'decline' ? 'Declining…' : 'Decline'}
            </Button>
          </>
        }
      >
        <p className="muted">You will need a new invitation to join later.</p>
      </Dialog>
    </div>
  );
}
