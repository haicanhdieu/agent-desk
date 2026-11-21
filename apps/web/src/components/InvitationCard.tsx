import { Button } from '@/ds';
import type { InvitationCardView } from '@/mocks/types';
import { SurfaceCard } from './SurfaceCard';
import styles from './Invitations.module.css';

export interface InvitationCardProps {
  card: InvitationCardView;
  /** Which button was pressed while its request is in flight. */
  pending: 'accept' | 'decline' | null;
  onAccept: () => void;
  onDecline: () => void;
}

/** One pending invitation for the invitee: org, role, access, inviter and expiry, with Decline and Accept. */
export function InvitationCard({ card, pending, onAccept, onDecline }: InvitationCardProps) {
  const busy = pending !== null;
  const expires = card.inviter
    ? `Invited by ${card.inviter}, expires ${card.expires.text}`
    : `Expires ${card.expires.text}`;
  return (
    <SurfaceCard>
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>{`${card.orgName} invited you as ${card.roleName}`}</h2>
        <span className={styles.muted}>{card.access}</span>
        <span className={styles.muted} title={card.expires.title}>
          {expires}
        </span>
        <div className={styles.cardActions}>
          <Button disabled={busy} onClick={onDecline}>
            {pending === 'decline' ? 'Declining…' : 'Decline'}
          </Button>
          <Button variant="primary" disabled={busy} onClick={onAccept}>
            {pending === 'accept' ? 'Accepting…' : 'Accept'}
          </Button>
        </div>
      </div>
    </SurfaceCard>
  );
}
