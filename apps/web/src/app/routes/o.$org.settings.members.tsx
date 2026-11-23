import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { ApiError, isOrgMismatchError } from '@agentdesk/contracts/client';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  pageOfSearch,
  pageToSearch,
  useClampToLastPage,
  usePageSize,
  usePaginationProps,
  PageSearch,
} from '@/app/pagination';
import { toastFromError } from '@/app/boundaries';
import { ChangeRoleDialog, type ChangeRoleDialogProps } from '@/components';
import { useToast } from '@/ds';
import { requirePermission } from '@/features/access/guards';
import { orgAccessQuery, toAccess } from '@/features/access/queries';
import { orgsQuery } from '@/features/auth/session';
import { callerRights, toMemberRow } from '@/features/members/map';
import { refreshAccess, useChangeRole, useRemoveMember } from '@/features/members/mutations';
import { membersQuery } from '@/features/members/queries';
import { roleCards } from '@/features/members/roleCards';
import { inviteProjectsQuery, inviteRolesQuery } from '@/features/orgInvitations/queries';
import type { MemberRowView } from '@/mocks/types';
import { OrgMembers, type OrgMembersProps } from '@/screens';
import { can } from '@agentdesk/contracts';

export const Route = createFileRoute('/o/$org/settings/members')({
  // Members need `member:read` at org level (a project grant never gives it); the page keeps its own no-access state.
  beforeLoad: ({ context: { queryClient }, params }) => requirePermission(queryClient, params.org, 'member:read'),
  validateSearch: PageSearch,
  component: MembersPage,
});

function MembersPage() {
  const { org } = Route.useParams();
  const { data: orgs } = useSuspenseQuery(orgsQuery);
  const orgId = orgs.find((o) => o.slug === org)?.id;
  // The route stays mounted when only the slug changes (browser back or forward). Everything held in the page (an
  // open dialog or confirm, the member it is about, its error, a role picked) and every cached placeholder belongs to
  // one org: a new org gets a fresh page, so nothing of the old org can be shown or sent to the new one.
  return <MembersContent key={`${org}/${orgId ?? ''}`} org={org} />;
}

