import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { InvitationListStatus } from '@agentdesk/contracts';
import { ApiError } from '@agentdesk/contracts/client';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import {
  PageSearch,
  pageOfSearch,
  pageToSearch,
  useClampToLastPage,
  usePageSize,
  usePaginationProps,
} from '@/app/pagination';
import { useNow } from '@/app/useNow';
import { useToast } from '@/ds';
import { canInvite, orgAccessQuery, toAccess } from '@/features/access/queries';
import { orgsQuery, sessionQuery } from '@/features/auth/session';
import { toOrgSwitch } from '@/features/orgs/orgSwitch';
import { copyText, invitationUrl } from '@/features/orgInvitations/link';
import { failureTitle, toOrgInvitationRow } from '@/features/orgInvitations/map';
import { useResendInvitation, useRevokeInvitation } from '@/features/orgInvitations/mutations';
import { orgInvitationsQuery } from '@/features/orgInvitations/queries';
import { formatShortDate } from '@/features/invitations/dates';
import { OrgInvitations, type InvitationFilter, type OrgInvitationsProps } from '@/screens';

// `?status=` is a filter name; a bad value reads as Pending, and Pending is left out of the URL.
const InvitationsSearch = PageSearch.extend({
  status: InvitationListStatus.optional().catch(undefined),
});

export const Route = createFileRoute('/o/$org/invitations')({
  validateSearch: InvitationsSearch,
  component: InvitationsPage,
});

const COPY_FAILED = 'Could not copy. Select the link and copy it.';
const noop = () => undefined;

function InvitationsPage() {
  const { org } = Route.useParams();
  const search = Route.useSearch();
  const status: InvitationFilter = search.status ?? 'pending';
  const page = pageOfSearch(search);
  const navigate = useNavigate({ from: Route.fullPath });
  const now = useNow();
  const toast = useToast();
  const [pageSize] = usePageSize();
  const { data: session } = useSuspenseQuery(sessionQuery);
  const { data: orgs } = useSuspenseQuery(orgsQuery);
  const { data: accessDto } = useSuspenseQuery(orgAccessQuery(org));
  const allowed = canInvite(toAccess(accessDto));
  const orgId = orgs.find((o) => o.slug === org)?.id;

  // Nothing is requested without invite rights (the page is the no-access state).
  const list = useQuery({
    ...orgInvitationsQuery(org, orgId ?? '', { status, page, pageSize }),
    enabled: allowed && orgId !== undefined,
  });
  const resend = useResendInvitation(org);
  const revoke = useRevokeInvitation(org);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState<{ rowId: string; link: string } | null>(null);

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

  const orgSwitch = {
    ...toOrgSwitch(orgs, org, accessDto.platformAdmin),
    orgHref: (o: { slug: string }) => `/o/${encodeURIComponent(o.slug)}/projects`,
    createHref: '/orgs/new',
  };
  const handle = session?.user.handle ?? '';
  const user = { login: handle, initials: handle.slice(0, 2).toUpperCase() };

  const rows = data?.items.map((dto) => toOrgInvitationRow(dto, now)) ?? [];
  const busyRowId = resend.isPending ? resend.variables : revoke.isPending ? revoke.variables : null;

  let state: OrgInvitationsProps['state'];
  if (!allowed || (list.error instanceof ApiError && list.error.status === 403)) {
    state = { kind: 'forbidden' };
  } else if (list.isError) {
    const requestId = list.error instanceof ApiError ? list.error.requestId : undefined;
    state = { kind: 'error', ...(requestId !== undefined && { requestId }), onRetry: () => void list.refetch() };
  } else if (data === undefined) {
    state = { kind: 'loading' };
  } else {
    state = { kind: 'ready', rows, busyRowId, pagination };
  }

  const onCopy = (id: string) => {
    const link = invitationUrl(id);
    // Cleared first, so a repeat failure re-shows a popover that was dismissed.
    setCopyFailed(null);
    void copyText(link).then((ok) => {
      if (ok) {
        toast.show({ tone: 'ok', title: 'Link copied' });
      } else {
        setCopyFailed({ rowId: id, link });
        toast.show({ tone: 'err', title: COPY_FAILED });
      }
    });
  };

  const onResend = (id: string) => {
    if (busyRowId !== null) return;
    resend.mutate(id, {
      onSuccess: (dto) =>
        toast.show({
          tone: 'ok',
          title: `Invitation renewed. It now expires on ${formatShortDate(dto.expiresAt)}.`,
        }),
      onError: (e) => toast.show({ tone: 'err', title: failureTitle(e) }),
    });
  };

  const revokeRow = revoking === null ? undefined : rows.find((r) => r.id === revoking);
  const onConfirmRevoke = () => {
    if (revoking === null || revoke.isPending) return;
    const close = () => setRevoking(null);
    revoke.mutate(revoking, {
      onSuccess: () => {
        close();
        toast.show({ tone: 'ok', title: 'Invitation revoked' });
      },
      onError: (e) => {
        close();
        toast.show({ tone: 'err', title: failureTitle(e) });
      },
    });
  };

  return (
    <OrgInvitations
      user={user}
      org={orgSwitch}
      filter={status}
      onFilterChange={(next) =>
        void navigate({
          search: (prev) => ({ ...prev, status: next === 'pending' ? undefined : next, page: undefined }),
        })
      }
      state={state}
      // The invite dialog arrives with the Invite people task; until then the button has nothing to open.
      onInvite={noop}
      onCopy={onCopy}
      onResend={onResend}
      onRevoke={setRevoking}
      {...(revokeRow && {
        revokeConfirm: {
          email: revokeRow.email,
          busy: revoke.isPending,
          onConfirm: onConfirmRevoke,
          onCancel: () => {
            if (!revoke.isPending) setRevoking(null);
          },
        },
      })}
      {...(copyFailed && { copyFailed })}
    />
  );
}
