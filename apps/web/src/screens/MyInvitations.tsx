import { Button, Skeleton } from '@/ds';
import { EmptyState, InvitationCard, PageHeader, RouteLoadError } from '@/components';
import type { InvitationCardView } from '@/mocks/types';
import styles from './Screens.module.css';

export type MyInvitationsState =
  | { kind: 'loading' }
  | { kind: 'error'; requestId?: string; onRetry: () => void }
  | { kind: 'list'; cards: InvitationCardView[]; pending: { id: string; action: 'accept' | 'decline' } | null }
  | { kind: 'empty'; member: boolean; email: string; platformAdmin: boolean; createHref: string };

export interface MyInvitationsProps {
  state: MyInvitationsState;
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
  onSignOut: () => void;
}

/** The welcome page: the signed-in person's pending invitations, or what to do when there are none. */
export function MyInvitations({ state, onAccept, onDecline, onSignOut }: MyInvitationsProps) {
  return shellBody(state, onAccept, onDecline, onSignOut);
}

const noticeMember = (email: string) => (
  <EmptyState headingLevel={2} title="No pending invitations" body={`No invitations for ${email}.`} />
);

/** In the shell the bar and menu are the shell's: this draws only the page, one main, no h1 while loading or failed. */
function shellBody(
  state: MyInvitationsState,
  onAccept: (id: string) => void,
  onDecline: (id: string) => void,
  onSignOut: () => void,
) {
  if (state.kind === 'empty' && !state.member) {
    return (
      <main className={styles.emptyNotice}>
        <div className={styles.emptyNoticeCol}>
          <h1>You&apos;re not a member of any organization</h1>
          <p className="muted">
            {state.platformAdmin
              ? 'Create an organization and invite its first owner.'
              : `No invitations for ${state.email}. Ask an owner or admin to invite you.`}
          </p>
          <div className={styles.welcomeActions}>
            {state.platformAdmin && (
              <Button variant="primary" size="lg" icon="plus" href={state.createHref}>
                Create organization
              </Button>
            )}
            <Button size="lg" onClick={onSignOut}>
              Sign out
            </Button>
          </div>
        </div>
      </main>
    );
  }
  return (
    <main className={styles.shellMain}>
      {state.kind === 'loading' && (
        <div className={styles.welcomeLoading} aria-busy="true" role="status" aria-label="Loading">
          <Skeleton variant="block" height={28} width={200} />
          <span className={styles.welcomeLoadingList} aria-hidden="true">
            <Skeleton variant="block" height={98} width="100%" />
            <Skeleton variant="block" height={98} width="100%" />
          </span>
        </div>
      )}
      {state.kind === 'error' && (
        <RouteLoadError title="Internal server error" requestId={state.requestId} onRetry={state.onRetry} />
      )}
      {state.kind === 'list' && (
        <>
          <PageHeader title="My invitations" />
          <ul className={styles.welcomeList}>
            {state.cards.map((card) => (
              <li key={card.id}>
                <InvitationCard
                  card={card}
                  pending={state.pending?.id === card.id ? state.pending.action : null}
                  onAccept={() => onAccept(card.id)}
                  onDecline={() => onDecline(card.id)}
                />
              </li>
            ))}
          </ul>
        </>
      )}
      {state.kind === 'empty' && (
        <>
          <PageHeader title="My invitations" />
          {noticeMember(state.email)}
        </>
      )}
    </main>
  );
}
