import { RunListFilter, can } from '@agentdesk/contracts';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { z } from 'zod';
import {
  PageSearch,
  loadPage,
  pageOfSearch,
  pageToSearch,
  readPageSize,
  useClampToLastPage,
  usePageSize,
  usePagedQuery,
  usePaginationProps,
} from '@/app/pagination';
import { toastFromError } from '@/app/boundaries';
import { useNow } from '@/app/useNow';
import { useToast } from '@/ds';
import { useAccess } from '@/features/access/guards';
import { useFinishRun } from '@/features/runs/mutations';
import { projectsQueries } from '@/features/projects/queries';
import {
  groupByTicket,
  linkedTicketsByRun,
  idleSlotNote,
  prRefsOf,
  repoUrlOf,
  startOfLocalDay,
  ticketRunCounts,
  toConnectionWarning,
  toIgnored,
  todaySummary,
  toRunSummary,
  withPrState,
  withPrStates,
} from '@/features/runs/map';
import { runHref, useProjectPage } from '@/features/runs/page';
import { runsQueries, usePrStates } from '@/features/runs/queries';
import { useGroupedPref } from '@/features/runs/useGroupedPref';
import { RunsView, readSavedView, writeSavedView } from '@/features/runs/savedView';
import { useSearchBox } from '@/features/runs/useSearchBox';
import { relativeTime } from '@/features/relativeTime';
import { Runs, RunsProblems, type RunsFilter, type RunsProblemsWarning } from '@/screens';

/** The chosen view (`filter`, `q`; see `RunsView`) and the page. */
const RunsSearch = z.object({ ...PageSearch.shape, ...RunsView.shape });
type RunsSearch = z.infer<typeof RunsSearch>;

export const Route = createFileRoute('/o/$org/p/$project/runs/')({
  validateSearch: (search): RunsSearch => RunsSearch.parse(search),
  beforeLoad: ({ params: { org, project }, search, cause }) => {
    // Coming to the page (a link, a reload) with no choice in the URL brings back the last filter and search seen here.
    // Moving inside the page (the All chip, the clear button) never does: that is the person choosing no filter.
    if (cause !== 'enter' || search.filter !== undefined || search.q !== undefined || search.page !== undefined) return;
    const saved = readSavedView(org, project);
    if (saved.filter === undefined && saved.q === undefined) return;
    throw redirect({ to: '/o/$org/p/$project/runs/', params: { org, project }, search: saved, replace: true });
  },
  loaderDeps: ({ search }) => ({
    filter: search.filter ?? 'all',
    q: search.q,
    page: pageOfSearch(search),
  }),
  loader: async ({ context: { queryClient }, params: { org, project }, deps: { filter, q, page }, cause }) => {
    // The numbers come from runs.stats; the list and the ignored events load only for the view that shows them.
    await Promise.all([
      queryClient.ensureQueryData(projectsQueries.detail(org, project)),
      queryClient.ensureQueryData(runsQueries.stats(org, project, startOfLocalDay(new Date()))),
      filter === 'ignored'
        ? loadPage(queryClient, runsQueries.ignored(org, project, { page, pageSize: readPageSize() }), cause)
        : loadPage(queryClient, runsQueries.list(org, project, { filter, q, page, pageSize: readPageSize() }), cause),
    ]);
  },
  component: RunsRoute,
});

/** What both views share: the project page, and the numbers (chips, Today, slots) from the server. */
function useRunsCommon(org: string, projectId: string, q: string | undefined, now: Date) {
  const page = useProjectPage(org, projectId, now);
  const { paths, dto } = page;
  const { data: stats } = useSuspenseQuery(runsQueries.stats(org, projectId, startOfLocalDay(now)));
  const searchQuery = q === undefined ? '' : new URLSearchParams({ q }).toString();
  const filterHref = (f: RunsFilter) => {
    const query = [f === 'all' ? '' : `filter=${f}`, searchQuery].filter(Boolean).join('&');
    return query ? `${paths.runs}?${query}` : paths.runs;
  };
  const common = {
    project: page.project,
    user: page.user,
    links: page.links,
    projectMenu: page.projectMenu,
    org: page.org,
    needsYou: dto.counts.needsYou,
    // Idle runs hold a slot too.
    // counts.running is every live job (starting, running, idle): each holds a slot.
    slots: { used: dto.counts.running, total: dto.maxConcurrentRuns },
    today: todaySummary(stats.today),
    counts: stats.counts,
    filterHref,
  };
  return { page, stats, common };
}

function RunsRoute() {
  const { org, project } = Route.useParams();
  const search = Route.useSearch();
  const now = useNow();
  // Every filter and search shown is remembered, so the next visit starts from it.
  useEffect(
    () => writeSavedView(org, project, { filter: search.filter, q: search.q }),
    [org, project, search.filter, search.q],
  );
  return search.filter === 'ignored' ? (
    <IgnoredView org={org} projectId={project} q={search.q} now={now} />
  ) : (
    <ListView org={org} projectId={project} filter={search.filter ?? 'all'} q={search.q} now={now} />
  );
}

