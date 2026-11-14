import { Button } from '@/ds';
import { DataTable, EmptyState, NeedsYouBanner, RunRow, TicketGroupRow } from '@/components';
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
}

const statuses: Record<Exclude<RunsFilter, 'all' | 'ignored'>, RunStatus[]> = {
  needs_you: ['idle'],
  // Same meaning as the API's `active` filter: idle runs are still active (they hold a slot).
  active: ['starting', 'running', 'idle'],
  queued: ['queued'],
  ended: ['succeeded', 'failed', 'cancelled', 'timed_out'],
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
  { key: 'skill', header: 'Skill' },
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

export function Runs({ groups, needsYouRun, filter, runHref = defaultRunHref, showAllHref, ...page }: RunsProps) {
  const shown = filterGroups(groups, filter);
  return (
    <RunsPage {...page} filter={filter}>
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
        <DataTable columns={columns}>
          {shown.flatMap((g) => [
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
          ])}
        </DataTable>
      )}
    </RunsPage>
  );
}
