import { useSuspenseQueries, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  PageSearch,
  loadPage,
  pageOfSearch,
  pageToSearch,
  usePageSize,
  usePagedQuery,
  usePaginationProps,
  useClampToLastPage,
  readPageSize,
} from '@/app/pagination';
import { useNow } from '@/app/useNow';
import { sessionQuery } from '@/features/auth/session';
import { toConnectionStatus, toProject } from '@/features/projects/map';
import { projectsQueries } from '@/features/projects/queries';
import { Projects } from '@/screens';
import type { Actor } from '@/mocks/types';

export const Route = createFileRoute('/o/$org/projects/')({
  validateSearch: PageSearch,
  loaderDeps: ({ search }) => ({ page: pageOfSearch(search) }),
  loader: ({ context: { queryClient }, params, deps: { page }, cause }) =>
    loadPage(queryClient, projectsQueries.list(params.org, { page, pageSize: readPageSize() }), cause),
  component: ProjectsPage,
});

function ProjectsPage() {
  const { org } = Route.useParams();
  const page = pageOfSearch(Route.useSearch());
  const navigate = useNavigate({ from: Route.fullPath });
  const now = useNow();
  const { data: session } = useSuspenseQuery(sessionQuery);
  const [pageSize] = usePageSize();
  const { data, busy } = usePagedQuery({ page, pageSize }, (q) => projectsQueries.list(org, q));
  const dtos = data.items;
  // One request per project of the shown page, in parallel; the list suspends until all have answered.
  const connections = useSuspenseQueries({
    queries: dtos.map((d) => projectsQueries.connection(org, d.id)),
  });
  const projects = dtos.map((dto, i) => {
    const connection = connections[i];
    if (!connection) throw new Error(`Missing connection query for project ${dto.id}`);
    return toProject(dto, toConnectionStatus(connection.data, dto, now), org, now);
  });
  const go = (p: number, replace = false) =>
    void navigate({ search: (prev) => ({ ...prev, page: pageToSearch(p) }), replace });
  useClampToLastPage(page, data.pageSize, data.total, (p) => go(p, true));
  const pagination = usePaginationProps({ page, total: data.total, busy, go });
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
      settingsHref={(p) => `${orgPath}/p/${encodeURIComponent(p.id)}/desk/agent`}
      switchToPollingHref={(p) => `${orgPath}/p/${encodeURIComponent(p.id)}/desk/agent`}
      pagination={pagination}
    />
  );
}
