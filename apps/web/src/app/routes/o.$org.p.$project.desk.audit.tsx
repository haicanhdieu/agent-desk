import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@agentdesk/contracts/client';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  PageSearch,
  pageOfSearch,
  pageToSearch,
  useClampToLastPage,
  usePageSize,
  usePaginationProps,
} from '@/app/pagination';
import { useNow } from '@/app/useNow';
import { requireProjectPermission } from '@/features/access/guards';
import { toAuditRow } from '@/features/audit/map';
import { useDeskFrame } from '@/features/desk/frame';
import { projectAuditQuery } from '@/features/projectAudit/queries';
import { DeskAudit, type DeskAuditProps } from '@/screens';

export const Route = createFileRoute('/o/$org/p/$project/desk/audit')({
  staticData: { chrome: { mode: 'standard', scope: 'project', item: 'projectAudit', crumb: 'Audit log' } },
  // The log needs `project-audit:read` on this project; the guard runs before any loader, so a refused route fetches nothing.
  beforeLoad: ({ context: { queryClient }, params }) =>
    requireProjectPermission(queryClient, params.org, 'project-audit:read', params.project),
  validateSearch: PageSearch,
  component: DeskAuditPage,
});

function DeskAuditPage() {
  const { org, project: projectId } = Route.useParams();
  const search = Route.useSearch();
  const page = pageOfSearch(search);
  const navigate = useNavigate({ from: Route.fullPath });
  const [pageSize] = usePageSize();
  const now = useNow();
  const frame = useDeskFrame(org, projectId, now);
  const list = useQuery(projectAuditQuery(org, projectId, { page, pageSize }));

  const go = (p: number, replace = false) =>
    void navigate({ search: (prev) => ({ ...prev, page: pageToSearch(p) }), replace });
  const data = list.data;
  useClampToLastPage(page, data?.pageSize ?? pageSize, data?.total ?? 0, (p) => go(p, true));
  const pagination = usePaginationProps({
    page: data?.page ?? page,
    pageSize: data?.pageSize ?? pageSize,
    total: data?.total ?? 0,
    busy: list.isPlaceholderData,
    go,
  });

  // A 403 is thrown to the route's Forbidden page; the API stays the authority.
  if (list.error instanceof ApiError && (list.error.status === 403 || list.error.status === 404)) throw list.error;

  let state: DeskAuditProps['state'];
  if (list.isError) {
    const requestId = list.error instanceof ApiError ? list.error.requestId : undefined;
    state = { kind: 'error', ...(requestId !== undefined && { requestId }), onRetry: () => void list.refetch() };
  } else if (data === undefined) {
    state = { kind: 'loading' };
  } else {
    state = { kind: 'ready', rows: data.items.map((dto) => toAuditRow(dto, now, undefined, 'project')), pagination };
  }

  return <DeskAudit frame={frame} state={state} />;
}
