import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { Id, PlatformAuditAction } from '@agentdesk/contracts';
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
import { useNow } from '@/app/useNow';
import { PLATFORM_AUDIT_ACTION_LABELS, toPlatformAuditRow } from '@/features/platform/map';
import { platformAuditQuery, platformOrgQuery } from '@/features/platform/queries';
import { PlatformAudit, type PlatformAuditProps } from '@/screens';

// The platform Audit log. `action` and `org` live in the URL; an invalid action is dropped. `org` is any text so a
// mistyped link shows "Unknown organization" instead of an error; only a well-formed id reaches the API. A 403 from a
// read (rights lost since) shows the shell's forbidden state. UI only: the API is the authority.
const AuditSearch = PageSearch.extend({
  action: PlatformAuditAction.optional().catch(undefined),
  org: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/platform/audit')({
  staticData: { chrome: { mode: 'standard', scope: 'platform', item: 'platformAudit' } },
  validateSearch: AuditSearch,
  component: PlatformAuditPage,
});

const ACTIONS = PlatformAuditAction.options.map((value) => ({ value, label: PLATFORM_AUDIT_ACTION_LABELS[value] }));

function PlatformAuditPage() {
  const search = Route.useSearch();
  const page = pageOfSearch(search);
  const action = search.action;
  const org = search.org;
  const orgId = org === undefined ? undefined : Id.safeParse(org).data;
  const navigate = useNavigate({ from: Route.fullPath });
  const [pageSize] = usePageSize();
  const now = useNow();

  // The chip's name. A malformed id never reaches the API, so nothing loads for it.
  const orgDetail = useQuery({ ...platformOrgQuery(orgId ?? ''), enabled: orgId !== undefined, retry: false });
  const orgUnknown =
    org !== undefined &&
    (orgId === undefined || (orgDetail.error instanceof ApiError && orgDetail.error.status === 404));
  const list = useQuery({
    ...platformAuditQuery({
      page,
      pageSize,
      ...(action !== undefined && { action }),
      ...(orgId !== undefined && { orgId }),
    }),
    enabled: org === undefined || orgId !== undefined,
  });

  const go = (p: number, replace = false) =>
    void navigate({ search: (prev) => ({ ...prev, page: pageToSearch(p) }), replace });
  const data = org !== undefined && orgId === undefined ? { items: [], total: 0, page: 1, pageSize } : list.data;
  useClampToLastPage(page, data?.pageSize ?? pageSize, data?.total ?? 0, (p) => go(p, true));
  const pagination = usePaginationProps({
    page: data?.page ?? page,
    pageSize: data?.pageSize ?? pageSize,
    total: data?.total ?? 0,
    busy: list.isPlaceholderData,
    go,
  });

  const setFilters = (next: { action?: PlatformAuditAction | undefined; org?: string | undefined }) =>
    void navigate({ search: (prev) => ({ ...prev, ...next, page: undefined }) });

  const failed = [list, orgDetail].find((q) => q.isError && !(q === orgDetail && orgUnknown));
  let view: PlatformAuditProps['view'];
  if (failed?.error instanceof ApiError && failed.error.status === 403) {
    throw failed.error;
  } else if (failed !== undefined) {
    const failure = failed.error;
    view = {
      kind: 'error',
      title: failure instanceof ApiError ? failure.title : 'Something went wrong',
      ...(failure instanceof ApiError && failure.requestId !== undefined && { requestId: failure.requestId }),
      onRetry: () => void failed.refetch(),
    };
  } else if (data === undefined || (orgId !== undefined && orgDetail.isPending)) {
    view = { kind: 'loading' };
  } else {
    view = { kind: 'ready', rows: data.items.map((dto) => toPlatformAuditRow(dto, now)), pagination };
  }

  const chipText =
    org === undefined ? undefined : orgUnknown ? 'Unknown organization' : `Organization: ${orgDetail.data?.name ?? ''}`;
  return (
    <PlatformAudit
      view={view}
      action={action ?? 'all'}
      actions={ACTIONS}
      onAction={(v) => setFilters({ action: PlatformAuditAction.safeParse(v).data })}
      {...(chipText !== undefined && { orgChip: { label: chipText, onRemove: () => setFilters({ org: undefined }) } })}
      filtered={action !== undefined || org !== undefined}
      onClearFilters={() => setFilters({ action: undefined, org: undefined })}
    />
  );
}
