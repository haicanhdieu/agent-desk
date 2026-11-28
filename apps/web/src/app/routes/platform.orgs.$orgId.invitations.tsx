import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@agentdesk/contracts/client';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { pageOfSearch, pageToSearch, useClampToLastPage, usePageSize, usePaginationProps } from '@/app/pagination';
import { useNow } from '@/app/useNow';
import { InviteDialog, InviteLink } from '@/components';
import { Button, Dialog, useToast } from '@/ds';
import { ORG_SWITCHED_MESSAGE } from '@/features/auth/orgResync';
import { formatShortDate } from '@/features/invitations/dates';
import { useInviteForm } from '@/features/orgInvitations/inviteForm';
import { copyText, invitationUrl } from '@/features/orgInvitations/link';
import { failureTitle, toOrgInvitationRow } from '@/features/orgInvitations/map';
import { InvitationsSearch } from '@/features/orgInvitations/search';
import {
  useCreatePlatformInvitation,
  useResendPlatformInvitation,
  useRevokePlatformInvitation,
} from '@/features/platform/mutations';
import {
  platformOrgAllProjectsQuery,
  platformOrgInvitationsQuery,
  platformOrgRolesQuery,
} from '@/features/platform/queries';
import type { InvitationStatusView, InviteOption, OrgInvitationRowView } from '@/mocks';
import { PlatformOrgInvitations, type ListView } from '@/screens';

// The Invitations of one organization, driven by the platform routes: pending by default (`?status=`, its own `?page=N`),
// invite, copy link, resend and revoke as on the org's own page. A platform admin may invite an Owner, to the whole
// organization or to some projects. Links are built from the invitation id when shown and never cached. A 403 from a
// read (rights lost since) shows the shell's forbidden state. UI only: the API is the authority.
export const Route = createFileRoute('/platform/orgs/$orgId/invitations')({
  staticData: { chrome: { mode: 'standard', scope: 'platformOrg', item: 'orgInvitations' } },
  validateSearch: InvitationsSearch,
  component: PlatformOrgInvitationsPage,
});

const COPY_FAILED = 'Could not copy. Select the link and copy it.';
const LOAD_FAILED = 'Could not load the roles and projects. Close the dialog and try again.';
/** The roles the dialog offers, in its order. */
const ROLE_KEYS = ['owner', 'admin', 'member', 'viewer'] as const;

