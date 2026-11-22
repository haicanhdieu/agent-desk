import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
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
import { requirePermission } from '@/features/access/guards';
import { orgAccessQuery, toAccess } from '@/features/access/queries';
import { orgsQuery } from '@/features/auth/session';
import { callerRights, toMemberRow } from '@/features/members/map';
import { membersQuery } from '@/features/members/queries';
import { inviteProjectsQuery } from '@/features/orgInvitations/queries';
import { OrgMembers, type OrgMembersProps } from '@/screens';
import { can } from '@agentdesk/contracts';

export const Route = createFileRoute('/o/$org/settings/members')({
  // Members need `member:read` at org level (a project grant never gives it); the page keeps its own no-access state.
  beforeLoad: ({ context: { queryClient }, params }) => requirePermission(queryClient, params.org, 'member:read'),
  validateSearch: PageSearch,
  component: MembersPage,
});

const noop = () => {};

function MembersPage() {
  const { org } = Route.useParams();
  const search = Route.useSearch();
  const page = pageOfSearch(search);
  const navigate = useNavigate({ from: Route.fullPath });
  const [pageSize] = usePageSize();
  const { data: orgs } = useSuspenseQuery(orgsQuery);
  const { data: accessDto } = useSuspenseQuery(orgAccessQuery(org));
  const access = toAccess(accessDto);
  const allowed = can(access, 'member:read');
  const orgId = orgs.find((o) => o.slug === org)?.id;
  const enabled = allowed && orgId !== undefined;

  // Nothing is requested without `member:read` (the page is the no-access state).
  const list = useQuery({ ...membersQuery(org, orgId ?? '', { page, pageSize }), enabled });
  const projects = useQuery({ ...inviteProjectsQuery(org), enabled });

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

  let state: OrgMembersProps['state'];
  if (!allowed || (list.error instanceof ApiError && list.error.status === 403)) {
    state = { kind: 'forbidden' };
  } else if (list.isError || projects.isError) {
    const failure = list.error ?? projects.error;
    const requestId = failure instanceof ApiError ? failure.requestId : undefined;
    state = {
      kind: 'error',
      ...(requestId !== undefined && { requestId }),
      onRetry: () => void Promise.all([list.refetch(), projects.refetch()]),
    };
  } else if (data === undefined || projects.data === undefined) {
    state = { kind: 'loading' };
  } else {
    const rights = callerRights(access);
    const names = new Map(projects.data.map((p) => [p.id, p.name]));
    state = {
      kind: 'ready',
      rows: data.items.map((dto) => toMemberRow(dto, rights, names)),
      busyUserId: null,
      pagination,
    };
  }

  // Change role and Remove are wired in the next task.
  return <OrgMembers state={state} onChangeRole={noop} onRemove={noop} />;
}
