import { useEffect, useRef, useState } from 'react';
import { ChangeRoleDialog, InviteDialog, type ChangeRoleDialogProps } from '@/components';
import { useToast } from '@/ds';
import { keepPreviousData, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { ApiError, isOrgMismatchError } from '@agentdesk/contracts/client';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  PageSearch,
  pageOfSearch,
  pageToSearch,
  useClampToLastPage,
  usePageSize,
  usePaginationProps,
} from '@/app/pagination';
import { toastFromError } from '@/app/boundaries';
import { requireProjectPermission } from '@/features/access/guards';
import { ORG_SWITCHED_MESSAGE } from '@/features/auth/orgResync';
import { orgsQuery, sessionQuery } from '@/features/auth/session';
import { formatShortDate } from '@/features/invitations/dates';
import { copyText, invitationUrl } from '@/features/orgInvitations/link';
import { projectRoleOptions, useInviteForm } from '@/features/orgInvitations/inviteForm';
import { inviteRolesQuery } from '@/features/orgInvitations/queries';
import { useDeskFrame } from '@/features/desk/frame';
import { AddMemberDialog } from '@/features/projectMembers/AddMemberDialog';
import { toProjectMemberRow } from '@/features/projectMembers/map';
import { useRemoveProjectMember, useSetProjectRole } from '@/features/projectMembers/mutations';
import { projectMembersQuery } from '@/features/projectMembers/queries';
import { projectRoleCards } from '@/features/projectMembers/roleCards';
import type { ProjectMemberRowView } from '@/mocks/types';
import { useNow } from '@/app/useNow';
import { DeskMembers, type DeskMembersProps } from '@/screens';

export const Route = createFileRoute('/o/$org/p/$project/desk/members')({
  staticData: { chrome: { mode: 'standard', scope: 'project', item: 'projectMembers', crumb: 'Members' } },
  // The page needs `assignment:read` on this project; the guard runs before any loader, so a refused route fetches nothing.
  beforeLoad: ({ context: { queryClient }, params }) =>
    requireProjectPermission(queryClient, params.org, 'assignment:read', params.project),
  validateSearch: PageSearch,
  component: DeskMembersPage,
});

const GONE = 'Member is no longer on this project';
const COPY_FAILED = 'Could not copy. Select the link and copy it.';
const LOAD_FAILED = 'Could not load the roles. Close the dialog and try again.';

const findAddButton = () =>
  [...document.querySelectorAll<HTMLButtonElement>('main button')].find((b) => b.textContent === 'Add member');

