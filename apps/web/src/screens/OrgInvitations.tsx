import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Dialog, Popover, Skeleton, Toast, ToastRegion } from '@/ds';
import {
  DataTable,
  EmptyState,
  FilterChip,
  FilterChips,
  InvitationRow,
  InviteLink,
  PageHeader,
  Pagination,
  RouteLoadError,
  useShellOwnsChrome,
  type PaginationProps,
} from '@/components';
import type { OrgInvitationRowView } from '@/mocks/types';
import styles from './Screens.module.css';

const noop = () => undefined;

export type InvitationFilter = 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired' | 'all';

export interface OrgInvitationsProps {
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
  /** The revoke confirm dialog. While its own request is in flight (`busy`) it cannot be closed or repeated. */
  revokeConfirm?: { email: string; busy?: boolean; onConfirm: () => void; onCancel: () => void };
  /** The clipboard refused: a small popover under the row's menu button holds the link to copy by hand. */
  copyFailed?: { rowId: string; link: string };
  /** The outcome of the last row action, shown as a dismissible toast. */
  notice?: { tone: 'ok' | 'error'; title: string; onDismiss: () => void };
  /** The dialog layer (the invite dialog). */
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
  filter,
  onFilterChange,
  state,
  onInvite,
  onCopy,
  onResend,
  onRevoke,
  openMenuRowId,
  revokeConfirm,
  copyFailed,
  notice,
  children,
}: OrgInvitationsProps) {
  const owned = useShellOwnsChrome();
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

  const [copyAt, setCopyAt] = useState<{ top: number; right: number } | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const copyRow = state.kind === 'ready' ? copyFailed : undefined;
  const copyKey = copyRow ? `${copyRow.rowId}\n${copyRow.link}` : null;
  const copyEmail =
    copyRow && state.kind === 'ready' ? state.rows.find((r) => r.id === copyRow.rowId)?.email : undefined;
  const copyShown = copyEmail !== undefined && copyKey !== dismissedKey;
  // The route clears `copyFailed` before each attempt: a dismissal then belongs to the attempt that is over.
  if (copyKey === null && dismissedKey !== null) setDismissedKey(null);
  // The popover is fixed in viewport coordinates: keep it under its row's button through scroll and resize, so the
  // link stays selectable. Escape (via the Popover) or a press outside closes it.
  useLayoutEffect(() => {
    if (!copyShown) return undefined;
    const place = () => {
      const button = [...(tableRef.current?.querySelectorAll('button') ?? [])].find(
        (b) => b.getAttribute('aria-label') === `Actions for ${copyEmail}`,
      );
      const r = button?.getBoundingClientRect();
      setCopyAt(r ? { top: r.bottom + 4, right: window.innerWidth - r.right } : null);
    };
    place();
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Element && !e.target.closest('[aria-label="Invitation link"]')) setDismissedKey(copyKey);
    };
    document.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [copyShown, copyEmail, copyKey, copyRow?.link]);

  const busyRow = revokeConfirm?.busy === true;
  const layer = (
    <>
      {children}
      {revokeConfirm && (
        <Dialog
          open
          title={`Revoke invitation for ${revokeConfirm.email}?`}
          width={440}
          onClose={busyRow ? noop : revokeConfirm.onCancel}
          footer={
            <>
              <Button variant="ghost" disabled={busyRow} onClick={revokeConfirm.onCancel}>
                Cancel
              </Button>
              <Button variant="solid-danger" disabled={busyRow} aria-busy={busyRow} onClick={revokeConfirm.onConfirm}>
                {busyRow ? 'Revoking…' : 'Revoke'}
              </Button>
            </>
          }
        >
          <p className="muted">The link stops working.</p>
        </Dialog>
      )}
      {copyRow && copyAt && copyShown && (
        <Popover
          open
          label="Invitation link"
          onClose={() => setDismissedKey(copyKey)}
          style={{ position: 'fixed', top: copyAt.top, right: copyAt.right }}
        >
          <InviteLink link={copyRow.link} onCopy={() => onCopy(copyRow.rowId)} copyFailed />
        </Popover>
      )}
      {notice && (
        <ToastRegion>
          <Toast
            tone={notice.tone === 'ok' ? 'ok' : 'err'}
            role="status"
            title={notice.title}
            onDismiss={notice.onDismiss}
          />
        </ToastRegion>
      )}
    </>
  );

  if (state.kind === 'forbidden') {
    return (
      <>
        <main className={styles.emptyNotice}>
          <div className={styles.emptyNoticeCol}>
            <h1>You don&apos;t have access</h1>
            <p className="muted">Ask an owner of this organization to give you access.</p>
          </div>
        </main>
        {layer}
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
      <main className={owned ? styles.shellMain : styles.listMain}>
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
            {owned ? (
              <PageHeader title="Invitations" actions={invite} />
            ) : (
              <div className={styles.listHead}>
                <h1>Invitations</h1>
                {invite}
              </div>
            )}
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
      {layer}
    </>
  );
}
