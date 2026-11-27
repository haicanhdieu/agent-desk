import { useState } from 'react';
import { Button, Skeleton, TextInput, Select } from '@/ds';
import {
  DataTable,
  EmptyState,
  Pagination,
  PageHeader,
  PlatformOrgRow,
  RouteLoadError,
  platformOrgColumns,
  useShellOwnsChrome,
  type PaginationProps,
} from '@/components';
import type { OrgStatusView, PlatformOrgRowView } from '@/mocks';
import styles from './Screens.module.css';

export type PlatformOrgsView =
  | { kind: 'loading' }
  | { kind: 'error'; title: string; requestId?: string; onRetry: () => void }
  | { kind: 'ready'; rows: PlatformOrgRowView[]; pagination: PaginationProps; busy?: boolean };

export interface PlatformOrgsProps {
  view: PlatformOrgsView;
  /** `active` is true when a search or a status is applied: it picks "No organizations match" over "yet". */
  filters: { q: string; status: 'all' | OrgStatusView; active: boolean };
  onSearch: (q: string) => void;
  onStatus: (s: 'all' | OrgStatusView) => void;
  onClearFilters: () => void;
  createHref: string;
}

const isStatus = (v: string): v is 'all' | OrgStatusView => v === 'all' || v === 'active' || v === 'suspended';

/** The platform Organizations directory. Names, slugs and owners are text, never HTML. */
export function PlatformOrgs({ view, filters, onSearch, onStatus, onClearFilters, createHref }: PlatformOrgsProps) {
  const owned = useShellOwnsChrome();
  // The box keeps what was typed while the route debounces; it follows `filters.q` when that changes elsewhere.
  const [text, setText] = useState(filters.q);
  const [seenQ, setSeenQ] = useState(filters.q);
  if (seenQ !== filters.q) {
    setSeenQ(filters.q);
    setText(filters.q);
  }

  const empty = view.kind === 'ready' && view.rows.length === 0;
  const showFilters = view.kind !== 'error' && !(empty && !filters.active);

  return (
    <main className={owned ? styles.shellMain : styles.platformMain}>
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
          {owned ? (
            <PageHeader
              title="Organizations"
              actions={
                <Button variant="primary" icon="plus" href={createHref}>
                  Create organization
                </Button>
              }
            />
          ) : (
            <div className={styles.listHead}>
              <h1 tabIndex={-1}>Organizations</h1>
              <Button variant="primary" icon="plus" href={createHref}>
                Create organization
              </Button>
            </div>
          )}
          {showFilters && (
            <div className={styles.platformFilters}>
              <TextInput
                type="search"
                aria-label="Search organizations"
                placeholder="Search organizations"
                maxLength={100}
                className={styles.platformSearch}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  onSearch(e.target.value);
                }}
              />
              <Select
                aria-label="Status"
                className={styles.platformStatus}
                value={filters.status}
                onChange={(e) => {
                  const v = e.target.value;
                  if (isStatus(v)) onStatus(v);
                }}
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </Select>
            </div>
          )}
          {empty ? (
            filters.active ? (
              <EmptyState
                headingLevel={2}
                title="No organizations match"
                action={<Button onClick={onClearFilters}>Clear filters</Button>}
              />
            ) : (
              <EmptyState headingLevel={2} title="No organizations yet" body="Create one to invite its first owner." />
            )
          ) : (
            <>
              <div className={styles.platformTableScroll} role="region" aria-label="Organizations table" tabIndex={0}>
                <DataTable columns={platformOrgColumns} busy={view.busy ?? view.pagination.busy}>
                  {view.rows.map((row) => (
                    <PlatformOrgRow key={row.id} row={row} />
                  ))}
                </DataTable>
              </div>
              <Pagination {...view.pagination} />
            </>
          )}
        </>
      )}
    </main>
  );
}
