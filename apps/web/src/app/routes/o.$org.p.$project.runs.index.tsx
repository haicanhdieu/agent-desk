import { RunListFilter } from '@agentdesk/contracts';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { useNow } from '@/app/useNow';
import { projectsQueries } from '@/features/projects/queries';
import {
  groupByTicket,
  idleSlotNote,
  repoUrlOf,
  runCounts,
  toConnectionWarning,
  toIgnored,
  todaySummary,
  toRunSummary,
} from '@/features/runs/map';
import { runHref, useProjectPage } from '@/features/runs/page';
import { runsQueries } from '@/features/runs/queries';
import { relativeTime } from '@/features/relativeTime';
import { Runs, RunsProblems, type RunsFilter, type RunsProblemsWarning } from '@/screens';

/** `filter`: a run list filter or `ignored`; anything else falls back to all. `ticket`: a ticket number. */
const RunsSearch = z.object({
  filter: z
    .enum([...RunListFilter.options, 'ignored'])
    .optional()
    .catch(undefined),
  ticket: z.string().regex(/^\d+$/).optional().catch(undefined),
});
type RunsSearch = z.infer<typeof RunsSearch>;

const listFilterOf = (filter: RunsFilter): RunListFilter => (filter === 'ignored' ? 'all' : filter);

export const Route = createFileRoute('/o/$org/p/$project/runs/')({
  validateSearch: (search): RunsSearch => RunsSearch.parse(search),
  loaderDeps: ({ search }) => ({ filter: search.filter ?? 'all' }),
  loader: async ({ context: { queryClient }, params: { org, project }, deps: { filter } }) => {
    await Promise.all([
      // The unfiltered list feeds the chip counts, the "today" line and the needs-you banner.
      queryClient.ensureQueryData(runsQueries.list(org, project, 'all')),
      queryClient.ensureQueryData(runsQueries.list(org, project, listFilterOf(filter))),
      queryClient.ensureQueryData(runsQueries.ignored(org, project)),
    ]);
  },
  component: RunsRoute,
});

function RunsRoute() {
  const { org, project: projectId } = Route.useParams();
  const search = Route.useSearch();
  const filter: RunsFilter = search.filter ?? 'all';
  const now = useNow();
  const queryClient = useQueryClient();
  const page = useProjectPage(org, projectId, now);
  const { data: all } = useSuspenseQuery(runsQueries.list(org, projectId, 'all'));
  const { data: listed } = useSuspenseQuery(runsQueries.list(org, projectId, listFilterOf(filter)));
  const { data: ignoredDtos } = useSuspenseQuery(runsQueries.ignored(org, projectId));

  const { paths, dto } = page;
  const counts: Record<RunsFilter, number> = { ...runCounts(all.items), ignored: ignoredDtos.length };
  const ticketQuery = search.ticket === undefined ? '' : `ticket=${search.ticket}`;
  const filterHref = (f: RunsFilter) => {
    const query = [f === 'all' ? '' : `filter=${f}`, ticketQuery].filter(Boolean).join('&');
    return query ? `${paths.runs}?${query}` : paths.runs;
  };
  const active = all.items.filter((r) => r.status === 'starting' || r.status === 'running' || r.status === 'idle');
  const common = {
    project: page.project,
    user: page.user,
    links: page.links,
    needsYou: dto.counts.needsYou,
    slots: { used: active.length, total: dto.maxConcurrentRuns },
    today: todaySummary(all.items, now),
    counts,
    filterHref,
  };

  if (filter === 'ignored') {
    const repoUrl = repoUrlOf(dto.repoPath);
    const recheck = () => void queryClient.invalidateQueries(projectsQueries.connection(org, projectId));
    const warning = toConnectionWarning(page.connection, page.connectionDto, paths.agent, now);
    const warnings: RunsProblemsWarning[] = warning
      ? [{ ...warning, actions: warning.actions.map((a) => (a.href ? a : { ...a, onClick: recheck })) }]
      : [];
    return (
      <RunsProblems
        {...common}
        filter="ignored"
        warnings={warnings}
        ignored={ignoredDtos.map((i) => toIgnored(i, repoUrl))}
      />
    );
  }

  const summaries = listed.items
    .map((r) => toRunSummary(r, now))
    .filter((r) => search.ticket === undefined || String(r.ticket.number) === search.ticket);
  // The newest idle run gets the pinned banner; the oldest queued run is the one it keeps waiting.
  const idle = all.items.find((r) => r.status === 'idle');
  const waiting = all.items.filter((r) => r.status === 'queued').at(-1);
  const needsYouRun = idle && {
    run: toRunSummary(idle, now),
    askedAgo: relativeTime(idle.idleSince ?? idle.startedAt ?? idle.queuedAt, now),
    slotNote: idleSlotNote(dto.maxConcurrentRuns, waiting?.number),
    href: runHref(paths, idle.number),
  };

  return (
    <Runs
      {...common}
      filter={filter}
      groups={groupByTicket(summaries, dto.maxRunsPerTicket)}
      needsYouRun={needsYouRun}
      runHref={(r) => runHref(paths, r.id)}
      showAllHref={paths.runs}
    />
  );
}
