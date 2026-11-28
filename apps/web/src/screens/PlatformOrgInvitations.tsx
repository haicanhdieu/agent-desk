import { useState, type ReactNode } from 'react';
import { Button, Toast, ToastRegion } from '@/ds';
import {
  DataTable,
  EmptyState,
  FilterChip,
  FilterChips,
  InvitationRow,
  Pagination,
  RouteLoadError,
  type InvitationRowProps,
} from '@/components';
import type { InvitationStatusView, OrgInvitationRowView } from '@/mocks';
import { TabLoading, type ListView } from './PlatformOrgProjects';
import styles from './Screens.module.css';

export interface PlatformOrgInvitationsProps {
  view: ListView<OrgInvitationRowView>;
  status: InvitationStatusView | 'all';
  onStatus: (s: InvitationStatusView | 'all') => void;
  onInvite: () => void;
  /** The row whose resend is in flight: its menu is disabled. */
  resendingId?: string;
  /** The invite form dialog. */
  inviteDialog?: ReactNode;
  /** The "Invitation link" dialog shown after create or from Copy link. */
  linkDialog?: ReactNode;
  /** The clipboard refused: a notice tells the admin to copy the link by hand. */
  copyFailed?: boolean;
  /** The handlers of one row's menu. */
  rowActions: (row: OrgInvitationRowView) => Pick<InvitationRowProps, 'onCopy' | 'onResend' | 'onRevoke'>;
}

const CHIPS: { value: InvitationStatusView | 'all'; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'declined', label: 'Declined' },
  { value: 'revoked', label: 'Revoked' },
  { value: 'expired', label: 'Expired' },
  { value: 'all', label: 'All' },
];

const columns = [
  { key: 'email', header: 'Email' },
  { key: 'role', header: 'Role' },
  { key: 'access', header: 'Access' },
  { key: 'status', header: 'Status' },
  { key: 'expires', header: 'Expires' },
  { key: 'by', header: 'Invited by' },
  { key: 'actions', header: <span className="sr-only">Actions</span>, width: 56 },
];

/** The Invitations tab of a platform org detail: the tenant invitations table with a platform note. Text, never HTML. */
export function PlatformOrgInvitations({
  view,
  status,
  onStatus,
  onInvite,
  resendingId,
  inviteDialog,
  linkDialog,
  copyFailed,
  rowActions,
}: PlatformOrgInvitationsProps) {
  // A dismissal belongs to one failure: the route clears `copyFailed` before the next attempt.
  const [dismissed, setDismissed] = useState(false);
  if (!copyFailed && dismissed) setDismissed(false);
  return (
    <>
      {view.kind === 'loading' && <TabLoading />}
      {view.kind === 'error' && <RouteLoadError title={view.title} requestId={view.requestId} onRetry={view.onRetry} />}
      {view.kind === 'ready' && (
        <>
          <div className={styles.listHead}>
            <h2>Invitations</h2>
            <Button variant="primary" icon="plus" onClick={onInvite}>
              Invite people
            </Button>
          </div>
          <p className="muted">Platform view: names and emails only. Tickets, runs and secrets are never shown here.</p>
          <div className={styles.invitationChips}>
            <FilterChips aria-label="Filter by status">
              {CHIPS.map((c) => (
                <FilterChip key={c.value} label={c.label} on={status === c.value} onClick={() => onStatus(c.value)} />
              ))}
            </FilterChips>
          </div>
          <DataTable columns={columns} busy={view.busy ?? view.pagination.busy}>
            {view.rows.map((row) => (
              <InvitationRow key={row.id} row={row} busy={resendingId === row.id} {...rowActions(row)} />
            ))}
          </DataTable>
          {view.rows.length === 0 ? (
            <EmptyState title="No invitations" action={<Button onClick={onInvite}>Invite people</Button>} />
          ) : (
            <Pagination {...view.pagination} />
          )}
        </>
      )}
      {inviteDialog}
      {linkDialog}
      {copyFailed && !dismissed && (
        <ToastRegion>
          <Toast
            tone="err"
            role="alert"
            title="Could not copy. Select the link and copy it."
            onDismiss={() => setDismissed(true)}
          />
        </ToastRegion>
      )}
    </>
  );
}
