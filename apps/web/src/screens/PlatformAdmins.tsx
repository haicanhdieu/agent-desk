import { Button, Dialog, Skeleton } from '@/ds';
import {
  AddPlatformAdminDialog,
  DataTable,
  EmptyState,
  Pagination,
  PlatformAdminRow,
  RouteLoadError,
  platformAdminColumns,
  type AddPlatformAdminDialogProps,
  type PaginationProps,
} from '@/components';
import type { PlatformAdminRowView } from '@/mocks';
import styles from './Screens.module.css';

export type PlatformAdminsView =
  | { kind: 'loading' }
  | { kind: 'error'; title: string; requestId?: string; onRetry: () => void }
  | { kind: 'forbidden' }
  | { kind: 'ready'; rows: PlatformAdminRowView[]; pagination: PaginationProps; busyId?: string };

export interface PlatformAdminsProps {
  view: PlatformAdminsView;
  onAdd: () => void;
  onRevoke: (row: PlatformAdminRowView) => void;
  /** The revoke confirm. While its request is in flight (`busy`) it cannot be closed or repeated. */
  revokeConfirm?: {
    row: PlatformAdminRowView;
    own: boolean;
    busy: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  };
  addDialog?: AddPlatformAdminDialogProps;
}

const noop = () => {};

/** The Platform admins page: who may open the platform area. Names and emails are text, never HTML. */
export function PlatformAdmins({ view, onAdd, onRevoke, revokeConfirm, addDialog }: PlatformAdminsProps) {
  if (view.kind === 'forbidden') {
    return (
      <main className={styles.emptyNotice}>
        <div className={styles.emptyNoticeCol}>
          <h1>You don&apos;t have access</h1>
          <p className="muted">This area is for platform admins.</p>
          <Button href="/projects">Go to projects</Button>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.platformMain}>
      {view.kind === 'loading' && (
        <div className={styles.platformLoading} aria-busy="true" role="status" aria-label="Loading">
          <span aria-hidden="true">
            <Skeleton variant="block" height={28} width={140} />
          </span>
          <span className={styles.membersLoadingRows} aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} variant="block" height={30} width="100%" />
            ))}
          </span>
        </div>
      )}
      {view.kind === 'error' && <RouteLoadError title={view.title} requestId={view.requestId} onRetry={view.onRetry} />}
      {view.kind === 'ready' && (
        <>
          <div className={styles.listHead}>
            <h1 tabIndex={-1}>Platform admins</h1>
            <Button variant="primary" icon="plus" onClick={onAdd}>
              Add platform admin
            </Button>
          </div>
          {view.rows.length === 0 ? (
            <EmptyState headingLevel={2} title="No platform admins" />
          ) : (
            <>
              <DataTable columns={platformAdminColumns} busy={view.pagination.busy}>
                {view.rows.map((row) => (
                  <PlatformAdminRow key={row.id} row={row} busy={view.busyId === row.id} onRevoke={onRevoke} />
                ))}
              </DataTable>
              <Pagination {...view.pagination} />
            </>
          )}
        </>
      )}
      {addDialog && <AddPlatformAdminDialog {...addDialog} />}
      {revokeConfirm && (
        <Dialog
          open
          title={
            revokeConfirm.own
              ? 'Revoke your own platform access?'
              : `Revoke platform access for ${revokeConfirm.row.name ?? revokeConfirm.row.email}?`
          }
          width={480}
          onClose={revokeConfirm.busy ? noop : revokeConfirm.onCancel}
          footer={
            <>
              <Button variant="ghost" disabled={revokeConfirm.busy} onClick={revokeConfirm.onCancel}>
                Cancel
              </Button>
              <Button
                variant="solid-danger"
                disabled={revokeConfirm.busy}
                aria-busy={revokeConfirm.busy}
                onClick={revokeConfirm.onConfirm}
              >
                {revokeConfirm.busy ? 'Revoking…' : 'Revoke'}
              </Button>
            </>
          }
        >
          <p className="muted">
            {revokeConfirm.own
              ? 'You lose access right away and go to the home page.'
              : 'They can no longer open the platform admin area.'}
          </p>
        </Dialog>
      )}
    </main>
  );
}
