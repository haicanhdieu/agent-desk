import { Skeleton } from '@/ds';
import {
  DataTable,
  EmptyState,
  Pagination,
  PlatformProjectRow,
  RouteLoadError,
  platformProjectColumns,
  type PaginationProps,
} from '@/components';
import type { PlatformProjectRowView } from '@/mocks';
import styles from './Screens.module.css';

/** The states of a platform org tab list. */
export type ListView<R> =
  | { kind: 'loading' }
  | { kind: 'error'; title: string; requestId?: string; onRetry: () => void }
  | { kind: 'ready'; rows: R[]; pagination: PaginationProps; busy?: boolean };

/** The loading placeholder of a platform org tab. */
export function TabLoading() {
  return (
    <div className={styles.platformLoading} aria-busy="true" role="status" aria-label="Loading">
      <span className={styles.membersLoadingRows} aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} variant="block" height={30} width="100%" />
        ))}
      </span>
    </div>
  );
}

/** The Projects tab of a platform org detail: id and name only, no link and no action. Text, never HTML. */
export function PlatformOrgProjects({ view }: { view: ListView<PlatformProjectRowView> }) {
  if (view.kind === 'loading') return <TabLoading />;
  if (view.kind === 'error') {
    return <RouteLoadError title={view.title} requestId={view.requestId} onRetry={view.onRetry} />;
  }
  return (
    <>
      <h2>Projects</h2>
      {view.rows.length === 0 ? (
        <EmptyState title="No projects" />
      ) : (
        <>
          <DataTable columns={platformProjectColumns} busy={view.busy ?? view.pagination.busy}>
            {view.rows.map((row) => (
              <PlatformProjectRow key={row.id} row={row} />
            ))}
          </DataTable>
          <Pagination {...view.pagination} />
        </>
      )}
    </>
  );
}
