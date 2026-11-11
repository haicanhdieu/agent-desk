import { Button } from '@/ds';
import { DataTable, EmptyState, NeedsYouBanner, RunRow, TicketGroupRow } from '@/components';
import type { RunStatus } from '@/ds/tokens';
import type { RunSummary, TicketGroup } from '@/mocks/types';
import styles from './Screens.module.css';
import { RunsPage, type RunsFilter, type RunsPageProps } from './RunsPage';

export type { RunsFilter } from './RunsPage';

export interface RunsProps extends Omit<RunsPageProps, 'children' | 'banners'> {
  groups: TicketGroup[];
  needsYouRun?: { run: RunSummary; askedAgo: string; slotNote: string; href: string };
}

const statuses: Record<Exclude<RunsFilter, 'all' | 'ignored'>, RunStatus[]> = {
  needs_you: ['idle'],
  active: ['starting', 'running'],
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
  { key: 'actions', header: <span className={styles.srOnly}>Actions</span> },
];

const runHref = (r: RunSummary) => `/runs/${r.id}`;

function rowActions(run: RunSummary) {
  if (run.status === 'idle') {
    return (
      <>
        <Button variant="go" size="sm" href={runHref(run)}>Open terminal</Button>{' '}
        <Button size="sm">Finish</Button>
      </>
    );
  }
  if (run.status === 'running') return <Button size="sm" href={runHref(run)}>Watch</Button>;
  return null;
}

export function Runs({ groups, needsYouRun, filter, ...page }: RunsProps) {
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
          action={<Button variant="ghost" onClick={() => page.onFilter?.('all')}>Show all runs</Button>}
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
                actions={rowActions(r)}
              />
            )),
          ])}
        </DataTable>
      )}
    </RunsPage>
  );
}
