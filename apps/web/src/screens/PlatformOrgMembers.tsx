import { Button, Dialog } from '@/ds';
import {
  AssignmentDialog,
  DataTable,
  EmptyState,
  Pagination,
  PlatformMemberRow,
  RouteLoadError,
  platformMemberColumns,
  type AssignmentDialogProps,
  type PlatformMemberRowProps,
} from '@/components';
import type { PlatformMemberRowView } from '@/mocks';
import { TabLoading, type ListView } from './PlatformOrgProjects';

export interface PlatformOrgMembersProps {
  view: ListView<PlatformMemberRowView>;
  /** The row whose request is in flight: its menu is disabled. */
  busyUserId?: string;
  onAdd: PlatformMemberRowProps['onAdd'];
  onRemove: PlatformMemberRowProps['onRemove'];
  /** The remove confirm. While its request is in flight (`busy`) it cannot be closed or repeated. */
  removeConfirm?: {
    roleLabel: string;
    personName: string;
    busy: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  };
  assignmentDialog?: AssignmentDialogProps;
}

const noop = () => {};

/** The Members tab of a platform org detail: names, emails and roles with scopes. Text, never HTML. */
export function PlatformOrgMembers({
  view,
  busyUserId,
  onAdd,
  onRemove,
  removeConfirm,
  assignmentDialog,
}: PlatformOrgMembersProps) {
  return (
    <>
      {view.kind === 'loading' && <TabLoading />}
      {view.kind === 'error' && <RouteLoadError title={view.title} requestId={view.requestId} onRetry={view.onRetry} />}
      {view.kind === 'ready' && (
        <>
          <h2>Members</h2>
          <p className="muted">Platform view: names and emails only. Tickets, runs and secrets are never shown here.</p>
          {view.rows.length === 0 ? (
            <EmptyState title="No members" />
          ) : (
            <>
              <DataTable columns={platformMemberColumns} busy={view.busy ?? view.pagination.busy}>
                {view.rows.map((row) => (
                  <PlatformMemberRow
                    key={row.userId}
                    row={row}
                    busy={busyUserId === row.userId}
                    onAdd={onAdd}
                    onRemove={onRemove}
                  />
                ))}
              </DataTable>
              <Pagination {...view.pagination} />
            </>
          )}
        </>
      )}
      {assignmentDialog && <AssignmentDialog {...assignmentDialog} />}
      {removeConfirm && (
        <Dialog
          open
          title={`Remove ${removeConfirm.roleLabel} from ${removeConfirm.personName}?`}
          width={440}
          onClose={removeConfirm.busy ? noop : removeConfirm.onCancel}
          footer={
            <>
              <Button variant="ghost" disabled={removeConfirm.busy} onClick={removeConfirm.onCancel}>
                Cancel
              </Button>
              <Button
                variant="solid-danger"
                disabled={removeConfirm.busy}
                aria-busy={removeConfirm.busy}
                onClick={removeConfirm.onConfirm}
              >
                {removeConfirm.busy ? 'Removing…' : 'Remove'}
              </Button>
            </>
          }
        />
      )}
    </>
  );
}
