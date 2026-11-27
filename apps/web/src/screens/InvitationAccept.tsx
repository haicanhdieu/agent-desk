import type { ReactNode } from 'react';
import { Button, Dialog, Skeleton } from '@/ds';
import {
  KeyValue,
  PageHeader,
  RouteLoadError,
  SurfaceCard,
  TopBar,
  useShellOwnsChrome,
  type OrgSwitchProps,
} from '@/components';
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
  const owned = useShellOwnsChrome();
  if (owned) return shellBody(state, handlers);
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

function notice(shell: boolean, title: string, text?: string, actions?: ReactNode) {
  if (shell) return shellNotice(title, text, actions);
  return (
    <div className={styles.emptyNoticeCol}>
      <h1>{title}</h1>
      {text && <p className="muted">{text}</p>}
      {actions && <div className={styles.welcomeActions}>{actions}</div>}
    </div>
  );
}

function body(state: InvitationAcceptState, h: Handlers, shell = false) {
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
      return pendingBody(state, h, shell);
    case 'accepted':
      return notice(
        shell,
        `You already joined ${state.orgName}`,
        undefined,
        <Button variant="primary" size="lg" href={state.orgHref}>
          {`Go to ${state.orgName}`}
        </Button>,
      );
    case 'declined':
      return notice(
        shell,
        'You declined this invitation',
        undefined,
        <Button size="lg" href={state.invitationsHref}>
          Go to invitations
        </Button>,
      );
    case 'revoked':
      return notice(shell, 'This invitation was revoked');
    case 'expired':
      return notice(
        shell,
        'This invitation has expired',
        state.inviter
          ? `Ask ${state.inviter} to resend it.`
          : `Ask an owner or admin of ${state.orgName} to resend it.`,
      );
    case 'notAvailable':
      return notice(
        shell,
        'This invitation is not available',
        'Check that you signed in with the email it was sent to, or ask the person who invited you for a new link.',
        <>
          <span className={styles.signedIn}>{`Signed in as ${state.email}`}</span>
          <Button onClick={h.onSignOut}>Sign out</Button>
        </>,
      );
  }
}

function pendingBody(state: Extract<InvitationAcceptState, { kind: 'pending' }>, h: Handlers, shell = false) {
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
    <div className={shell ? styles.shellPending : styles.welcomeCol}>
      {shell ? <PageHeader title={`Join ${details.orgName}`} /> : <h1>{`Join ${details.orgName}`}</h1>}
      <SurfaceCard>
        <div className={styles.acceptCardBody}>
          <KeyValue items={items} termWidth={120} />
        </div>
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

function shellNotice(title: string, text?: string, actions?: ReactNode) {
  return (
    <>
      <PageHeader title={title} />
      {text && <p className="muted">{text}</p>}
      {actions && <div className={styles.shellNoticeActions}>{actions}</div>}
    </>
  );
}

/**
 * In the shell the bar and menu are the shell's: this draws only the page, one main. Loading and a failed load have
 * no title; "not available" is centred like the other pages with no menu; the rest keep their title in the header.
 */
function shellBody(state: InvitationAcceptState, h: Handlers) {
  if (state.kind === 'notAvailable') {
    return <main className={styles.emptyNotice}>{body(state, h)}</main>;
  }
  return (
    <main className={styles.shellMain}>
      {state.kind === 'loading' && (
        <div className={styles.welcomeLoading} aria-busy="true" role="status" aria-label="Loading">
          <Skeleton variant="block" height={28} width={260} />
          <Skeleton variant="block" height={150} width="100%" />
          <span className={styles.acceptActions} aria-hidden="true">
            <Skeleton variant="block" height={40} width={96} />
            <Skeleton variant="block" height={40} width={96} />
          </span>
        </div>
      )}
      {state.kind === 'error' && (
        <RouteLoadError title="Internal server error" requestId={state.requestId} onRetry={state.onRetry} />
      )}
      {state.kind !== 'loading' && state.kind !== 'error' && body(state, h, true)}
    </main>
  );
}
