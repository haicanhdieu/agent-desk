import { Skeleton } from '@/ds';
import {
  AuditRow,
  auditColumns,
  DataTable,
  EmptyState,
  Pagination,
  RouteLoadError,
  type PaginationProps,
} from '@/components';
import type { AuditRowView } from '@/mocks/types';
import styles from './Screens.module.css';
import { DeskFrame, type DeskFrameData } from './DeskFrame';

export interface DeskAuditProps {
  /** The project, its connection and the setup warning. */
  frame: DeskFrameData;
  state:
    | { kind: 'loading' }
    | { kind: 'error'; requestId?: string; onRetry: () => void }
    | { kind: 'ready'; rows: AuditRowView[]; pagination?: PaginationProps };
}

/** The project's Audit log page inside the Desk: when, who and what for each entry, paging, and the states around it. */
export function DeskAudit({ frame, state }: DeskAuditProps) {
  return (
    <DeskFrame {...frame} active="audit" title={state.kind === 'ready' ? 'Audit log' : undefined}>
      <div className={styles.shellBody}>
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
            <p className="muted">Changes to this project, newest first.</p>
            <DataTable columns={auditColumns} busy={state.pagination?.busy}>
              {state.rows.map((row) => (
                <AuditRow key={row.id} row={row} />
              ))}
            </DataTable>
            {state.rows.length === 0 && <EmptyState headingLevel={2} title="No activity yet" />}
            {state.pagination && <Pagination {...state.pagination} />}
          </>
        )}
      </div>
    </DeskFrame>
  );
}