function MembersContent({ org }: { org: string }) {
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
  const toast = useToast();
  const queryClient = useQueryClient();
  const orgName = orgs.find((o) => o.slug === org)?.name ?? org;

  // The row a dialog is about is held as it was when the menu item was pressed (its current role id with it), so a
  // refetch behind the open dialog never swaps the member under it.
  const [changing, setChanging] = useState<{ row: MemberRowView; current: string | null } | null>(null);
  const [changeError, setChangeError] = useState<ChangeRoleDialogProps['error']>();
  const [removing, setRemoving] = useState<MemberRowView | null>(null);
  const focusHeading = useRef(false);
  const change = useChangeRole(org, orgId ?? '');
  const remove = useRemoveMember(org, orgId ?? '');

  // After a remove the opener is gone: focus moves to the page heading, once the confirm has left the page.
  useEffect(() => {
    if (removing !== null || !focusHeading.current) return;
    focusHeading.current = false;
    document.querySelector<HTMLElement>('main h1')?.focus();
  }, [removing]);

  // Nothing is requested without `member:read` (the page is the no-access state).
  const list = useQuery({ ...membersQuery(org, orgId ?? '', { page, pageSize }), enabled });
  const projects = useQuery({ ...inviteProjectsQuery(org), enabled });
  // The role cards are read ahead, so the dialog opens even if the rights were lost since: the refusal then ends in
  // the dialog's own no-access Banner on Save, not in a toast that closes the dialog.
  useEffect(() => {
    if (enabled && orgId !== undefined) void queryClient.prefetchQuery(inviteRolesQuery(org, orgId));
  }, [enabled, queryClient, org, orgId]);

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
      busyUserId: change.isPending
        ? (change.variables?.userId ?? null)
        : remove.isPending
          ? (remove.variables?.userId ?? null)
          : null,
      pagination,
    };
  }

  const openChangeRole = (row: MemberRowView) => {
    const dto = data?.items.find((m) => m.userId === row.userId);
    setChangeError(undefined);
    setChanging({ row, current: dto?.assignments.find((a) => a.scope.type === 'org')?.role.id ?? null });
  };

  const onSaveRole = async (roleId: string | null) => {
    if (changing === null || change.isPending) return;
    setChangeError(undefined);
    try {
      await change.mutateAsync({ userId: changing.row.userId, roleId });
      setChanging(null);
      toast.show({ tone: 'ok', title: 'Role changed' });
    } catch (e) {
      if (isOrgMismatchError(e)) {
        toast.show(toastFromError(e)); // the choice stays; a second press tries again
      } else if (e instanceof ApiError && e.status === 409) {
        setChangeError({ kind: 'lastOwner' });
      } else if (e instanceof ApiError && e.status === 403) {
        setChangeError({ kind: 'forbidden', ...(e.requestId !== undefined && { requestId: e.requestId }) });
      } else if (e instanceof ApiError && e.status === 404) {
        setChanging(null);
        toast.show(toastFromError(e));
      } else {
        toast.show(toastFromError(e)); // 422 and the rest: the dialog stays open to try again
      }
    }
  };

  const onConfirmRemove = async () => {
    if (removing === null || remove.isPending) return;
    try {
      await remove.mutateAsync({ userId: removing.userId });
      focusHeading.current = true;
      setRemoving(null);
      toast.show({ tone: 'ok', title: `${removing.name} removed` });
    } catch (e) {
      toast.show(toastFromError(e));
      if (e instanceof ApiError && e.status === 403) void refreshAccess(queryClient, org);
      // Every refusal but an org switched in another tab closes the confirm: the list was fetched again.
      if (!isOrgMismatchError(e)) setRemoving(null);
    }
  };

  return (
    <OrgMembers
      state={state}
      onChangeRole={openChangeRole}
      onRemove={setRemoving}
      {...(removing && {
        removeConfirm: {
          memberName: removing.name,
          orgName,
          busy: remove.isPending,
          onConfirm: () => void onConfirmRemove(),
          onCancel: () => {
            if (!remove.isPending) setRemoving(null);
          },
        },
      })}
    >
      {changing && orgId !== undefined && (
        <ChangeRolePanel
          org={org}
          orgId={orgId}
          orgName={orgName}
          row={changing.row}
          current={changing.current}
          callerIsOwner={callerRights(access).owner}
          saving={change.isPending}
          error={changeError}
          onSave={(roleId) => void onSaveRole(roleId)}
          onCancel={() => {
            if (change.isPending) return;
            // A refused save: the rights may be gone, so the page reads them again now that the Banner was seen.
            if (changeError?.kind === 'forbidden') void refreshAccess(queryClient, org);
            setChanging(null);
          }}
          onLoadFailed={(e) => {
            toast.show(toastFromError(e));
            setChanging(null);
          }}
        />
      )}
    </OrgMembers>
  );
}

interface ChangeRolePanelProps {
  org: string;
  orgId: string;
  orgName: string;
  row: MemberRowView;
  current: string | null;
  callerIsOwner: boolean;
  saving: boolean;
  error: ChangeRoleDialogProps['error'];
  onSave: (roleId: string | null) => void;
  onCancel: () => void;
  onLoadFailed: (e: unknown) => void;
}

/** Mounted while the change-role dialog is wanted: loads the role cards, then shows the dialog. */
function ChangeRolePanel({
  org,
  orgId,
  orgName,
  row,
  current,
  callerIsOwner,
  error,
  onLoadFailed,
  ...rest
}: ChangeRolePanelProps) {
  // Kept across a refetch: an org resync (another tab switched the org) drops the roles query, and the dialog must
  // not be rebuilt, losing the picked card, while they load again. The panel lives inside one org's page (the page
  // is keyed on the org), so the kept roles are always this org's.
  const roles = useQuery({ ...inviteRolesQuery(org, orgId), placeholderData: keepPreviousData });
  // A failed refresh behind cards already read keeps the dialog: its Save ends in the Banner for a 403.
  const failure = roles.data === undefined ? roles.error : null;
  useEffect(() => {
    if (failure !== null) onLoadFailed(failure);
  }, [failure, onLoadFailed]);
  if (roles.data === undefined) return null;
  return (
    <ChangeRoleDialog
      memberName={row.name}
      orgName={orgName}
      options={roleCards(roles.data, callerIsOwner)}
      current={current}
      self={row.you}
      currentIsOwner={row.role?.key === 'owner'}
      {...(error && { error })}
      {...rest}
    />
  );
}