function PlatformOrgInvitationsPage() {
  const { orgId } = Route.useParams();
  const search = Route.useSearch();
  const status: InvitationStatusView | 'all' = search.status ?? 'pending';
  const page = pageOfSearch(search);
  const navigate = useNavigate({ from: Route.fullPath });
  const now = useNow();
  const toast = useToast();
  const [pageSize] = usePageSize();
  const list = useQuery(platformOrgInvitationsQuery(orgId, { status, page, pageSize }));
  const resend = useResendPlatformInvitation(orgId);
  const revoke = useRevokePlatformInvitation(orgId);
  const [inviting, setInviting] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  // The row whose Copy link was refused: the link is shown to copy by hand.
  const [copyFailed, setCopyFailed] = useState<string | null>(null);

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
  const busyId = resend.isPending ? resend.variables : revoke.isPending ? revoke.variables : undefined;

  let view: ListView<OrgInvitationRowView>;
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
    view = { kind: 'ready', rows, pagination };
  }

  const onCopy = (id: string) => {
    // Cleared first, so a repeat failure shows the notice again.
    setCopyFailed(null);
    void copyText(invitationUrl(id)).then((ok) => {
      if (ok) toast.show({ tone: 'ok', title: 'Link copied' });
      else setCopyFailed(id);
    });
  };

  const onResend = (id: string) => {
    if (busyId !== undefined) return;
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
    revoke.mutate(revoking, {
      onSuccess: () => {
        setRevoking(null);
        toast.show({ tone: 'ok', title: 'Invitation revoked' });
      },
      onError: (e) => {
        setRevoking(null);
        toast.show({ tone: 'err', title: failureTitle(e) });
      },
    });
  };

  const linkDialog =
    copyFailed === null ? undefined : (
      <Dialog
        open
        title="Invitation link"
        width={520}
        onClose={() => setCopyFailed(null)}
        footer={
          <Button variant="primary" onClick={() => setCopyFailed(null)}>
            Done
          </Button>
        }
      >
        <InviteLink link={invitationUrl(copyFailed)} onCopy={() => onCopy(copyFailed)} copyFailed />
      </Dialog>
    );

  return (
    <>
      <PlatformOrgInvitations
        view={view}
        status={status}
        onStatus={(next) =>
          void navigate({
            search: (prev) => ({ ...prev, status: next === 'pending' ? undefined : next, page: undefined }),
          })
        }
        onInvite={() => setInviting(true)}
        {...(busyId !== undefined && resend.isPending && { resendingId: busyId })}
        {...(inviting && { inviteDialog: <InvitePeople orgId={orgId} onClose={() => setInviting(false)} /> })}
        {...(linkDialog && { linkDialog, copyFailed: true })}
        rowActions={(row) => ({
          onCopy: () => onCopy(row.id),
          onResend: () => onResend(row.id),
          onRevoke: () => setRevoking(row.id),
        })}
      />
      {revokeRow && (
        <Dialog
          open
          title={`Revoke invitation for ${revokeRow.email}?`}
          width={440}
          onClose={() => {
            if (!revoke.isPending) setRevoking(null);
          }}
          footer={
            <>
              <Button variant="ghost" disabled={revoke.isPending} onClick={() => setRevoking(null)}>
                Cancel
              </Button>
              <Button
                variant="solid-danger"
                disabled={revoke.isPending}
                aria-busy={revoke.isPending}
                onClick={onConfirmRevoke}
              >
                {revoke.isPending ? 'Revoking…' : 'Revoke'}
              </Button>
            </>
          }
        >
          <p className="muted">The link stops working.</p>
        </Dialog>
      )}
    </>
  );
}

// Mounted only while the dialog is open, so each opening starts from an empty form and reads its choices again.
function InvitePeople({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const toast = useToast();
  const roles = useQuery(platformOrgRolesQuery(orgId));
  const projects = useQuery(platformOrgAllProjectsQuery(orgId));
  const create = useCreatePlatformInvitation(orgId);
  // A platform admin invites to the whole organization or to projects: never "projects only".
  const form = useInviteForm({
    org: orgId,
    projectsOnly: false,
    create,
    onOrgSwitched: () => toast.show({ tone: 'err', title: ORG_SWITCHED_MESSAGE }),
  });
  const roleOptions: InviteOption[] = ROLE_KEYS.flatMap((key) => {
    const role = roles.data?.find((r) => r.key === key);
    return role ? [{ id: role.id, label: role.name }] : [];
  });
  const projectOptions: InviteOption[] = (projects.data ?? []).map((p) => ({ id: p.id, label: p.name }));
  const loadFailed = roles.isError || projects.isError;
  const created = form.created;

  if (created) {
    return (
      <Dialog
        open
        title="Invitation link"
        width={520}
        onClose={onClose}
        footer={
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        }
      >
        <p className="muted">
          Send this link to {created.email}. It works only for that email and expires on{' '}
          {formatShortDate(created.expiresAt)}.
        </p>
        <InviteLink
          link={invitationUrl(created.id)}
          onCopy={() =>
            void copyText(invitationUrl(created.id)).then((ok) =>
              toast.show(ok ? { tone: 'ok', title: 'Link copied' } : { tone: 'err', title: COPY_FAILED }),
            )
          }
        />
      </Dialog>
    );
  }
  const formError = form.formError ?? (loadFailed ? LOAD_FAILED : undefined);
  return (
    <InviteDialog
      open
      step={{
        kind: 'form',
        values: form.values,
        errors: form.errors,
        ...(formError !== undefined && { formError }),
        saving: form.saving,
      }}
      roles={roleOptions}
      projects={projectOptions}
      projectsOnly={false}
      onChange={form.change}
      onSubmit={form.submit}
      onCancel={() => {
        if (!form.saving) onClose();
      }}
      onCopy={() => undefined}
      onDone={onClose}
    />
  );
}
