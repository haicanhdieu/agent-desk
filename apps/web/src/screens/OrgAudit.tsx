import { Skeleton } from '@/ds';
import {
  AuditRow,
  auditColumns,
  DataTable,
  EmptyState,
  Pagination,
  PageHeader,
  RouteLoadError,
  useShellOwnsChrome,
  type PaginationProps,
} from '@/components';
import type { AuditRowView } from '@/mocks/types';
import styles from './Screens.module.css';

export interface OrgAuditProps {
  state:
    | { kind: 'loading' }
    | { kind: 'error'; requestId?: string; onRetry: () => void }
    | { kind: 'forbidden' }
    | { kind: 'ready'; rows: AuditRowView[]; pagination?: PaginationProps };
}

/** The org's Audit log page: when, who and what for each entry, paging, and the states around it. All text, never HTML. */
export function OrgAudit({ state }: OrgAuditProps) {
  const owned = useShellOwnsChrome();
  if (state.kind === 'forbidden') {
    return (
      <main className={styles.emptyNotice}>
        <div className={styles.emptyNoticeCol}>
          <h1>You don&apos;t have access</h1>
          <p className="muted">Ask an owner of this organization to give you access.</p>
        </div>
      </main>
    );
  }

  return (
    <main className={owned ? styles.shellMain : styles.listMain}>
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
          {owned ? (
            <PageHeader title="Audit log" />
          ) : (
            <div className={styles.listHead}>
              <h1 tabIndex={-1}>Audit log</h1>
            </div>
          )}
          <DataTable columns={auditColumns} busy={state.pagination?.busy}>
            {state.rows.map((row) => (
              <AuditRow key={row.id} row={row} />
            ))}
          </DataTable>
          {state.rows.length === 0 && <EmptyState headingLevel={2} title="No activity yet" />}
          {state.pagination && <Pagination {...state.pagination} />}
        </>
      )}
    </main>
  );
}
