import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
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
import { requireProjectPermission } from '@/features/access/guards';
import { sessionQuery } from '@/features/auth/session';
import { useDeskFrame } from '@/features/desk/frame';
import { toProjectMemberRow } from '@/features/projectMembers/map';
import { projectMembersQuery } from '@/features/projectMembers/queries';
import { useNow } from '@/app/useNow';
import { DeskMembers, type DeskMembersProps } from '@/screens';

export const Route = createFileRoute('/o/$org/p/$project/desk/members')({
  // The page needs `assignment:read` on this project; the guard runs before any loader, so a refused route fetches nothing.
  beforeLoad: ({ context: { queryClient }, params }) =>
    requireProjectPermission(queryClient, params.org, 'assignment:read', params.project),
  validateSearch: PageSearch,
  component: DeskMembersPage,
});

const noop = () => {};

/**
 * The Members page's data and wiring: the frame, the list query and the screen state. Tasks 25 to 27 extend it with the
 * Add, Invite, Change role and Remove actions.
 */
export function useDeskMembersState(org: string, projectId: string): Omit<DeskMembersProps, 'headingRef'> {
  const search = Route.useSearch();
  const page = pageOfSearch(search);
  const navigate = useNavigate({ from: Route.fullPath });
  const [pageSize] = usePageSize();
  const now = useNow();
  const frame = useDeskFrame(org, projectId, now);
  const { data: session } = useSuspenseQuery(sessionQuery);
  const list = useQuery(projectMembersQuery(org, projectId, { page, pageSize }));

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

  // The project is gone (404) or the caller lost access (403, the permission check precedes any lookup): the route's
  // error pages show, never a crash. The API stays the authority.
  if (list.error instanceof ApiError && (list.error.status === 403 || list.error.status === 404)) throw list.error;

  let state: DeskMembersProps['state'];
  if (list.isError) {
    const requestId = list.error instanceof ApiError ? list.error.requestId : undefined;
    state = { kind: 'error', ...(requestId !== undefined && { requestId }), onRetry: () => void list.refetch() };
  } else if (data === undefined) {
    state = { kind: 'loading' };
  } else {
    const self = session?.user.id ?? '';
    state = {
      kind: 'ready',
      rows: data.items.map((dto) => toProjectMemberRow(dto, self)),
      busyUserId: null,
      pagination,
    };
  }

  // Add, Invite and the row actions are wired by the next tasks.
  return {
    frame,
    orgName: frame.org.current?.name ?? org,
    projectName: frame.project.name,
    state,
    onAdd: noop,
    onInvite: noop,
    onChangeRole: noop,
    onRemove: noop,
  };
}

function DeskMembersPage() {
  const { org, project: projectId } = Route.useParams();
  return <DeskMembers {...useDeskMembersState(org, projectId)} />;
}
