import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { ORG_SEARCH_MAX, OrgStatus } from '@agentdesk/contracts';
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
import { toPlatformOrgRow } from '@/features/platform/map';
import { platformOrgsQuery } from '@/features/platform/queries';
import { PlatformOrgs, type PlatformOrgsProps } from '@/screens';

// The Organizations directory. `q` and `status` live in the URL; anything invalid is dropped. A 403 from the list
// (rights lost since) shows the shell's forbidden state. UI only: the API is the authority.
const OrgsSearch = PageSearch.extend({
  q: z.string().trim().max(ORG_SEARCH_MAX).optional().catch(undefined),
  status: OrgStatus.optional().catch(undefined),
});

export const Route = createFileRoute('/platform/orgs/')({
  validateSearch: OrgsSearch,
  component: PlatformOrgsPage,
});

/** How long typing pauses before the search reaches the URL and the server. */
const SEARCH_DEBOUNCE_MS = 250;

function PlatformOrgsPage() {
  const search = Route.useSearch();
  const page = pageOfSearch(search);
  const q = search.q ?? '';
  const status = search.status;
  const navigate = useNavigate({ from: Route.fullPath });
  const [pageSize] = usePageSize();
  const now = useNow();

  const list = useQuery(
    platformOrgsQuery({ page, pageSize, ...(q !== '' && { q }), ...(status !== undefined && { status }) }),
  );
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

  // A filter change starts again at page 1.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The typed text the debounce has not yet sent to the URL; undefined when nothing is pending.
  const pending = useRef<string | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const setFilters = (next: { q?: string; status?: OrgStatus | undefined }, replace: boolean) =>
    void navigate({ search: (prev) => ({ ...prev, ...next, page: undefined }), replace });
  const qOf = (text: string) => (text.trim() === '' ? undefined : text.trim());
  const onSearch = (text: string) => {
    clearTimeout(timer.current);
    pending.current = text;
    timer.current = setTimeout(() => {
      pending.current = undefined;
      setFilters({ q: qOf(text) }, true);
    }, SEARCH_DEBOUNCE_MS);
  };

  let view: PlatformOrgsProps['view'];
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
    view = { kind: 'ready', rows: data.items.map((dto) => toPlatformOrgRow(dto, now)), pagination };
  }

  return (
    <PlatformOrgs
      view={view}
      filters={{ q, status: status ?? 'all', active: q !== '' || status !== undefined }}
      onSearch={onSearch}
      onStatus={(s) => {
        // Text still waiting on the debounce goes to the URL with the status, so the input and the list agree.
        clearTimeout(timer.current);
        const typed = pending.current;
        pending.current = undefined;
        setFilters({ ...(typed !== undefined && { q: qOf(typed) }), status: s === 'all' ? undefined : s }, false);
      }}
      onClearFilters={() => {
        clearTimeout(timer.current);
        pending.current = undefined;
        setFilters({ q: undefined, status: undefined }, false);
      }}
      createHref="/orgs/new"
    />
  );
}
