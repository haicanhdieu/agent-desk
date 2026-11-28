import { Button, IconButton, Select, Skeleton } from '@/ds';
import {
  AuditRow,
  auditColumns,
  DataTable,
  EmptyState,
  PageHeader,
  Pagination,
  RouteLoadError,
  type PaginationProps,
} from '@/components';
import type { AuditRowView } from '@/mocks/types';
import styles from './Screens.module.css';

export interface PlatformAuditProps {
  view:
    | { kind: 'loading' }
    | { kind: 'error'; title: string; requestId?: string; onRetry: () => void }
    | { kind: 'ready'; rows: AuditRowView[]; pagination: PaginationProps; busy?: boolean };
  /** The chosen action key, or `all`. */
  action: string;
  actions: { value: string; label: string }[];
  onAction: (value: string) => void;
  /** Present when the list is limited to one organization. */
  orgChip?: { label: string; onRemove: () => void };
  /** True when an action or an organization limits the list: it picks "No audit entries match" over "No audit entries". */
  filtered: boolean;
  onClearFilters: () => void;
}

/** The platform Audit log: when, who and what for each entry, an action filter, an optional org chip and paging. All text, never HTML. */
export function PlatformAudit({
  view,
  action,
  actions,
  onAction,
  orgChip,
  filtered,
  onClearFilters,
}: PlatformAuditProps) {
  return (
    <main className={styles.shellMain}>
      {view.kind === 'loading' && (
        <div className={styles.platformLoading} aria-busy="true" role="status" aria-label="Loading">
          <span aria-hidden="true">
            <Skeleton variant="block" height={28} width={160} />
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
          <PageHeader title="Audit log" />
          <div className={styles.platformFilters}>
            <Select
              aria-label="Action"
              className={styles.platformAction}
              value={action}
              onChange={(e) => onAction(e.target.value)}
            >
              <option value="all">All actions</option>
              {actions.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </Select>
            {orgChip && (
              <span className={styles.platformChip}>
                <span className={styles.platformChipLabel} title={orgChip.label}>
                  {orgChip.label}
                </span>
                <IconButton
                  icon="x"
                  size="sm"
                  aria-label={`Remove filter ${orgChip.label}`}
                  onClick={orgChip.onRemove}
                />
              </span>
            )}
          </div>
          <DataTable columns={auditColumns} busy={view.busy ?? view.pagination.busy}>
            {view.rows.map((row) => (
              <AuditRow key={row.id} row={row} />
            ))}
          </DataTable>
          {view.rows.length === 0 &&
            (filtered ? (
              <EmptyState
                headingLevel={2}
                title="No audit entries match"
                action={<Button onClick={onClearFilters}>Clear filters</Button>}
              />
            ) : (
              <EmptyState headingLevel={2} title="No audit entries" />
            ))}
          {view.rows.length > 0 && <Pagination {...view.pagination} />}
        </>
      )}
    </main>
  );
}