/**
 * The Members page's data and wiring: the frame, the list query and the screen state, with Add, Invite, Change role and Remove.
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
  const { data: orgs } = useSuspenseQuery(orgsQuery);
  const orgId = orgs.find((o) => o.slug === org)?.id;
  const [adding, setAdding] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState<{ title: string } | null>(null);
  const toast = useToast();
  const queryClient = useQueryClient();
  // The role cards are read ahead (as the org Members page does), so Change role opens at once.
  useEffect(() => {
    if (orgId !== undefined) void queryClient.prefetchQuery(inviteRolesQuery(org, orgId));
  }, [queryClient, org, orgId]);
  // The row a dialog is about is held as it was when its menu button was pressed, so a refetch behind an open dialog
  // never swaps the person (or the preselected role) under it.
  const [changing, setChanging] = useState<{ row: ProjectMemberRowView; current: string | null } | null>(null);
  const [changeError, setChangeError] = useState<ChangeRoleDialogProps['error']>();
  const [removing, setRemoving] = useState<ProjectMemberRowView | null>(null);
  const setRole = useSetProjectRole(org, projectId);
  const removeMember = useRemoveProjectMember(org, projectId);
  // Set synchronously before the request: two quick clicks send one request.
  const inFlight = useRef(false);
  const refocusHeading = useRef(false);
  const refocusAdd = useRef(false);
  // After a remove the opener is gone: focus goes to the page heading once the confirm has left the page.
  useEffect(() => {
    if (removing !== null || !refocusHeading.current) return;
    refocusHeading.current = false;
    document.querySelector<HTMLElement>('main h1')?.focus();
  }, [removing]);
  // After a successful add the dialog is gone: focus goes back to "Add member".
  useEffect(() => {
    if (adding || !refocusAdd.current) return;
    refocusAdd.current = false;
    findAddButton()?.focus();
  }, [adding]);

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

  const openChangeRole = (row: ProjectMemberRowView) => {
    const roles = data?.items.find((m) => m.userId === row.userId)?.projectRoles ?? [];
    // One role is preselected; a person holding several starts with no card picked.
    setChangeError(undefined);
    setChanging({ row, current: roles.length === 1 ? (roles[0]?.role.id ?? null) : null });
  };

  const onSaveRole = async (roleId: string | null) => {
    if (changing === null || roleId === null || inFlight.current) return;
    inFlight.current = true;
    setChangeError(undefined);
    try {
      await setRole.mutateAsync({ userId: changing.row.userId, roleId });
      setChanging(null);
      setNotice({ title: 'Role changed' });
    } catch (e) {
      if (isOrgMismatchError(e)) {
        toast.show(toastFromError(e)); // the choice stays; a second press tries again
      } else if (e instanceof ApiError && e.status === 404) {
        setChanging(null);
        toast.show({ tone: 'err', title: GONE });
      } else if (e instanceof ApiError && e.status === 403) {
        setChangeError({ kind: 'forbidden', ...(e.requestId !== undefined && { requestId: e.requestId }) });
      } else {
        toast.show(toastFromError(e));
      }
    } finally {
      inFlight.current = false;
    }
  };

  const onConfirmRemove = async () => {
    if (removing === null || inFlight.current) return;
    inFlight.current = true;
    try {
      await removeMember.mutateAsync(removing.userId);
      refocusHeading.current = true;
      setRemoving(null);
      setNotice({ title: `${removing.name} removed from ${frame.project.name}` });
    } catch (e) {
      if (isOrgMismatchError(e)) {
        toast.show(toastFromError(e)); // the confirm stays; a second press tries again
      } else {
        refocusHeading.current = true;
        setRemoving(null);
        if (e instanceof ApiError && e.status === 404) toast.show({ tone: 'err', title: GONE });
        else if (e instanceof ApiError && e.status === 403) {
          toast.show({
            tone: 'err',
            title: "You don't have access",
            ...(e.requestId !== undefined && { detail: `Request ID: ${e.requestId}` }),
          });
        } else toast.show(toastFromError(e));
      }
    } finally {
      inFlight.current = false;
    }
  };

  const busyUserId = setRole.isPending
    ? (setRole.variables?.userId ?? null)
    : removeMember.isPending
      ? (removeMember.variables ?? null)
      : null;
  if (state.kind === 'ready') state = { ...state, busyUserId };

  return {
    frame,
    orgName: frame.org.current?.name ?? org,
    projectName: frame.project.name,
    state,
    onAdd: () => setAdding(true),
    onInvite: () => setInviting(true),
    onChangeRole: openChangeRole,
    onRemove: setRemoving,
    ...(removing && {
      removeConfirm: {
        memberName: removing.name,
        projectName: frame.project.name,
        orgName: frame.org.current?.name ?? org,
        busy: removeMember.isPending,
        onConfirm: () => void onConfirmRemove(),
        onCancel: () => {
          if (!removeMember.isPending) setRemoving(null);
        },
      },
    }),
    ...(notice && { notice: { tone: 'ok' as const, title: notice.title, onDismiss: () => setNotice(null) } }),
    children: (
      <>
        {adding && orgId !== undefined && (
          <AddMemberDialog
            org={org}
            orgId={orgId}
            orgName={frame.org.current?.name ?? org}
            projectId={projectId}
            projectName={frame.project.name}
            onAdded={(dto, roleName) => {
              refocusAdd.current = true;
              setNotice({ title: `${dto.name} added as ${roleName}` });
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        )}
        {changing && orgId !== undefined && (
          <ChangeRolePanel
            org={org}
            orgId={orgId}
            orgName={frame.org.current?.name ?? org}
            row={changing.row}
            current={changing.current}
            saving={setRole.isPending}
            error={changeError}
            onSave={(roleId) => void onSaveRole(roleId)}
            onCancel={() => {
              if (!setRole.isPending) setChanging(null);
            }}
            onLoadFailed={(e) => {
              toast.show(toastFromError(e));
              setChanging(null);
            }}
          />
        )}
        {inviting && orgId !== undefined && (
          <InviteToProject
            org={org}
            orgId={orgId}
            projectId={projectId}
            projectName={frame.project.name}
            onClose={() => setInviting(false)}
          />
        )}
      </>
    ),
  };
}

interface ChangeRolePanelProps {
  org: string;
  orgId: string;
  orgName: string;
  row: ProjectMemberRowView;
  current: string | null;
  saving: boolean;
  error: ChangeRoleDialogProps['error'];
  onSave: (roleId: string | null) => void;
  onCancel: () => void;
  onLoadFailed: (e: unknown) => void;
}

/** Mounted while the Change role dialog is wanted: loads the role cards (Admin, Member, Viewer), then shows the dialog. */
function ChangeRolePanel({
  org,
  orgId,
  orgName,
  row,
  current,
  error,
  onSave,
  onLoadFailed,
  ...rest
}: ChangeRolePanelProps) {
  // Kept across a refetch (an org resync drops the roles query): the dialog must not be rebuilt, losing the picked card.
  const roles = useQuery({ ...inviteRolesQuery(org, orgId), placeholderData: keepPreviousData });
  const failure = roles.data === undefined ? roles.error : null;
  useEffect(() => {
    if (failure !== null) onLoadFailed(failure);
  }, [failure, onLoadFailed]);
  if (roles.data === undefined) return null;
  return (
    <ChangeRoleDialog
      memberName={row.name}
      orgName={orgName}
      options={projectRoleCards(roles.data)}
      current={current}
      self={false}
      currentIsOwner={false}
      {...(error && { error })}
      {...rest}
      onSave={(change) => onSave(change.roleId)}
    />
  );
}

// Mounted only while the dialog is open: each opening starts from an empty form and loads the roles again.
function InviteToProject({
  org,
  orgId,
  projectId,
  projectName,
  onClose,
}: {
  org: string;
  orgId: string;
  projectId: string;
  projectName: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const roles = useQuery(inviteRolesQuery(org, orgId));
  const form = useInviteForm({
    org,
    projectsOnly: true,
    fixedProjectId: projectId,
    onOrgSwitched: () => toast.show({ tone: 'err', title: ORG_SWITCHED_MESSAGE }),
  });
  const { created } = form;
  const formError = form.formError ?? (roles.isError ? LOAD_FAILED : undefined);
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
              ...(formError !== undefined && { formError }),
              saving: form.saving,
            }
      }
      roles={projectRoleOptions(roles.data ?? [])}
      projects={[{ id: projectId, label: projectName }]}
      projectsOnly
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

function DeskMembersPage() {
  const { org, project: projectId } = Route.useParams();
  return <DeskMembers {...useDeskMembersState(org, projectId)} />;
}
