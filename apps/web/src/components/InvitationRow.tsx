import { Button, IconButton, Popover, StatusIcon } from '@/ds';
import type { InvitationStatusView, OrgInvitationRowView } from '@/mocks/types';
import { ExpiryLabel } from './ExpiryLabel';
import { useRowMenu } from './useRowMenu';
import styles from './Invitations.module.css';

export interface InvitationRowProps {
  row: OrgInvitationRowView;
  /** A row action is in flight: the menu is disabled. */
  busy?: boolean;
  onCopy: () => void;
  onResend: () => void;
  onRevoke: () => void;
}

const LABELS: Record<InvitationStatusView, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  declined: 'Declined',
  revoked: 'Revoked',
  expired: 'Expired',
};

/** Glyph and tone per status (shape carries the meaning, text always follows). */
function StatusGlyph({ status }: { status: InvitationStatusView }) {
  switch (status) {
    case 'pending':
      return <StatusIcon status="queued" />;
    case 'accepted':
      return <StatusIcon status="succeeded" />;
    case 'declined':
      return <StatusIcon status="cancelled" />;
    case 'expired':
      return <StatusIcon status="timed_out" />;
    case 'revoked':
      // A grey ring crossed out; no run status draws this one.
      return (
        <span className={styles.off}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16">
            <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path
              d="M5.9 5.9l4.2 4.2M10.1 5.9l-4.2 4.2"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </span>
      );
  }
}

/** One row of the org's invitations table: email, role, access, status, expiry, inviter and the row menu. */
export function InvitationRow({ row, busy, onCopy, onResend, onRevoke }: InvitationRowProps) {
  const { menuAt, open, moreRef, toggleMenu, closeMenu } = useRowMenu();
  const pick = (action: () => void) => () => {
    closeMenu();
    action();
  };
  const can = (a: OrgInvitationRowView['actions'][number]) => row.actions.includes(a);
  const hasMenu = row.actions.length > 0;

  return (
    <tr>
      <td className={styles.ellipsisCell} data-label="Email">
        <span className={styles.ellipsis} title={row.email}>
          {row.email}
        </span>
      </td>
      <td className={styles.cell} data-label="Role">
        {row.role}
      </td>
      <td className={styles.ellipsisCell} data-label="Access">
        <span className={styles.ellipsis} title={row.access}>
          {row.access}
        </span>
      </td>
      <td data-label="Status">
        <span className={styles.status}>
          <StatusGlyph status={row.status} />
          {LABELS[row.status]}
        </span>
      </td>
      <td data-label="Expires">
        <ExpiryLabel expires={row.expires} />
      </td>
      <td className={styles.cell} data-label="Invited by">
        {row.invitedBy ?? '–'}
      </td>
      <td className={styles.actionsCell}>
        <span ref={moreRef}>
          <IconButton
            icon="more"
            aria-label={`Actions for ${row.email}`}
            aria-haspopup="dialog"
            aria-expanded={open}
            disabled={busy || !hasMenu}
            onClick={toggleMenu}
          />
          <Popover
            open={open}
            label={`Actions for ${row.email}`}
            onClose={closeMenu}
            style={{ position: 'fixed', top: menuAt?.top, right: menuAt?.right, padding: 6, gap: 2 }}
          >
            {can('copy') && (
              <Button variant="ghost" size="sm" icon="copy" className={styles.menuAction} onClick={pick(onCopy)}>
                Copy link
              </Button>
            )}
            {can('resend') && (
              <Button variant="ghost" size="sm" className={styles.menuAction} onClick={pick(onResend)}>
                Resend
              </Button>
            )}
            {can('revoke') && (
              <Button variant="danger" size="sm" className={styles.menuAction} onClick={pick(onRevoke)}>
                Revoke
              </Button>
            )}
          </Popover>
        </span>
      </td>
    </tr>
  );
}
