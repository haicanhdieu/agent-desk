import { useSuspenseQueries, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useNow } from '@/app/useNow';
import { sessionQuery } from '@/features/auth/session';
import { toConnectionStatus, toProject } from '@/features/projects/map';
import { projectsQueries } from '@/features/projects/queries';
import { Projects } from '@/screens';
import type { Actor } from '@/mocks/types';

export const Route = createFileRoute('/o/$org/projects/')({
  loader: ({ context: { queryClient }, params }) => queryClient.ensureQueryData(projectsQueries.list(params.org)),
  component: ProjectsPage,
});

function ProjectsPage() {
  const { org } = Route.useParams();
  const now = useNow();
  const { data: session } = useSuspenseQuery(sessionQuery);
  const { data: dtos } = useSuspenseQuery(projectsQueries.list(org));
  // One request per project, in parallel; the list suspends until all have answered.
  const connections = useSuspenseQueries({
    queries: dtos.map((d) => projectsQueries.connection(org, d.id)),
  });
  const projects = dtos.map((dto, i) => {
    const connection = connections[i];
    if (!connection) throw new Error(`Missing connection query for project ${dto.id}`);
    return toProject(dto, toConnectionStatus(connection.data, dto, now), org, now);
  });
  const handle = session?.user.handle ?? '';
  const user: Actor = {
    login: handle,
    initials: handle.slice(0, 2).toUpperCase(),
  };
  const orgPath = `/o/${encodeURIComponent(org)}`;
  return (
    <Projects
      user={user}
      projects={projects}
      newHref={`${orgPath}/projects/new/repo`}
      projectHref={(p) => `${orgPath}/p/${encodeURIComponent(p.id)}/runs`}
    />
  );
}
