import { useState } from 'react';
import { Button } from '@/ds';
import {
  DataTable,
  EmptyState,
  NeedsYouBanner,
  Pagination,
  RunRow,
  TicketGroupRow,
  type PaginationProps,
} from '@/components';
import type { RunStatus } from '@/ds/tokens';
import type { RunSummary, TicketGroup } from '@/mocks/types';
import { RunsPage, type RunsFilter, type RunsPageProps } from './RunsPage';

export type { RunsFilter } from './RunsPage';

export interface RunsProps extends Omit<RunsPageProps, 'children' | 'banners'> {
  groups: TicketGroup[];
  needsYouRun?: { run: RunSummary; askedAgo: string; slotNote: string; href: string };
  /** In-app href of a run; defaults to the prototype's `/runs/<id>`. */
  runHref?(run: RunSummary): string;
  /** Href for the empty state's "Show all runs" (a link instead of the `onFilter('all')` button). */
  showAllHref?: string;
  /** The page control, drawn directly under the table; the table is aria-busy while it loads. */
  pagination?: PaginationProps;
}

const statuses: Record<Exclude<RunsFilter, 'all' | 'ignored'>, RunStatus[]> = {
  // As the API's needs_you list: a paused run waits for a person too.
  needs_you: ['idle', 'paused'],
  // Same meaning as the API's `active` filter: idle runs are still active (they hold a slot).
  active: ['starting', 'running', 'idle'],
  queued: ['queued'],
  ended: ['succeeded', 'failed', 'cancelled', 'timed_out', 'expired'],
};

/** Keeps matching runs and drops groups left empty. `ignored` is a separate list, so no run matches it. */
export function filterGroups(groups: TicketGroup[], filter: RunsFilter): TicketGroup[] {
  if (filter === 'all') return groups;
  if (filter === 'ignored') return [];
  const allowed = statuses[filter];
  return groups
    .map((g) => ({ ...g, runs: g.runs.filter((r) => allowed.includes(r.status)) }))
    .filter((g) => g.runs.length > 0);
}

const columns = [
  { key: 'run', header: 'Run', width: 110 },
  { key: 'status', header: 'Status' },
  { key: 'ticket', header: 'Ticket' },
  { key: 'rule', header: 'Routing rule' },
  { key: 'by', header: 'Triggered by' },
  { key: 'started', header: 'Started' },
  { key: 'duration', header: 'Duration' },
  { key: 'actions', header: <span className="sr-only">Actions</span> },
];

const defaultRunHref = (r: RunSummary) => `/runs/${r.id}`;

function rowActions(run: RunSummary, runHref: (r: RunSummary) => string) {
  if (run.status === 'idle') {
    return (
      <>
        <Button variant="go" size="sm" href={runHref(run)}>
          Open terminal
        </Button>{' '}
        <Button size="sm">Finish</Button>
      </>
    );
  }
  if (run.status === 'running')
    return (
      <Button size="sm" href={runHref(run)}>
        Watch
      </Button>
    );
  return null;
}

export function Runs({
  groups,
  needsYouRun,
  filter,
  runHref = defaultRunHref,
  showAllHref,
  grouped: groupedProp,
  onGroupedChange,
  pagination,
  ...page
}: RunsProps) {
  // Controlled when the container passes `grouped` (it persists the choice); otherwise the screen keeps it itself.
  const [groupedState, setGroupedState] = useState(true);
  const grouped = groupedProp ?? groupedState;
  const setGrouped = (next: boolean) => {
    setGroupedState(next);
    onGroupedChange?.(next);
  };
  const shown = filterGroups(groups, filter);
  // Ungrouped: the same runs as one flat list, newest first. Only the layout changes, never the run data.
  const flat = shown.flatMap((g) => g.runs).sort((a, b) => b.id - a.id);
  return (
    <RunsPage {...page} filter={filter} grouped={grouped} onGroupedChange={setGrouped}>
      {needsYouRun && (
        <NeedsYouBanner
          run={needsYouRun.run}
          askedAgo={needsYouRun.askedAgo}
          slotNote={needsYouRun.slotNote}
          href={needsYouRun.href}
        />
      )}
      {shown.length === 0 ? (
        <EmptyState
          title="No runs match this filter"
          headingLevel={2}
          body="Runs appear here when a ticket comment starts one."
          action={
            showAllHref !== undefined ? (
              <Button variant="ghost" href={showAllHref}>
                Show all runs
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => page.onFilter?.('all')}>
                Show all runs
              </Button>
            )
          }
        />
      ) : (
        <>
          <DataTable columns={columns} busy={pagination?.busy}>
            {grouped
              ? shown.flatMap((g) => [
                  <TicketGroupRow key={`g${g.ticket.number}`} group={g} colSpan={columns.length} />,
                  ...g.runs.map((r, i) => (
                    <RunRow
                      key={r.id}
                      run={r}
                      tree={i === g.runs.length - 1 ? 'last' : 'mid'}
                      href={runHref(r)}
                      actions={rowActions(r, runHref)}
                    />
                  )),
                ])
              : flat.map((r) => (
                  <RunRow key={r.id} run={r} tree="none" href={runHref(r)} actions={rowActions(r, runHref)} />
                ))}
          </DataTable>
          {pagination && <Pagination {...pagination} />}
        </>
      )}
    </RunsPage>
  );
}
