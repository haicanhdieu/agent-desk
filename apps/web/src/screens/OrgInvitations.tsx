import { useEffect, useRef, type ReactNode } from 'react';
import { Button, Skeleton } from '@/ds';
import {
  DataTable,
  EmptyState,
  FilterChip,
  FilterChips,
  InvitationRow,
  Pagination,
  RouteLoadError,
  TopBar,
  type OrgSwitchProps,
  type PaginationProps,
} from '@/components';
import type { Actor, OrgInvitationRowView } from '@/mocks/types';
import styles from './Screens.module.css';

export type InvitationFilter = 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired' | 'all';

export interface OrgInvitationsProps {
  user: Actor;
  org: OrgSwitchProps;
  filter: InvitationFilter;
  onFilterChange: (f: InvitationFilter) => void;
  state:
    | { kind: 'loading' }
    | { kind: 'error'; requestId?: string; onRetry: () => void }
    | { kind: 'forbidden' }
    | { kind: 'ready'; rows: OrgInvitationRowView[]; busyRowId: string | null; pagination?: PaginationProps };
  onInvite: () => void;
  onCopy: (id: string) => void;
  onResend: (id: string) => void;
  onRevoke: (id: string) => void;
  /** Stories only: render this row's menu open. */
  openMenuRowId?: string;
  /** The dialog and toasts layer. */
  children?: ReactNode;
}

const CHIPS: { value: InvitationFilter; label: string }[] = [
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

function emptyTitle(filter: InvitationFilter): string {
  if (filter === 'all') return 'No invitations yet';
  return `No ${filter} invitations`;
}

/** The org's Invitations page: status filter, the invitations table, paging, and the states around it. */
export function OrgInvitations({
  user,
  org,
  filter,
  onFilterChange,
  state,
  onInvite,
  onCopy,
  onResend,
  onRevoke,
  openMenuRowId,
  children,
}: OrgInvitationsProps) {
  const tableRef = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  const menuRow = state.kind === 'ready' ? openMenuRowId : undefined;
  useEffect(() => {
    if (!menuRow || opened.current) return;
    const email = state.kind === 'ready' ? state.rows.find((r) => r.id === menuRow)?.email : undefined;
    const button = [...(tableRef.current?.querySelectorAll('button') ?? [])].find(
      (b) => b.getAttribute('aria-label') === `Actions for ${email}`,
    );
    if (!button) return;
    opened.current = true;
    button.click();
  }, [menuRow, state]);

  if (state.kind === 'forbidden') {
    return (
      <>
        <TopBar variant="global" user={user} org={org} />
        <main className={styles.emptyNotice}>
          <div className={styles.emptyNoticeCol}>
            <h1>You don&apos;t have access</h1>
            <p className="muted">Ask an owner of this organization to give you access.</p>
          </div>
        </main>
        {children}
      </>
    );
  }

  const invite = (
    <Button variant="primary" icon="plus" onClick={onInvite}>
      Invite people
    </Button>
  );

  return (
    <>
      <TopBar variant="global" user={user} org={org} />
      <main className={styles.listMain}>
        {state.kind === 'loading' && (
          <div className={styles.invitationsLoading} aria-busy="true" role="status" aria-label="Loading">
            <span className={styles.invitationsLoadingHead} aria-hidden="true">
              <Skeleton variant="block" height={28} width={160} />
              <Skeleton variant="block" height={32} width={130} />
            </span>
            <span className={styles.invitationsLoadingChips} aria-hidden="true">
              {CHIPS.map((c) => (
                <Skeleton key={c.value} variant="block" height={28} width={78} />
              ))}
            </span>
            <span className={styles.invitationsLoadingRows} aria-hidden="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} variant="block" height={30} width="100%" />
              ))}
            </span>
          </div>
        )}
        {state.kind === 'error' && (
          <RouteLoadError title="Internal server error" requestId={state.requestId} onRetry={state.onRetry} />
        )}
        {state.kind === 'ready' && (
          <>
            <div className={styles.listHead}>
              <h1>Invitations</h1>
              {invite}
            </div>
            <FilterChips aria-label="Filter by status">
              {CHIPS.map((c) => (
                <FilterChip
                  key={c.value}
                  label={c.label}
                  on={filter === c.value}
                  onClick={() => onFilterChange(c.value)}
                />
              ))}
            </FilterChips>
            <div ref={tableRef}>
              <DataTable columns={columns} busy={state.pagination?.busy}>
                {state.rows.map((row) => (
                  <InvitationRow
                    key={row.id}
                    row={row}
                    busy={state.busyRowId === row.id}
                    onCopy={() => onCopy(row.id)}
                    onResend={() => onResend(row.id)}
                    onRevoke={() => onRevoke(row.id)}
                  />
                ))}
              </DataTable>
            </div>
            {state.rows.length === 0 && (
              <EmptyState
                headingLevel={2}
                title={emptyTitle(filter)}
                action={filter === 'pending' ? invite : undefined}
              />
            )}
            {state.pagination && <Pagination {...state.pagination} />}
          </>
        )}
      </main>
      {children}
    </>
  );
}
