import { useSuspenseQueries, useSuspenseQuery } from '@tanstack/react-query';
import { can } from '@agentdesk/contracts';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { toastFromError } from '@/app/boundaries';
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
import { useNow } from '@/app/useNow';
import { useToast } from '@/ds';
import { useAccess } from '@/features/access/guards';
import { projectPaths } from '@/features/desk/frame';
import { toConnectionStatus, toProject } from '@/features/projects/map';
import { projectsQueries } from '@/features/projects/queries';
import { clockTime, idleEndsAt, toRunSummary } from '@/features/runs/map';
import { useResumeRun } from '@/features/runs/mutations';
import { runHref, useProjectPage } from '@/features/runs/page';
import { runsQueries } from '@/features/runs/queries';
import { NeedsYou, type NeedsYouRun } from '@/screens';

export const Route = createFileRoute('/o/$org/p/$project/needs-you')({
  validateSearch: PageSearch,
  loaderDeps: ({ search }) => ({ page: pageOfSearch(search) }),
  loader: async ({ context: { queryClient }, params: { org, project }, deps: { page }, cause }) => {
    await Promise.all([
      loadPage(
        queryClient,
        runsQueries.list(org, project, { filter: 'needs_you', page, pageSize: readPageSize() }),
        cause,
      ),
      queryClient.ensureQueryData(projectsQueries.all(org)),
    ]);
  },
  component: NeedsYouRoute,
});

function NeedsYouRoute() {
  const { org, project: projectId } = Route.useParams();
  const now = useNow();
  const toast = useToast();
  const resume = useResumeRun(org, projectId, { onError: (e) => toast.show(toastFromError(e)) });
  const access = useAccess(org);
  const page = useProjectPage(org, projectId, now);
  const navigate = useNavigate({ from: Route.fullPath });
  const current = pageOfSearch(Route.useSearch());
  const [pageSize] = usePageSize();
  const { data: idle, busy } = usePagedQuery({ filter: 'needs_you' as const, page: current, pageSize }, (q) =>
    runsQueries.list(org, projectId, q),
  );
  const go = (p: number, replace = false) =>
    void navigate({ search: (prev) => ({ ...prev, page: pageToSearch(p) }), replace });
  useClampToLastPage(current, idle.pageSize, idle.total, (p) => go(p, true));
  const pagination = usePaginationProps({ page: idle.page, pageSize: idle.pageSize, total: idle.total, busy, go });
  const { data: all } = useSuspenseQuery(projectsQueries.all(org));
  const dtos = all.items;
  // The switcher shows each project's connection warning: one request per project, in parallel.
  const connections = useSuspenseQueries({ queries: dtos.map((d) => projectsQueries.connection(org, d.id)) });
  const projects = dtos.map((dto, i) => {
    const connection = connections[i];
    if (!connection) throw new Error(`Missing connection query for project ${dto.id}`);
    return toProject(dto, toConnectionStatus(connection.data, dto, now), org, now);
  });

  const runs: NeedsYouRun[] = idle.items.map((r) => {
    // A paused run lists from the moment it paused; pausedAt is history once it has been resumed.
    const since = (r.status === 'paused' ? r.pausedAt : null) ?? r.idleSince ?? r.startedAt ?? r.queuedAt;
    return {
      run: toRunSummary(r, now),
      href: runHref(page.paths, r.number),
      idleAt: clockTime(since),
      endsAt: idleEndsAt(since, r.idleEndSeconds),
    };
  });

  return (
    <NeedsYou
      project={page.project}
      projects={projects}
      runs={runs}
      canResume={(r) => {
        const dto = idle.items.find((x) => x.number === r.id);
        return (
          access !== undefined &&
          dto !== undefined &&
          can(access, 'run:update', { projectId, ownerUserId: dto.ownerUserId })
        );
      }}
      onResume={(r) => {
        const dto = idle.items.find((x) => x.number === r.id);
        if (dto) resume.mutate({ id: dto.id, number: dto.number });
      }}
      resuming={resume.isPending ? resume.variables.number : undefined}
      projectHref={(p) => projectPaths(org, p.id).needsYou}
      pagination={pagination}
      topBar={{ user: page.user, org: page.org, account: page.account }}
    />
  );
}
