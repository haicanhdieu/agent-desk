import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@agentdesk/contracts/client';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  pageOfSearch,
  pageToSearch,
  useClampToLastPage,
  usePageSize,
  usePaginationProps,
  PageSearch,
} from '@/app/pagination';
import { platformOrgProjectsQuery } from '@/features/platform/queries';
import { PlatformOrgProjects, type ListView } from '@/screens';
import type { PlatformProjectRowView } from '@/mocks';

// The Projects of one organization: id and name only, its own `?page=N`. A 403 from the read (rights lost since) shows
// the shell's forbidden state. UI only: the API is the authority.
export const Route = createFileRoute('/platform/orgs/$orgId/projects')({
  staticData: { chrome: { mode: 'standard', scope: 'platformOrg', item: 'orgProjects' } },
  validateSearch: PageSearch,
  component: PlatformOrgProjectsPage,
});

function PlatformOrgProjectsPage() {
  const { orgId } = Route.useParams();
  const page = pageOfSearch(Route.useSearch());
  const navigate = useNavigate({ from: Route.fullPath });
  const [pageSize] = usePageSize();
  const list = useQuery(platformOrgProjectsQuery(orgId, { page, pageSize }));
  const data = list.data;

  const go = (p: number, replace = false) =>
    void navigate({ search: (prev) => ({ ...prev, page: pageToSearch(p) }), replace });
  useClampToLastPage(page, data?.pageSize ?? pageSize, data?.total ?? 0, (p) => go(p, true));
  const pagination = usePaginationProps({
    page: data?.page ?? page,
    pageSize: data?.pageSize ?? pageSize,
    total: data?.total ?? 0,
    busy: list.isPlaceholderData,
    go,
  });

  let view: ListView<PlatformProjectRowView>;
  if (list.error instanceof ApiError && list.error.status === 403) {
    throw list.error;
  } else if (list.isError) {
    const failure = list.error;
    view = {
      kind: 'error',
      title: failure instanceof ApiError ? failure.title : 'Something went wrong',
      ...(failure instanceof ApiError && failure.requestId !== undefined && { requestId: failure.requestId }),
      onRetry: () => void list.refetch(),
    };
  } else if (data === undefined) {
    view = { kind: 'loading' };
  } else {
    view = { kind: 'ready', rows: data.items, pagination };
  }
  return <PlatformOrgProjects view={view} />;
}
