import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CreateAssignmentRequest, PlatformRoleDto } from '@agentdesk/contracts';
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
import { toastFromError } from '@/app/boundaries';
import type { AssignmentDialogProps, AssignmentRoleKey } from '@/components';
import { useToast } from '@/ds';
import { fieldErrorsFromProblem } from '@/features/desk/problem';
import { toPlatformMemberRow } from '@/features/platform/map';
import { useAddPlatformAssignment, useRemovePlatformAssignment } from '@/features/platform/mutations';
import {
  platformOrgAllProjectsQuery,
  platformOrgMembersQuery,
  platformOrgRolesQuery,
} from '@/features/platform/queries';
import type { PlatformMemberAssignmentView, PlatformMemberRowView } from '@/mocks';
import { PlatformOrgMembers, type ListView, type PlatformOrgMembersProps } from '@/screens';

// The Members of one organization: names, emails and roles with scopes, its own `?page=N`. The row menu adds and
// removes assignments for platform admins. A 403 from a read (rights lost since) shows the shell's forbidden state.
// UI only: the API is the authority.
export const Route = createFileRoute('/platform/orgs/$orgId/members')({
  validateSearch: PageSearch,
  component: PlatformOrgMembersPage,
});

const ROLE_KEYS: readonly AssignmentRoleKey[] = ['owner', 'admin', 'member', 'viewer'];
/** The four built-in roles the dialog offers, in its order; any other role is not offered. */
function roleChoices(roles: PlatformRoleDto[]): AssignmentDialogProps['roles'] {
  return ROLE_KEYS.flatMap((key) => {
    const role = roles.find((r) => r.key === key);
    return role ? [{ key, label: role.name }] : [];
  });
}

const EMPTY_VALUES: AssignmentDialogProps['values'] = { access: 'org', roleKey: '', projectId: '' };
const REQUEST_FIELDS = { '/roleId': 'roleKey', '/scope/projectId': 'projectId' };

