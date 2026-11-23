import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { ProjectMemberDto } from '@agentdesk/contracts';
import { useEffect, useState } from 'react';
import { AddProjectMemberDialog } from '@/components';
import type { MemberPickerOption, MemberPickerState } from '@/mocks/types';
import { inviteRolesQuery } from '../orgInvitations/queries';
import { useAddMemberForm } from './addForm';
import { PICKER_DEBOUNCE_MS, pickerQuery } from './picker';
import { projectRoleCards } from './roleCards';

const ROLES_FAILED = { title: 'Could not load the roles.', detail: 'Close the dialog and try again.' };

export interface AddMemberDialogProps {
  org: string;
  orgId: string;
  orgName: string;
  projectId: string;
  projectName: string;
  onAdded: (dto: ProjectMemberDto, roleName: string) => void;
  onCancel: () => void;
}

/**
 * The Add member dialog with its data: the picker's infinite list (read while this is mounted, so closing it stops the
 * reads), the role cards and the form. Mounted per open: every open starts empty.
 */
export function AddMemberDialog({
  org,
  orgId,
  orgName,
  projectId,
  projectName,
  onAdded,
  onCancel,
}: AddMemberDialogProps) {
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(text.trim()), PICKER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const list = useInfiniteQuery(pickerQuery(org, orgId, projectId, debounced));
  const roles = useQuery(inviteRolesQuery(org, orgId));
  const cards = projectRoleCards(roles.data ?? []);
  const form = useAddMemberForm(org, projectId, onAdded);

  const options: MemberPickerOption[] = (list.data?.pages ?? []).flatMap((p) =>
    p.items.map((m) => ({ userId: m.userId, name: m.name, handle: m.handle })),
  );
  const rolesError = roles.isError ? ROLES_FAILED : undefined;
  const retry = () => void (list.isFetchNextPageError ? list.fetchNextPage() : list.refetch());
  const catching = text.trim() !== debounced;
  let state: MemberPickerState = { kind: 'idle' };
  if (list.isError && list.data === undefined) state = { kind: 'error', onRetry: retry };
  else if (list.isPending) state = { kind: 'loading' };
  else if (list.isFetchNextPageError) state = { kind: 'loadMoreError', onRetry: retry };
  else if (list.isFetchingNextPage) state = { kind: 'loadingMore' };
  else if (list.isPlaceholderData || catching) state = { kind: 'searching' };

  return (
    <AddProjectMemberDialog
      projectName={projectName}
      orgName={orgName}
      picker={{
        query: text,
        onQueryChange: (q) => {
          // Editing the field after a pick leaves no person picked: the field must match what is submitted.
          if (form.picked) form.pick(null);
          setText(q);
        },
        options,
        total: list.data?.pages[0]?.total ?? 0,
        hasMore: list.hasNextPage,
        state,
        picked: form.picked,
        onPick: (o) => {
          form.pick(o);
          // The field now shows the person; the next search starts from an empty box.
          setText('');
          setDebounced('');
        },
        onLoadMore: () => void list.fetchNextPage(),
      }}
      roles={cards}
      roleId={form.roleId === '' ? null : form.roleId}
      onRoleChange={form.setRole}
      errors={form.errors}
      {...((form.formError ?? rolesError) && { formError: form.formError ?? rolesError })}
      saving={form.saving}
      // Nothing is sent until the role cards are there.
      onSubmit={() => roles.isSuccess && void form.submit((id) => cards.find((c) => c.roleId === id)?.name ?? '')}
      onCancel={onCancel}
    />
  );
}
