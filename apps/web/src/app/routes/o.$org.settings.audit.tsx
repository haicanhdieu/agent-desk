import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { ApiError } from '@agentdesk/contracts/client';
import { can } from '@agentdesk/contracts';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  pageOfSearch,
  pageToSearch,
  useClampToLastPage,
  usePageSize,
  usePaginationProps,
  PageSearch,
} from '@/app/pagination';
import { useNow } from '@/app/useNow';
import { requirePermission } from '@/features/access/guards';
import { orgAccessQuery, toAccess } from '@/features/access/queries';
import { toAuditRow } from '@/features/audit/map';
import { auditQuery } from '@/features/audit/queries';
import { orgsQuery } from '@/features/auth/session';
import { OrgAudit, type OrgAuditProps } from '@/screens';

export const Route = createFileRoute('/o/$org/settings/audit')({
  // The log needs `audit:read` at org level (a project grant never gives it); the page keeps its own no-access state.
  beforeLoad: ({ context: { queryClient }, params }) => requirePermission(queryClient, params.org, 'audit:read'),
  validateSearch: PageSearch,
  component: AuditPage,
});

function AuditPage() {
  const { org } = Route.useParams();
  const { data: orgs } = useSuspenseQuery(orgsQuery);
  const orgId = orgs.find((o) => o.slug === org)?.id;
  // Keyed on the org: nothing of the previous org's page survives a switch.
  return <AuditContent key={org} org={org} orgId={orgId} />;
}

function AuditContent({ org, orgId }: { org: string; orgId: string | undefined }) {
  const search = Route.useSearch();
  const page = pageOfSearch(search);
  const navigate = useNavigate({ from: Route.fullPath });
  const [pageSize] = usePageSize();
  const now = useNow();
  const { data: accessDto } = useSuspenseQuery(orgAccessQuery(org));
  const allowed = can(toAccess(accessDto), 'audit:read');
  const enabled = allowed && orgId !== undefined;

  // Nothing is requested without `audit:read` (the page is the no-access state).
  const list = useQuery({ ...auditQuery(org, orgId ?? '', { page, pageSize }), enabled });

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

  let state: OrgAuditProps['state'];
  if (!allowed || (list.error instanceof ApiError && list.error.status === 403)) {
    state = { kind: 'forbidden' };
  } else if (list.isError) {
    const requestId = list.error instanceof ApiError ? list.error.requestId : undefined;
    state = {
      kind: 'error',
      ...(requestId !== undefined && { requestId }),
      onRetry: () => void list.refetch(),
    };
  } else if (data === undefined) {
    state = { kind: 'loading' };
  } else {
    state = { kind: 'ready', rows: data.items.map((dto) => toAuditRow(dto, now)), pagination };
  }

  return <OrgAudit state={state} />;
}