function PlatformOrgMembersPage() {
  const { orgId } = Route.useParams();
  const page = pageOfSearch(Route.useSearch());
  const navigate = useNavigate({ from: Route.fullPath });
  const [pageSize] = usePageSize();
  const toast = useToast();
  const list = useQuery(platformOrgMembersQuery(orgId, { page, pageSize }));
  const projects = useQuery(platformOrgAllProjectsQuery(orgId));
  const roles = useQuery(platformOrgRolesQuery(orgId));
  const add = useAddPlatformAssignment(orgId);
  const remove = useRemovePlatformAssignment(orgId);

  // The row a dialog is about is held as it was when the menu item was pressed.
  const [adding, setAdding] = useState<PlatformMemberRowView | null>(null);
  const [values, setValues] = useState(EMPTY_VALUES);
  const [errors, setErrors] = useState<AssignmentDialogProps['errors']>({});
  const [formError, setFormError] = useState<AssignmentDialogProps['formError']>();
  const [removing, setRemoving] = useState<{
    row: PlatformMemberRowView;
    assignment: PlatformMemberAssignmentView;
  } | null>(null);
  const [refocus, setRefocus] = useState(0);

  // After a remove the opener may be gone: focus moves to the page heading once the confirm has left.
  useEffect(() => {
    if (refocus > 0) document.querySelector<HTMLElement>('main h1')?.focus();
  }, [refocus]);

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

  // Only the members read fails the page: without project names the roles read "a project" and the dialog says so.
  const failed = list.isError ? list : undefined;
  let view: ListView<PlatformMemberRowView>;
  if ([list, projects, roles].some((q) => q.error instanceof ApiError && q.error.status === 403)) {
    throw [list, projects, roles].find((q) => q.error instanceof ApiError && q.error.status === 403)?.error;
  } else if (failed !== undefined) {
    const failure = failed.error;
    view = {
      kind: 'error',
      title: failure instanceof ApiError ? failure.title : 'Something went wrong',
      ...(failure instanceof ApiError && failure.requestId !== undefined && { requestId: failure.requestId }),
      onRetry: () => void Promise.all([list.refetch(), projects.refetch()]),
    };
  } else if (data === undefined || projects.isPending) {
    view = { kind: 'loading' };
  } else {
    const names = new Map((projects.data ?? []).map((p) => [p.id, p.name]));
    view = { kind: 'ready', rows: data.items.map((dto) => toPlatformMemberRow(dto, names)), pagination };
  }

  // The roles are read ahead; if they are not there when the menu item is pressed they are asked for again, and if
  // they cannot be read the dialog does not open.
  const openAdd = async (row: PlatformMemberRowView) => {
    if (roles.data === undefined) {
      const again = await roles.refetch();
      if (again.data === undefined) {
        toast.show(toastFromError(again.error));
        return;
      }
    }
    setValues(EMPTY_VALUES);
    setErrors({});
    setFormError(undefined);
    setAdding(row);
  };

  const submitAdd = async () => {
    if (adding === null || roles.data === undefined || add.isPending) return;
    const role = roles.data.find((r) => r.key === values.roleKey);
    const next: AssignmentDialogProps['errors'] = {};
    if (!role) next.roleKey = 'Choose a role.';
    if (values.access === 'project' && values.projectId === '') {
      next.projectId = projects.data === undefined ? 'Projects could not be loaded.' : 'Choose a project.';
    }
    setErrors(next);
    setFormError(undefined);
    if (!role || next.projectId !== undefined) return;
    const body: CreateAssignmentRequest = {
      userId: adding.userId,
      roleId: role.id,
      scope: values.access === 'org' ? { type: 'org' } : { type: 'project', projectId: values.projectId },
    };
    try {
      await add.mutateAsync(body);
      setAdding(null);
      toast.show({ tone: 'ok', title: 'Assignment added' });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setAdding(null);
        toast.show(toastFromError(e));
        return;
      }
      const problem = fieldErrorsFromProblem(e, REQUEST_FIELDS);
      setErrors({
        ...(problem.fields.roleKey !== undefined && { roleKey: problem.fields.roleKey }),
        ...(problem.fields.projectId !== undefined && { projectId: problem.fields.projectId }),
      });
      if (problem.form !== undefined) {
        setFormError({
          title: e instanceof ApiError ? e.title : problem.form,
          ...(e instanceof ApiError && e.requestId !== undefined && { requestId: e.requestId }),
        });
      }
    }
  };

  const confirmRemove = async () => {
    if (removing === null || remove.isPending) return;
    try {
      await remove.mutateAsync({ assignmentId: removing.assignment.assignmentId });
      setRemoving(null);
      setRefocus((n) => n + 1);
      toast.show({ tone: 'ok', title: 'Assignment removed' });
    } catch (e) {
      // Every refusal closes the confirm: the list was fetched again behind it.
      setRemoving(null);
      toast.show(toastFromError(e));
    }
  };

  const busyUserId = add.isPending ? adding?.userId : remove.isPending ? removing?.row.userId : undefined;
  const assignmentDialog: AssignmentDialogProps | undefined =
    adding !== null && roles.data !== undefined
      ? {
          open: true,
          person: { name: adding.name, handle: adding.handle },
          roles: roleChoices(roles.data),
          projects: projects.data ?? [],
          values,
          errors,
          saving: add.isPending,
          ...(formError !== undefined && { formError }),
          onChange: (v) => {
            setValues(v);
            setErrors({});
            setFormError(undefined);
          },
          onSubmit: () => void submitAdd(),
          onClose: () => setAdding(null),
        }
      : undefined;
  const removeConfirm: PlatformOrgMembersProps['removeConfirm'] =
    removing === null
      ? undefined
      : {
          roleLabel: removing.assignment.label,
          personName: removing.row.name ?? removing.row.handle ?? removing.row.email,
          busy: remove.isPending,
          onConfirm: () => void confirmRemove(),
          onCancel: () => {
            if (!remove.isPending) setRemoving(null);
          },
        };

  return (
    <PlatformOrgMembers
      view={view}
      {...(busyUserId !== undefined && { busyUserId })}
      onAdd={(row) => void openAdd(row)}
      onRemove={(row, assignment) => setRemoving({ row, assignment })}
      {...(removeConfirm && { removeConfirm })}
      {...(assignmentDialog && { assignmentDialog })}
    />
  );
}