function IgnoredView({ org, projectId, q, now }: { org: string; projectId: string; q: string | undefined; now: Date }) {
  const queryClient = useQueryClient();
  const { page, common } = useRunsCommon(org, projectId, q, now);
  const navigate = useNavigate({ from: Route.fullPath });
  const current = pageOfSearch(Route.useSearch());
  const [pageSize] = usePageSize();
  const { data: ignoredPage, busy } = usePagedQuery({ page: current, pageSize }, (q) =>
    runsQueries.ignored(org, projectId, q),
  );
  const go = (p: number, replace = false) =>
    void navigate({ search: (prev) => ({ ...prev, page: pageToSearch(p) }), replace });
  useClampToLastPage(current, ignoredPage.pageSize, ignoredPage.total, (p) => go(p, true));
  const pagination = usePaginationProps({
    page: ignoredPage.page,
    pageSize: ignoredPage.pageSize,
    total: ignoredPage.total,
    busy,
    go,
  });
  const repoUrl = repoUrlOf(page.dto.repoPath);
  const ignored = ignoredPage.items.map((i) => toIgnored(i, repoUrl));
  // Real rows have kind issue and send nothing; a row that is already a PR gets its state.
  const prStates = usePrStates(org, projectId, prRefsOf(ignored.map((i) => i.ticket)));
  const recheck = () => void queryClient.invalidateQueries(projectsQueries.connection(org, projectId));
  const warning = toConnectionWarning(
    page.connection,
    page.connectionDto,
    page.desk.agent ? page.paths.agent : undefined,
    now,
  );
  const warnings: RunsProblemsWarning[] = warning
    ? [{ ...warning, actions: warning.actions.map((a) => (a.href ? a : { ...a, onClick: recheck })) }]
    : [];
  return (
    <RunsProblems
      {...common}
      filter="ignored"
      warnings={warnings}
      ignored={ignored.map((i) => ({ ...i, ticket: withPrState(i.ticket, prStates) }))}
      pagination={pagination}
    />
  );
}

function ListView({
  org,
  projectId,
  filter,
  q,
  now,
}: {
  org: string;
  projectId: string;
  filter: RunListFilter;
  q: string | undefined;
  now: Date;
}) {
  const [grouped, setGroupedPref] = useGroupedPref();
  const toast = useToast();
  const { page, stats, common } = useRunsCommon(org, projectId, q, now);
  const { paths, dto } = page;
  const navigate = useNavigate({ from: Route.fullPath });
  const current = pageOfSearch(Route.useSearch());
  const [pageSize] = usePageSize();
  const { data: listed, busy } = usePagedQuery({ filter, q, page: current, pageSize }, (q) =>
    runsQueries.list(org, projectId, q),
  );
  const go = (p: number, replace = false) =>
    void navigate({ search: (prev) => ({ ...prev, page: pageToSearch(p) }), replace });
  useClampToLastPage(current, listed.pageSize, listed.total, (p) => go(p, true));
  const pagination = usePaginationProps({
    page: listed.page,
    pageSize: listed.pageSize,
    total: listed.total,
    busy,
    go,
  });
  // A new query shows page 1 of its results; the URL is replaced, so back does not step through every pause in typing.
  const searchBox = useSearchBox(
    q,
    (next) => void navigate({ search: (prev) => ({ ...prev, q: next, page: undefined }), replace: true }),
  );
  // Grouping changes what a page holds, so the toggle returns to page 1.
  const setGrouped = (next: boolean) => {
    setGroupedPref(next);
    go(1, true);
  };

  const summaries = listed.items.map((r) => toRunSummary(r, now));
  // The newest idle run gets the pinned banner; the oldest queued run is the one it keeps waiting. Both come from stats.
  const idle = stats.idleRun ?? undefined;
  const needsYouRun = idle && {
    run: toRunSummary(idle, now),
    askedAgo: relativeTime(idle.idleSince ?? idle.startedAt ?? idle.queuedAt, now),
    slotNote: idleSlotNote(dto.maxConcurrentRuns, stats.nextQueuedNumber ?? undefined, idle.idleEndSeconds),
    href: runHref(paths, idle.number),
  };

  const prStates = usePrStates(
    org,
    projectId,
    prRefsOf([...summaries.map((s) => s.ticket), ...(needsYouRun ? [needsYouRun.run.ticket] : [])]),
  );
  // Finish from the banner: only where the viewer holds run:update on the idle run (a member on their own run).
  const finish = useFinishRun(org, projectId, { onError: (e) => toast.show(toastFromError(e)) });
  const access = useAccess(org);
  const mayFinishIdle =
    idle !== undefined &&
    access !== undefined &&
    can(access, 'run:update', { projectId, ownerUserId: idle.ownerUserId });

  return (
    <Runs
      {...common}
      filter={filter}
      grouped={grouped}
      onGroupedChange={setGrouped}
      search={{ ...searchBox, applied: q ?? '' }}
      groups={withPrStates(
        groupByTicket(summaries, dto.maxRunsPerTicket, ticketRunCounts(listed.items), linkedTicketsByRun(listed.items)),
        prStates,
      )}
      needsYouRun={
        needsYouRun && {
          ...needsYouRun,
          run: { ...needsYouRun.run, ticket: withPrState(needsYouRun.run.ticket, prStates) },
        }
      }
      waitingRun={stats.nextQueuedNumber ?? undefined}
      {...(mayFinishIdle && idle && { onFinishIdle: () => finish({ id: idle.id, number: idle.number }) })}
      runHref={(r) => runHref(paths, r.id)}
      showAllHref={paths.runs}
      pagination={pagination}
    />
  );
}
