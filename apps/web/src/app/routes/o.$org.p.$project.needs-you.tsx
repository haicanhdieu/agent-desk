import { useSuspenseQueries, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { toastFromError } from '@/app/boundaries';
import { useNow } from '@/app/useNow';
import { useToast } from '@/ds';
import { projectPaths } from '@/features/desk/frame';
import { toConnectionStatus, toProject } from '@/features/projects/map';
import { projectsQueries } from '@/features/projects/queries';
import { clockTime, idleEndsAt, toRunSummary } from '@/features/runs/map';
import { useResumeRun } from '@/features/runs/mutations';
import { runHref, useProjectPage } from '@/features/runs/page';
import { runsQueries } from '@/features/runs/queries';
import { NeedsYou, type NeedsYouRun } from '@/screens';

export const Route = createFileRoute('/o/$org/p/$project/needs-you')({
  loader: async ({ context: { queryClient }, params: { org, project } }) => {
    await Promise.all([
      queryClient.ensureQueryData(runsQueries.list(org, project, 'needs_you')),
      queryClient.ensureQueryData(projectsQueries.list(org)),
    ]);
  },
  component: NeedsYouRoute,
});

function NeedsYouRoute() {
  const { org, project: projectId } = Route.useParams();
  const now = useNow();
  const toast = useToast();
  const resume = useResumeRun(org, projectId, { onError: (e) => toast.show(toastFromError(e)) });
  const page = useProjectPage(org, projectId, now);
  const { data: idle } = useSuspenseQuery(runsQueries.list(org, projectId, 'needs_you'));
  const { data: dtos } = useSuspenseQuery(projectsQueries.list(org));
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
      endsAt: idleEndsAt(since),
    };
  });

  return (
    <NeedsYou
      project={page.project}
      projects={projects}
      runs={runs}
      onResume={(r) => {
        const dto = idle.items.find((x) => x.number === r.id);
        if (dto) resume.mutate({ id: dto.id, number: dto.number });
      }}
      resuming={resume.isPending ? resume.variables.number : undefined}
      projectHref={(p) => projectPaths(org, p.id).needsYou}
      topBar={{ user: page.user, links: page.links, projectMenu: page.projectMenu }}
    />
  );
}
