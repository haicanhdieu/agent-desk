import { useEffect, useRef, type ReactNode, type Ref } from 'react';
import { Button, Dialog, Skeleton, Toast, ToastRegion } from '@/ds';
import {
  DataTable,
  EmptyState,
  Pagination,
  ProjectMemberRow,
  projectMemberColumns,
  RouteLoadError,
  type PaginationProps,
} from '@/components';
import type { ProjectMemberRowView } from '@/mocks/types';
import styles from './Screens.module.css';
import { DeskFrame, type DeskFrameData } from './DeskFrame';

export interface DeskMembersProps {
  /** Top bar and Desk navigation data. */
  frame: DeskFrameData;
  orgName: string;
  projectName: string;
  state:
    | { kind: 'loading' }
    | { kind: 'error'; requestId?: string; onRetry: () => void }
    | { kind: 'ready'; rows: ProjectMemberRowView[]; busyUserId: string | null; pagination?: PaginationProps };
  onAdd: () => void;
  onInvite: () => void;
  onChangeRole: (row: ProjectMemberRowView) => void;
  onRemove: (row: ProjectMemberRowView) => void;
  headingRef?: Ref<HTMLHeadingElement>;
  /** Stories only: render this person's row menu open. */
  openMenuUserId?: string;
  /** The outcome of the last action, shown as a dismissible toast. */
  notice?: { tone: 'ok' | 'error'; title: string; onDismiss: () => void };
  /** The remove confirm. While its request is in flight (`busy`) it cannot be closed or repeated. */
  removeConfirm?: {
    memberName: string;
    projectName: string;
    orgName: string;
    busy?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  };
  /** The dialogs of the page. */
  children?: ReactNode;
}

const noop = () => {};

/** The project's Members page inside the Desk: who can reach the project (project roles and inherited org roles), the row actions, and the states around it. */
export function DeskMembers({
  frame,
  orgName,
  state,
  onAdd,
  onInvite,
  onChangeRole,
  onRemove,
  headingRef,
  openMenuUserId,
  notice,
  removeConfirm,
  children,
}: DeskMembersProps) {
  const tableRef = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  const menuRow = state.kind === 'ready' ? openMenuUserId : undefined;
  useEffect(() => {
    if (!menuRow || opened.current) return;
    const name = state.kind === 'ready' ? state.rows.find((r) => r.userId === menuRow)?.name : undefined;
    const button = [...(tableRef.current?.querySelectorAll('button') ?? [])].find(
      (b) => b.getAttribute('aria-label') === `Actions for ${name}`,
    );
    if (!button) return;
    opened.current = true;
    button.click();
  }, [menuRow, state]);

  return (
    <DeskFrame {...frame} active="members">
      <main className={styles.listMain}>
        {state.kind === 'loading' && (
          <div className={styles.membersLoading} aria-busy="true" role="status" aria-label="Loading">
            <span aria-hidden="true">
              <Skeleton variant="block" height={28} width={160} />
            </span>
            <span className={styles.membersLoadingRows} aria-hidden="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} variant="block" height={30} width="100%" />
              ))}
            </span>
          </div>
        )}
        {state.kind === 'error' && (
          <RouteLoadError title="Internal server error" requestId={state.requestId} onRetry={state.onRetry} />
        )}
        {state.kind === 'ready' && (
          <>
            <div className={styles.listHead}>
              <h1 ref={headingRef} tabIndex={-1}>
                Members
              </h1>
              <div className={styles.listHeadActions}>
                <Button onClick={onInvite}>Invite people</Button>
                {state.rows.length > 0 && (
                  <Button variant="primary" onClick={onAdd}>
                    Add member
                  </Button>
                )}
              </div>
            </div>
            <p className="muted">
              People with access to this project. A role in {orgName} also applies here. Those people are labelled
              Organization and are managed in {orgName} Settings, Members.
            </p>
            <div ref={tableRef}>
              <DataTable columns={projectMemberColumns} busy={state.pagination?.busy}>
                {state.rows.map((row) => (
                  <ProjectMemberRow
                    key={row.userId}
                    row={row}
                    busy={state.busyUserId === row.userId}
                    onChangeRole={onChangeRole}
                    onRemove={onRemove}
                  />
                ))}
              </DataTable>
            </div>
            {state.rows.length === 0 && (
              <EmptyState
                headingLevel={2}
                title="No project roles yet"
                body={`Add a member of ${orgName} to give them a role on this project.`}
                action={
                  <Button variant="primary" onClick={onAdd}>
                    Add member
                  </Button>
                }
              />
            )}
            {state.pagination && <Pagination {...state.pagination} />}
          </>
        )}
      </main>
      {children}
      {removeConfirm && (
        <Dialog
          open
          title={`Remove ${removeConfirm.memberName} from ${removeConfirm.projectName}?`}
          width={440}
          onClose={removeConfirm.busy ? noop : removeConfirm.onCancel}
          footer={
            <>
              <Button variant="ghost" disabled={removeConfirm.busy === true} onClick={removeConfirm.onCancel}>
                Cancel
              </Button>
              <Button
                variant="solid-danger"
                disabled={removeConfirm.busy === true}
                aria-busy={removeConfirm.busy === true}
                onClick={removeConfirm.onConfirm}
              >
                {removeConfirm.busy ? 'Removing…' : 'Remove'}
              </Button>
            </>
          }
        >
          <p className="muted">
            They lose their role on this project. A role they hold in {removeConfirm.orgName} stays.
          </p>
        </Dialog>
      )}
      {notice && (
        <ToastRegion>
          <Toast
            tone={notice.tone === 'ok' ? 'ok' : 'err'}
            role="status"
            title={notice.title}
            onDismiss={notice.onDismiss}
          />
        </ToastRegion>
      )}
    </DeskFrame>
  );
}
