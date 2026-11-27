import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { ApiError } from '@agentdesk/contracts/client';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { InviteDialog } from '@/components';
import { pageOfSearch, pageToSearch, useClampToLastPage, usePageSize, usePaginationProps } from '@/app/pagination';
import { useNow } from '@/app/useNow';
import { useToast } from '@/ds';
import { requireInvite } from '@/features/access/guards';
import { canInvite, orgAccessQuery, toAccess } from '@/features/access/queries';
import { ORG_SWITCHED_MESSAGE } from '@/features/auth/orgResync';
import { orgsQuery } from '@/features/auth/session';
import { copyText, invitationUrl } from '@/features/orgInvitations/link';
import { failureTitle, toOrgInvitationRow } from '@/features/orgInvitations/map';
import { useResendInvitation, useRevokeInvitation } from '@/features/orgInvitations/mutations';
import { projectOptions, projectsOnly, roleOptions, useInviteForm } from '@/features/orgInvitations/inviteForm';
import { InvitationsSearch } from '@/features/orgInvitations/search';
import { inviteProjectsQuery, inviteRolesQuery, orgInvitationsQuery } from '@/features/orgInvitations/queries';
import { formatShortDate } from '@/features/invitations/dates';
import { OrgInvitations, type InvitationFilter, type OrgInvitationsProps } from '@/screens';

export const Route = createFileRoute('/o/$org/settings/invitations')({
  staticData: { chrome: { mode: 'standard', scope: 'org', item: 'invitations', crumb: 'Invitations' } },
  // Invite rights are checked before the page loads; the page keeps its own no-access state as a second line.
  beforeLoad: ({ context: { queryClient }, params }) => requireInvite(queryClient, params.org),
  validateSearch: InvitationsSearch,
  component: InvitationsRoute,
});

const COPY_FAILED = 'Could not copy. Select the link and copy it.';
const LOAD_FAILED = 'Could not load the roles and projects. Close the dialog and try again.';

function InvitationsRoute() {
  const { org } = Route.useParams();
  const { data: orgs } = useSuspenseQuery(orgsQuery);
  const orgId = orgs.find((o) => o.slug === org)?.id;
  // The route stays mounted when only the slug changes (browser back or forward). What the page holds (revoke
  // confirm, invite dialog, copy-failed popover) belongs to one org: a new org gets a fresh page.
  return <InvitationsPage key={`${org}/${orgId ?? ''}`} org={org} />;
}

function InvitationsPage({ org }: { org: string }) {
  const search = Route.useSearch();
  const status: InvitationFilter = search.status ?? 'pending';
  const page = pageOfSearch(search);
  const navigate = useNavigate({ from: Route.fullPath });
  const now = useNow();
  const toast = useToast();
  const [pageSize] = usePageSize();
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
  const [inviting, setInviting] = useState(false);
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
      filter={status}
      onFilterChange={(next) =>
        void navigate({
          search: (prev) => ({ ...prev, status: next === 'pending' ? undefined : next, page: undefined }),
        })
      }
      state={state}
      onInvite={() => setInviting(true)}
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
    >
      {inviting && orgId !== undefined && (
        <InvitePeople org={org} orgId={orgId} access={toAccess(accessDto)} onClose={() => setInviting(false)} />
      )}
    </OrgInvitations>
  );
}

// Mounted only while the dialog is open, so each opening starts from an empty form and loads its choices again.
function InvitePeople({
  org,
  orgId,
  access,
  onClose,
}: {
  org: string;
  orgId: string;
  access: ReturnType<typeof toAccess>;
  onClose: () => void;
}) {
  const toast = useToast();
  const roles = useQuery(inviteRolesQuery(org, orgId));
  const projects = useQuery(inviteProjectsQuery(org));
  const only = projectsOnly(access);
  const form = useInviteForm({
    org,
    projectsOnly: only,
    onOrgSwitched: () => toast.show({ tone: 'err', title: ORG_SWITCHED_MESSAGE }),
  });
  const loadFailed = roles.isError || projects.isError;
  const created = form.created;
  return (
    <InviteDialog
      open
      step={
        created
          ? {
              kind: 'created',
              email: created.email,
              expiresOn: formatShortDate(created.expiresAt),
              link: invitationUrl(created.id),
            }
          : {
              kind: 'form',
              values: form.values,
              errors: form.errors,
              ...((form.formError ?? (loadFailed ? LOAD_FAILED : undefined)) !== undefined && {
                formError: form.formError ?? LOAD_FAILED,
              }),
              saving: form.saving,
            }
      }
      roles={roleOptions(roles.data ?? [], access)}
      projects={projectOptions(projects.data ?? [], access)}
      projectsOnly={only}
      onChange={form.change}
      onSubmit={form.submit}
      onCancel={() => {
        if (!form.saving) onClose();
      }}
      onCopy={() => {
        if (!created) return;
        void copyText(invitationUrl(created.id)).then((ok) =>
          toast.show(ok ? { tone: 'ok', title: 'Link copied' } : { tone: 'err', title: COPY_FAILED }),
        );
      }}
      onDone={onClose}
    />
  );
}
