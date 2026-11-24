import { Button, Skeleton } from '@/ds';
import { InvitationCard, RouteLoadError, TopBar, type OrgSwitchProps } from '@/components';
import type { Actor, InvitationCardView } from '@/mocks/types';
import styles from './Screens.module.css';

export type MyInvitationsState =
  | { kind: 'loading' }
  | { kind: 'error'; requestId?: string; onRetry: () => void }
  | { kind: 'list'; cards: InvitationCardView[]; pending: { id: string; action: 'accept' | 'decline' } | null }
  | { kind: 'empty'; email: string; platformAdmin: boolean; createHref: string };

export interface MyInvitationsProps {
  user: Actor;
  org?: OrgSwitchProps;
  state: MyInvitationsState;
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
  onSignOut: () => void;
}

/** The welcome page: the signed-in person's pending invitations, or what to do when there are none. */
export function MyInvitations({ user, org, state, onAccept, onDecline, onSignOut }: MyInvitationsProps) {
  return (
    <>
      <TopBar
        variant="global"
        crumbs={[{ label: 'Invitations' }]}
        user={user}
        org={org}
        tabs={org?.current ? 'org' : 'none'}
      />
      <main className={styles.emptyMain}>{body(state, onAccept, onDecline, onSignOut)}</main>
    </>
  );
}

function body(
  state: MyInvitationsState,
  onAccept: (id: string) => void,
  onDecline: (id: string) => void,
  onSignOut: () => void,
) {
  switch (state.kind) {
    case 'loading':
      return (
        <div className={styles.welcomeCol}>
          <div className={styles.welcomeLoading} aria-busy="true" role="status" aria-label="Loading">
            <Skeleton variant="block" height={32} width={200} />
            <span className={styles.welcomeLoadingList} aria-hidden="true">
              <Skeleton variant="block" height={98} width="100%" />
              <Skeleton variant="block" height={98} width="100%" />
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
    case 'list':
      return (
        <div className={styles.welcomeCol}>
          <h1>Invitations</h1>
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
        </div>
      );
    case 'empty':
      return (
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
      );
  }
}
