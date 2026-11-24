import { Button, IconButton, LabelChip, Popover } from '@/ds';
import type { ProjectMemberRowView } from '@/mocks/types';
import type { DataTableColumn } from './DataTable';
import { useRowMenu } from './useRowMenu';
import styles from './ProjectMemberRow.module.css';

export interface ProjectMemberRowProps {
  row: ProjectMemberRowView;
  /** A row action is in flight: the menu is disabled. */
  busy?: boolean;
  onChangeRole: (row: ProjectMemberRowView) => void;
  onRemove: (row: ProjectMemberRowView) => void;
}

export const projectMemberColumns: DataTableColumn[] = [
  { key: 'name', header: 'Name' },
  { key: 'roles', header: 'Role' },
  { key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right' },
];

/**
 * One row of a project's Members table: name and handle, the project roles, the org-wide roles labelled Organization,
 * and the row menu. An inherited row (org-wide role only) has no menu: it is managed in the org's Members. Text only.
 */
export function ProjectMemberRow({ row, busy, onChangeRole, onRemove }: ProjectMemberRowProps) {
  const { menuAt, open, moreRef, toggleMenu, closeMenu } = useRowMenu();
  const pick = (action: (r: ProjectMemberRowView) => void) => () => {
    closeMenu();
    action(row);
  };
  const label = `Actions for ${row.name}`;

  return (
    <tr>
      <td className={styles.nameCell}>
        <span className={styles.name}>
          <span className={styles.nameText} title={row.name}>
            {row.name}
          </span>
          {row.handle !== null && <span className={styles.handle}>{row.handle}</span>}
          {row.you && <LabelChip name="You" />}
        </span>
      </td>
      <td className={styles.cell}>
        {row.roles}
        {row.orgRoles !== '' && (
          <span className={[styles.orgRoles, row.roles !== '' && styles.afterRoles].filter(Boolean).join(' ')}>
            {row.orgRoles}
            <LabelChip name="Organization" tone="idle" />
          </span>
        )}
      </td>
      <td className={styles.actionsCell}>
        {!row.you && !row.inherited && (
          <span ref={moreRef}>
            <IconButton
              icon="more"
              aria-label={label}
              aria-haspopup="dialog"
              aria-expanded={open}
              disabled={busy}
              onClick={toggleMenu}
            />
            <Popover
              open={open}
              label={label}
              onClose={closeMenu}
              style={{ position: 'fixed', top: menuAt?.top, right: menuAt?.right, padding: 6, gap: 2 }}
            >
              <Button variant="ghost" size="sm" className={styles.menuAction} onClick={pick(onChangeRole)}>
                Change role
              </Button>
              <Button variant="danger" size="sm" className={styles.menuAction} onClick={pick(onRemove)}>
                Remove from project
              </Button>
            </Popover>
          </span>
        )}
      </td>
    </tr>
  );
}
