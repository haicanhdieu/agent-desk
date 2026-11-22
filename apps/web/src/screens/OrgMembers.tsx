import { useEffect, useRef, type ReactNode } from 'react';
import { Button, Dialog, Skeleton, Toast, ToastRegion } from '@/ds';
import {
  DataTable,
  EmptyState,
  MemberRow,
  memberColumns,
  Pagination,
  RouteLoadError,
  type PaginationProps,
} from '@/components';
import type { MemberRowView } from '@/mocks/types';
import styles from './Screens.module.css';

export interface OrgMembersProps {
  state:
    | { kind: 'loading' }
    | { kind: 'error'; requestId?: string; onRetry: () => void }
    | { kind: 'forbidden' }
    | { kind: 'ready'; rows: MemberRowView[]; busyUserId: string | null; pagination?: PaginationProps };
  onChangeRole: (row: MemberRowView) => void;
  onRemove: (row: MemberRowView) => void;
  /** Stories only: render this member's row menu open. */
  openMenuUserId?: string;
  /** The outcome of the last action, shown as a dismissible toast. */
  notice?: { tone: 'ok' | 'error'; title: string; onDismiss: () => void };
  /** The remove confirm. While its request is in flight (`busy`) it cannot be closed or repeated. */
  removeConfirm?: {
    memberName: string;
    orgName: string;
    busy?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  };
  /** The change-role dialog (a `ChangeRoleDialog`). */
  children?: ReactNode;
}

const noop = () => {};

/** The org's Members page: the members table, paging, and the states around it. Names are text, never HTML. */
export function OrgMembers({
  state,
  onChangeRole,
  onRemove,
  openMenuUserId,
  notice,
  removeConfirm,
  children,
}: OrgMembersProps) {
  const tableRef = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  const menuRow = state.kind === 'ready' ? openMenuUserId : undefined;
  useEffect(() => {
    if (!menuRow || opened.current) return;
    const name = state.kind === 'ready' ? state.rows.find((r) => r.userId === menuRow)?.name : undefined;
    const button = [...(tableRef.current?.querySelectorAll('button') ?? [])].find(
      (b) => b.getAttribute('aria-label') === `Actions for ${name}`,
    );
    if (!button) return;
    opened.current = true;
    button.click();
  }, [menuRow, state]);

  const layer = (
    <>
      {children}
      {removeConfirm && (
        <Dialog
          open
          title={`Remove ${removeConfirm.memberName} from ${removeConfirm.orgName}?`}
          width={440}
          onClose={removeConfirm.busy ? noop : removeConfirm.onCancel}
          footer={
            <>
              <Button variant="ghost" disabled={removeConfirm.busy === true} onClick={removeConfirm.onCancel}>
                Cancel
              </Button>
              <Button
                variant="solid-danger"
                disabled={removeConfirm.busy === true}
                aria-busy={removeConfirm.busy === true}
                onClick={removeConfirm.onConfirm}
              >
                {removeConfirm.busy ? 'Removing…' : 'Remove'}
              </Button>
            </>
          }
        >
          <p className="muted">They lose access to every project in {removeConfirm.orgName}.</p>
        </Dialog>
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

  return (
    <>
      <main className={styles.listMain}>
        {state.kind === 'loading' && (
          <div className={styles.membersLoading} aria-busy="true" role="status" aria-label="Loading">
            <span aria-hidden="true">
              <Skeleton variant="block" height={28} width={160} />
            </span>
            <span className={styles.membersLoadingRows} aria-hidden="true">
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
              <h1 tabIndex={-1}>Members</h1>
            </div>
            <div ref={tableRef}>
              <DataTable columns={memberColumns} busy={state.pagination?.busy}>
                {state.rows.map((row) => (
                  <MemberRow
                    key={row.userId}
                    row={row}
                    busy={state.busyUserId === row.userId}
                    onChangeRole={onChangeRole}
                    onRemove={onRemove}
                  />
                ))}
              </DataTable>
            </div>
            {state.rows.length === 0 && <EmptyState headingLevel={2} title="No members" />}
            {state.pagination && <Pagination {...state.pagination} />}
          </>
        )}
      </main>
      {layer}
    </>
  );
}
